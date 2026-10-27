import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api, fetchResource } from './api';
import { bitrateBits, captureDimensions, qualityForSource, senderScale, shareOptionsFor } from './media-quality';
import type { ShareFps, ShareHeight } from './media-quality';
import { createMicrophonePipeline, normalizeAudioSettings, microphoneCaptureConstraints, type SuppressionStatus } from './audio-pipeline';
import { audioBitrate, isCaptureCancellation, matchesShortcut, missingAudioDevice, releasesShortcut, voiceDescription } from './audio-policy';
import { adaptCongestion, defaultRuntimePreferences, effectiveSharePreferences, initialCongestion, normalizeRuntimePreferences, statisticsInterval, type RuntimePreferences, type CongestionState } from './runtime-policy';
import { subscribeConnectionReports } from './connection-stats';
import { useAppActivity } from './app-activity';
import { readMediaPreference, saveMediaPreference } from './media-persistence';
import { normalizeLocalShortcut, shortcutTypesText } from './shortcuts';
import { restoreAudioDevices } from './media-devices';
import { createInputMonitor } from './input-monitor';
import { createInputMeter } from './input-meter';
import { createScreenTransport } from './screen-transport';
import { soundboardService } from './soundboard-service';
import { createCandidateRouter, iceUfrags } from './ice-candidates';
import { createVoiceDiagnostics, type VoiceDiagnosticType } from './voice-diagnostics';
import { readPreferences } from './preferences';
import type { User } from '@haven/shared/types';
export interface MediaUser {
  id: string;
  name?: string;
  displayName?: string;
  username?: string;
  color?: string;
  avatar?: string | null;
  status?: string;
}

export interface VoiceState { muted: boolean; deafened: boolean; sharing: boolean; speaking?: boolean; serverMuted?: boolean; serverDeafened?: boolean; streamProtocol?: number; broadcastId?: string }
export interface MediaPeer {
  socketId: string;
  user: MediaUser;
  stream: MediaStream | null;
  state: VoiceState;
  volume: number;
  streamVolume?: number;
  localMuted?: boolean;
  connectionState?: RTCPeerConnectionState;
  connectionError?: string;
}
export interface MediaSettings extends RuntimePreferences {
  inputDevice: string;
  outputDevice: string;
  inputDeviceLabel: string;
  outputDeviceLabel: string;
  noiseSuppression: boolean;
  noiseSuppressionMode: 'standard' | 'enhanced';
  echoCancellation: boolean;
  pushToTalk: boolean;
  inputVolume: number;
  outputVolume: number;
  inputSensitivity: number;
  pushToTalkKey: string;
  gamingMode: boolean;
  soundboardVolume: number;
  soundboardMuted: boolean;
}
export interface VideoStatistics {
  socketId: string;
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  packetsLost: number | null;
  jitter: number | null;
  qualityLimitationReason?: string;
}
export interface ShareQuality {
  nativeWidth: number;
  nativeHeight: number;
  width: number;
  height: number;
  fps: ShareFps;
  bitrateMbps: number;
  stats: { outbound: VideoStatistics[]; inbound: VideoStatistics[] };
}
interface PeerConnection {
  connection: RTCPeerConnection;
  peer: MediaPeer;
  audio: Map<string, HTMLAudioElement>;
  makingOffer: boolean;
  ignoreOffer: boolean;
  answering: boolean;
  candidates: ReturnType<typeof createCandidateRouter>;
  screenSenders: RTCRtpSender[];
  screenTransport?: ReturnType<typeof createScreenTransport>;
  screenCapable: boolean;
  voiceTransceiver?: RTCRtpTransceiver;
  screenAudioTracks: Set<string>;
  watchTimer?: ReturnType<typeof setTimeout>;
  receivedBroadcastId?: string;
  offerOnInitialNegotiation: boolean;
  signalQueue: Promise<void>;
  videoTracks: Map<string, MediaStreamTrack>;
  restartTimer?: ReturnType<typeof setTimeout>;
  restartAttempts: number;
  /** First connection attempt with this peer; kept when the connection pair is replaced. */
  startedAt: number;
  /** Start of the current ICE checking phase (connection, local or remote ICE restart). */
  checkingSince: number;
  checkingTimer?: ReturnType<typeof setTimeout>;
  remoteRestartAt: number;
  everConnected: boolean;
  /** The remote client can replace the connection pair on a `reset` signal. */
  resettable: boolean;
  congested: boolean;
  congestion?: CongestionState;
}
interface PeerPresence { resumed?: boolean; entrySound?: boolean; signaling?: number }
interface Signal {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  reset?: boolean;
}
const initialSettings: MediaSettings = {
  ...defaultRuntimePreferences,
  inputDevice: '', outputDevice: '', inputDeviceLabel: '', outputDeviceLabel: '', noiseSuppression: true, noiseSuppressionMode: 'standard', echoCancellation: true, pushToTalk: false,
  inputVolume: 1, outputVolume: 1, inputSensitivity: -45,
  pushToTalkKey: 'Control+Shift+Space', gamingMode: false,
  soundboardVolume: 1, soundboardMuted: false,
};
/** ICE that has not connected by now is treated as failed: a lost candidate or description can leave it checking forever. */
const iceCheckingLimit = 12_000;
const maxIceRestarts = 5;
/** A dropped connection that resumes within this window is a reconnection, not a leave. */
const leaveCueGraceMs = 5000;
function randomId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID requires a secure context; getRandomValues does not.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
}
const initialQuality: ShareQuality = {
  nativeWidth: 0, nativeHeight: 0, width: 0, height: 0, fps: 60, bitrateMbps: 8,
  stats: { outbound: [], inbound: [] },
};

function readSettings(): { settings: MediaSettings; error: string | null } {
  try {
    const saved: unknown = JSON.parse(readMediaPreference('haven.media.settings') ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid saved media settings');
    const values = saved as Record<string, unknown>;
    const next = { ...initialSettings };
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(initialSettings, key) || (key !== 'shareHeight' && typeof value !== typeof initialSettings[key as keyof MediaSettings])) throw new Error(`Invalid saved media setting: ${key}`);
    }
    for (const [key, min, max] of [['inputVolume', 0, 2], ['outputVolume', 0, 1], ['soundboardVolume', 0, 1], ['inputSensitivity', -60, -10], ['voiceBitrateKbps', 24, 64], ['shareBitrateMbps', 1, 50]] as const) {
      if (key in values && !(typeof values[key] === 'number' && Number.isFinite(values[key]) && values[key] >= min && values[key] <= max)) throw new Error(`Invalid saved media setting: ${key}`);
    }
    if ('pushToTalkKey' in values) normalizeLocalShortcut(values.pushToTalkKey as string);
    if ('noiseSuppressionMode' in values && !['standard', 'enhanced'].includes(values.noiseSuppressionMode as string)) throw new Error('Invalid suppression mode');
    if ('shareFps' in values && ![15, 30, 60].includes(values.shareFps as number)) throw new Error('Invalid share frame rate');
    if ('shareHeight' in values && values.shareHeight !== 'native' && !(typeof values.shareHeight === 'number' && Number.isInteger(values.shareHeight) && values.shareHeight > 0 && values.shareHeight <= 8640)) throw new Error('Invalid share height');
    if (values.noiseSuppressionMode === 'enhanced') next.noiseSuppressionMode = 'enhanced';
    for (const key of ['inputDevice', 'outputDevice', 'inputDeviceLabel', 'outputDeviceLabel', 'pushToTalkKey'] as const) if (typeof values[key] === 'string') next[key] = values[key];
    for (const key of ['noiseSuppression', 'echoCancellation', 'pushToTalk', 'gamingMode', 'soundboardMuted'] as const) if (typeof values[key] === 'boolean') next[key] = values[key];
    for (const key of ['inputVolume', 'outputVolume', 'soundboardVolume', 'inputSensitivity'] as const) if (typeof values[key] === 'number') next[key] = values[key];
    Object.assign(next, normalizeAudioSettings(next));
    Object.assign(next, normalizeRuntimePreferences(values));
    return { settings: next, error: null };
  } catch (error) { return { settings: { ...initialSettings, pushToTalk: true }, error: `Could not restore audio settings. Microphone is blocked until settings are saved: ${error instanceof Error ? error.message : error}` }; }
}

function readVoiceState(): VoiceState & { persistenceError?: string } {
  try {
    const saved = JSON.parse(readMediaPreference('haven.voice.state') ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.entries(saved).some(([key, value]) => !['muted', 'deafened'].includes(key) || typeof value !== 'boolean')) throw new Error('Invalid voice settings');
    return { muted: saved.muted === true, deafened: saved.deafened === true, sharing: false };
  } catch (error) { return { muted: true, deafened: true, sharing: false, persistenceError: `Could not restore mute/deafen settings. Microphone is blocked: ${error instanceof Error ? error.message : error}` }; }
}

export function useMedia(socket: Socket | null, currentUserId: string, reportError: (message: string) => void, currentUser?: User | null) {
  const accountRef = useRef(currentUser);
  accountRef.current = currentUser;
  const [initialVoice] = useState(readVoiceState);
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [peers, setPeers] = useState<MediaPeer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(initialVoice.muted);
  const [deafened, setDeafened] = useState(initialVoice.deafened);
  const [sharing, setSharing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>('disconnected');
  const [microphoneProcessing, setMicrophoneProcessing] = useState<SuppressionStatus>('off');
  const [testProcessing, setTestProcessing] = useState<SuppressionStatus>('off');
  const [micTest, updateMicTest] = useState<{ status: 'idle' | 'starting' | 'running' | 'error'; level: number; speaking: boolean; error: string | null }>({ status: 'idle', level: 0, speaking: false, error: null });
  const [loadedSettings] = useState(readSettings);
  const [settings, updateSettings] = useState<MediaSettings>(loadedSettings.settings);
  const [persistenceError, setPersistenceError] = useState<string | null>(loadedSettings.error || initialVoice.persistenceError || null);
  const persistenceBlocked = useRef(Boolean(loadedSettings.error || initialVoice.persistenceError));
  const settingsEdited = useRef(false);
  const [inputMeter] = useState(createInputMeter);
  const inputMonitorRef = useRef<ReturnType<typeof createInputMonitor> | null>(null);
  const lastInputSampleTime = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const background = !useAppActivity();
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const [videoDetailsOpen, setVideoDetailsOpen] = useState(false);
  const [quality, updateQuality] = useState<ShareQuality>(initialQuality);
  const records = useRef(new Map<string, PeerConnection>());
  const connectionStatsSources = useCallback(() => Array.from(records.current.values(), record => ({
    socketId: record.peer.socketId,
    name: record.peer.user.displayName || record.peer.user.name || record.peer.user.username || 'Peer',
    connection: record.connection,
  })), []);
  const pendingSignals = useRef(new Map<string, Signal[]>());
  const microphone = useRef<MediaStream | null>(null);
  const screen = useRef<MediaStream | null>(null);
  const streamSubscribers = useRef<Set<string>>(new Set());
  const activeWatchedStreams = useRef<Set<string>>(new Set());
  const [watchingStreams, setWatchingStreams] = useState<string[]>([]);
  // Broadcast IDs survive a transport reconnect, but never a stop/restart of capture.
  const wantedBroadcasts = useRef(new Map<string, string>());
  const watchRequests = useRef(new Map<string, object>());
  const streamErrors = useRef(new Map<string, string>());
  const streamProtocol = useRef(false);
  const screenSourceSize = useRef<{ trackId: string; width: number; height: number } | null>(null);
  const mixer = useRef<AudioContext | null>(null);
  const destination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const microphonePipeline = useRef<ReturnType<typeof createMicrophonePipeline> | null>(null);
  const testGeneration = useRef(0);
  const testDesired = useRef(false);
  const testResources = useRef<{ stream: MediaStream; context?: AudioContext; pipeline?: ReturnType<typeof createMicrophonePipeline>; audio?: HTMLAudioElement; output?: MediaStreamAudioDestinationNode } | null>(null);
  const room = useRef<string | null>(null);
  const reconnectRoom = useRef<string | null>(null);
  const generation = useRef(0);
  const screenGeneration = useRef(0);
  const inputGeneration = useRef(0);
  const state = useRef<VoiceState>(initialVoice);
  const settingsRef = useRef(settings);
  const qualityRef = useRef(quality);
  const qualityHeight = useRef<ShareHeight>('native');
  const qualityQueue = useRef<Promise<void>>(Promise.resolve());
  const pushHeld = useRef(false);
  const errorRef = useRef(reportError);
  const iceServers = useRef<RTCIceServer[]>([]);
  const iceRefreshTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const byteSamples = useRef(new Map<string, { bytes: number; timestamp: number }>());
  const sounds = useRef(new Set<AudioBufferSourceNode>());
  const soundMonitors = useRef(new Set<GainNode>());
  const voiceSocket = useRef(socket);
  const globalPtt = useRef(false);
  const desktopPttKey = useRef<string | null>(null);
  const desktopSettings = useRef<{ canConfigure: boolean; gamingMode: boolean } | null>(null);
  const recordingShortcut = useRef(false);
  const roomServerId = useRef<string | null>(null);
  const localPreferences = useRef(new Map<string, { volume: number; muted: boolean }>());
  const moderationRef = useRef({ muted: false, deafened: false });
  const [moderation, setModeration] = useState(moderationRef.current);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  // Private key of this voice session, presented again on reconnection so the server retires the stale socket.
  const voiceSession = useRef<string | null>(null);
  const leaveCueTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const leaveCued = useRef(new Set<string>());
  const audioSamples = useRef(new Map<string, number>());
  const soundboardPreviousVolume = useRef(settings.soundboardVolume > 0 ? settings.soundboardVolume : 1);
  const [diagnostics] = useState(() => createVoiceDiagnostics(report => {
    if (room.current && voiceSocket.current?.connected) voiceSocket.current.emit('voice:diagnostic', report);
  }));
  errorRef.current = reportError;
  settingsRef.current = settings;
  qualityRef.current = quality;
  voiceSocket.current = socket;

  if (!inputMonitorRef.current) inputMonitorRef.current = createInputMonitor({
    canStart: () => !room.current && !testDesired.current,
    capture: () => navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false }),
    createContext: () => new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 }),
    createPipeline: (context, stream, output) => createMicrophonePipeline(
      context, stream, output, () => ({ ...settingsRef.current, pushToTalk: false }), () => true,
      level => { if (!backgroundRef.current) inputMeter.publish(level); },
    ),
  });

  function fail(error: unknown, fallback: string) {
    errorRef.current(error instanceof Error ? `${fallback}: ${error.message}` : fallback);
  }
  function refreshPeers() {
    setPeers(Array.from(records.current.values(), record => ({ ...record.peer })));
  }
  useEffect(() => { if (!currentUserId) localPreferences.current.clear(); }, [currentUserId]);
  function emitState() {
    if (room.current) voiceSocket.current?.emit('voice:state', state.current);
  }
  function updateSpeaking(next: boolean) {
    if (Boolean(state.current.speaking) === next) return;
    state.current.speaking = next;
    if (!backgroundRef.current) setSpeaking(next);
    if (room.current) voiceSocket.current?.emit('voice:activity', { speaking: next });
  }
  function microphoneEnabled() {
    return !persistenceBlocked.current && !recordingShortcut.current && !state.current.muted && !state.current.deafened && !moderationRef.current.muted && !moderationRef.current.deafened && (!settingsRef.current.pushToTalk || pushHeld.current);
  }
  function remoteAudioMuted(peer: MediaPeer, screenAudio = false) {
    return state.current.deafened || moderationRef.current.deafened || Boolean(peer.localMuted || peer.state.serverMuted || peer.state.serverDeafened)
      || (screenAudio && !activeWatchedStreams.current.has(peer.socketId));
  }
  function applyPeerAudio(record: PeerConnection) {
    record.audio.forEach((audio, trackId) => {
      const screenAudio = record.screenAudioTracks.has(trackId);
      audio.muted = remoteAudioMuted(record.peer, screenAudio);
      audio.volume = Math.max(0, Math.min(1, record.peer.volume * (settingsRef.current.outputVolume ?? 1) * (screenAudio ? record.peer.streamVolume ?? 1 : 1)));
    });
  }
  function applyModeration(next: { muted: boolean; deafened: boolean }) {
    moderationRef.current = { muted: next.muted, deafened: next.deafened };
    setModeration(moderationRef.current);
    pushHeld.current = false;
    applyAudioState();
  }
  function applyAudioState() {
    const enabled = microphoneEnabled();
    destination.current?.stream.getAudioTracks().forEach(track => { track.enabled = enabled; });
    microphone.current?.getAudioTracks().forEach(track => { track.enabled = enabled; });
    if (!enabled) {
      updateSpeaking(false);
      inputMeter.publish(0);
    }
    microphonePipeline.current?.refresh();
    records.current.forEach(applyPeerAudio);
    soundboardService.updatePlaybackSettings({
      volume: settingsRef.current.soundboardVolume ?? 1,
      isMuted: Boolean(settingsRef.current.soundboardMuted || state.current.deafened || moderationRef.current.deafened),
      outputVolume: settingsRef.current.outputVolume ?? 1,
      outputDeviceId: settingsRef.current.outputDevice,
    });
    soundMonitors.current.forEach(monitor => { monitor.gain.value = state.current.deafened || moderationRef.current.deafened ? 0 : 1; });
  }
  async function ensureMixer() {
    if (!mixer.current || mixer.current.state === 'closed') {
      mixer.current = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      destination.current = mixer.current.createMediaStreamDestination();
      destination.current.channelCount = 1;
      const outputContext = mixer.current as AudioContext & { setSinkId?: (deviceId: string) => Promise<void> };
      if (settingsRef.current.outputDevice && outputContext.setSinkId) {
        void outputContext.setSinkId(settingsRef.current.outputDevice).catch(error => fail(error, 'Could not select soundboard speaker'));
      }
    }
    const context = mixer.current;
    if (context.state === 'suspended') await context.resume();
    return context;
  }
  async function enumerateDevices(recover = false) {
    try {
      const available = await navigator.mediaDevices.enumerateDevices();
      setDevices(available);
      setDeviceError(null);
      const restored = restoreAudioDevices(settingsRef.current, available);
      if (Object.keys(restored).length) setSettings(restored);
      if (!recover || (!available.some(device => device.kind === 'audioinput' && device.label) && !microphone.current && !testResources.current)) return;
      const next: Partial<MediaSettings> = {};
      if (missingAudioDevice(available, 'audioinput', settingsRef.current.inputDevice)) next.inputDevice = '';
      if (missingAudioDevice(available, 'audiooutput', settingsRef.current.outputDevice)) next.outputDevice = '';
      if (Object.keys(next).length) setSettings(next);
      else if (microphone.current && (room.current || reconnectRoom.current) && microphone.current.getAudioTracks().some(track => track.readyState === 'ended')) {
        await acquireMicrophone(generation.current);
      }
    } catch (error) { setDeviceError(error instanceof Error ? error.message : 'Could not enumerate audio devices'); }
  }
  async function refreshDevices() {
    let permission: MediaStream | null = null;
    try {
      if (!microphone.current && !testResources.current) permission = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      await enumerateDevices(true);
    } catch (error) { setDeviceError(error instanceof Error ? error.message : 'Microphone access is required to detect device names.'); }
    finally { permission?.getTracks().forEach(track => track.stop()); }
  }
  function microphoneConstraints(nativeFallback = false): MediaTrackConstraints {
    return microphoneCaptureConstraints({ ...settingsRef.current, ...(nativeFallback ? { noiseSuppressionMode: 'standard' as const } : {}) });
  }
  async function acquireMicrophone(expectedGeneration: number, nativeFallback = false) {
    const inputRequest = ++inputGeneration.current;
    await enumerateDevices();
    if (inputRequest !== inputGeneration.current || expectedGeneration !== generation.current) return false;
    const selectedInput = settingsRef.current.inputDevice;
    const requested = microphoneConstraints(nativeFallback);
    const activeCapture = microphone.current?.getAudioTracks()[0]?.getSettings();
    // Chromium can share one native processor between captures of the same device.
    // Release the old source before changing its processing; keep the mixer and RTP
    // sender alive, so this is a brief capture restart rather than a voice reconnect.
    if (activeCapture && (activeCapture.noiseSuppression !== undefined && activeCapture.noiseSuppression !== requested.noiseSuppression
      || activeCapture.echoCancellation !== undefined && activeCapture.echoCancellation !== requested.echoCancellation)) {
      microphonePipeline.current?.stop();
      microphonePipeline.current = null;
      microphone.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      microphone.current = null;
      updateSpeaking(false);
    }
    let nextStream: MediaStream;
    try { nextStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(nativeFallback), video: false }); }
    catch (error) {
      if (!selectedInput || selectedInput !== settingsRef.current.inputDevice || !error || typeof error !== 'object' || !('name' in error) || !['OverconstrainedError', 'NotFoundError'].includes(String(error.name))) throw error;
      if (inputRequest !== inputGeneration.current || expectedGeneration !== generation.current) return false;
      setSettings({ inputDevice: '' });
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(nativeFallback), video: false });
    }
    if (expectedGeneration !== generation.current || inputRequest !== inputGeneration.current) {
      nextStream.getTracks().forEach(track => track.stop());
      return false;
    }
    try {
      const context = await ensureMixer();
      if (expectedGeneration !== generation.current || inputRequest !== inputGeneration.current) {
        nextStream.getTracks().forEach(track => track.stop());
        return false;
      }
      const pipeline = createMicrophonePipeline(context, nextStream, destination.current!, () => ({ ...settingsRef.current, ...(nativeFallback ? { noiseSuppressionMode: 'standard' as const } : {}) }), microphoneEnabled, (level, active) => {
        updateSpeaking(active);
        const now = performance.now();
        if (!backgroundRef.current && now - lastInputSampleTime.current >= 50) {
          lastInputSampleTime.current = now;
          inputMeter.publish(level);
        }
      }, status => {
        if (expectedGeneration !== generation.current || inputRequest !== inputGeneration.current) return;
        setMicrophoneProcessing(nativeFallback ? 'fallback' : status);
        if (status === 'fallback' && !nativeFallback) void acquireMicrophone(expectedGeneration, true).catch(error => fail(error, 'Could not restore browser noise suppression'));
      });
      microphonePipeline.current?.stop();
      microphone.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      microphonePipeline.current = pipeline;
      microphone.current = nextStream;
      nextStream.getAudioTracks().forEach(track => {
        track.onended = () => {
          if (microphone.current !== nextStream) return;
          microphonePipeline.current?.stop();
          microphonePipeline.current = null;
          updateSpeaking(false);
          void enumerateDevices(true);
        };
      });
      setLocalStream(nextStream);
      applyAudioState();
      await enumerateDevices();
      return true;
    } catch (error) {
      nextStream.getTracks().forEach(track => track.stop());
      throw error;
    }
  }
  async function setOutput(audio: HTMLAudioElement, strict = false) {
    const output = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
    if (output.setSinkId) {
      let selected: string;
      do {
        selected = settingsRef.current.outputDevice;
        try { await output.setSinkId(selected); }
        catch (error) {
          if (selected !== settingsRef.current.outputDevice) continue;
          if (strict) throw error;
          fail(error, 'Could not select speaker');
          return;
        }
      } while (selected !== settingsRef.current.outputDevice);
    } else if (settingsRef.current.outputDevice && strict) throw new Error('This browser cannot route microphone test audio to a selected speaker. Choose System default.');
  }
  function releaseMicTest() {
    const resources = testResources.current;
    testResources.current = null;
    if (!resources) return;
    resources.pipeline?.stop();
    if (resources.audio) { resources.audio.pause(); resources.audio.srcObject = null; resources.audio.remove(); }
    resources.stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    resources.output?.stream.getTracks().forEach(track => track.stop());
    if (resources.context && resources.context.state !== 'closed') void resources.context.close().catch(() => {});
  }
  function stopMicTest() {
    testDesired.current = false;
    testGeneration.current++;
    releaseMicTest();
    setTestProcessing('off');
    updateMicTest({ status: 'idle', level: 0, speaking: false, error: null });
  }
  async function startMicTest(nativeFallback = false) {
    stopInputMonitor();
    testDesired.current = true;
    const operation = ++testGeneration.current;
    releaseMicTest();
    updateMicTest({ status: 'starting', level: 0, speaking: false, error: null });
    let captured: MediaStream | null = null;
    let context: AudioContext | null = null;
    let audio: HTMLAudioElement | null = null;
    let pipeline: ReturnType<typeof createMicrophonePipeline> | null = null;
    let output: MediaStreamAudioDestinationNode | null = null;
    const isCurrent = () => operation === testGeneration.current && testDesired.current;
    try {
      captured = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(nativeFallback), video: false });
      if (!isCurrent()) { captured.getTracks().forEach(track => track.stop()); return; }
      const resources: NonNullable<typeof testResources.current> = { stream: captured };
      testResources.current = resources;
      context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      resources.context = context;
      await context.resume();
      if (!isCurrent()) { captured.getTracks().forEach(track => track.stop()); await context.close(); return; }
      output = context.createMediaStreamDestination();
      output.channelCount = 1;
      resources.output = output;
      audio = new Audio();
      resources.audio = audio;
      audio.autoplay = true;
      audio.volume = 0.3;
      audio.srcObject = output.stream;
      await setOutput(audio, true);
      if (!isCurrent()) { audio.srcObject = null; audio.remove(); captured.getTracks().forEach(track => track.stop()); output.stream.getTracks().forEach(track => track.stop()); await context.close(); return; }
      let lastMeterUpdate = -Infinity;
      let lastMeterLevel = -1;
      let lastMeterSpeaking = false;
      pipeline = createMicrophonePipeline(context, captured, output, () => ({ ...settingsRef.current, pushToTalk: false, ...(nativeFallback ? { noiseSuppressionMode: 'standard' as const } : {}) }), () => true, (level, active) => {
        const now = performance.now();
        const meterLevel = Math.round(level * 50) / 50;
        if (isCurrent() && !backgroundRef.current && (active !== lastMeterSpeaking || now - lastMeterUpdate >= 100 && meterLevel !== lastMeterLevel)) {
          lastMeterUpdate = now; lastMeterLevel = meterLevel; lastMeterSpeaking = active;
          updateMicTest({ status: 'running', level: meterLevel, speaking: active, error: null });
        }
      }, status => {
        if (!isCurrent()) return;
        setTestProcessing(nativeFallback ? 'fallback' : status);
        if (status === 'fallback' && !nativeFallback) void startMicTest(true);
      });
      resources.pipeline = pipeline;
      captured.getAudioTracks().forEach(track => {
        track.onended = () => {
          if (!isCurrent()) return;
          updateMicTest({ status: 'starting', level: 0, speaking: false, error: null });
          void enumerateDevices(true).then(() => { if (isCurrent()) void startMicTest(); });
        };
      });
      await audio.play();
      if (!isCurrent()) return;
      await enumerateDevices();
    } catch (error) {
      pipeline?.stop();
      if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
      captured?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      output?.stream.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      if (!isCurrent()) return;
      testResources.current = null;
      testDesired.current = false;
      updateMicTest({ status: 'error', level: 0, speaking: false, error: error instanceof Error ? error.message : 'Could not start microphone test.' });
    }
  }
  async function configureScreenSender(sender: RTCRtpSender) {
    if (sender.track?.kind !== 'video' || !screen.current) return;
    const config = qualityRef.current;
    const record = Array.from(records.current.values()).find(record => record.screenSenders.includes(sender));
    const limited = record?.congestion?.videoLimited;
    const captured = screenDimensions(sender.track);
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings.length ? parameters.encodings : [{}];
    parameters.encodings.forEach(encoding => {
      encoding.maxBitrate = bitrateBits(limited ? Math.min(1, config.bitrateMbps) : config.bitrateMbps);
      encoding.maxFramerate = limited ? Math.min(15, config.fps) : config.fps;
      const reduction = limited ? Math.min(1, 720 / config.height) : 1;
      encoding.scaleResolutionDownBy = senderScale(captured.width ?? config.width, captured.height ?? config.height, config.width * reduction, config.height * reduction);
      encoding.priority = 'low';
    });
    parameters.degradationPreference = 'balanced';
    await sender.setParameters(parameters);
  }
  async function configureAudioSender(sender: RTCRtpSender, congested: boolean) {
    if (sender.track?.kind !== 'audio') return;
    const parameters = sender.getParameters();
    parameters.encodings = (parameters.encodings.length ? parameters.encodings : [{}]).map(encoding => ({
      ...encoding, maxBitrate: audioBitrate(settingsRef.current.gamingMode, congested, settingsRef.current.voiceBitrateKbps), dtx: 'enabled', priority: 'high',
    }));
    try { await sender.setParameters(parameters); } catch {}
  }
  /** Tells the backend about a peer connection that failed or recovered; see voice-diagnostics.ts. */
  function reportIce(record: PeerConnection, type: VoiceDiagnosticType) {
    if (!room.current || !voiceSocket.current?.connected) return;
    void diagnostics.report(type, record.connection, {
      peer: record.peer.socketId, retryCount: record.restartAttempts, startedAt: record.startedAt,
      checkingSince: record.checkingSince, everConnected: record.everConnected, resettable: record.resettable,
    }).catch(() => {});
  }
  function iceStuck(record: PeerConnection) {
    const state = record.connection.connectionState;
    if (state === 'failed' || state === 'disconnected') return true;
    return (state === 'new' || state === 'connecting') && Date.now() - record.checkingSince >= iceCheckingLimit;
  }
  /** Re-evaluates the connection when its current checking phase reaches the limit. */
  function superviseIce(record: PeerConnection) {
    clearTimeout(record.checkingTimer);
    record.checkingTimer = setTimeout(() => {
      record.checkingTimer = undefined;
      if (records.current.get(record.peer.socketId) !== record || !iceStuck(record)) return;
      // Failed and disconnected states are reported when they occur; this is ICE that never finished.
      if (['new', 'connecting'].includes(record.connection.connectionState)) reportIce(record, record.restartAttempts ? 'recovery_failed' : 'ice_timeout');
      scheduleIceRestart(record);
    }, Math.max(0, record.checkingSince + iceCheckingLimit - Date.now()));
  }
  function iceCheckingStarted(record: PeerConnection) {
    record.checkingSince = Date.now();
    superviseIce(record);
  }
  function scheduleIceRestart(record: PeerConnection) {
    if (record.restartTimer || record.peer.connectionError || !room.current || !voiceSocket.current?.connected) return;
    // Both peers usually detect the failure together. The polite peer waits so it answers the
    // impolite peer's restart offer instead of colliding with a second ICE generation.
    const polite = (voiceSocket.current.id ?? '') > record.peer.socketId;
    record.restartTimer = setTimeout(() => {
      record.restartTimer = undefined;
      if (records.current.get(record.peer.socketId) !== record || !room.current || !voiceSocket.current?.connected) return;
      // Recovered, or still inside its checking window: look again when the window ends.
      if (!iceStuck(record)) { superviseIce(record); return; }
      // The remote peer started a new ICE generation recently. Let it finish instead of colliding.
      if (Date.now() - record.remoteRestartAt < iceCheckingLimit) { superviseIce(record); return; }
      if (record.restartAttempts >= maxIceRestarts) {
        record.peer.connectionError = 'Connection lost. Disconnect and rejoin voice to retry.';
        reportIce(record, 'retries_exhausted');
        errorRef.current(`Could not restore the connection to ${record.peer.user.displayName ?? record.peer.user.name ?? 'a participant'}. Disconnect and rejoin voice to retry.`);
        refreshPeers();
        return;
      }
      record.restartAttempts++;
      // An ICE restart cannot revive a session that never connected when Firefox takes part: both
      // ends report connected, but Firefox never transmits media. Replace the connection pair.
      // Only the impolite side initiates, so the two peers never replace it at the same time; the
      // polite side counts the attempt and waits, since its own restart would only delay the reset.
      if (!record.everConnected && record.resettable) {
        if (polite) superviseIce(record);
        else resetPeer(record, true);
        return;
      }
      iceCheckingStarted(record);
      restartIce(record);
      scheduleIceRestart(record);
    }, Math.min(30_000, 2000 * 2 ** record.restartAttempts) + (polite ? 3000 : 0));
  }
  /** Replaces a peer's connection with a fresh one; the initiator offers, the other side answers. */
  function resetPeer(record: PeerConnection, initiate: boolean) {
    const { socketId, user, state: peerState } = record.peer;
    if (initiate) sendSignal(record, { reset: true });
    removePeer(socketId);
    const next = createPeer(socketId, user, initiate, peerState.streamProtocol, record.resettable ? 2 : undefined);
    next.peer.state = peerState;
    next.restartAttempts = record.restartAttempts;
    next.startedAt = record.startedAt;
    recoverStreamWatch(next);
    refreshPeers();
    return next;
  }
  function restartIce(record: PeerConnection) {
    const connection = record.connection;
    if (!connection.localDescription || !connection.remoteDescription) {
      // Never negotiated: the first offer or its answer was lost. Offer from this side instead;
      // restartIce() alone would not fire negotiationneeded again.
      record.offerOnInitialNegotiation = true;
      void negotiate(record);
    } else if (connection.signalingState === 'have-local-offer' && !record.makingOffer) {
      // The answer to our offer never arrived. Roll back so the restart can negotiate again.
      record.signalQueue = record.signalQueue.then(async () => {
        if (records.current.get(record.peer.socketId) !== record || connection.signalingState !== 'have-local-offer') return;
        await connection.setLocalDescription({ type: 'rollback' });
        connection.restartIce();
      }).catch(error => { if (records.current.get(record.peer.socketId) === record) fail(error, 'Voice reconnection failed'); });
    } else connection.restartIce();
  }
  /** Sends a signal and confirms delivery. A rejected signal used to vanish silently. */
  function sendSignal(record: PeerConnection, signal: Pick<Signal, 'description' | 'candidate' | 'reset'>, attempt = 0) {
    const socket = voiceSocket.current;
    if (!socket) return;
    socket.timeout(10_000).emit('voice:signal', { target: record.peer.socketId, ...signal }, (error: Error | null, result?: { error?: string }) => {
      // A timeout means the transport dropped; reconnection rebuilds every peer connection.
      if (error || !result?.error || records.current.get(record.peer.socketId) !== record || voiceSocket.current !== socket) return;
      const ufrag = signal.candidate?.usernameFragment;
      const current = signal.description ? record.connection.localDescription?.sdp === signal.description.sdp
        : !ufrag || iceUfrags(record.connection.localDescription?.sdp).has(ufrag);
      if (/rate|too many/i.test(result.error) && current && attempt < 3) {
        setTimeout(() => { if (records.current.get(record.peer.socketId) === record) sendSignal(record, signal, attempt + 1); }, 1000 * 2 ** attempt);
        return;
      }
      // Without this signal ICE may never leave checking; the watchdog restarts it when it is due.
      superviseIce(record);
    });
  }
  async function negotiate(record: PeerConnection) {
    const connection = record.connection;
    if (!record.offerOnInitialNegotiation && !connection.remoteDescription) return;
    try {
      record.makingOffer = true;
      await connection.setLocalDescription(voiceDescription(await connection.createOffer(), settingsRef.current.gamingMode, settingsRef.current.voiceBitrateKbps));
      sendSignal(record, { description: connection.localDescription?.toJSON() });
    } catch (error) {
      if (connection.signalingState !== 'closed') fail(error, 'Voice negotiation failed');
    } finally { record.makingOffer = false; }
  }
  function screenDimensions(track: MediaStreamTrack) {
    const measured = screenSourceSize.current;
    if (measured?.trackId === track.id) return measured;
    const captured = track.getSettings();
    return {
      width: captured.width,
      height: captured.height,
    };
  }
  function attachScreenTrackToPeer(socketId: string) {
    const record = records.current.get(socketId);
    if (!record?.screenTransport || !screen.current || !streamSubscribers.current.has(socketId)) return;
    void record.screenTransport.setStream(screen.current).then(async () => {
      if (records.current.get(socketId) !== record) return;
      await configureScreenSender(record.screenTransport!.video.sender);
      const sender = record.screenTransport!.audio.sender;
      if (sender.track) {
        const parameters = sender.getParameters();
        parameters.encodings = (parameters.encodings.length ? parameters.encodings : [{}]).map(encoding => ({ ...encoding, maxBitrate: 128_000, priority: 'low' }));
        await sender.setParameters(parameters);
      }
    }).catch(error => {
      if (records.current.get(socketId) === record) fail(error, 'Could not send screen media');
    });
  }
  function adoptScreenLanes(record: PeerConnection) {
    if (!record.screenCapable || record.screenTransport) return;
    const lanes = record.connection.getTransceivers().filter(lane => lane !== record.voiceTransceiver);
    const video = lanes.find(lane => lane.receiver.track.kind === 'video');
    const audio = lanes.find(lane => lane.receiver.track.kind === 'audio');
    if (!video || !audio) return;
    record.screenTransport = createScreenTransport(record.connection, { video, audio });
    record.screenSenders = record.screenTransport.senders;
    if (streamSubscribers.current.has(record.peer.socketId)) attachScreenTrackToPeer(record.peer.socketId);
  }
  function detachScreenTrackFromPeer(socketId: string) {
    const record = records.current.get(socketId);
    if (!record?.screenTransport) return;
    void record.screenTransport.setStream(null).catch(error => {
      if (records.current.get(socketId) === record) fail(error, 'Could not stop screen transmission');
    });
  }
  function addStreamSubscriber(socketId: string) {
    streamSubscribers.current.add(socketId);
    if (screen.current) {
      attachScreenTrackToPeer(socketId);
    }
  }
  function removeStreamSubscriber(socketId: string) {
    streamSubscribers.current.delete(socketId);
    detachScreenTrackFromPeer(socketId);
  }
  function watchStream(peerSocketId: string) {
    const record = records.current.get(peerSocketId);
    const broadcastId = record?.peer.state.broadcastId;
    if (!room.current || !record || !record.peer.state.sharing) return;
    if (!streamProtocol.current || record.peer.state.streamProtocol !== 1 || !broadcastId) {
      if (broadcastId) wantedBroadcasts.current.delete(broadcastId);
      const message = 'Screen viewing requires an updated Haven backend and broadcaster. Voice remains available.';
      streamErrors.current.set(peerSocketId, message);
      errorRef.current(message);
      refreshPeers();
      return;
    }
    if (activeWatchedStreams.current.has(peerSocketId)) return;
    wantedBroadcasts.current.set(broadcastId, record.peer.user.id);
    // Bound abandoned reconnect intentions without ever matching a new broadcast by user ID.
    if (wantedBroadcasts.current.size > 16) wantedBroadcasts.current.delete(wantedBroadcasts.current.keys().next().value!);
    streamErrors.current.delete(peerSocketId);
    activeWatchedStreams.current.add(peerSocketId);
    setWatchingStreams(Array.from(activeWatchedStreams.current));
    const request = {};
    watchRequests.current.set(peerSocketId, request);
    record.receivedBroadcastId = undefined;
    applyPeerAudio(record);
    syncPeerVideo(record);
    const failed = (message: string) => {
      if (watchRequests.current.get(peerSocketId) !== request || records.current.get(peerSocketId) !== record) return;
      stopWatchingStream(peerSocketId);
      streamErrors.current.set(peerSocketId, message);
      errorRef.current(message);
      refreshPeers();
    };
    const decodedFrames = async () => {
      const receiver = record.screenTransport?.video.receiver;
      if (!receiver) return 0;
      const stats = await receiver.getStats();
      return Array.from(stats.values()).filter(stat => stat.type === 'inbound-rtp' && stat.kind === 'video').reduce((sum, stat) => sum + (stat.framesDecoded || 0), 0);
    };
    const baseline = decodedFrames().catch(() => 0);
    const deadline = performance.now() + 15_000;
    const verifyVideo = async () => {
      if (watchRequests.current.get(peerSocketId) !== request) return;
      try {
        const first = await baseline;
        if (await decodedFrames() > first && watchRequests.current.get(peerSocketId) === request) {
          record.receivedBroadcastId = broadcastId;
          syncPeerVideo(record);
          refreshPeers();
          return;
        }
      } catch { /* The peer may be negotiating or closing. Keep the bounded deadline. */ }
      if (watchRequests.current.get(peerSocketId) !== request) return;
      if (performance.now() >= deadline) failed('The stream did not deliver video. Check the connection and try Watch Stream again.');
      else record.watchTimer = setTimeout(() => { void verifyVideo(); }, 250);
    };
    record.watchTimer = setTimeout(() => { void verifyVideo(); }, 250);
    voiceSocket.current?.timeout(5000).emit('voice:stream-watch', { target: peerSocketId, broadcastId },
      (error: Error | null, result?: { error?: string; protocol?: number; broadcastId?: string }) => {
        if (watchRequests.current.get(peerSocketId) !== request) return;
        if (error) failed('The backend did not acknowledge Watch Stream. It may need an update; please retry.');
        else if (result?.error) failed(`Could not watch stream: ${result.error}`);
        else if (result?.protocol !== 1 || result.broadcastId !== broadcastId) failed('The backend does not support this screen-sharing protocol. Voice remains available.');
      });
  }
  function stopWatchingStream(peerSocketId: string) {
    const record = records.current.get(peerSocketId);
    const broadcastId = record?.peer.state.broadcastId;
    if (record?.peer.state.broadcastId) wantedBroadcasts.current.delete(record.peer.state.broadcastId);
    watchRequests.current.delete(peerSocketId);
    clearTimeout(record?.watchTimer);
    if (record) record.receivedBroadcastId = undefined;
    activeWatchedStreams.current.delete(peerSocketId);
    setWatchingStreams(Array.from(activeWatchedStreams.current));
    if (record) {
      syncPeerVideo(record);
      applyPeerAudio(record);
      refreshPeers();
    }
    if (!record || !voiceSocket.current?.connected) return;
    const request = {};
    watchRequests.current.set(peerSocketId, request);
    const cancel = (attempt: number) => {
      voiceSocket.current?.timeout(5000).emit('voice:stream-unwatch', { target: peerSocketId, broadcastId },
        (error: Error | null, result?: { error?: string }) => {
          if (watchRequests.current.get(peerSocketId) !== request || records.current.get(peerSocketId) !== record || !voiceSocket.current?.connected || record.peer.state.broadcastId !== broadcastId) return;
          if (!error && !result?.error) { watchRequests.current.delete(peerSocketId); return; }
          if (error && attempt < 3) { cancel(attempt + 1); return; }
          const message = 'The backend could not confirm Stop Watching. Disconnect and rejoin voice if screen traffic continues.';
          streamErrors.current.set(peerSocketId, message);
          errorRef.current(message);
          refreshPeers();
        });
    };
    cancel(1);
  }
  function syncPeerVideo(record: PeerConnection) {
    const stream = record.peer.stream;
    if (!stream) return;
    const watching = activeWatchedStreams.current.has(record.peer.socketId) && record.peer.state.sharing && record.receivedBroadcastId === record.peer.state.broadcastId;
    record.videoTracks.forEach(track => {
      if (watching && track.readyState === 'live' && !track.muted) {
        if (!stream.getTracks().includes(track)) stream.addTrack(track);
      } else stream.removeTrack(track);
    });
  }
  function recoverStreamWatch(record: PeerConnection) {
    const broadcastId = record.peer.state.broadcastId;
    if (record.peer.state.sharing && broadcastId && wantedBroadcasts.current.has(broadcastId)) watchStream(record.peer.socketId);
  }
  function removePeer(socketId: string) {
    pendingSignals.current.delete(socketId);
    const record = records.current.get(socketId);
    if (!record) return;
    records.current.delete(socketId);
    streamErrors.current.delete(socketId);
    watchRequests.current.delete(socketId);
    activeWatchedStreams.current.delete(socketId);
    clearTimeout(record.watchTimer);
    clearTimeout(record.restartTimer);
    clearTimeout(record.checkingTimer);
    record.screenTransport?.close();
    record.connection.onicecandidate = null;
    record.connection.onnegotiationneeded = null;
    record.connection.ontrack = null;
    record.connection.onconnectionstatechange = null;
    record.connection.getTransceivers().forEach(({ receiver }) => {
      receiver.track.onended = null;
      receiver.track.onmute = null;
      receiver.track.onunmute = null;
      receiver.track.stop();
    });
    record.connection.close();
    record.audio.forEach(audio => { audio.pause(); audio.srcObject = null; audio.remove(); });
    byteSamples.current.forEach((_sample, key) => { if (key.startsWith(`${socketId}:`)) byteSamples.current.delete(key); });
    audioSamples.current.forEach((_sample, key) => { if (key.startsWith(`${socketId}:`)) audioSamples.current.delete(key); });
    refreshPeers();
  }
  function createPeer(socketId: string, user: MediaUser, offerOnInitialNegotiation = true, peerProtocol?: number, signaling?: number) {
    const existing = records.current.get(socketId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: iceServers.current });
    const record: PeerConnection = {
      connection, audio: new Map(), screenAudioTracks: new Set(), screenCapable: streamProtocol.current && peerProtocol === 1, makingOffer: false, ignoreOffer: false, answering: false, candidates: createCandidateRouter(), screenSenders: [],
      offerOnInitialNegotiation, signalQueue: Promise.resolve(),
      videoTracks: new Map(), restartAttempts: 0, startedAt: Date.now(), checkingSince: Date.now(), remoteRestartAt: -Infinity, everConnected: false, resettable: signaling === 2, congested: false,
      peer: { socketId, user, stream: null, state: { muted: false, deafened: false, sharing: false }, volume: localPreferences.current.get(user.id)?.volume ?? 1, localMuted: localPreferences.current.get(user.id)?.muted ?? false },
    };
    records.current.set(socketId, record);
    connection.onicecandidate = event => {
      if (event.candidate) sendSignal(record, { candidate: event.candidate.toJSON() });
    };
    connection.onnegotiationneeded = () => { void negotiate(record); };
    connection.ontrack = event => {
      adoptScreenLanes(record);
      const screenAudio = event.transceiver === record.screenTransport?.audio;
      const screenVideo = event.transceiver === record.screenTransport?.video;
      const voiceAudio = event.transceiver === record.voiceTransceiver;
      // An older client may offer unsolicited screen lanes. Never play or accept them.
      if (!voiceAudio && !screenAudio && !screenVideo) {
        if (event.transceiver && !event.transceiver.sender.track) event.transceiver.direction = 'inactive';
        return;
      }
      const stream = record.peer.stream ?? new MediaStream();
      if (event.track.kind !== 'video' && !stream.getTracks().some(track => track.id === event.track.id)) stream.addTrack(event.track);
      if (event.track.kind === 'video') record.videoTracks.set(event.track.id, event.track);
      if (screenAudio) record.screenAudioTracks.add(event.track.id);
      record.peer.stream = stream;
      if (event.track.kind === 'audio' && !record.audio.has(event.track.id)) {
        const audio = new Audio();
        audio.autoplay = true;
        audio.srcObject = new MediaStream([event.track]);
        record.audio.set(event.track.id, audio);
        applyPeerAudio(record);
        void setOutput(audio);
        void audio.play().catch(() => {});
      }
      event.track.onended = () => {
        stream.removeTrack(event.track);
        record.videoTracks.delete(event.track.id);
        record.screenAudioTracks.delete(event.track.id);
        const audio = record.audio.get(event.track.id);
        if (audio) { audio.pause(); audio.srcObject = null; record.audio.delete(event.track.id); }
        refreshPeers();
      };
      event.track.onmute = () => {
        if (event.track.kind === 'video') stream.removeTrack(event.track);
        refreshPeers();
      };
      event.track.onunmute = () => {
        syncPeerVideo(record);
        refreshPeers();
      };
      syncPeerVideo(record);
      refreshPeers();
    };
    connection.onconnectionstatechange = () => {
      record.peer.connectionState = connection.connectionState;
      refreshPeers();
      if (connection.connectionState === 'connected') {
        if (record.restartAttempts) reportIce(record, 'recovered');
        record.everConnected = true;
        clearTimeout(record.restartTimer);
        clearTimeout(record.checkingTimer);
        record.restartTimer = undefined;
        record.checkingTimer = undefined;
        record.restartAttempts = 0;
        record.peer.connectionError = undefined;
        refreshPeers();
      } else if (['failed', 'disconnected'].includes(connection.connectionState)) {
        // A brief disconnection usually recovers by itself; only a failure is worth reporting.
        if (connection.connectionState === 'failed') reportIce(record, 'ice_failed');
        scheduleIceRestart(record);
      }
    };
    destination.current?.stream.getAudioTracks().forEach(track => {
      const sender = connection.addTrack(track, destination.current!.stream);
      const transceiver = connection.getTransceivers().find(value => value.sender === sender);
      record.voiceTransceiver = transceiver;
      const codecs = RTCRtpSender.getCapabilities?.('audio')?.codecs;
      if (codecs && transceiver?.setCodecPreferences) {
        const opus = codecs.filter(codec => codec.mimeType.toLowerCase() === 'audio/opus');
        if (opus.length) transceiver.setCodecPreferences([...opus, ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'audio/opus')]);
      }
      void configureAudioSender(sender, record.congested);
    });
    if (record.screenCapable && offerOnInitialNegotiation) {
      record.screenTransport = createScreenTransport(connection);
      record.screenSenders = record.screenTransport.senders;
    }
    if (streamSubscribers.current.has(socketId)) {
      attachScreenTrackToPeer(socketId);
    }
    const queued = pendingSignals.current.get(socketId) ?? [];
    pendingSignals.current.delete(socketId);
    queued.forEach(signal => { void receiveSignal(signal); });
    superviseIce(record);
    refreshPeers();
    return record;
  }
  async function receiveSignal(signal: Signal) {
    if (!room.current) return;
    const record = records.current.get(signal.from);
    if (!record) {
      if (pendingSignals.current.size >= 16 && !pendingSignals.current.has(signal.from)) return;
      const queued = pendingSignals.current.get(signal.from) ?? [];
      // One ICE generation of a multi-homed host can exceed 64 candidates; the router bounds the rest.
      if (queued.length < 256) queued.push(signal);
      pendingSignals.current.set(signal.from, queued);
      return;
    }
    // Handled on arrival, not queued: every later signal from this peer belongs to the new connection.
    if (signal.reset) { resetPeer(record, false); return; }
    record.signalQueue = record.signalQueue.then(() => processSignal(record, signal)).catch(error => {
      if (records.current.get(signal.from) === record) fail(error, 'Voice signaling failed');
    });
    await record.signalQueue;
  }
  async function processSignal(record: PeerConnection, signal: Signal) {
    if (!room.current || records.current.get(signal.from) !== record) return;
    const connection = record.connection;
    try {
      if (signal.description) {
        const ready = !record.makingOffer && (connection.signalingState === 'stable' || record.answering);
        const collision = signal.description.type === 'offer' && !ready;
        const polite = (voiceSocket.current?.id ?? '') > signal.from;
        record.ignoreOffer = !polite && collision;
        if (record.ignoreOffer) { record.candidates.ignoredOffer(signal.description.sdp); return; }
        record.answering = signal.description.type === 'answer';
        const previousUfrags = iceUfrags(connection.remoteDescription?.sdp);
        await connection.setRemoteDescription(signal.description);
        adoptScreenLanes(record);
        record.answering = false;
        const unlocked = record.candidates.applied(signal.description.sdp);
        if (Array.from(iceUfrags(signal.description.sdp)).some(ufrag => !previousUfrags.has(ufrag))) {
          // A new remote ICE generation starts a new checking phase.
          if (signal.description.type === 'offer' && previousUfrags.size) record.remoteRestartAt = Date.now();
          iceCheckingStarted(record);
        }
        if (signal.description.type === 'offer') {
          await connection.setLocalDescription(voiceDescription(await connection.createAnswer(), settingsRef.current.gamingMode, settingsRef.current.voiceBitrateKbps));
          record.offerOnInitialNegotiation = true;
          sendSignal(record, { description: connection.localDescription?.toJSON() });
        }
        // After answering: a rejected early candidate must not withhold the answer itself.
        await addCandidates(connection, unlocked);
      } else if (signal.candidate) {
        // Candidates of the current generation stay valid while a colliding offer is ignored.
        const candidate = record.candidates.receive(signal.candidate, record.ignoreOffer);
        if (candidate) await connection.addIceCandidate(candidate);
      }
    } catch (error) {
      record.answering = false;
      if (connection.signalingState !== 'closed') fail(error, 'Voice connection failed');
    }
  }
  async function addCandidates(connection: RTCPeerConnection, candidates: RTCIceCandidateInit[]) {
    // One rejected candidate must not discard the rest of its generation.
    let failure: unknown;
    for (const candidate of candidates) {
      try { await connection.addIceCandidate(candidate); }
      catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }
  function stopShare() {
    screenGeneration.current++;
    const captured = screen.current;
    screen.current = null;
    screenSourceSize.current = null;
    captured?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    records.current.forEach(record => {
      detachScreenTrackFromPeer(record.peer.socketId);
    });
    streamSubscribers.current.clear();
    state.current.sharing = false;
    state.current.broadcastId = undefined;
    setSharing(false);
    setScreenStream(null);
    qualityRef.current = { ...qualityRef.current, nativeWidth: 0, nativeHeight: 0, width: 0, height: 0, stats: { outbound: [], inbound: [] } };
    updateQuality(qualityRef.current);
    emitState();
  }
  function voiceCue(kind: 'join' | 'leave') {
    if (!readPreferences().voiceCues || state.current.deafened || moderationRef.current.deafened) return;
    void soundboardService.playCue(kind, { outputVolume: settingsRef.current.outputVolume, outputDeviceId: settingsRef.current.outputDevice });
  }
  function userInRoom(userId: string) {
    return Array.from(records.current.values()).some(record => record.peer.user.id === userId);
  }
  function clearLeaveCues() {
    leaveCueTimers.current.forEach(timer => clearTimeout(timer));
    leaveCueTimers.current.clear();
    leaveCued.current.clear();
  }
  function leave() {
    roomServerId.current = null;
    voiceSession.current = null;
    clearLeaveCues();
    moderationRef.current = { muted: false, deafened: false };
    setModeration(moderationRef.current);
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    clearInterval(iceRefreshTimer.current);
    iceRefreshTimer.current = undefined;
    reconnectAttempts.current = 0;
    generation.current++;
    inputGeneration.current++;
    reconnectRoom.current = null;
    updateSpeaking(false);
    inputMeter.publish(0);
    stopInputMonitor();
    if (room.current) voiceSocket.current?.emit('voice:leave');
    room.current = null;
    streamSubscribers.current.clear();
    activeWatchedStreams.current.clear();
    wantedBroadcasts.current.clear();
    watchRequests.current.clear();
    streamErrors.current.clear();
    streamProtocol.current = false;
    setWatchingStreams([]);
    stopShare();
    Array.from(records.current.keys()).forEach(removePeer);
    pendingSignals.current.clear();
    microphonePipeline.current?.stop();
    microphonePipeline.current = null;
    microphone.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    microphone.current = null;
    setMicrophoneProcessing('off');
    sounds.current.forEach(source => { try { source.stop(); } catch {} });
    sounds.current.clear();
    soundMonitors.current.clear();
    destination.current?.stream.getTracks().forEach(track => track.stop());
    if (mixer.current && mixer.current.state !== 'closed') void mixer.current.close();
    mixer.current = null;
    destination.current = null;
    byteSamples.current.clear();
    audioSamples.current.clear();
    soundboardService.stopAllSounds();
    setLocalStream(null);
    setVoiceChannelId(null);
    setConnectionStatus('disconnected');
  }
  async function join(channelId: string, recovering = false) {
    if (room.current === channelId) return;
    if (!recovering) leave();
    if (!recovering || !voiceSession.current) voiceSession.current = randomId();
    const session = voiceSession.current;
    const operation = generation.current;
    reconnectRoom.current = channelId;
    setVoiceChannelId(channelId);
    setConnectionStatus(recovering ? 'reconnecting' : 'connecting');
    try {
      if (!voiceSocket.current?.connected) throw new Error('Chat connection is offline');
      const configuration = await api<{ iceServers: RTCIceServer[] }>('/rtc');
      if (operation !== generation.current) return;
      iceServers.current = configuration.iceServers ?? [];
      // Temporary TURN credentials expire. Someone who stays in voice keeps handing fresh ones
      // to new peers and to existing connections' ICE restarts; a failed refresh keeps the current set.
      clearInterval(iceRefreshTimer.current);
      iceRefreshTimer.current = setInterval(async () => {
        try {
          const refreshed = (await api<{ iceServers: RTCIceServer[] }>('/rtc')).iceServers;
          if (operation !== generation.current || !Array.isArray(refreshed)) return;
          iceServers.current = refreshed;
          records.current.forEach(({ connection }) => {
            try { connection.setConfiguration({ ...connection.getConfiguration(), iceServers: refreshed }); } catch {}
          });
        } catch {}
      }, 6 * 60 * 60 * 1000);
      if (!microphone.current?.getAudioTracks().some(track => track.readyState === 'live') && !await acquireMicrophone(operation)) return;
      const activeSocket = voiceSocket.current;
      if (operation !== generation.current) return;
      if (!activeSocket?.connected) throw new Error('Chat connection went offline');
      room.current = channelId;
      setVoiceChannelId(channelId);
      type JoinResult = { capabilities?: { streamSubscriptions?: number; entrySounds?: number }; peers?: ({ socketId: string; user: MediaUser; signaling?: number } & Partial<VoiceState>)[]; moderation?: { serverId: string; muted: boolean; deafened: boolean }; error?: string };
      const responsePayload = await new Promise<JoinResult>((resolve, reject) => {
        // The server plays a deliberate join's entry sound itself, once, and never for a resumed session.
        activeSocket.timeout(10_000).emit('voice:join', { channelId, streamProtocol: 1, signaling: 2, session, resume: recovering, entrySound: !recovering }, (error: Error | null, result: JoinResult) => {
          if (error) reject(new Error('Voice channel did not respond'));
          else resolve(result ?? {});
        });
      });
      if (operation !== generation.current) return;
      if (responsePayload.error) throw new Error(responsePayload.error);
      streamProtocol.current = responsePayload.capabilities?.streamSubscriptions === 1;
      if (!streamProtocol.current && screen.current) {
        stopShare();
        errorRef.current('The backend no longer supports opt-in screen sharing. Sharing stopped; voice remains available.');
      }
      roomServerId.current = responsePayload.moderation?.serverId ?? null;
      applyModeration(responsePayload.moderation ?? { muted: false, deafened: false });
      responsePayload.peers?.forEach(peer => {
        if (peer.socketId === activeSocket.id) return;
        const record = createPeer(peer.socketId, peer.user, false, peer.streamProtocol, peer.signaling);
        record.peer.state = { muted: peer.muted ?? false, deafened: peer.deafened ?? false, sharing: peer.sharing ?? false, speaking: peer.speaking ?? false, serverMuted: peer.serverMuted, serverDeafened: peer.serverDeafened, streamProtocol: peer.streamProtocol, broadcastId: peer.broadcastId };
        recoverStreamWatch(record);
      });
      refreshPeers();
      emitState();
      voiceSocket.current?.emit('voice:activity', { speaking: Boolean(state.current.speaking) });
      setConnectionStatus('connected');
      reconnectRoom.current = null;
      reconnectAttempts.current = 0;

      // A genuine join announces itself once: the entry sound when one is chosen, otherwise the join cue.
      if (!recovering) {
        const entrySoundId = roomServerId.current ? soundboardService.getEntrySoundId(roomServerId.current, accountRef.current) : null;
        // Servers before entry-sound support expect the client to play it.
        if (entrySoundId && responsePayload.capabilities?.entrySounds !== 1) activeSocket.emit('sound:play', { soundId: entrySoundId });
        if (!entrySoundId) voiceCue('join');
      }
    } catch (error) {
      if (operation !== generation.current) return;
      if (recovering && reconnectAttempts.current < 5 && !/access|permission|not found|deleted|member|limit|full/i.test(error instanceof Error ? error.message : '')) {
        room.current = null;
        Array.from(records.current.keys()).forEach(removePeer);
        reconnectRoom.current = channelId;
        reconnectAttempts.current++;
        setConnectionStatus('reconnecting');
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = undefined;
          if (reconnectRoom.current === channelId && voiceSocket.current?.connected) void join(channelId, true);
        }, Math.min(30_000, 1000 * 2 ** reconnectAttempts.current));
        return;
      }
      leave();
      fail(error, 'Could not join voice');
    }
  }
  async function setShareQuality(height: ShareHeight, fps: ShareFps, bitrateMbps: number) {
    // An explicit edit updates the preference even while a temporary cap applies.
    setSettings({ shareHeight: height, shareFps: fps, shareBitrateMbps: bitrateMbps });
    await applyShareQuality();
  }
  async function applyShareQuality() {
    const captured = screen.current;
    if (!captured) return;
    qualityQueue.current = qualityQueue.current.catch(() => {}).then(async () => {
      if (screen.current !== captured) return;
      const track = captured.getVideoTracks()[0];
      try {
        const { height, fps, bitrateMbps } = effectiveSharePreferences(settingsRef.current, settingsRef.current.gamingMode);
        const constraints: MediaTrackConstraints & { resizeMode: string } = { frameRate: { ideal: fps, max: fps }, resizeMode: 'none' };
        await track.applyConstraints(constraints);
        if (screen.current !== captured) return;
        const source = screenDimensions(track);
        const current = qualityRef.current;
        const dimensions = qualityForSource(source.width ?? current.nativeWidth, source.height ?? current.nativeHeight, height);
        qualityRef.current = { ...current, ...dimensions, fps, bitrateMbps: bitrateBits(bitrateMbps) / 1_000_000 };
        updateQuality(qualityRef.current);
        await Promise.all(Array.from(records.current.values()).flatMap(record => record.screenSenders.map(configureScreenSender)));
      } catch (error) { if (screen.current === captured) fail(error, 'Could not apply screen quality'); }
    });
    await qualityQueue.current;
  }
  async function startShare() {
    if (!room.current) { errorRef.current('Join a voice channel before sharing your screen.'); return; }
    if (screen.current) return;
    if (!streamProtocol.current) { errorRef.current('Screen sharing requires an updated Haven backend. Voice remains available.'); return; }
    const operation = ++screenGeneration.current;
    try {
      const { fps } = effectiveSharePreferences(settingsRef.current, settingsRef.current.gamingMode);
      const captured = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: fps, max: fps } }, audio: true });
      if (operation !== screenGeneration.current || !room.current) { captured.getTracks().forEach(track => track.stop()); return; }
      const track = captured.getVideoTracks()[0];
      if (!track) { captured.getTracks().forEach(item => item.stop()); throw new Error('No screen video was selected'); }
      const source = track.getSettings();
      const native = captureDimensions(source.width ?? 1, source.height ?? 1);
      screen.current = captured;
      state.current.broadcastId = crypto.randomUUID();
      track.contentHint = 'detail';
      track.onended = stopShare;
      qualityRef.current = { ...qualityRef.current, nativeWidth: native.width, nativeHeight: native.height, ...native };
      await applyShareQuality();
      if (screen.current !== captured) return;
      records.current.forEach(record => {
        if (streamSubscribers.current.has(record.peer.socketId)) {
          attachScreenTrackToPeer(record.peer.socketId);
        }
      });
      state.current.sharing = true;
      setSharing(true);
      setScreenStream(captured);
      emitState();
    } catch (error) {
      if (operation !== screenGeneration.current) return;
      if (isCaptureCancellation(error)) return;
      fail(error, 'Screen sharing failed');
      stopShare();
    }
  }
  function toggleMute() {
    if (moderationRef.current.muted || moderationRef.current.deafened) { errorRef.current('A moderator has muted you in this community.'); return; }
    state.current.muted = !state.current.muted;
    setMuted(state.current.muted);
    persistVoiceState();
    applyAudioState();
    emitState();
  }
  function toggleDeafen() {
    if (moderationRef.current.deafened) { errorRef.current('A moderator has deafened you in this community.'); return; }
    state.current.deafened = !state.current.deafened;
    setDeafened(state.current.deafened);
    persistVoiceState();
    applyAudioState();
    emitState();
  }
  function persistVoiceState() {
    const value = JSON.stringify({ muted: state.current.muted, deafened: state.current.deafened });
    try { saveMediaPreference('haven.voice.state', value); }
    catch (error) { persistenceFailed(error); }
  }
  function persistenceFailed(error: unknown) {
    persistenceBlocked.current = true;
    pushHeld.current = false;
    setPersistenceError(`Audio preferences could not be saved. Microphone is blocked: ${error instanceof Error ? error.message : error}`);
    applyAudioState();
  }
  function setSettings(next: Partial<MediaSettings> | ((previous: MediaSettings) => MediaSettings), edited = true) {
    if (edited) settingsEdited.current = true;
    const updated = typeof next === 'function' ? next(settingsRef.current) : { ...settingsRef.current, ...next };
    for (const [key, label, kind] of [['inputDevice', 'inputDeviceLabel', 'audioinput'], ['outputDevice', 'outputDeviceLabel', 'audiooutput']] as const) {
      if (updated[key] !== settingsRef.current[key]) updated[label] = devices.find(device => device.kind === kind && device.deviceId === updated[key])?.label ?? updated[label];
      if (!updated[key]) updated[label] = '';
    }
    settingsRef.current = { ...updated, ...normalizeAudioSettings(updated) };
    Object.assign(settingsRef.current, normalizeRuntimePreferences(settingsRef.current));
    updateSettings(settingsRef.current);
  }
  function setUserVolume(userId: string, volume: number) {
    const bounded = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    const preference = localPreferences.current.get(userId) ?? { volume: 1, muted: false };
    localPreferences.current.set(userId, { ...preference, volume: bounded });
    records.current.forEach(record => {
      if (record.peer.user.id !== userId) return;
      record.peer.volume = bounded;
      applyPeerAudio(record);
    });
    refreshPeers();
  }
  function setUserLocallyMuted(userId: string, locallyMuted: boolean) {
    const preference = localPreferences.current.get(userId) ?? { volume: 1, muted: false };
    localPreferences.current.set(userId, { ...preference, muted: locallyMuted });
    records.current.forEach(record => { if (record.peer.user.id === userId) record.peer.localMuted = locallyMuted; });
    applyAudioState();
    refreshPeers();
  }
  function setPeerVolume(socketId: string, volume: number) {
    const record = records.current.get(socketId);
    if (record) setUserVolume(record.peer.user.id, volume);
  }
  function setStreamVolume(socketId: string, volume: number) {
    const record = records.current.get(socketId);
    if (!record) return;
    record.peer.streamVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    applyPeerAudio(record);
  }
  function syncUser(user: MediaUser) {
    let changed = false;
    records.current.forEach(record => {
      if (record.peer.user.id !== user.id) return;
      record.peer.user = { ...record.peer.user, ...user };
      changed = true;
    });
    if (changed) refreshPeers();
  }
  const stopInputMonitor = useCallback(() => {
    inputMonitorRef.current?.stop();
    if (!room.current && !testDesired.current) inputMeter.publish(0);
  }, [inputMeter]);
  const startInputMonitor = useCallback(() => inputMonitorRef.current!.start(), []);
  async function testOutputSound() {
    try {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const outputContext = context as AudioContext & { setSinkId?: (deviceId: string) => Promise<void> };
      if (settingsRef.current.outputDevice && outputContext.setSinkId) {
        try { await outputContext.setSinkId(settingsRef.current.outputDevice); } catch {}
      }
      const osc = context.createOscillator();
      const gain = context.createGain();
      const master = settingsRef.current.outputVolume ?? 1;
      gain.gain.setValueAtTime(0.25 * master, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45);
      osc.frequency.setValueAtTime(523.25, context.currentTime);
      osc.frequency.setValueAtTime(659.25, context.currentTime + 0.15);
      osc.frequency.setValueAtTime(783.99, context.currentTime + 0.3);
      osc.connect(gain).connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.5);
      osc.onended = () => { void context.close().catch(() => {}); };
    } catch (e) {
      fail(e, 'Could not play output test sound');
    }
  }
  async function playSound(url: string) {
    await soundboardService.playSound(url);
  }

  useEffect(() => {
    if (!socket) return;
    const peerJoined = (payload: { socketId: string; user: MediaUser } & Partial<VoiceState> & PeerPresence) => {
      if (room.current && payload.socketId !== socket.id) {
        const userId = payload.user.id;
        const present = userInRoom(userId);
        const grace = leaveCueTimers.current.get(userId);
        clearTimeout(grace);
        leaveCueTimers.current.delete(userId);
        // A resumed session is silent unless its drop was already announced. A deliberate join
        // is announced by its entry sound when the server plays one, otherwise by the join cue.
        const announced = leaveCued.current.delete(userId);
        if (!present && (payload.resumed ? announced : !payload.entrySound)) voiceCue('join');
        const record = createPeer(payload.socketId, payload.user, true, payload.streamProtocol, payload.signaling);
        record.peer.state = { muted: payload.muted ?? false, deafened: payload.deafened ?? false, sharing: payload.sharing ?? false, speaking: payload.speaking ?? false, serverMuted: payload.serverMuted, serverDeafened: payload.serverDeafened, streamProtocol: payload.streamProtocol, broadcastId: payload.broadcastId };
        recoverStreamWatch(record);
        refreshPeers();
        emitState();
      }
    };
    const peerLeft = (payload: { socketId: string; reason?: 'leave' | 'moved' | 'disconnect' | 'replaced' | 'removed' }) => {
      streamSubscribers.current.delete(payload.socketId);
      if (activeWatchedStreams.current.has(payload.socketId)) {
        activeWatchedStreams.current.delete(payload.socketId);
        setWatchingStreams(Array.from(activeWatchedStreams.current));
      }
      const userId = records.current.get(payload.socketId)?.peer.user.id;
      removePeer(payload.socketId);
      // A replaced socket was this user's own stale connection; the user never left.
      if (!userId || !room.current || payload.reason === 'replaced' || userInRoom(userId)) return;
      if (payload.reason !== 'disconnect') { voiceCue('leave'); return; }
      // A dropped connection usually resumes within seconds. Announce it only if it stays gone.
      clearTimeout(leaveCueTimers.current.get(userId));
      leaveCueTimers.current.set(userId, setTimeout(() => {
        leaveCueTimers.current.delete(userId);
        if (!room.current || userInRoom(userId)) return;
        leaveCued.current.add(userId);
        voiceCue('leave');
      }, leaveCueGraceMs));
    };
    const signal = (payload: Signal) => { void receiveSignal(payload); };
    const peerState = (payload: VoiceState & { socketId: string }) => {
      const record = records.current.get(payload.socketId);
      if (record) {
        if (record.peer.state.broadcastId && (!payload.sharing || payload.broadcastId !== record.peer.state.broadcastId)) {
          wantedBroadcasts.current.delete(record.peer.state.broadcastId);
          if (activeWatchedStreams.current.has(payload.socketId)) stopWatchingStream(payload.socketId);
        }
        record.peer.state = { ...payload, streamProtocol: payload.streamProtocol ?? record.peer.state.streamProtocol, speaking: payload.speaking ?? record.peer.state.speaking };
        syncPeerVideo(record);
        applyPeerAudio(record);
        recoverStreamWatch(record);
        refreshPeers();
      }
    };
    const streamWatch = (payload: { viewerSocketId: string; broadcastId?: string }) => {
      if ((!payload.broadcastId || payload.broadcastId === state.current.broadcastId) && state.current.sharing && records.current.has(payload.viewerSocketId)) addStreamSubscriber(payload.viewerSocketId);
    };
    const streamUnwatch = (payload: { viewerSocketId: string; broadcastId?: string }) => {
      if (!payload.broadcastId || payload.broadcastId === state.current.broadcastId) removeStreamSubscriber(payload.viewerSocketId);
    };
    const forcedDisconnect = (payload: { reason?: string }) => {
      leave();
      voiceCue('leave');
      errorRef.current(payload.reason === 'channel-deleted' ? 'Voice disconnected because the channel was deleted.' : payload.reason === 'membership-revoked' ? 'Voice disconnected because access to the server was removed.' : 'Voice disconnected by the server.');
    };
    const moderated = (payload: { serverId: string; muted: boolean; deafened: boolean }) => {
      if (payload.serverId === roomServerId.current) { applyModeration(payload); emitState(); }
    };
    const activity = (payload: { socketId: string; speaking: boolean }) => {
      const record = records.current.get(payload.socketId);
      if (record && record.peer.state.speaking !== payload.speaking) { record.peer.state.speaking = payload.speaking; if (!backgroundRef.current) refreshPeers(); }
    };
    const disconnected = () => {
      const previous = room.current ?? reconnectRoom.current;
      generation.current++;
      inputGeneration.current++;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = undefined;
      room.current = null;
      Array.from(records.current.keys()).forEach(removePeer);
      pendingSignals.current.clear();
      // The room is rebuilt from the rejoin acknowledgement; pending announcements are stale.
      clearLeaveCues();
      streamProtocol.current = false;
      streamSubscribers.current.clear();
      activeWatchedStreams.current.clear();
      setWatchingStreams([]);
      reconnectRoom.current = previous;
      if (previous) { setVoiceChannelId(previous); setConnectionStatus('reconnecting'); }
    };
    const connected = () => { const previous = reconnectRoom.current; if (previous) void join(previous, true); };
    const soundPlayed = (payload: { sound: { url: string }; userId: string }) => {
      // Must be currently in a voice channel to receive soundboard playback
      if (!room.current) return;
      // Do not play if the receiver is deafened
      if (state.current.deafened || moderationRef.current.deafened) return;

      void soundboardService.playSound(payload.sound.url, {
        volume: settingsRef.current.soundboardVolume ?? 1,
        isMuted: settingsRef.current.soundboardMuted ?? false,
        userId: payload.userId,
        outputVolume: settingsRef.current.outputVolume ?? 1,
        outputDeviceId: settingsRef.current.outputDevice,
      });
    };
    socket.on('user:update', syncUser);
    socket.on('voice:moderated', moderated);
    socket.on('voice:peer-joined', peerJoined);
    socket.on('voice:peer-left', peerLeft);
    socket.on('voice:signal', signal);
    socket.on('voice:state', peerState);
    socket.on('voice:stream-watch', streamWatch);
    socket.on('voice:stream-unwatch', streamUnwatch);
    socket.on('voice:activity', activity);
    socket.on('voice:disconnect', forcedDisconnect);
    socket.on('disconnect', disconnected);
    socket.on('connect', connected);
    socket.on('sound:play', soundPlayed);
    return () => {
      socket.off('user:update', syncUser);
      socket.off('voice:moderated', moderated);
      socket.off('voice:peer-joined', peerJoined);
      socket.off('voice:peer-left', peerLeft);
      socket.off('voice:signal', signal);
      socket.off('voice:state', peerState);
      socket.off('voice:stream-watch', streamWatch);
      socket.off('voice:stream-unwatch', streamUnwatch);
      socket.off('voice:activity', activity);
      socket.off('voice:disconnect', forcedDisconnect);
      socket.off('disconnect', disconnected);
      socket.off('connect', connected);
      socket.off('sound:play', soundPlayed);
      if (room.current) socket.emit('voice:leave');
      room.current = null;
      leave();
      stopMicTest();
    };
  }, [socket, currentUserId]);

  useEffect(() => {
    if (!background) { setSpeaking(Boolean(state.current.speaking)); refreshPeers(); }
  }, [background]);

  useEffect(() => {
    if ((loadedSettings.error || initialVoice.persistenceError) && !settingsEdited.current) return;
    try {
      saveMediaPreference('haven.media.settings', JSON.stringify(settings));
      // Recover only after both microphone policy and mute/deafen state are durable.
      saveMediaPreference('haven.voice.state', JSON.stringify({ muted: state.current.muted, deafened: state.current.deafened }));
      persistenceBlocked.current = false;
      setPersistenceError(null);
      applyAudioState();
    } catch (error) { persistenceFailed(error); }
  }, [settings]);

  useEffect(() => {
    if (microphone.current && (room.current || reconnectRoom.current)) void acquireMicrophone(generation.current).catch(error => fail(error, 'Could not update microphone'));
    if (testDesired.current) void startMicTest();
    if (inputMonitorRef.current?.requested) {
      stopInputMonitor();
      void startInputMonitor();
    }
  }, [settings.inputDevice, settings.noiseSuppression, settings.noiseSuppressionMode, settings.echoCancellation]);


  useEffect(() => {
    records.current.forEach(record => { record.audio.forEach(audio => { void setOutput(audio); }); });
    const context = mixer.current as (AudioContext & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
    if (context?.setSinkId) void context.setSinkId(settings.outputDevice).catch(error => fail(error, 'Could not select soundboard speaker'));
    const resources = testResources.current;
    if (resources?.audio) void setOutput(resources.audio, true).catch(error => {
      if (testResources.current !== resources) return;
      stopMicTest();
      updateMicTest({ status: 'error', level: 0, speaking: false, error: error instanceof Error ? error.message : 'Could not select test output.' });
    });
  }, [settings.outputDevice]);

  useEffect(() => {
    records.current.forEach(applyPeerAudio);
  }, [settings.outputVolume]);

  useEffect(() => {
    pushHeld.current = false;
    applyAudioState();
  }, [settings.pushToTalk, settings.pushToTalkKey]);

  useEffect(() => {
    const desktop = desktopSettings.current;
    if (desktop?.canConfigure && desktop.gamingMode !== settings.gamingMode) {
      void window.haven?.updateDesktopSettings({ gamingMode: settings.gamingMode }).catch(error => fail(error, 'Could not save gaming mode'));
    }
  }, [settings.gamingMode]);

  useEffect(() => {
    records.current.forEach(record => {
      record.connection.getSenders().filter(sender => !record.screenSenders.includes(sender)).forEach(sender => { void configureAudioSender(sender, record.congested); });
    });
    if (screen.current) void applyShareQuality();
  }, [settings.gamingMode, settings.voiceBitrateKbps]);

  useEffect(() => {
    window.haven?.setVoiceState({ connected: Boolean(voiceChannelId), muted: muted || moderation.muted || moderation.deafened, deafened: deafened || moderation.deafened, sharing, pushToTalk: settings.pushToTalk });
  }, [voiceChannelId, muted, deafened, sharing, settings.pushToTalk, moderation]);

  useEffect(() => {
    const desktop = window.haven;
    if (!desktop?.onDesktopShortcut) return;
    const shortcut = desktop.onDesktopShortcut(event => {
      if (recordingShortcut.current) { pushHeld.current = false; applyAudioState(); return; }
      if (event.action === 'mute') toggleMute();
      else if (event.action === 'deafen') toggleDeafen();
      else {
        pushHeld.current = 'pressed' in event && event.pressed && settingsRef.current.pushToTalk;
        applyAudioState();
      }
    });
    const applyDesktop = (value: Awaited<ReturnType<typeof desktop.getDesktopSettings>>) => {
      const previousGlobal = globalPtt.current;
      globalPtt.current = value.runtime.globalPttAvailable;
      desktopPttKey.current = value.settings.pttShortcut;
      // Record the authoritative value before applying it, so broadcasts are
      // consumed without echoing writes, especially from isolated clients.
      desktopSettings.current = { canConfigure: value.runtime.canConfigureDesktop, gamingMode: value.settings.gamingMode };
      if (settingsRef.current.gamingMode !== value.settings.gamingMode) setSettings({ gamingMode: value.settings.gamingMode }, false);
      if (previousGlobal && !globalPtt.current) { pushHeld.current = false; applyAudioState(); }
    };
    void desktop.getDesktopSettings().then(applyDesktop).catch(() => {});
    const changed = desktop.onDesktopState(applyDesktop);
    return () => { shortcut(); changed(); };
  }, []);

  useEffect(() => {
    void enumerateDevices();
    const changed = () => { void enumerateDevices(true); };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    const pttShortcut = () => desktopPttKey.current ?? settingsRef.current.pushToTalkKey;
    const releaseLocalPtt = () => { if (!globalPtt.current && pushHeld.current) { pushHeld.current = false; applyAudioState(); } };
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const shortcut = pttShortcut();
      if (event.repeat || recordingShortcut.current || globalPtt.current || !settingsRef.current.pushToTalk || !shortcut || !matchesShortcut(event, shortcut)) return;
      // Only keys that would type text are ignored inside text fields; F-keys, modifiers and chords still work.
      if (shortcutTypesText(shortcut) && target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return;
      if (target?.closest('[data-shortcut-recorder]')) return;
      event.preventDefault();
      pushHeld.current = true;
      applyAudioState();
    };
    const keyup = (event: KeyboardEvent) => { if (pushHeld.current && releasesShortcut(event, pttShortcut())) releaseLocalPtt(); };
    // A browser only sees keys while the page has focus, so any loss of focus or visibility must close the
    // microphone: the matching key-up would never be delivered.
    const hidden = () => { if (document.visibilityState === 'hidden') releaseLocalPtt(); };
    const blur = () => releaseLocalPtt();
    const resume = () => {
      if (mixer.current?.state === 'suspended') void mixer.current.resume().catch(() => {});
      records.current.forEach(record => { record.audio.forEach(audio => { void audio.play().catch(() => {}); }); });
      records.current.forEach(record => scheduleIceRestart(record));
    };
    const recording = (event: Event) => {
      recordingShortcut.current = (event as CustomEvent<{ active: boolean }>).detail?.active === true;
      pushHeld.current = false;
      applyAudioState();
    };
    window.addEventListener('haven:shortcut-recording', recording);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', blur);
    window.addEventListener('pagehide', blur);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pointerdown', resume);
    window.addEventListener('online', resume);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', changed);
      window.removeEventListener('haven:shortcut-recording', recording);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pagehide', blur);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('online', resume);
      leave();
      stopMicTest();
      stopInputMonitor();
    };
  }, []);

  const hasRemoteVideo = peers.some(peer => peer.stream?.getVideoTracks().length);
  useEffect(() => {
    if (!voiceChannelId || !peers.length) return;
    let sampling = false;
    let cancelled = false;
    const samplePeriod = statisticsInterval(background, settings.gamingMode, videoDetailsOpen);
    const unsubscribe = subscribeConnectionReports(connectionStatsSources, async samples => {
      if (sampling || !room.current || !records.current.size) return;
      const hasVideo = Boolean(screen.current || Array.from(records.current.values()).some(record => record.videoTracks.size));
      sampling = true;
      const operation = generation.current;
      const outbound: VideoStatistics[] = [];
      const inbound: VideoStatistics[] = [];
      try {
        const sourceTrack = screen.current?.getVideoTracks()[0];
        // Chromium can retain display-sized getSettings() metadata for window
        // capture. The encoder's media-source report measures actual input frames
        // without keeping an extra background video decoder alive.
        if (sourceTrack) for (const { report } of samples) report?.forEach(value => {
          if (value.type === 'media-source' && value.kind === 'video' && value.trackIdentifier === sourceTrack.id && value.width > 0 && value.height > 0) {
            screenSourceSize.current = { trackId: sourceTrack.id, width: value.width, height: value.height };
          }
        });
        const captured = sourceTrack ? screenDimensions(sourceTrack) : null;
        if (captured?.width && captured.height && (captured.width !== qualityRef.current.nativeWidth || captured.height !== qualityRef.current.nativeHeight)) {
          await applyShareQuality();
        }
        if (cancelled || operation !== generation.current) return;
        await Promise.all(samples.map(async ({ source, report: reports }) => {
          const socketId = source.socketId;
          const record = records.current.get(socketId);
          if (!record || record.connection !== source.connection || record.connection.connectionState !== 'connected' || !reports) return;
          let loss: number | null = null;
          let rtt: number | null = null;
          reports.forEach(report => {
            if (report.type === 'remote-inbound-rtp' && (report.kind ?? report.mediaType) === 'audio') {
              const key = `${socketId}:${report.id}:${report.ssrc ?? ''}`;
              const previous = audioSamples.current.get(key);
              const measurement = report.roundTripTimeMeasurements ?? report.timestamp;
              if (measurement !== previous) {
                audioSamples.current.set(key, measurement);
                if (typeof report.fractionLost === 'number' && Number.isFinite(report.fractionLost) && report.fractionLost >= 0 && report.fractionLost <= 1) loss = Math.max(loss ?? 0, report.fractionLost);
                if (typeof report.roundTripTime === 'number' && Number.isFinite(report.roundTripTime) && report.roundTripTime >= 0) rtt = Math.max(rtt ?? 0, report.roundTripTime);
              }
            }
            if (background || !videoDetailsOpen) return;
            if (!['outbound-rtp', 'inbound-rtp'].includes(report.type) || (report.kind ?? report.mediaType) !== 'video' || report.isRemote) return;
            const outgoing = report.type === 'outbound-rtp';
            const bytes = outgoing ? report.bytesSent : report.bytesReceived;
            const key = `${socketId}:${report.id}`;
            const previous = byteSamples.current.get(key);
            byteSamples.current.set(key, { bytes: bytes ?? 0, timestamp: report.timestamp });
            const elapsed = previous ? (report.timestamp - previous.timestamp) / 1000 : 0;
            const lossReport = outgoing ? report.remoteId ? reports.get(report.remoteId) : undefined : report;
            const statistic: VideoStatistics = {
              socketId, width: report.frameWidth ?? 0, height: report.frameHeight ?? 0, fps: report.framesPerSecond ?? 0,
              bitrateMbps: previous && elapsed > 0 ? Math.max(0, ((bytes ?? 0) - previous.bytes) * 8 / elapsed / 1_000_000) : 0,
              packetsLost: typeof lossReport?.packetsLost === 'number' ? lossReport.packetsLost : null,
              jitter: typeof lossReport?.jitter === 'number' ? lossReport.jitter : null,
              qualityLimitationReason: report.qualityLimitationReason,
            };
            (outgoing ? outbound : inbound).push(statistic);
          });
          const previous = record.congestion ?? initialCongestion;
          const next = adaptCongestion(previous, loss, rtt);
          record.congestion = next;
          if (next.videoLimited !== previous.videoLimited) {
            await Promise.all(record.screenSenders.map(sender => configureScreenSender(sender).catch(() => {})));
          }
          // Foreground/mode changes may replace this observer while the encoder
          // applies its parameters. Never let an older decision undo newer health.
          if (cancelled || operation !== generation.current || records.current.get(socketId) !== record || record.congestion !== next) return;
          if (next.voiceLimited !== record.congested) {
            record.congested = next.voiceLimited;
            record.connection.getSenders().filter(sender => !record.screenSenders.includes(sender)).forEach(sender => { void configureAudioSender(sender, record.congested); });
          }
        }));
        if (!cancelled && operation === generation.current && hasVideo && videoDetailsOpen && !background) {
          qualityRef.current = { ...qualityRef.current, stats: { outbound, inbound } };
          updateQuality(qualityRef.current);
        }
      } catch {} finally { sampling = false; }
    }, samplePeriod);
    return () => { cancelled = true; unsubscribe(); };
  }, [voiceChannelId, peers.length, sharing, hasRemoteVideo, settings.gamingMode, background, videoDetailsOpen, connectionStatsSources]);

  return {
    join, voiceChannelId,
    /** Disconnects deliberately, with the leave cue. */
    leave: () => {
      const active = Boolean(room.current || reconnectRoom.current);
      leave();
      if (active) voiceCue('leave');
    },
    get peers() { return Array.from(records.current.values(), record => ({ ...record.peer })); },
    localStream, screenStream, muted: muted || moderation.muted || moderation.deafened, deafened: deafened || moderation.deafened, speaking, connectionStatus, moderation,
    toggleMute, toggleDeafen, sharing, startShare, stopShare,
    watchStream, stopWatchingStream,
    get watchingStreams() { return Array.from(activeWatchedStreams.current); },
    isWatchingStream: (id: string) => activeWatchedStreams.current.has(id),
    streamError: (id: string) => streamErrors.current.get(id),
    setStreamVolume,
    addStreamSubscriber, removeStreamSubscriber,
    shareOptions: quality.nativeWidth ? shareOptionsFor(quality.nativeWidth, quality.nativeHeight) : [],
    setShareQuality, quality, settings, persistenceError, setSettings, devices, enumerateDevices, refreshDevices, deviceError, setPeerVolume, setUserVolume, setUserLocallyMuted, playSound,
    micTest, startMicTest, stopMicTest, microphoneProcessing, testProcessing, connectionStatsSources, setVideoDetailsOpen, background,
    inputMeter, startInputMonitor, stopInputMonitor, testOutputSound,
    // Soundboard Controls & Entry Sounds
    get soundboardVolume() { return settings.soundboardVolume ?? 1; },
    get soundboardMuted() { return Boolean(settings.soundboardMuted || (settings.soundboardVolume ?? 1) === 0); },
    setSoundboardVolume: (volume: number) => {
      const bounded = Math.max(0, Math.min(1, volume));
      const muted = bounded === 0;
      if (bounded > 0) {
        soundboardPreviousVolume.current = bounded;
      }
      setSettings({ soundboardVolume: bounded, soundboardMuted: muted });
    },
    setSoundboardMuted: (muted: boolean) => {
      setSettings(prev => {
        if (muted) {
          if (prev.soundboardVolume > 0) soundboardPreviousVolume.current = prev.soundboardVolume;
          return { ...prev, soundboardMuted: true, soundboardVolume: 0 };
        } else {
          const restored = soundboardPreviousVolume.current > 0 ? soundboardPreviousVolume.current : 1;
          return { ...prev, soundboardMuted: false, soundboardVolume: restored };
        }
      });
    },
    toggleSoundboardMute: () => {
      setSettings(prev => {
        const isCurrentlyMuted = Boolean(prev.soundboardMuted || (prev.soundboardVolume ?? 1) === 0);
        if (isCurrentlyMuted) {
          const restored = soundboardPreviousVolume.current > 0 ? soundboardPreviousVolume.current : 1;
          return { ...prev, soundboardMuted: false, soundboardVolume: restored };
        } else {
          if (prev.soundboardVolume > 0) soundboardPreviousVolume.current = prev.soundboardVolume;
          return { ...prev, soundboardMuted: true, soundboardVolume: 0 };
        }
      });
    },
    isUserSoundboardMuted: (userId: string) => soundboardService.isUserSoundboardMuted(userId),
    setUserSoundboardMuted: (userId: string, muted: boolean) => {
      soundboardService.setUserSoundboardMuted(userId, muted);
      refreshPeers();
    },
    getEntrySoundId: (serverId: string, user?: User | null) => soundboardService.getEntrySoundId(serverId, user),
    saveEntrySound: async (serverId: string, soundId: string | null, currentUser: User) => {
      return await soundboardService.saveEntrySound(serverId, soundId, currentUser);
    },
  };
}
