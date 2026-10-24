export const avatarOutputSize = 512;
export const avatarInputLimit = 12 * 1024 * 1024;
export const avatarTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** The centred square that fills a circular profile picture from an arbitrary image. */
export function centeredSquare(width: number, height: number) {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

export function photoProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!avatarTypes.includes(file.type)) return 'Choose a PNG, JPEG, WebP or GIF image';
  if (file.size > avatarInputLimit) return 'Choose an image smaller than 12 MB';
  return null;
}

/**
 * Crops the image to a centred square and re-encodes it at 512×512, so every upload fits the 1 MB
 * server limit, is static, and carries no metadata (such as camera location) from the original.
 */
export async function squareAvatar(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('That image could not be read. Try another file.'); });
  try {
    const { x, y, size } = centeredSquare(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(avatarOutputSize, size);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot prepare images.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, x, y, size, size, 0, 0, canvas.width, canvas.height);
    for (const [type, quality] of [['image/webp', 0.9], ['image/jpeg', 0.88]] as const) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
      if (blob && blob.type === type && blob.size <= 1024 * 1024) return blob;
    }
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (png && png.size <= 1024 * 1024) return png;
    throw new Error('That image is too detailed to save. Try a smaller one.');
  } finally { bitmap.close(); }
}
