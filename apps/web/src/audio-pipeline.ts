export interface AudioProcessingSettings {
  inputVolume: number;
  outputVolume?: number;
  inputSensitivity: number;
  pushToTalk?: boolean;
  noiseSuppression?: boolean;
  noiseSuppressionMode?: 'standard' | 'enhanced';
}

export type SuppressionStatus = 'off' | 'native' | 'unverified' | 'unavailable' | 'starting' | 'rnnoise' | 'fallback';

export function microphoneCaptureConstraints(options: { inputDevice: string; noiseSuppression: boolean; echoCancellation: boolean; noiseSuppressionMode?: 'standard' | 'enhanced' }): MediaTrackConstraints {
  return {
    ...(options.inputDevice ? { deviceId: { exact: options.inputDevice } } : {}),
    // Chromium cannot reliably change native NS on an active source. Select once
    // at capture time; enhanced startup stays silent until the worklet is ready.
    noiseSuppression: options.noiseSuppression && options.noiseSuppressionMode !== 'enhanced', echoCancellation: options.echoCancellation,
    autoGainControl: false, channelCount: { ideal: 1 },
  };
}

export function normalizeAudioSettings(settings: AudioProcessingSettings): AudioProcessingSettings {
  return {
    inputVolume: Number.isFinite(settings.inputVolume) ? Math.max(0, Math.min(2, settings.inputVolume)) : 1,
    ...(typeof settings.outputVolume === 'number' && Number.isFinite(settings.outputVolume) ? { outputVolume: Math.max(0, Math.min(1, settings.outputVolume)) } : {}),
    inputSensitivity: Number.isFinite(settings.inputSensitivity) ? Math.max(-60, Math.min(-10, settings.inputSensitivity)) : -45,
  };
}

export function measureInput(samples: Float32Array) {
  let total = 0;
  for (const sample of samples) total += sample * sample;
  const rms = Math.sqrt(total / Math.max(1, samples.length));
  const decibels = Math.max(-100, 20 * Math.log10(Math.max(0.00001, rms)));
  return { decibels, level: Math.max(0, Math.min(1, (decibels + 60) / 60)) };
}

export class SpeechGate {
  private lastVoice = -Infinity;
  private open = false;

  sample(decibels: number, threshold: number, enabled: boolean, now: number) {
    if (!enabled) {
      this.lastVoice = -Infinity;
      this.open = false;
      return false;
    }
    if (decibels >= threshold - (this.open ? 4 : 0)) this.lastVoice = now;
    this.open = now - this.lastVoice < 500;
    return this.open;
  }
}

export function createMicrophonePipeline(
  context: AudioContext,
  stream: MediaStream,
  target: AudioNode,
  options: () => AudioProcessingSettings,
  enabled: () => boolean,
  onSample: (level: number, speaking: boolean) => void,
  onProcessing: (status: SuppressionStatus) => void = () => {},
  loadSuppressor = () => import('./noise-suppression').then(module => module.createNoiseSuppressor(context)),
) {
  const source = context.createMediaStreamSource(stream);
  const inputGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 12;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const gateGain = context.createGain();
  gateGain.gain.value = 0;
  source.connect(inputGain).connect(compressor).connect(analyser).connect(gateGain).connect(target);
  const samples = new Float32Array(analyser.fftSize);
  const gate = new SpeechGate();
  let stopped = false;
  let suppressor: { node: AudioNode; stop(): void } | undefined;
  const enhanced = options().noiseSuppression && options().noiseSuppressionMode === 'enhanced';
  let processingReady = !enhanced;
  let lastInputVolume = NaN;
  let lastTransmit: boolean | undefined;
  const nativeStatus = (): SuppressionStatus => {
    if (!options().noiseSuppression) return 'off';
    const applied = stream.getAudioTracks()[0]?.getSettings().noiseSuppression;
    return applied === true ? 'native' : applied === false ? 'unavailable' : 'unverified';
  };
  onProcessing(nativeStatus());
  if (enhanced) {
    onProcessing('starting');
    // Lazy-load only for the explicit enhanced mode. DSP runs on the audio thread.
    void loadSuppressor().then(async processor => {
      if (stopped) { processor.stop(); return; }
      suppressor = processor;
      const fallback = () => {
        if (stopped || suppressor !== processor) return;
        source.disconnect();
        processor.stop();
        suppressor = undefined;
        source.connect(inputGain);
        processingReady = false;
        sample();
        // The capture owner reopens with native NS; applyConstraints is unreliable
        // for changing Chromium's audio processor on a running source.
        onProcessing('fallback');
      };
      (processor.node as AudioWorkletNode).onprocessorerror = fallback;
      // Connect only a fully initialized processor; never transmit raw startup audio.
      source.disconnect();
      source.connect(processor.node).connect(inputGain);
      if (stream.getAudioTracks().some(track => track.getSettings().noiseSuppression === true)) { fallback(); return; }
      processingReady = true;
      sample();
      onProcessing('rnnoise');
    }).catch(() => { if (!stopped) onProcessing('fallback'); });
  }
  const sample = () => {
    if (stopped) return;
    const settings = normalizeAudioSettings(options());
    if (lastInputVolume !== settings.inputVolume) {
      inputGain.gain.setTargetAtTime(settings.inputVolume, context.currentTime, 0.015);
      lastInputVolume = settings.inputVolume;
    }
    analyser.getFloatTimeDomainData(samples);
    const measured = measureInput(samples);
    const speaking = gate.sample(measured.decibels, settings.inputSensitivity, processingReady && enabled() && settings.inputVolume > 0, performance.now());
    // PTT is an explicit transmission decision: never cut quiet speech with VAD.
    const transmit = processingReady && (options().pushToTalk ? enabled() && settings.inputVolume > 0 : speaking);
    if (lastTransmit !== transmit) {
      gateGain.gain.setTargetAtTime(transmit ? 1 : 0, context.currentTime, transmit ? 0.005 : 0.04);
      lastTransmit = transmit;
    }
    onSample(measured.level, speaking);
  };
  sample();
  const timer = globalThis.setInterval(sample, 50);
  return {
    refresh: sample,
    stop() {
      if (stopped) return;
      stopped = true;
      globalThis.clearInterval(timer);
      suppressor?.stop();
      for (const node of [source, inputGain, compressor, analyser, gateGain]) node.disconnect();
    },
  };
}
