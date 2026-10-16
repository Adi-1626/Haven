export type ShareHeight = number | 'native';
export type ShareFps = 15 | 30 | 60;

export interface ShareOption {
  label: string;
  height: ShareHeight;
  width: number;
}

export function captureDimensions(width: number, height: number) {
  return {
    width: Math.max(1, Math.floor(Number.isFinite(width) ? width : 1)),
    height: Math.max(1, Math.floor(Number.isFinite(height) ? height : 1)),
  };
}

export function targetDimensions(nativeWidth: number, nativeHeight: number, height: ShareHeight) {
  const native = captureDimensions(nativeWidth, nativeHeight);
  const targetHeight = height === 'native' || !Number.isFinite(height) ? native.height : Math.min(native.height, Math.max(1, Math.floor(height)));
  return { width: Math.min(native.width, Math.max(1, Math.round(native.width * targetHeight / native.height))), height: targetHeight };
}

export function qualityForSource(width: number, height: number, requestedHeight: ShareHeight) {
  const native = captureDimensions(width, height);
  return { nativeWidth: native.width, nativeHeight: native.height, ...targetDimensions(native.width, native.height, requestedHeight) };
}

export function shareOptionsFor(width: number, height: number): ShareOption[] {
  const native = captureDimensions(width, height);
  return [
    { label: `Native · ${native.width} × ${native.height}`, height: 'native', width: native.width },
    ...[2160, 1440, 1080, 720, 480].filter(value => value < native.height).map(value => ({
      label: `${value}p`, height: value, width: targetDimensions(native.width, native.height, value).width,
    })),
  ];
}

export function senderScale(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  return Math.max(1, sourceWidth / Math.max(1, targetWidth), sourceHeight / Math.max(1, targetHeight));
}

export function bitrateBits(mbps: number) {
  return Math.round(Math.min(50, Math.max(0.25, Number.isFinite(mbps) ? mbps : 8)) * 1_000_000);
}
