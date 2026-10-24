// Pure layout/quality decisions for the orbital scene, kept free of DOM and GL so they can be tested.

export interface SceneLayoutInput {
  width: number;
  height: number;
  /** Matches the auth page's compact breakpoint: the hero column is hidden and the card is centred. */
  compact: boolean;
  /** Top edge of the auth card in CSS px, when measured. */
  cardTop?: number;
  /** Right edge of the hero copy block in CSS px, when measured (desktop layout only). */
  textRight?: number;
  /** Left edge of the auth card in CSS px, when measured. */
  cardLeft?: number;
}

export interface SceneLayout {
  /** Planet centre in CSS px, y down. */
  cx: number;
  cy: number;
  /** Planet radius in CSS px. */
  radius: number;
}

// Proportions of the approved reference artwork (1672x941): planet centre (0.472, 0.494), radius 0.122H.
export function computeLayout({ width, height, compact, cardTop, textRight, cardLeft }: SceneLayoutInput): SceneLayout {
  if (!compact) {
    const radius = Math.max(56, Math.min(0.122 * height, 0.069 * width));
    // Single centred card (profile onboarding): no copy column, so tuck the planet in beside the card where it stays visible.
    if (!(textRight && textRight > 0) && cardLeft && cardLeft > radius * 2.4) {
      return { cx: Math.max(radius * 1.5, cardLeft - radius * 1.9), cy: height * 0.5, radius };
    }
    // On narrower windows the copy column gets close to the reference position; nudge the planet clear of it.
    const clearOfCopy = textRight && textRight > 0 ? textRight + radius * 0.4 : 0;
    return { cx: Math.min(Math.max(width * 0.472, clearOfCopy), width * 0.56), cy: height * 0.494, radius };
  }
  const freeTop = cardTop && cardTop > 0 ? Math.max(cardTop - 52, 0) : height * 0.28;
  const roomy = freeTop >= 150;
  const radius = Math.max(
    30,
    roomy ? Math.min(width * 0.2, Math.max(freeTop, height * 0.28) * 0.3) : Math.min(width, height) * 0.13,
  );
  const cy = roomy ? Math.max(radius * 1.55, freeTop * 0.5) : height * 0.3;
  return { cx: width * 0.5, cy, radius };
}

export type QualityTier = 'high' | 'medium' | 'low' | 'minimal';

export interface QualitySettings {
  /** Upper bound for the device-pixel-ratio the canvas is rendered at. */
  maxScale: number;
  /** Fraction of the particle / star buffers that is drawn. */
  particles: number;
  stars: number;
  /** Hard ceiling on drawing-buffer pixels. */
  maxPixels: number;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: { maxScale: 2, particles: 1, stars: 1, maxPixels: 3_600_000 },
  medium: { maxScale: 1.5, particles: 0.6, stars: 0.7, maxPixels: 2_400_000 },
  low: { maxScale: 1, particles: 0.32, stars: 0.5, maxPixels: 1_300_000 },
  // Software rasteriser or a struggling GPU: render at reduced resolution and let CSS scale the soft scene up.
  minimal: { maxScale: 0.8, particles: 0.16, stars: 0.3, maxPixels: 560_000 },
};

export interface DeviceHints {
  softwareRenderer: boolean;
  hardwareConcurrency: number;
  deviceMemory?: number;
  smallScreen: boolean;
}

export function pickInitialTier(hints: DeviceHints): QualityTier {
  if (hints.softwareRenderer) return 'minimal';
  if (hints.hardwareConcurrency <= 4 || (hints.deviceMemory !== undefined && hints.deviceMemory <= 4)) return 'medium';
  if (hints.smallScreen) return 'medium';
  return 'high';
}

export function lowerTier(tier: QualityTier): QualityTier {
  return tier === 'high' ? 'medium' : tier === 'medium' ? 'low' : 'minimal';
}

/** Resolves the drawing-buffer scale from the device pixel ratio, the tier cap and the pixel budget. */
export function resolveScale(cssWidth: number, cssHeight: number, dpr: number, quality: QualitySettings): number {
  const wanted = Math.min(Math.max(dpr, 1), quality.maxScale);
  const area = Math.max(cssWidth * cssHeight, 1);
  const budget = Math.sqrt(quality.maxPixels / area);
  return Math.max(0.6, Math.min(wanted, budget));
}
