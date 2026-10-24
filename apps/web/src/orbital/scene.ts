import {
  BODIES,
  BODY_STRIDE,
  DUST_COUNT,
  MAX_PARTICLES,
  MOON_COUNT,
  ORBITS,
  ORBIT_COUNT,
  PARTICLE_STRIDE,
  STAR_COUNT,
  STAR_STRIDE,
  buildBodyData,
  buildParticleData,
  buildStarData,
} from './config';
import { QUALITY, resolveScale, type QualityTier, type SceneLayout } from './layout';
import { buildArcTable } from './orbit-math';
import { PointerSpring } from './spring';
import {
  BACKGROUND_FS,
  BACKGROUND_VS,
  GLOW_FS,
  GLOW_VS,
  MOON_FS,
  MOON_VS,
  PARTICLE_FS,
  PARTICLE_VS,
  PLANET_FS,
  PLANET_VS,
  RIBBON_FS,
  RIBBON_VS,
  STAR_FS,
  STAR_VS,
} from './shaders';

const PERSPECTIVE_DISTANCE = 45;
const HEADER_FLOATS = 64;
const MASK_SLOTS = 6;
/** Time shown by the static (reduced-motion) frame: t = 0 is the arrangement art-directed against the approved reference. */
export const STATIC_TIME = 0;

export interface MaskRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  strength: number;
}

interface Program {
  program: WebGLProgram;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`Orbital shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('Could not create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`Orbital program link failed: ${log}`);
  }
  const block = gl.getUniformBlockIndex(program, 'Frame');
  if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, block, 0);
  return { program };
}

/**
 * The orbital environment: one WebGL2 scene (planet, orbit ribbons, moons, light nodes, dust and stars)
 * rendered with real depth so the planet occludes the far side of every ring. No per-frame allocations.
 */
export class OrbitalScene {
  readonly softwareRenderer: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly programs: Record<'background' | 'star' | 'planet' | 'moon' | 'ribbon' | 'glow' | 'particle', Program>;
  private readonly ubo: WebGLBuffer;
  private readonly buffers: WebGLBuffer[] = [];
  private readonly vaos: WebGLVertexArrayObject[] = [];
  private readonly vaoRibbon: WebGLVertexArrayObject;
  private readonly vaoBodies: WebGLVertexArrayObject;
  private readonly vaoParticles: WebGLVertexArrayObject;
  private readonly vaoStars: WebGLVertexArrayObject;
  private readonly vaoEmpty: WebGLVertexArrayObject;
  private readonly ribbonVertexCount: number;
  private readonly uniformData: Float32Array;
  private readonly header: Float32Array;

  private quality: QualityTier = 'high';
  private cssWidth = 1;
  private cssHeight = 1;
  private dpr = 1;
  private scale = 1;
  private layout: SceneLayout = { cx: 0, cy: 0, radius: 100 };
  private masks: MaskRect[] = [];
  private reduced = false;
  private disposed = false;

  // Pointer parallax: the target comes from input, the spring is integrated every frame.
  private targetX = 0;
  private targetY = 0;
  private readonly spring = new PointerSpring();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'default',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    this.softwareRenderer = /swiftshader|llvmpipe|software|softpipe|basic render/i.test(renderer);

    this.programs = {
      background: link(gl, BACKGROUND_VS, BACKGROUND_FS),
      star: link(gl, STAR_VS, STAR_FS),
      planet: link(gl, PLANET_VS, PLANET_FS),
      moon: link(gl, MOON_VS, MOON_FS),
      ribbon: link(gl, RIBBON_VS, RIBBON_FS),
      glow: link(gl, GLOW_VS, GLOW_FS),
      particle: link(gl, PARTICLE_VS, PARTICLE_FS),
    };

    // Uniform block: header + static orbit table.
    this.uniformData = new Float32Array((HEADER_FLOATS / 4 + ORBIT_COUNT * 5) * 4);
    this.header = this.uniformData.subarray(0, HEADER_FLOATS);
    this.writeOrbitTable();
    const ubo = gl.createBuffer();
    if (!ubo) throw new Error('Could not create uniform buffer');
    this.ubo = ubo;
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.uniformData, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);

    this.vaoEmpty = this.createVao();

    // Orbit ribbons: one static strip for every orbit, vertices spaced evenly along the projected arc.
    const ribbon = this.buildRibbon();
    this.ribbonVertexCount = ribbon.length / 4;
    this.vaoRibbon = this.createVao();
    this.uploadAttributes(ribbon, [[0, 4, 0]], 16, false);

    this.vaoBodies = this.createVao();
    this.uploadAttributes(buildBodyData(), [[0, 4, 0], [1, 4, 16]], BODY_STRIDE * 4, true);

    this.vaoParticles = this.createVao();
    this.uploadAttributes(buildParticleData(), [[0, 4, 0], [1, 4, 16]], PARTICLE_STRIDE * 4, false);

    this.vaoStars = this.createVao();
    this.uploadAttributes(buildStarData(), [[0, 4, 0], [1, 4, 16]], STAR_STRIDE * 4, false);
    gl.bindVertexArray(null);
  }

  isContextLost(): boolean {
    return this.gl.isContextLost();
  }

  setQuality(tier: QualityTier): void {
    this.quality = tier;
  }

  getQuality(): QualityTier {
    return this.quality;
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) {
      this.targetX = this.targetY = 0;
      this.spring.reset();
    }
  }

  /** Normalised pointer target in [-1, 1]; y is positive upwards. */
  setPointerTarget(x: number, y: number): void {
    this.targetX = Math.max(-1, Math.min(1, x));
    this.targetY = Math.max(-1, Math.min(1, y));
  }

  /** Smoothed pointer parallax in [-1, 1] (y up); the auth card reads it to lean its highlight. */
  getPointer(): { x: number; y: number } {
    return { x: this.spring.x, y: this.spring.y };
  }

  setLayout(layout: SceneLayout): void {
    this.layout = layout;
  }

  setMasks(masks: MaskRect[]): void {
    this.masks = masks;
  }

  /** Resizes the drawing buffer. Returns the scale (drawing-buffer px per CSS px) actually used. */
  resize(cssWidth: number, cssHeight: number, dpr: number): number {
    this.cssWidth = Math.max(cssWidth, 1);
    this.cssHeight = Math.max(cssHeight, 1);
    this.dpr = dpr;
    return this.applyResolution();
  }

  /** Re-applies the resolution after a quality change. */
  applyResolution(): number {
    this.scale = resolveScale(this.cssWidth, this.cssHeight, this.dpr, QUALITY[this.quality]);
    const width = Math.max(Math.round(this.cssWidth * this.scale), 1);
    const height = Math.max(Math.round(this.cssHeight * this.scale), 1);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return this.scale;
  }

  render(time: number, dt: number): void {
    const gl = this.gl;
    if (this.disposed || gl.isContextLost()) return;
    this.stepPointer(time, dt);
    this.writeHeader(time);

    const width = this.canvas.width;
    const height = this.canvas.height;
    const quality = QUALITY[this.quality];
    const stars = Math.round(STAR_COUNT * quality.stars);
    const particles = Math.round(MAX_PARTICLES * quality.particles);

    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.header);

    gl.viewport(0, 0, width, height);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 1. Backdrop and distant stars.
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.programs.background.program);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.programs.star.program);
    gl.bindVertexArray(this.vaoStars);
    gl.drawArrays(gl.POINTS, 0, stars);

    // 2. Opaque bodies write depth so they hide the far side of the rings.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.programs.planet.program);
    gl.bindVertexArray(this.vaoEmpty);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.useProgram(this.programs.moon.program);
    gl.bindVertexArray(this.vaoBodies);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, MOON_COUNT);

    // 3. Light: rings, dust and node glows are additive and depth-tested but never write depth.
    gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.programs.ribbon.program);
    gl.bindVertexArray(this.vaoRibbon);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.ribbonVertexCount);

    gl.useProgram(this.programs.particle.program);
    gl.bindVertexArray(this.vaoParticles);
    gl.drawArrays(gl.POINTS, 0, particles);

    gl.useProgram(this.programs.glow.program);
    gl.bindVertexArray(this.vaoBodies);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, BODIES.length);

    // 4. Foreground dust motes drift in front of everything for spatial depth.
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.programs.star.program);
    gl.bindVertexArray(this.vaoStars);
    gl.drawArrays(gl.POINTS, STAR_COUNT, Math.max(Math.round(DUST_COUNT * quality.stars), 0));
    gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (!gl.isContextLost()) {
      for (const { program } of Object.values(this.programs)) gl.deleteProgram(program);
      for (const buffer of this.buffers) gl.deleteBuffer(buffer);
      gl.deleteBuffer(this.ubo);
      for (const vao of this.vaos) gl.deleteVertexArray(vao);
    }
    // Release the GPU context immediately rather than waiting for garbage collection; browsers cap live contexts.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // -----------------------------------------------------------------------------------------

  private createVao(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    if (!vao) throw new Error('Could not create vertex array');
    this.vaos.push(vao);
    this.gl.bindVertexArray(vao);
    return vao;
  }

  private uploadAttributes(data: Float32Array, attributes: Array<[number, number, number]>, stride: number, instanced: boolean): void {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Could not create buffer');
    this.buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [location, size, offset] of attributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, instanced ? 1 : 0);
    }
  }

  private buildRibbon(): Float32Array {
    const parts: number[] = [];
    ORBITS.forEach((orbit, index) => {
      const probe = buildArcTable(orbit, PERSPECTIVE_DISTANCE, 8);
      const segments = Math.min(Math.max(Math.ceil(probe.total * 18), 160), 900);
      const table = buildArcTable(orbit, PERSPECTIVE_DISTANCE, segments);
      const vertex = (k: number, side: number) => [index, table.anomalies[k], table.lengths[k], side];
      // Degenerate joins between orbits keep everything in one draw call.
      if (parts.length) parts.push(...parts.slice(-4), ...vertex(0, -1));
      for (let k = 0; k <= segments; k++) parts.push(...vertex(k, -1), ...vertex(k, 1));
    });
    return new Float32Array(parts);
  }

  private writeOrbitTable(): void {
    const base = HEADER_FLOATS;
    ORBITS.forEach((o, i) => {
      this.uniformData.set([o.a, o.e, o.roll, o.incl], base + i * 4);
      this.uniformData.set([o.width, o.brightness, o.dotBack, o.spacing], base + (ORBIT_COUNT + i) * 4);
      this.uniformData.set([o.pulses[0].phase, o.pulses[0].speed, o.pulses[1].phase, o.pulses[1].speed], base + (ORBIT_COUNT * 2 + i) * 4);
      this.uniformData.set([o.motion, o.trail, o.gain, o.dotFront], base + (ORBIT_COUNT * 3 + i) * 4);
      this.uniformData.set([o.backDim, 0, 0, 0], base + (ORBIT_COUNT * 4 + i) * 4);
    });
  }

  /** Spring towards the pointer, plus a faint autonomous sway so the scene is never rigid. */
  private stepPointer(time: number, dt: number): void {
    if (this.reduced) return;
    this.spring.step(this.targetX + Math.sin(time * 0.11) * 0.16, this.targetY + Math.cos(time * 0.083) * 0.1, dt);
  }

  private writeHeader(time: number): void {
    const h = this.header;
    const scale = this.scale;
    const width = this.canvas.width;
    const height = this.canvas.height;

    h[0] = width;
    h[1] = height;
    h[2] = scale;
    h[3] = time;

    h[4] = this.layout.cx * scale;
    h[5] = height - this.layout.cy * scale;
    h[6] = this.layout.radius * scale;
    h[7] = PERSPECTIVE_DISTANCE;

    // View rotation = Rx(pitch) * Ry(yaw); a gentle perspective shift, never an aggressive camera move.
    const yaw = -this.spring.x * 0.075;
    const pitch = this.spring.y * 0.05;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cx = Math.cos(pitch);
    const sx = Math.sin(pitch);
    h.set([cy, sx * sy, -cx * sy, 0], 8);
    h.set([0, cx, sx, 0], 12);
    h.set([sy, -sx * cy, cx * cy, 0], 16);

    h[20] = this.spring.x;
    h[21] = this.spring.y;
    h[22] = this.spring.x * 9 * scale;
    h[23] = this.spring.y * 6 * scale;

    const lx = -0.7 + 0.06 * Math.sin(time * 0.07);
    const ly = 0.56 + 0.05 * Math.cos(time * 0.05);
    const lz = 0.36;
    const inv = 1 / Math.hypot(lx, ly, lz);
    h[24] = lx * inv;
    h[25] = ly * inv;
    h[26] = lz * inv;
    h[27] = 0.95 + 0.05 * Math.sin(time * 0.19);

    h[28] = time * 0.011 + 0.6;
    h[29] = this.reduced ? 1 : 0;
    h[30] = 0;
    h[31] = 0;

    for (let k = 0; k < MASK_SLOTS; k++) {
      const rect = this.masks[k];
      const o = 32 + k * 4;
      if (rect) {
        h[o] = rect.left * scale;
        h[o + 1] = height - rect.bottom * scale;
        h[o + 2] = rect.right * scale;
        h[o + 3] = height - rect.top * scale;
        h[56 + k] = rect.strength;
      } else {
        h[o] = h[o + 1] = h[o + 2] = h[o + 3] = 0;
        h[56 + k] = 0;
      }
    }
  }
}
