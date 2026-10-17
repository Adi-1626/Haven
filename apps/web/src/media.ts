import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { resolveApiUrl } from './api';
import { bitrateBits, captureDimensions, qualityForSource, senderScale, shareOptionsFor } from './media-quality';
import type { ShareFps, ShareHeight } from './media-quality';
import { createMicrophonePipeline, normalizeAudioSettings, microphoneCaptureConstraints, type SuppressionStatus } from './audio-pipeline';
import { audioBitrate, isCaptureCancellation, matchesShortcut, missingAudioDevice, releasesShortcut, voiceDescription } from './audio-policy';
import { adaptCongestion, defaultRuntimePreferences, effectiveSharePreferences, initialCongestion, normalizeRuntimePreferences, statisticsInterval, type RuntimePreferences, type CongestionState } from './runtime-policy';
import { subscribeConnectionReports } from './connection-stats';
import { useAppActivity } from './app-activity';
import { readMediaPreference, saveMediaPreference } from './media-persistence';
import { normalizeLocalShortcut } from './shortcuts';
import { restoreAudioDevices } from './media-devices';

export interface MediaUser {
  id: string;
  name?: string;
  displayName?: string;
  username?: string;
  color?: string;
  avatar?: string | null;
  status?: string;
}

export interface VoiceState { muted: boolean; deafened: boolean; sharing: boolean; speaking?: boolean; serverMuted?: boolean; serverDeafened?: boolean }
export interface MediaPeer {
  socketId: string;
  user: MediaUser;
  stream: MediaStream | null;
  state: VoiceState;
  volume: number;
  localMuted?: boolean;
  connectionState?: RTCPeerConnectionState;
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
  candidates: RTCIceCandidateInit[];
  screenSenders: RTCRtpSender[];
  offerOnInitialNegotiation: boolean;
  signalQueue: Promise<void>;
  videoTracks: Map<string, MediaStreamTrack>;
  restartTimer?: ReturnType<typeof setTimeout>;
  restartAttempts: number;
  congested: boolean;
  congestion?: CongestionState;
}
interface Signal {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}
const initialSettings: MediaSettings = {
  ...defaultRuntimePreferences,
  inputDevice: '', outputDevice: '', inputDeviceLabel: '', outputDeviceLabel: '', noiseSuppression: true, noiseSuppressionMode: 'standard', echoCancellation: true, pushToTalk: false,
  inputVolume: 1, outputVolume: 1, inputSensitivity: -45,
  pushToTalkKey: 'Control+Shift+Space', gamingMode: false,
};
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
    for (const [key, min, max] of [['inputVolume', 0, 2], ['outputVolume', 0, 1], ['inputSensitivity', -60, -10], ['voiceBitrateKbps', 24, 64], ['shareBitrateMbps', 1, 50]] as const) {
      if (key in values && !(typeof values[key] === 'number' && Number.isFinite(values[key]) && values[key] >= min && values[key] <= max)) throw new Error(`Invalid saved media setting: ${key}`);
    }
    if ('pushToTalkKey' in values) normalizeLocalShortcut(values.pushToTalkKey as string);
    if ('noiseSuppressionMode' in values && !['standard', 'enhanced'].includes(values.noiseSuppressionMode as string)) throw new Error('Invalid suppression mode');
    if ('shareFps' in values && ![15, 30, 60].includes(values.shareFps as number)) throw new Error('Invalid share frame rate');
    if ('shareHeight' in values && values.shareHeight !== 'native' && !(typeof values.shareHeight === 'number' && Number.isInteger(values.shareHeight) && values.shareHeight > 0 && values.shareHeight <= 8640)) throw new Error('Invalid share height');
    if (values.noiseSuppressionMode === 'enhanced') next.noiseSuppressionMode = 'enhanced';
    for (const key of ['inputDevice', 'outputDevice', 'inputDeviceLabel', 'outputDeviceLabel', 'pushToTalkKey'] as const) if (typeof values[key] === 'string') next[key] = values[key];
    for (const key of ['noiseSuppression', 'echoCancellation', 'pushToTalk', 'gamingMode'] as const) if (typeof values[key] === 'boolean') next[key] = values[key];
    for (const key of ['inputVolume', 'outputVolume', 'inputSensitivity'] as const) if (typeof values[key] === 'number') next[key] = values[key];
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

export function useMedia(socket: Socket | null, currentUserId: string, reportError: (message: string) => void) {
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
  const [inputLevel, setInputLevel] = useState(0);
  const inputMonitorRef = useRef<{ stream: MediaStream; context: AudioContext; pipeline: ReturnType<typeof createMicrophonePipeline> } | null>(null);
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
  const audioSamples = useRef(new Map<string, number>());
  errorRef.current = reportError;
  settingsRef.current = settings;
  qualityRef.current = quality;
  voiceSocket.current = socket;

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
  function remoteAudioMuted(peer: MediaPeer) {
    return state.current.deafened || moderationRef.current.deafened || Boolean(peer.localMuted || peer.state.serverMuted || peer.state.serverDeafened);
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
      setInputLevel(0);
    }
    microphonePipeline.current?.refresh();
    records.current.forEach(record => { record.audio.forEach(audio => { audio.muted = remoteAudioMuted(record.peer); }); });
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
          setInputLevel(Math.round(level * 50) / 50);
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
  function scheduleIceRestart(record: PeerConnection) {
    if (record.restartTimer || record.restartAttempts >= 5 || !room.current || !voiceSocket.current?.connected) return;
    record.restartTimer = setTimeout(() => {
      record.restartTimer = undefined;
      if (records.current.get(record.peer.socketId) !== record || !room.current || !voiceSocket.current?.connected) return;
      if (!['failed', 'disconnected'].includes(record.connection.connectionState)) return;
      record.restartAttempts++;
      record.connection.restartIce();
      scheduleIceRestart(record);
    }, Math.min(30_000, 2000 * 2 ** record.restartAttempts));
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
  function removePeer(socketId: string) {
    pendingSignals.current.delete(socketId);
    const record = records.current.get(socketId);
    if (!record) return;
    records.current.delete(socketId);
    clearTimeout(record.restartTimer);
    record.connection.close();
    record.audio.forEach(audio => { audio.pause(); audio.srcObject = null; audio.remove(); });
    byteSamples.current.forEach((_sample, key) => { if (key.startsWith(`${socketId}:`)) byteSamples.current.delete(key); });
    audioSamples.current.forEach((_sample, key) => { if (key.startsWith(`${socketId}:`)) audioSamples.current.delete(key); });
    refreshPeers();
  }
  function createPeer(socketId: string, user: MediaUser, offerOnInitialNegotiation = true) {
    const existing = records.current.get(socketId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: iceServers.current });
    const record: PeerConnection = {
      connection, audio: new Map(), makingOffer: false, ignoreOffer: false, answering: false, candidates: [], screenSenders: [],
      offerOnInitialNegotiation, signalQueue: Promise.resolve(),
      videoTracks: new Map(), restartAttempts: 0, congested: false,
      peer: { socketId, user, stream: null, state: { muted: false, deafened: false, sharing: false }, volume: localPreferences.current.get(user.id)?.volume ?? 1, localMuted: localPreferences.current.get(user.id)?.muted ?? false },
    };
    records.current.set(socketId, record);
    connection.onicecandidate = event => {
      if (event.candidate) voiceSocket.current?.emit('voice:signal', { target: socketId, candidate: event.candidate.toJSON() });
    };
    connection.onnegotiationneeded = async () => {
      if (!record.offerOnInitialNegotiation && !connection.remoteDescription) return;
      try {
        record.makingOffer = true;
        await connection.setLocalDescription(voiceDescription(await connection.createOffer(), settingsRef.current.gamingMode, settingsRef.current.voiceBitrateKbps));
        voiceSocket.current?.emit('voice:signal', { target: socketId, description: connection.localDescription?.toJSON() });
      } catch (error) {
        if (connection.signalingState !== 'closed') fail(error, 'Voice negotiation failed');
      } finally { record.makingOffer = false; }
    };
    connection.ontrack = event => {
      const stream = record.peer.stream ?? new MediaStream();
      if (!stream.getTracks().some(track => track.id === event.track.id)) stream.addTrack(event.track);
      if (event.track.kind === 'video') record.videoTracks.set(event.track.id, event.track);
      record.peer.stream = stream;
      if (event.track.kind === 'audio' && !record.audio.has(event.track.id)) {
        const audio = new Audio();
        audio.autoplay = true;
        audio.muted = remoteAudioMuted(record.peer);
        audio.volume = Math.max(0, Math.min(1, record.peer.volume * (settingsRef.current.outputVolume ?? 1)));
        audio.srcObject = new MediaStream([event.track]);
        record.audio.set(event.track.id, audio);
        void setOutput(audio);
        void audio.play().catch(() => {});
      }
      event.track.onended = () => {
        stream.removeTrack(event.track);
        record.videoTracks.delete(event.track.id);
        const audio = record.audio.get(event.track.id);
        if (audio) { audio.pause(); audio.srcObject = null; record.audio.delete(event.track.id); }
        refreshPeers();
      };
      event.track.onmute = () => {
        if (event.track.kind === 'video') stream.removeTrack(event.track);
        refreshPeers();
      };
      event.track.onunmute = () => {
        if (event.track.kind === 'video' && record.peer.state.sharing && !stream.getTracks().includes(event.track)) stream.addTrack(event.track);
        refreshPeers();
      };
      refreshPeers();
    };
    connection.onconnectionstatechange = () => {
      record.peer.connectionState = connection.connectionState;
      refreshPeers();
      if (connection.connectionState === 'connected') {
        clearTimeout(record.restartTimer);
        record.restartTimer = undefined;
        record.restartAttempts = 0;
      } else if (['failed', 'disconnected'].includes(connection.connectionState)) scheduleIceRestart(record);
    };
    destination.current?.stream.getAudioTracks().forEach(track => {
      const sender = connection.addTrack(track, destination.current!.stream);
      const transceiver = connection.getTransceivers().find(value => value.sender === sender);
      const codecs = RTCRtpSender.getCapabilities?.('audio')?.codecs;
      if (codecs && transceiver?.setCodecPreferences) {
        const opus = codecs.filter(codec => codec.mimeType.toLowerCase() === 'audio/opus');
        if (opus.length) transceiver.setCodecPreferences([...opus, ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'audio/opus')]);
      }
      void configureAudioSender(sender, record.congested);
    });
    screen.current?.getTracks().forEach(track => {
      const sender = connection.addTrack(track, screen.current!);
      record.screenSenders.push(sender);
      void configureScreenSender(sender).catch(error => fail(error, 'Could not configure screen encoding'));
    });
    const queued = pendingSignals.current.get(socketId) ?? [];
    pendingSignals.current.delete(socketId);
    queued.forEach(signal => { void receiveSignal(signal); });
    refreshPeers();
    return record;
  }
  async function receiveSignal(signal: Signal) {
    if (!room.current) return;
    const record = records.current.get(signal.from);
    if (!record) {
      if (pendingSignals.current.size >= 16 && !pendingSignals.current.has(signal.from)) return;
      const queued = pendingSignals.current.get(signal.from) ?? [];
      if (queued.length < 64) queued.push(signal);
      pendingSignals.current.set(signal.from, queued);
      return;
    }
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
        if (record.ignoreOffer) return;
        record.answering = signal.description.type === 'answer';
        await connection.setRemoteDescription(signal.description);
        record.answering = false;
        for (const candidate of record.candidates.splice(0)) await connection.addIceCandidate(candidate);
        if (signal.description.type === 'offer') {
          await connection.setLocalDescription(voiceDescription(await connection.createAnswer(), settingsRef.current.gamingMode, settingsRef.current.voiceBitrateKbps));
          record.offerOnInitialNegotiation = true;
          voiceSocket.current?.emit('voice:signal', { target: signal.from, description: connection.localDescription?.toJSON() });
        }
      } else if (signal.candidate && !record.ignoreOffer) {
        if (connection.remoteDescription) await connection.addIceCandidate(signal.candidate);
        else record.candidates.push(signal.candidate);
      }
    } catch (error) {
      record.answering = false;
      if (!record.ignoreOffer && connection.signalingState !== 'closed') fail(error, 'Voice connection failed');
    }
  }
  function stopShare() {
    screenGeneration.current++;
    const captured = screen.current;
    screen.current = null;
    screenSourceSize.current = null;
    captured?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    records.current.forEach(record => {
      record.screenSenders.forEach(sender => {
        try { record.connection.removeTrack(sender); } catch {}
      });
      record.screenSenders = [];
    });
    state.current.sharing = false;
    setSharing(false);
    setScreenStream(null);
    qualityRef.current = { ...qualityRef.current, nativeWidth: 0, nativeHeight: 0, width: 0, height: 0, stats: { outbound: [], inbound: [] } };
    updateQuality(qualityRef.current);
    emitState();
  }
  function leave() {
    roomServerId.current = null;
    moderationRef.current = { muted: false, deafened: false };
    setModeration(moderationRef.current);
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    reconnectAttempts.current = 0;
    generation.current++;
    inputGeneration.current++;
    reconnectRoom.current = null;
    updateSpeaking(false);
    setInputLevel(0);
    stopInputMonitor();
    if (room.current) voiceSocket.current?.emit('voice:leave');
    room.current = null;
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
    pushHeld.current = false;
    setLocalStream(null);
    setVoiceChannelId(null);
    setConnectionStatus('disconnected');
  }
  async function join(channelId: string, recovering = false) {
    if (room.current === channelId) return;
    if (!recovering) leave();
    const operation = generation.current;
    reconnectRoom.current = channelId;
    setConnectionStatus(recovering ? 'reconnecting' : 'connecting');
    try {
      if (!voiceSocket.current?.connected) throw new Error('Chat connection is offline');
      const response = await fetch(resolveApiUrl('/api/rtc'), { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load authenticated ICE configuration');
      const configuration = await response.json() as { iceServers: RTCIceServer[] };
      if (operation !== generation.current) return;
      iceServers.current = configuration.iceServers ?? [];
      if (!microphone.current?.getAudioTracks().some(track => track.readyState === 'live') && !await acquireMicrophone(operation)) return;
      const activeSocket = voiceSocket.current;
      if (operation !== generation.current) return;
      if (!activeSocket?.connected) throw new Error('Chat connection went offline');
      room.current = channelId;
      setVoiceChannelId(channelId);
      const responsePayload = await new Promise<{ peers?: ({ socketId: string; user: MediaUser } & Partial<VoiceState>)[]; moderation?: { serverId: string; muted: boolean; deafened: boolean }; error?: string }>((resolve, reject) => {
        activeSocket.timeout(10_000).emit('voice:join', { channelId }, (error: Error | null, result: { peers?: ({ socketId: string; user: MediaUser } & Partial<VoiceState>)[]; moderation?: { serverId: string; muted: boolean; deafened: boolean }; error?: string }) => {
          if (error) reject(new Error('Voice channel did not respond'));
          else resolve(result ?? {});
        });
      });
      if (operation !== generation.current) return;
      if (responsePayload.error) throw new Error(responsePayload.error);
      roomServerId.current = responsePayload.moderation?.serverId ?? null;
      applyModeration(responsePayload.moderation ?? { muted: false, deafened: false });
      responsePayload.peers?.forEach(peer => {
        if (peer.socketId === activeSocket.id) return;
        const record = createPeer(peer.socketId, peer.user, false);
        record.peer.state = { muted: peer.muted ?? false, deafened: peer.deafened ?? false, sharing: peer.sharing ?? false, speaking: peer.speaking ?? false, serverMuted: peer.serverMuted, serverDeafened: peer.serverDeafened };
      });
      refreshPeers();
      emitState();
      voiceSocket.current?.emit('voice:activity', { speaking: Boolean(state.current.speaking) });
      setConnectionStatus('connected');
      reconnectRoom.current = null;
      reconnectAttempts.current = 0;
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
      track.contentHint = 'detail';
      track.onended = stopShare;
      qualityRef.current = { ...qualityRef.current, nativeWidth: native.width, nativeHeight: native.height, ...native };
      await applyShareQuality();
      if (screen.current !== captured) return;
      records.current.forEach(record => {
        captured.getTracks().forEach(sharedTrack => {
          const sender = record.connection.addTrack(sharedTrack, captured);
          record.screenSenders.push(sender);
          void configureScreenSender(sender).catch(error => fail(error, 'Could not configure screen encoding'));
        });
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
    const master = settingsRef.current.outputVolume ?? 1;
    records.current.forEach(record => {
      if (record.peer.user.id !== userId) return;
      record.peer.volume = bounded;
      record.audio.forEach(audio => { audio.volume = Math.max(0, Math.min(1, bounded * master)); });
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
  function syncUser(user: MediaUser) {
    let changed = false;
    records.current.forEach(record => {
      if (record.peer.user.id !== user.id) return;
      record.peer.user = { ...record.peer.user, ...user };
      changed = true;
    });
    if (changed) refreshPeers();
  }
  function stopInputMonitor() {
    if (inputMonitorRef.current) {
      inputMonitorRef.current.pipeline.stop();
      inputMonitorRef.current.stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
      if (inputMonitorRef.current.context.state !== 'closed') void inputMonitorRef.current.context.close().catch(() => {});
      inputMonitorRef.current = null;
    }
    if (!room.current && micTest.status !== 'running') {
      setInputLevel(0);
    }
  }
  async function startInputMonitor() {
    if (room.current || micTest.status === 'running' || inputMonitorRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false });
      const context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      await context.resume();
      const output = context.createMediaStreamDestination();
      const pipeline = createMicrophonePipeline(
        context,
        stream,
        output,
        () => ({ ...settingsRef.current, pushToTalk: false }),
        () => true,
        (level) => {
          const now = performance.now();
          if (!backgroundRef.current && now - lastInputSampleTime.current >= 50) {
            lastInputSampleTime.current = now;
            setInputLevel(Math.round(level * 50) / 50);
          }
        }
      );
      inputMonitorRef.current = { stream, context, pipeline };
    } catch {
      // Permission or device unavailable
    }
  }
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
    const operation = generation.current;
    try {
      const context = await ensureMixer();
      const response = await fetch(resolveApiUrl(url), { credentials: 'include' });
      if (!response.ok) throw new Error('Sound file could not be loaded');
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (operation !== generation.current || context.state === 'closed') return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(destination.current!);
      const monitor = context.createGain();
      monitor.gain.value = state.current.deafened || moderationRef.current.deafened ? 0 : 1;
      source.connect(monitor).connect(context.destination);
      sounds.current.add(source);
      soundMonitors.current.add(monitor);
      source.onended = () => { sounds.current.delete(source); soundMonitors.current.delete(monitor); source.disconnect(); monitor.disconnect(); };
      source.start();
    } catch (error) { if (operation === generation.current) fail(error, 'Could not play sound'); }
  }

  useEffect(() => {
    if (!socket) return;
    const peerJoined = (payload: { socketId: string; user: MediaUser } & Partial<VoiceState>) => {
      if (room.current && payload.socketId !== socket.id) {
        const record = createPeer(payload.socketId, payload.user);
        record.peer.state = { muted: payload.muted ?? false, deafened: payload.deafened ?? false, sharing: payload.sharing ?? false, speaking: payload.speaking ?? false, serverMuted: payload.serverMuted, serverDeafened: payload.serverDeafened };
        refreshPeers();
        emitState();
      }
    };
    const peerLeft = (payload: { socketId: string }) => removePeer(payload.socketId);
    const signal = (payload: Signal) => { void receiveSignal(payload); };
    const peerState = (payload: VoiceState & { socketId: string }) => {
      const record = records.current.get(payload.socketId);
      if (record) {
        record.peer.state = { muted: payload.muted, deafened: payload.deafened, sharing: payload.sharing, speaking: payload.speaking ?? record.peer.state.speaking, serverMuted: payload.serverMuted, serverDeafened: payload.serverDeafened };
        record.audio.forEach(audio => { audio.muted = remoteAudioMuted(record.peer); });
        const stream = record.peer.stream;
        if (stream) record.videoTracks.forEach(track => {
          if (!payload.sharing) stream.removeTrack(track);
          else if (track.readyState === 'live' && !track.muted && !stream.getTracks().includes(track)) stream.addTrack(track);
        });
        refreshPeers();
      }
    };
    const forcedDisconnect = (payload: { reason?: string }) => {
      leave();
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
      reconnectRoom.current = previous;
      if (previous) { setVoiceChannelId(previous); setConnectionStatus('reconnecting'); }
    };
    const connected = () => { const previous = reconnectRoom.current; if (previous) void join(previous, true); };
    const soundPlayed = (payload: { sound: { url: string }; userId: string }) => {
      if (!room.current && payload.userId !== currentUserId) void playSound(payload.sound.url);
    };
    socket.on('user:update', syncUser);
    socket.on('voice:moderated', moderated);
    socket.on('voice:peer-joined', peerJoined);
    socket.on('voice:peer-left', peerLeft);
    socket.on('voice:signal', signal);
    socket.on('voice:state', peerState);
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
    if (inputMonitorRef.current) {
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
    const master = settings.outputVolume ?? 1;
    records.current.forEach(record => {
      record.audio.forEach(audio => {
        audio.volume = Math.max(0, Math.min(1, record.peer.volume * master));
      });
    });
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
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || recordingShortcut.current || globalPtt.current || !matchesShortcut(event, desktopPttKey.current ?? settingsRef.current.pushToTalkKey) || !settingsRef.current.pushToTalk || target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],[data-shortcut-recorder]')) return;
      event.preventDefault();
      pushHeld.current = true;
      applyAudioState();
    };
    const keyup = (event: KeyboardEvent) => { if (!globalPtt.current && pushHeld.current && releasesShortcut(event, desktopPttKey.current ?? settingsRef.current.pushToTalkKey)) { pushHeld.current = false; applyAudioState(); } };
    const blur = () => { if (!globalPtt.current) { pushHeld.current = false; applyAudioState(); } };
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
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerdown', resume);
    window.addEventListener('online', resume);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', changed);
      window.removeEventListener('haven:shortcut-recording', recording);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
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
    join, leave, voiceChannelId, peers, localStream, screenStream, muted: muted || moderation.muted || moderation.deafened, deafened: deafened || moderation.deafened, speaking, connectionStatus, moderation,
    toggleMute, toggleDeafen, sharing, startShare, stopShare,
    shareOptions: quality.nativeWidth ? shareOptionsFor(quality.nativeWidth, quality.nativeHeight) : [],
    setShareQuality, quality, settings, persistenceError, setSettings, devices, enumerateDevices, refreshDevices, deviceError, setPeerVolume, setUserVolume, setUserLocallyMuted, playSound,
    micTest, startMicTest, stopMicTest, microphoneProcessing, testProcessing, connectionStatsSources, setVideoDetailsOpen, background,
    inputLevel, startInputMonitor, stopInputMonitor, testOutputSound,
  };
}
