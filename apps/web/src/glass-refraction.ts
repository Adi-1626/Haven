/**
 * Displacement map for the authentication glass. Light bends at the bevel of a thick glass pane, so only a
 * narrow band along the rounded edge is displaced; the interior stays neutral and perfectly readable.
 *
 * Each pixel encodes where to sample the backdrop from: R/G = 128 + 127 * shift (feDisplacementMap).
 * The shift points inward, because the backdrop outside the card is not available to sample.
 */
export interface RefractionMap { width: number; height: number; data: Uint8ClampedArray }

export function refractionMap(width: number, height: number, radius: number, bezel: number): RefractionMap {
  const data = new Uint8ClampedArray(width * height * 4);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corner = Math.min(radius, halfWidth, halfHeight);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const x = column + 0.5 - halfWidth;
      const y = row + 0.5 - halfHeight;
      // Signed distance to the rounded rectangle (negative inside) and its outward normal.
      const qx = Math.abs(x) - (halfWidth - corner);
      const qy = Math.abs(y) - (halfHeight - corner);
      const outsideX = Math.max(qx, 0);
      const outsideY = Math.max(qy, 0);
      const outside = Math.hypot(outsideX, outsideY);
      const distance = outside + Math.min(Math.max(qx, qy), 0) - corner;
      let nx = 0;
      let ny = 0;
      if (outside > 0) { nx = (outsideX / outside) * Math.sign(x); ny = (outsideY / outside) * Math.sign(y); }
      else if (qx > qy) nx = Math.sign(x) || 1;
      else ny = Math.sign(y) || 1;
      const depth = -distance;
      const t = Math.min(Math.max(depth / bezel, 0), 1);
      const magnitude = depth <= 0 ? 0 : (1 - t) * (1 - t);
      const index = (row * width + column) * 4;
      data[index] = Math.round(128 - 127 * nx * magnitude);
      data[index + 1] = Math.round(128 - 127 * ny * magnitude);
      data[index + 2] = 128;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Chromium (Chrome, Edge, Electron) renders SVG filters in backdrop-filter; other engines get the lit-glass fallback. */
export function supportsGlassRefraction(nav: { userAgentData?: { brands?: Array<{ brand: string }>; mobile?: boolean } } = navigator as never): boolean {
  const data = nav.userAgentData;
  return Boolean(data?.brands?.some(item => item.brand === 'Chromium') && !data.mobile);
}
