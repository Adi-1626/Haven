export interface RasterInfo { mime: string; width: number; height: number; animated: boolean }

export function inspectRaster(bytes: Buffer, maximumDimension: number): RasterInfo {
  const invalid = () => { throw new Error('Choose a valid PNG, JPEG, GIF or WebP image'); };
  let width = 0; let height = 0; let frames = 1; let mime = ''; let animated = false;
  if (bytes.length < 12) return invalid();
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mime = 'image/png'; let ended = false; let first = true; let imageData = false; let declaredFrames = 0; let frameControls = 0;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset + length + 12 > bytes.length) return invalid();
      if (first) { if (type !== 'IHDR' || length !== 13) return invalid(); width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12); first = false; }
      else if (type === 'IHDR') return invalid();
      if (type === 'acTL') { if (length !== 8 || declaredFrames || imageData) return invalid(); declaredFrames = bytes.readUInt32BE(offset + 8); if (!declaredFrames) return invalid(); animated = true; }
      if (type === 'fcTL') {
        if (!declaredFrames || length !== 26) return invalid();
        const frameWidth = bytes.readUInt32BE(offset + 12); const frameHeight = bytes.readUInt32BE(offset + 16);
        if (!frameWidth || !frameHeight || frameWidth + bytes.readUInt32BE(offset + 20) > width || frameHeight + bytes.readUInt32BE(offset + 24) > height) return invalid();
        frameControls++;
      }
      if (type === 'fdAT' && (!declaredFrames || !frameControls || length < 5)) return invalid();
      if (type === 'IDAT') { if (!length) return invalid(); imageData = true; }
      if (type === 'IEND') { if (length || offset + 12 !== bytes.length) return invalid(); ended = true; break; }
      offset += length + 12;
    }
    if (!ended || !imageData || frameControls !== declaredFrames) return invalid();
    frames = declaredFrames || 1;
  } else if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    mime = 'image/gif'; if (bytes.length < 13) return invalid(); width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8); frames = 0;
    let offset = 13 + ((bytes[10] & 128) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0); let ended = false;
    const blocks = () => { while (offset < bytes.length) { const length = bytes[offset++]; if (!length) return; offset += length; if (offset > bytes.length) return invalid(); } return invalid(); };
    while (offset < bytes.length) {
      const marker = bytes[offset++];
      if (marker === 59) { ended = true; break; }
      if (marker === 33) { offset++; blocks(); }
      else if (marker === 44) {
        if (offset + 9 > bytes.length) return invalid();
        const frameWidth = bytes.readUInt16LE(offset + 4); const frameHeight = bytes.readUInt16LE(offset + 6);
        if (!frameWidth || !frameHeight || frameWidth > maximumDimension || frameHeight > maximumDimension || bytes.readUInt16LE(offset) + frameWidth > width || bytes.readUInt16LE(offset + 2) + frameHeight > height) return invalid();
        const packed = bytes[offset + 8]; offset += 9 + ((packed & 128) ? 3 * (2 ** ((packed & 7) + 1)) : 0); offset++; blocks(); frames++;
      } else return invalid();
    }
    if (!ended || !frames) return invalid();
  } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mime = 'image/webp'; if (bytes.readUInt32LE(4) + 8 !== bytes.length) return invalid();
    frames = 0; let extended = false; let animationHeader = false; let payload = false; let offset = 12;
    const bitstreamDimensions = (type: string, data: number, length: number) => {
      let imageWidth = 0; let imageHeight = 0;
      if (type === 'VP8 ' && length >= 10) { if (bytes[data + 3] !== 157 || bytes[data + 4] !== 1 || bytes[data + 5] !== 42) return invalid(); imageWidth = bytes.readUInt16LE(data + 6) & 16383; imageHeight = bytes.readUInt16LE(data + 8) & 16383; }
      else if (type === 'VP8L' && length >= 5) { if (bytes[data] !== 47) return invalid(); const packed = bytes.readUInt32LE(data + 1); imageWidth = (packed & 16383) + 1; imageHeight = ((packed >>> 14) & 16383) + 1; }
      else return invalid();
      if (!imageWidth || !imageHeight || imageWidth > maximumDimension || imageHeight > maximumDimension) return invalid();
      return { width: imageWidth, height: imageHeight };
    };
    for (; offset + 8 <= bytes.length;) {
      const type = bytes.toString('ascii', offset, offset + 4); const length = bytes.readUInt32LE(offset + 4); const data = offset + 8;
      if (data + length > bytes.length) return invalid();
      if (type === 'VP8X') { if (length !== 10 || offset !== 12 || extended) return invalid(); extended = true; animated = Boolean(bytes[data] & 2); width = bytes.readUIntLE(data + 4, 3) + 1; height = bytes.readUIntLE(data + 7, 3) + 1; }
      if (type === 'VP8 ' || type === 'VP8L') { if (payload || animated) return invalid(); const size = bitstreamDimensions(type, data, length); if (width && (size.width !== width || size.height !== height)) return invalid(); width = size.width; height = size.height; payload = true; }
      if (type === 'ANIM') { if (!animated || animationHeader || length !== 6 || frames) return invalid(); animationHeader = true; }
      if (type === 'ANMF') {
        if (!animationHeader || length < 24) return invalid(); const frameWidth = bytes.readUIntLE(data + 6, 3) + 1; const frameHeight = bytes.readUIntLE(data + 9, 3) + 1;
        if (frameWidth > maximumDimension || frameHeight > maximumDimension || bytes.readUIntLE(data, 3) * 2 + frameWidth > width || bytes.readUIntLE(data + 3, 3) * 2 + frameHeight > height) return invalid();
        let encoded = false; let chunkOffset = data + 16;
        for (; chunkOffset + 8 <= data + length;) {
          const frameType = bytes.toString('ascii', chunkOffset, chunkOffset + 4); const frameLength = bytes.readUInt32LE(chunkOffset + 4); const frameData = chunkOffset + 8;
          if (frameData + frameLength > data + length) return invalid();
          if (frameType === 'VP8 ' || frameType === 'VP8L') { const size = bitstreamDimensions(frameType, frameData, frameLength); if (encoded || size.width !== frameWidth || size.height !== frameHeight) return invalid(); encoded = true; }
          else if (frameType !== 'ALPH') return invalid();
          chunkOffset = frameData + frameLength + (frameLength & 1);
        }
        if (!encoded || chunkOffset !== data + length) return invalid(); frames++;
      }
      offset = data + length + (length & 1);
    }
    if (offset !== bytes.length || (animated ? !frames : !payload)) return invalid();
    frames = Math.max(1, frames);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg';
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset++] !== 255) return invalid(); while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]; if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = bytes.readUInt16BE(offset); if (length < 2 || offset + length > bytes.length) return invalid();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) { if (length < 8) return invalid(); height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break; }
      offset += length;
    }
  } else return invalid();
  if (!width || !height || width > maximumDimension || height > maximumDimension) throw new Error(`Image dimensions must be at most ${maximumDimension} × ${maximumDimension}`);
  if (frames > 120) throw new Error('Animated images must contain at most 120 frames');
  return { mime, width, height, animated: animated || frames > 1 };
}
