import type { ShareFps, ShareHeight } from './media-quality';

export interface RuntimePreferences {
  voiceBitrateKbps: number;
  shareHeight: ShareHeight;
  shareFps: ShareFps;
  shareBitrateMbps: number;
}
export const defaultRuntimePreferences: RuntimePreferences = {
  voiceBitrateKbps: 48, shareHeight: 'native', shareFps: 60, shareBitrateMbps: 8,
};
export function normalizeRuntimePreferences(value: unknown): RuntimePreferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const bounded = (key: string, fallback: number, min: number, max: number) => typeof source[key] === 'number' && Number.isFinite(source[key]) ? Math.max(min, Math.min(max, source[key] as number)) : fallback;
  return {
    voiceBitrateKbps: bounded('voiceBitrateKbps', 48, 24, 64),
    shareHeight: source.shareHeight === 'native' ? 'native' : typeof source.shareHeight === 'number' && Number.isFinite(source.shareHeight) ? Math.max(1, Math.min(8640, Math.round(source.shareHeight))) : 'native',
    shareFps: [15, 30, 60].includes(source.shareFps as number) ? source.shareFps as ShareFps : 60,
    shareBitrateMbps: bounded('shareBitrateMbps', 8, 1, 50),
  };
}
/** Preferences remain untouched; overrides are derived for the current mode. */
export function effectiveSharePreferences(preferences: RuntimePreferences, gamingMode: boolean) {
  return {
    height: gamingMode ? preferences.shareHeight === 'native' ? 720 : Math.min(720, preferences.shareHeight) : preferences.shareHeight,
    fps: (gamingMode ? Math.min(30, preferences.shareFps) : preferences.shareFps) as ShareFps,
    bitrateMbps: gamingMode ? Math.min(3, preferences.shareBitrateMbps) : preferences.shareBitrateMbps,
  };
}
export function statisticsInterval(background: boolean, gaming: boolean, videoDetailsOpen: boolean) {
  return !background && videoDetailsOpen ? gaming ? 2000 : 1000 : 5000;
}

export interface CongestionState {
  badSamples: number;
  healthySamples: number;
  videoLimited: boolean;
  voiceLimited: boolean;
  baselineRtt: number | null;
}
export const initialCongestion: CongestionState = { badSamples: 0, healthySamples: 0, videoLimited: false, voiceLimited: false, baselineRtt: null };
/** Stable high geographic RTT alone is not congestion. Reduce video first. */
export function adaptCongestion(previous: CongestionState, loss: number | null, rttSeconds: number | null): CongestionState {
  if (loss === null && rttSeconds === null) return previous;
  const validRtt = rttSeconds !== null && Number.isFinite(rttSeconds) && rttSeconds >= 0 ? rttSeconds : null;
  const baselineRtt = validRtt === null ? previous.baselineRtt : Math.min(previous.baselineRtt ?? validRtt, validRtt);
  const bad = loss !== null && loss >= .03 || validRtt !== null && baselineRtt !== null && validRtt > Math.max(baselineRtt * 2, baselineRtt + .15);
  const badSamples = bad ? previous.badSamples + 1 : 0;
  const healthySamples = bad ? 0 : previous.healthySamples + 1;
  return {
    badSamples, healthySamples, baselineRtt,
    videoLimited: bad || previous.videoLimited && healthySamples < 3,
    voiceLimited: badSamples >= 3 && loss !== null && loss >= .08 || previous.voiceLimited && healthySamples < 3,
  };
}
