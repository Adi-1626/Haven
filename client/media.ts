import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { bitrateBits, captureDimensions, qualityForSource, senderScale, shareOptionsFor } from './media-quality';
import type { ShareFps, ShareHeight } from './media-quality';
import { createMicrophonePipeline, normalizeAudioSettings } from './audio-pipeline';
import { audioBitrate, isCaptureCancellation, matchesShortcut, missingAudioDevice, releasesShortcut, voiceDescription } from './audio-policy';

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
export interface MediaSettings {
  inputDevice: string;
  outputDevice: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  pushToTalk: boolean;
  inputVolume: number;
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
}
interface Signal {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}
const initialSettings: MediaSettings = {
  inputDevice: '', outputDevice: '', noiseSuppression: true, echoCancellation: true, pushToTalk: false,
  inputVolume: 1, inputSensitivity: -45,
  pushToTalkKey: 'Control+Shift+Space', gamingMode: false,
};
const initialQuality: ShareQuality = {
  nativeWidth: 0, nativeHeight: 0, width: 0, height: 0, fps: 60, bitrateMbps: 8,
  stats: { outbound: [], inbound: [] },
};

function readSettings(): MediaSettings {
  try {
    const saved: unknown = JSON.parse((typeof window !== 'undefined' ? window.haven?.readClientSetting?.('haven.media.settings') : null) ?? localStorage.getItem('haven.media.settings') ?? '{}');
    if (!saved || typeof saved !== 'object') return initialSettings;
    const values = saved as Record<string, unknown>;
    const next = { ...initialSettings };
    for (const key of ['inputDevice', 'outputDevice', 'pushToTalkKey'] as const) if (typeof values[key] === 'string') next[key] = values[key];
    for (const key of ['noiseSuppression', 'echoCancellation', 'pushToTalk', 'gamingMode'] as const) if (typeof values[key] === 'boolean') next[key] = values[key];
    for (const key of ['inputVolume', 'inputSensitivity'] as const) if (typeof values[key] === 'number') next[key] = values[key];
    Object.assign(next, normalizeAudioSettings(next));
    return next;
  } catch { return initialSettings; }
}

function readVoiceState(): VoiceState {
  try {
    const saved = JSON.parse((typeof window !== 'undefined' ? window.haven?.readClientSetting?.('haven.voice.state') : null) ?? localStorage.getItem('haven.voice.state') ?? '{}');
    return { muted: saved.muted === true, deafened: saved.deafened === true, sharing: false };
  } catch { return { muted: false, deafened: false, sharing: false }; }
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
  const [micTest, updateMicTest] = useState<{ status: 'idle' | 'starting' | 'running' | 'error'; level: number; speaking: boolean; error: string | null }>({ status: 'idle', level: 0, speaking: false, error: null });
  const [settings, updateSettings] = useState<MediaSettings>(readSettings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [background, setBackground] = useState(document.hidden);
  const [quality, updateQuality] = useState<ShareQuality>(initialQuality);
  const records = useRef(new Map<string, PeerConnection>());
  const pendingSignals = useRef(new Map<string, Signal[]>());
  const microphone = useRef<MediaStream | null>(null);
  const screen = useRef<MediaStream | null>(null);
  const sourcePreview = useRef<HTMLVideoElement | null>(null);
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
  const desktopReady = useRef(false);
  const recordingShortcut = useRef(false);
  const roomServerId = useRef<string | null>(null);
  const localPreferences = useRef(new Map<string, { volume: number; muted: boolean }>());
  const moderationRef = useRef({ muted: false, deafened: false });
  const [moderation, setModeration] = useState(moderationRef.current);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const desktopBackground = useRef(false);
  const audioSamples = useRef(new Map<string, { lost: number; received: number }>());
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
    setSpeaking(next);
    if (room.current) voiceSocket.current?.emit('voice:activity', { speaking: next });
  }
  function microphoneEnabled() {
    return !recordingShortcut.current && !state.current.muted && !state.current.deafened && !moderationRef.current.muted && !moderationRef.current.deafened && (!settingsRef.current.pushToTalk || pushHeld.current);
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
    if (!enabled) updateSpeaking(false);
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
  function microphoneConstraints(): MediaTrackConstraints {
    const options = settingsRef.current;
    return {
      ...(options.inputDevice ? { deviceId: { exact: options.inputDevice } } : {}),
      noiseSuppression: options.noiseSuppression, echoCancellation: options.echoCancellation, autoGainControl: true,
      channelCount: { ideal: 1 },
    };
  }
  async function acquireMicrophone(expectedGeneration: number) {
    const inputRequest = ++inputGeneration.current;
    const selectedInput = settingsRef.current.inputDevice;
    let nextStream: MediaStream;
    try { nextStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false }); }
    catch (error) {
      if (!selectedInput || selectedInput !== settingsRef.current.inputDevice || !error || typeof error !== 'object' || !('name' in error) || !['OverconstrainedError', 'NotFoundError'].includes(String(error.name))) throw error;
      if (inputRequest !== inputGeneration.current || expectedGeneration !== generation.current) return false;
      setSettings({ inputDevice: '' });
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false });
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
      const pipeline = createMicrophonePipeline(context, nextStream, destination.current!, () => settingsRef.current, microphoneEnabled, (_level, active) => updateSpeaking(active));
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
    updateMicTest({ status: 'idle', level: 0, speaking: false, error: null });
  }
  async function startMicTest() {
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
      captured = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false });
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
      pipeline = createMicrophonePipeline(context, captured, output, () => settingsRef.current, () => true, (level, active) => {
        if (isCurrent()) updateMicTest({ status: 'running', level, speaking: active, error: null });
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
    const captured = screenDimensions(sender.track);
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings.length ? parameters.encodings : [{}];
    parameters.encodings.forEach(encoding => {
      encoding.maxBitrate = bitrateBits(settingsRef.current.gamingMode ? Math.min(3, config.bitrateMbps) : config.bitrateMbps);
      encoding.maxFramerate = config.fps;
      encoding.scaleResolutionDownBy = senderScale(captured.width ?? config.width, captured.height ?? config.height, config.width, config.height);
    });
    parameters.degradationPreference = 'maintain-resolution';
    await sender.setParameters(parameters);
  }
  async function configureAudioSender(sender: RTCRtpSender, congested: boolean) {
    if (sender.track?.kind !== 'audio') return;
    const parameters = sender.getParameters();
    parameters.encodings = (parameters.encodings.length ? parameters.encodings : [{}]).map(encoding => ({
      ...encoding, maxBitrate: audioBitrate(settingsRef.current.gamingMode, congested), dtx: 'enabled',
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
    const captured = track.getSettings();
    return {
      width: sourcePreview.current?.videoWidth || captured.width,
      height: sourcePreview.current?.videoHeight || captured.height,
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
        await connection.setLocalDescription(voiceDescription(await connection.createOffer(), settingsRef.current.gamingMode));
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
        audio.volume = record.peer.volume;
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
          await connection.setLocalDescription(voiceDescription(await connection.createAnswer(), settingsRef.current.gamingMode));
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
    sourcePreview.current?.pause();
    if (sourcePreview.current) sourcePreview.current.srcObject = null;
    sourcePreview.current = null;
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
    if (room.current) voiceSocket.current?.emit('voice:leave');
    room.current = null;
    stopShare();
    Array.from(records.current.keys()).forEach(removePeer);
    pendingSignals.current.clear();
    microphonePipeline.current?.stop();
    microphonePipeline.current = null;
    microphone.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    microphone.current = null;
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
      const response = await fetch('/api/rtc', { credentials: 'include' });
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
    const captured = screen.current;
    if (!captured) return;
    qualityQueue.current = qualityQueue.current.catch(() => {}).then(async () => {
      if (screen.current !== captured) return;
      const track = captured.getVideoTracks()[0];
      try {
        if (settingsRef.current.gamingMode) {
          height = height === 'native' ? 720 : Math.min(720, height);
          fps = Math.min(30, fps) as ShareFps;
          bitrateMbps = Math.min(3, bitrateMbps);
        }
        const constraints: MediaTrackConstraints & { resizeMode: string } = { frameRate: { ideal: fps, max: fps }, resizeMode: 'none' };
        await track.applyConstraints(constraints);
        if (screen.current !== captured) return;
        const source = screenDimensions(track);
        const current = qualityRef.current;
        const dimensions = qualityForSource(source.width ?? current.nativeWidth, source.height ?? current.nativeHeight, height);
        qualityHeight.current = height;
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
      const fps = settingsRef.current.gamingMode ? 30 : qualityRef.current.fps;
      const captured = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: fps, max: fps } }, audio: true });
      if (operation !== screenGeneration.current || !room.current) { captured.getTracks().forEach(track => track.stop()); return; }
      const track = captured.getVideoTracks()[0];
      if (!track) { captured.getTracks().forEach(item => item.stop()); throw new Error('No screen video was selected'); }
      const source = track.getSettings();
      const native = captureDimensions(source.width ?? 1, source.height ?? 1);
      screen.current = captured;
      const preview = document.createElement('video');
      preview.muted = true;
      preview.autoplay = true;
      preview.playsInline = true;
      preview.srcObject = captured;
      sourcePreview.current = preview;
      void preview.play().catch(() => {});
      track.contentHint = 'detail';
      track.onended = stopShare;
      qualityRef.current = { ...qualityRef.current, nativeWidth: native.width, nativeHeight: native.height, ...native };
      await setShareQuality(settingsRef.current.gamingMode ? 720 : qualityHeight.current, fps, settingsRef.current.gamingMode ? Math.min(3, qualityRef.current.bitrateMbps) : qualityRef.current.bitrateMbps);
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
    if (typeof window !== 'undefined') window.haven?.writeClientSetting?.('haven.voice.state', value);
    try { localStorage.setItem('haven.voice.state', value); } catch {}
  }
  function setSettings(next: Partial<MediaSettings> | ((previous: MediaSettings) => MediaSettings)) {
    const updated = typeof next === 'function' ? next(settingsRef.current) : { ...settingsRef.current, ...next };
    settingsRef.current = { ...updated, ...normalizeAudioSettings(updated) };
    updateSettings(settingsRef.current);
  }
  function setUserVolume(userId: string, volume: number) {
    const bounded = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    const preference = localPreferences.current.get(userId) ?? { volume: 1, muted: false };
    localPreferences.current.set(userId, { ...preference, volume: bounded });
    records.current.forEach(record => {
      if (record.peer.user.id !== userId) return;
      record.peer.volume = bounded;
      record.audio.forEach(audio => { audio.volume = bounded; });
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
  async function playSound(url: string) {
    const operation = generation.current;
    try {
      const context = await ensureMixer();
      const response = await fetch(url, { credentials: 'include' });
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
      if (record) { record.peer.state.speaking = payload.speaking; refreshPeers(); }
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
    window.haven?.writeClientSetting?.('haven.media.settings', JSON.stringify(settings));
    try { localStorage.setItem('haven.media.settings', JSON.stringify(settings)); } catch {}
  }, [settings]);

  useEffect(() => {
    if (microphone.current && (room.current || reconnectRoom.current)) void acquireMicrophone(generation.current).catch(error => fail(error, 'Could not update microphone'));
    if (testDesired.current) void startMicTest();
  }, [settings.inputDevice, settings.noiseSuppression, settings.echoCancellation]);

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
    pushHeld.current = false;
    applyAudioState();
  }, [settings.pushToTalk, settings.pushToTalkKey]);

  useEffect(() => {
    if (desktopReady.current) void window.haven?.updateDesktopSettings({ gamingMode: settings.gamingMode }).catch(error => fail(error, 'Could not save gaming mode'));
    records.current.forEach(record => {
      record.connection.getSenders().filter(sender => !record.screenSenders.includes(sender)).forEach(sender => { void configureAudioSender(sender, record.congested); });
      record.screenSenders.forEach(sender => { void configureScreenSender(sender).catch(() => {}); });
    });
    if (settings.gamingMode && screen.current) void setShareQuality(qualityHeight.current, qualityRef.current.fps, qualityRef.current.bitrateMbps);
  }, [settings.gamingMode]);

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
      desktopBackground.current = value.runtime.background;
      setBackground(value.runtime.background || document.hidden);
      desktopReady.current = true;
      if (settingsRef.current.gamingMode !== value.settings.gamingMode) setSettings({ gamingMode: value.settings.gamingMode });
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
    const visibility = () => setBackground(document.hidden || desktopBackground.current);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', changed);
      window.removeEventListener('haven:shortcut-recording', recording);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', visibility);
      leave();
      stopMicTest();
    };
  }, []);

  const hasRemoteVideo = peers.some(peer => peer.stream?.getVideoTracks().length);
  useEffect(() => {
    if (!voiceChannelId || !peers.length) return;
    let sampling = false;
    let cancelled = false;
    const samplePeriod = (sharing || hasRemoteVideo) && !background && !settings.gamingMode ? 1000 : 5000;
    const timer = window.setInterval(async () => {
      if (sampling || !room.current || !records.current.size) return;
      const hasVideo = Boolean(screen.current || Array.from(records.current.values()).some(record => record.videoTracks.size));
      sampling = true;
      const operation = generation.current;
      const outbound: VideoStatistics[] = [];
      const inbound: VideoStatistics[] = [];
      try {
        const sourceTrack = screen.current?.getVideoTracks()[0];
        const captured = sourceTrack ? screenDimensions(sourceTrack) : null;
        if (captured?.width && captured.height && (captured.width !== qualityRef.current.nativeWidth || captured.height !== qualityRef.current.nativeHeight)) {
          await setShareQuality(qualityHeight.current, qualityRef.current.fps, qualityRef.current.bitrateMbps);
        }
        await Promise.all(Array.from(records.current.entries()).map(async ([socketId, record]) => {
          if (record.connection.connectionState !== 'connected') return;
          const reports = await record.connection.getStats();
          let congested = record.congested;
          reports.forEach(report => {
            if (report.type === 'remote-inbound-rtp' && (report.kind ?? report.mediaType) === 'audio') {
              const key = `${socketId}:${report.id}`;
              const previous = audioSamples.current.get(key);
              audioSamples.current.set(key, { lost: report.packetsLost ?? 0, received: report.packetsReceived ?? 0 });
              const lost = Math.max(0, (report.packetsLost ?? 0) - (previous?.lost ?? 0));
              const received = Math.max(0, (report.packetsReceived ?? 0) - (previous?.received ?? 0));
              const loss = typeof report.fractionLost === 'number' ? report.fractionLost : lost / Math.max(1, received + lost);
              congested = loss > (record.congested ? 0.02 : 0.05) || (report.roundTripTime ?? 0) > (record.congested ? 0.25 : 0.4);
            }
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
          if (congested !== record.congested) {
            record.congested = congested;
            record.connection.getSenders().filter(sender => !record.screenSenders.includes(sender)).forEach(sender => { void configureAudioSender(sender, congested); });
          }
        }));
        if (!cancelled && operation === generation.current && hasVideo) {
          qualityRef.current = { ...qualityRef.current, stats: { outbound, inbound } };
          updateQuality(qualityRef.current);
        }
      } catch {} finally { sampling = false; }
    }, samplePeriod);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [voiceChannelId, peers.length, sharing, hasRemoteVideo, settings.gamingMode, background]);

  return {
    join, leave, voiceChannelId, peers, localStream, screenStream, muted: muted || moderation.muted || moderation.deafened, deafened: deafened || moderation.deafened, speaking, connectionStatus, moderation,
    toggleMute, toggleDeafen, sharing, startShare, stopShare,
    shareOptions: quality.nativeWidth ? shareOptionsFor(quality.nativeWidth, quality.nativeHeight) : [],
    setShareQuality, quality, settings, setSettings, devices, enumerateDevices, refreshDevices, deviceError, setPeerVolume, setUserVolume, setUserLocallyMuted, playSound,
    micTest, startMicTest, stopMicTest,
  };
}
