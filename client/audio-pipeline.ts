export interface AudioProcessingSettings {
  inputVolume: number;
  inputSensitivity: number;
}

export function normalizeAudioSettings(settings: AudioProcessingSettings): AudioProcessingSettings {
  return {
    inputVolume: Number.isFinite(settings.inputVolume) ? Math.max(0, Math.min(2, settings.inputVolume)) : 1,
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
  const sample = () => {
    const settings = normalizeAudioSettings(options());
    inputGain.gain.setTargetAtTime(settings.inputVolume, context.currentTime, 0.015);
    analyser.getFloatTimeDomainData(samples);
    const measured = measureInput(samples);
    const speaking = gate.sample(measured.decibels, settings.inputSensitivity, enabled() && settings.inputVolume > 0, performance.now());
    gateGain.gain.setTargetAtTime(speaking ? 1 : 0, context.currentTime, speaking ? 0.005 : 0.04);
    onSample(measured.level, speaking);
  };
  sample();
  const timer = globalThis.setInterval(sample, 50);
  let stopped = false;
  return {
    refresh: sample,
    stop() {
      if (stopped) return;
      stopped = true;
      globalThis.clearInterval(timer);
      for (const node of [source, inputGain, compressor, analyser, gateGain]) node.disconnect();
    },
  };
}
