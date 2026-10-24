import { ORBIT_COUNT } from './config';

// GLSL ES 3.00. One uniform block ("Frame") carries the camera, pointer, layout masks and the static
// orbit table, so every pass evaluates the same orbital geometry.

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
#define N_ORB ${ORBIT_COUNT}
#define TAU 6.28318530718
#define ZR 40.0

layout(std140) uniform Frame {
  vec4 uRes;      // xy framebuffer px, z px per CSS px, w time (s)
  vec4 uCenter;   // xy planet centre px (y up), z planet radius px, w perspective distance
  vec4 uRot0;     // view rotation columns
  vec4 uRot1;
  vec4 uRot2;
  vec4 uPtr;      // xy smoothed pointer, zw scene shift px
  vec4 uLight;    // xyz key light (view space), w breathing
  vec4 uMisc;     // x planet spin, y reduced-motion flag
  vec4 uMask[6];  // protected rects (x0 y0 x1 y1, px, y up)
  vec4 uMaskK[2]; // protection strength per rect
  vec4 uOrbA[N_ORB]; // a, e, roll, incl
  vec4 uOrbB[N_ORB]; // width, brightness, dotBack, spacing
  vec4 uOrbC[N_ORB]; // pulse0 phase/speed, pulse1 phase/speed
  vec4 uOrbD[N_ORB]; // motion, trail, gain, dotFront
  vec4 uOrbE[N_ORB]; // backDim
};

mat3 viewRot() { return mat3(uRot0.xyz, uRot1.xyz, uRot2.xyz); }

float kepler(float M, float e) {
  M = mod(M, TAU);
  float E = M + e * sin(M) * (1.0 + e * cos(M));
  for (int k = 0; k < 3; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  return E;
}

vec3 orbitWorld(int i, float E) {
  vec4 A = uOrbA[i];
  float b = A.x * sqrt(1.0 - A.y * A.y);
  float px = A.x * (cos(E) - A.y);
  float py = b * sin(E);
  float qy = py * cos(A.w);
  float qz = py * sin(A.w);
  float cr = cos(A.z);
  float sr = sin(A.z);
  return vec3(px * cr - qy * sr, px * sr + qy * cr, qz);
}

float perspAt(float z) { return uCenter.w / (uCenter.w - z); }

vec3 projectView(vec3 v) {
  return vec3(uCenter.xy + uPtr.zw + v.xy * uCenter.z * perspAt(v.z), v.z);
}

vec4 clipFromPx(vec3 p) {
  return vec4(p.xy / uRes.xy * 2.0 - 1.0, clamp(-p.z / ZR, -0.98, 0.98), 1.0);
}

float depthFromZ(float z) { return clamp(-z / ZR, -0.98, 0.98) * 0.5 + 0.5; }

// Soft protection around copy and form controls: 1 = untouched, lower = calmer.
float maskAt(vec2 px) {
  float m = 1.0;
  float feather = 90.0 * uRes.z;
  for (int k = 0; k < 6; k++) {
    vec4 r = uMask[k];
    if (r.z - r.x < 2.0) continue;
    vec2 c = (r.xy + r.zw) * 0.5;
    vec2 h = (r.zw - r.xy) * 0.5;
    vec2 q = abs(px - c) - h;
    float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);
    m *= 1.0 - uMaskK[k >> 2][k & 3] * (1.0 - smoothstep(0.0, feather, d));
  }
  return m;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

const vec3 LAVENDER = vec3(0.62, 0.63, 1.0);
const vec3 WHITE_LAV = vec3(0.90, 0.91, 1.0);
`;

const quadCorner = /* glsl */ `
vec2 quadCorner() { return vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0; }
`;

// ---------------------------------------------------------------------------------------------
// Background: deep indigo gradient, evolving haze, faint grid, crosshairs and the vertical axis.
// ---------------------------------------------------------------------------------------------
export const BACKGROUND_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.999, 1.0);
}`;

export const BACKGROUND_FS = HEADER + /* glsl */ `
out vec4 outColor;

float cross2(vec2 d, float arm, float thick) {
  d = abs(d);
  float h = (1.0 - smoothstep(thick, thick + 1.0, d.y)) * (1.0 - smoothstep(arm - 1.0, arm, d.x));
  float v = (1.0 - smoothstep(thick, thick + 1.0, d.x)) * (1.0 - smoothstep(arm - 1.0, arm, d.y));
  return max(h, v);
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / uRes.xy;
  float t = uRes.w;
  float dpr = uRes.z;
  vec2 C = uCenter.xy + uPtr.zw * 0.35;
  float R = uCenter.z;
  vec2 q = (px - C) / R;
  float rq = length(q);
  float m = maskAt(px);

  // Base: near-black indigo with a lavender bloom behind the planet that slowly breathes.
  float breathe = 0.93 + 0.07 * sin(t * 0.21);
  vec3 col = mix(vec3(0.012, 0.013, 0.030), vec3(0.022, 0.023, 0.052), smoothstep(1.4, 0.0, length((uv - vec2(0.5, 0.52)) * vec2(1.25, 1.0))));
  col += vec3(0.052, 0.046, 0.150) * exp(-rq * rq * 0.07) * 0.36 * breathe;
  col += vec3(0.030, 0.028, 0.095) * exp(-rq * 0.34) * 0.26;

  // Slowly evolving haze so the empty space is never static.
  vec2 hz = px / (R * 5.0) + vec2(t * 0.004, -t * 0.003) * (1.0 - uMisc.y);
  float haze = vnoise2(hz * 1.7) * 0.6 + vnoise2(hz * 3.9 + 7.0) * 0.4;
  col += vec3(0.030, 0.024, 0.100) * smoothstep(0.4, 0.9, haze) * 0.30 * m;

  // Faint blueprint grid and crosshairs, parallaxed away from the planet.
  vec2 gp = px / dpr - uPtr.zw * 0.12 / dpr;
  vec2 gd = abs(fract(gp / 72.0) - 0.5) * 72.0;
  float grid = 1.0 - smoothstep(0.0, 1.1, min(gd.x, gd.y));
  col += vec3(0.30, 0.30, 0.62) * grid * 0.032 * (0.25 + 0.75 * m) * smoothstep(7.0, 1.0, rq);

  const vec2 CROSS[8] = vec2[8](
    vec2(0.183, 0.057), vec2(0.023, 0.133), vec2(0.343, 0.203), vec2(0.183, 0.347),
    vec2(0.858, 0.057), vec2(0.223, 0.707), vec2(0.537, 0.849), vec2(0.858, 0.203));
  for (int k = 0; k < 8; k++) {
    vec2 cp = vec2(CROSS[k].x, 1.0 - CROSS[k].y) * uRes.xy + uPtr.zw * 0.25;
    float tw = 0.65 + 0.35 * sin(t * 0.6 + float(k) * 1.7);
    col += LAVENDER * cross2((px - cp) / dpr, 5.0, 0.55) * 0.22 * tw * m;
  }

  // Vertical axis through the planet: hairline, glints and two slow travelling light packets.
  float ax = C.x + R * 0.14 + uPtr.z * 0.2;
  float dx = abs(px.x - ax) / dpr;
  float axisLine = exp(-dx * dx * 1.8);
  float axisFade = 0.30 + 0.70 * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.88, uv.y);
  float along = (px.y - C.y) / R;
  float H = uRes.y / R;
  float s1 = sin(t * 0.17) * H * 0.42;
  float s2 = sin(t * 0.13 + 2.4) * H * 0.38;
  float packet = exp(-pow(along - s1, 2.0) * 1.6) + 0.7 * exp(-pow(along - s2, 2.0) * 2.4);
  float glints = 0.0;
  const float GY[4] = float[4](2.55, 1.65, -2.2, -1.25);
  for (int k = 0; k < 4; k++) {
    float gdist = (px.y - (C.y + GY[k] * R)) / dpr;
    glints += exp(-(gdist * gdist) / 26.0 - dx * dx * 0.9) * (0.7 + 0.3 * sin(t * 0.9 + float(k) * 2.1));
  }
  col += LAVENDER * axisLine * axisFade * (0.26 + 0.60 * packet) * 0.8 * m;
  col += WHITE_LAV * glints * 0.8 * m;

  col += (hash12(px) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------------------------
// Stars and dust motes (screen-space, parallaxed by layer, gently twinkling / drifting).
// ---------------------------------------------------------------------------------------------
export const STAR_VS = HEADER + /* glsl */ `
layout(location = 0) in vec4 aS0; // u, v, layer, size
layout(location = 1) in vec4 aS1; // phase, brightness, rate, kind
out vec3 vS;
void main() {
  float t = uRes.w;
  float dpr = uRes.z;
  float kind = aS1.w;
  vec2 pos = aS0.xy * uRes.xy;
  pos += uPtr.zw * aS0.z * 1.6;
  float drift = kind > 0.5 ? 14.0 : 2.5;
  pos += vec2(sin(t * 0.045 + aS1.x * 3.0), cos(t * 0.037 + aS1.x * 2.0)) * drift * dpr * (1.0 - uMisc.y);
  float tw = 1.0 - 0.22 * (0.5 + 0.5 * sin(t * aS1.z + aS1.x));
  float m = maskAt(pos);
  float b = aS1.y * tw * mix(0.4, 1.0, m);
  gl_Position = vec4(pos / uRes.xy * 2.0 - 1.0, 0.99, 1.0);
  gl_PointSize = max(aS0.w * dpr * (kind > 0.5 ? 1.0 : 1.5), 1.0);
  vS = vec3(b, kind, aS1.x);
}`;

export const STAR_FS = HEADER + /* glsl */ `
in vec3 vS;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  float soft = vS.y > 0.5 ? exp(-r2 * 2.4) * 0.14 : exp(-r2 * 5.0) * 1.25 + exp(-r2 * 1.6) * 0.14;
  vec3 tint = mix(vec3(0.78, 0.80, 1.0), vec3(1.0, 0.97, 0.95), fract(vS.z * 7.0) * 0.5);
  outColor = vec4(tint * soft * vS.x, 1.0);
}`;

// ---------------------------------------------------------------------------------------------
// Planet: ray-traced sphere impostor, procedural regolith, atmosphere and key/fill/rim lighting.
// ---------------------------------------------------------------------------------------------
export const PLANET_VS = HEADER + quadCorner + /* glsl */ `
#define HALO 2.3
out vec2 vP;
void main() {
  vec2 c = quadCorner();
  vec3 p = projectView(vec3(0.0));
  vP = c * HALO;
  gl_Position = clipFromPx(vec3(p.xy + c * HALO * uCenter.z, 0.0));
}`;

export const PLANET_FS = HEADER + /* glsl */ `
in vec2 vP;
out vec4 outColor;

mat3 axisAngle(vec3 u, float a) {
  float c = cos(a);
  float s = sin(a);
  float k = 1.0 - c;
  return mat3(
    c + u.x * u.x * k, u.y * u.x * k + u.z * s, u.z * u.x * k - u.y * s,
    u.x * u.y * k - u.z * s, c + u.y * u.y * k, u.z * u.y * k + u.x * s,
    u.x * u.z * k + u.y * s, u.y * u.z * k - u.x * s, c + u.z * u.z * k);
}

float fbm3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise3(p);
    p = p * 2.07 + 11.3;
    a *= 0.5;
  }
  return s;
}

void main() {
  float r = length(vP);
  float Rpx = uCenter.z;
  float t = uRes.w;
  vec3 L = normalize(uLight.xyz);
  float breathe = uLight.w;

  float edge = 1.0 - smoothstep(1.0 - 1.4 / Rpx, 1.0 + 0.6 / Rpx, r);
  vec2 dirXY = normalize(vP + vec2(1e-4));
  float lightSide = smoothstep(-0.35, 0.8, dot(dirXY, L.xy));

  // Atmosphere: a thin lavender veil that clings to the lit limb.
  float outer = max(r - 1.0, 0.0);
  vec3 halo = vec3(0.34, 0.33, 0.95) * exp(-outer * 9.0) * 0.30 * (0.20 + 0.80 * lightSide) * breathe
            + vec3(0.20, 0.20, 0.72) * exp(-outer * 3.2) * 0.035;
  halo *= (1.0 - edge);

  vec3 sphere = vec3(0.0);
  float depth = 1.0;
  if (r < 1.0 + 1.0 / Rpx) {
    float rr = min(r, 0.9999);
    vec3 n = vec3(vP, sqrt(1.0 - rr * rr));
    // Object-space normal: undo the view tilt, then spin about a tilted axis. The surface slowly
    // turns, and shifts a little with the pointer, so the lighting evolves instead of looping.
    vec3 no = transpose(viewRot()) * n;
    vec3 axis = normalize(vec3(0.38, 0.92, 0.12));
    no = axisAngle(axis, uMisc.x) * no;
    float big = fbm3(no * 2.3 + 3.0);
    float mid = fbm3(no * 7.0 + 17.0);
    float fine = vnoise3(no * 64.0);
    float albedo = 0.42 + 0.58 * smoothstep(0.25, 0.8, big) ;
    albedo *= 0.82 + 0.36 * mid;
    float grain = smoothstep(0.70, 0.97, fine) * 0.55 + smoothstep(0.55, 0.9, vnoise3(no * 28.0)) * 0.16;

    float ndl = dot(n, L);
    float lit = pow(smoothstep(0.0, 1.0, ndl), 1.7);
    vec3 ambient = vec3(0.011, 0.012, 0.032);
    vec3 key = vec3(0.34, 0.35, 0.66);
    vec3 bounce = vec3(0.050, 0.055, 0.190) * smoothstep(0.0, 1.0, dot(n, normalize(vec3(0.72, -0.58, 0.30))));
    vec3 col = ambient + (key * lit * 0.55 + bounce * 0.40) * albedo;
    col += vec3(0.50, 0.52, 0.85) * grain * (0.03 + 0.85 * lit);

    float fres = pow(1.0 - n.z, 2.3);
    col += vec3(0.72, 0.73, 1.0) * fres * (0.03 + 0.97 * lightSide) * 1.45 * breathe;
    float ringSide = smoothstep(0.0, 0.9, dot(dirXY, normalize(vec2(0.64, -0.77))));
    col += vec3(0.30, 0.32, 0.95) * pow(1.0 - n.z, 3.5) * ringSide * 0.42;
    sphere = col;
    depth = depthFromZ(n.z);
  }

  outColor = vec4(sphere * edge + halo, edge);
  gl_FragDepth = depth;
}`;

// ---------------------------------------------------------------------------------------------
// Orbit ribbons: screen-space-thin, depth-tested lines evaluated from the orbit table, with
// travelling light pulses, a front-solid / back-dotted treatment and calm masks over the UI.
// ---------------------------------------------------------------------------------------------
export const RIBBON_VS = HEADER + /* glsl */ `
layout(location = 0) in vec4 aRib; // orbit, E, arc length, side
out vec4 vA;       // E, arc length (units), across (css px), view z
flat out vec2 vEp; // pulse head anomalies
flat out int vOrb;
void main() {
  int i = int(aRib.x + 0.5);
  float E = aRib.y;
  vec3 v0 = viewRot() * orbitWorld(i, E);
  vec3 v1 = viewRot() * orbitWorld(i, E + 0.004);
  vec3 p0 = projectView(v0);
  vec3 p1 = projectView(v1);
  vec2 d = p1.xy - p0.xy;
  vec2 dir = d / max(length(d), 1e-4);
  vec2 nrm = vec2(-dir.y, dir.x);
  float spread = uOrbB[i].x * 2.2 + 1.2;
  float halfCss = uOrbB[i].x * 0.5 + spread * 2.6 + 1.0;
  float across = aRib.w * halfCss;
  gl_Position = clipFromPx(vec3(p0.xy + nrm * across * uRes.z, p0.z));
  float t = uRes.w;
  vec4 C = uOrbC[i];
  float e = uOrbA[i].y;
  vEp = vec2(kepler(C.x + C.y * t, e), kepler(C.z + C.w * t, e));
  vA = vec4(E, aRib.z, across, v0.z);
  vOrb = i;
}`;

export const RIBBON_FS = HEADER + /* glsl */ `
in vec4 vA;
flat in vec2 vEp;
flat in int vOrb;
out vec4 outColor;

float trailAt(float E, float Ep, float speed, float len) {
  float behind = speed >= 0.0 ? mod(Ep - E, TAU) : mod(E - Ep, TAU);
  return exp(-behind / len);
}

void main() {
  int i = vOrb;
  vec4 B = uOrbB[i];
  vec4 C = uOrbC[i];
  vec4 D = uOrbD[i];
  float t = uRes.w;
  float w = B.x;
  float ac = abs(vA.z);

  float back = smoothstep(0.30, -0.45, vA.w);
  float dotAmt = mix(D.w, B.z, back);

  float line = 1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.6, ac);
  float g = w * 2.2 + 1.2;
  float glow = exp(-ac * ac / (2.0 * g * g)) * 0.26 + exp(-ac * ac / (2.0 * g * g * 0.16)) * 0.10;

  float sCss = vA.y * uCenter.z / uRes.z;
  float fx = (fract(sCss / B.w) - 0.5) * B.w;
  float dr = max(0.8, w * 0.62);
  float dd = length(vec2(fx, vA.z));
  float dotv = (1.0 - smoothstep(dr - 0.5, dr + 0.55, dd)) * 1.6;

  float shape = mix(line + glow, dotv + glow * 0.7, dotAmt);

  float pulse = 0.0;
  if (C.y != 0.0) pulse += trailAt(vA.x, vEp.x, C.y, D.y);
  if (C.w != 0.0) pulse += trailAt(vA.x, vEp.y, C.w, D.y);

  float breathe = 0.92 + 0.08 * sin(t * 0.33 + float(i) * 1.3);
  float side = mix(uOrbE[i].x, 1.0, 1.0 - back);
  float bright = B.y * side * breathe;
  float I = shape * (bright + D.z * pulse * side);
  vec3 col = mix(vec3(0.44, 0.45, 1.0), vec3(0.78, 0.79, 1.0), clamp(pulse * 0.8, 0.0, 1.0));
  float m = maskAt(gl_FragCoord.xy);
  outColor = vec4(col * I * m, 1.0);
}`;

// ---------------------------------------------------------------------------------------------
// Bodies (moons and light nodes) – position comes from the same orbit table + Kepler solve.
// ---------------------------------------------------------------------------------------------
const BODY_COMMON = /* glsl */ `
layout(location = 0) in vec4 aB0; // orbit, mode, phase, speed
layout(location = 1) in vec4 aB1; // radius, glow, intensity, seed
vec3 bodyView() {
  int i = int(aB0.x + 0.5);
  int mode = int(aB0.y + 0.5);
  float t = uRes.w;
  float M = mode == 0 ? uOrbC[i].x + uOrbC[i].y * t
          : mode == 1 ? uOrbC[i].z + uOrbC[i].w * t
          : aB0.z + aB0.w * t;
  float E = kepler(M, uOrbA[i].y);
  return viewRot() * orbitWorld(i, E);
}
`;

export const MOON_VS = HEADER + quadCorner + BODY_COMMON + /* glsl */ `
out vec2 vLocal;
out vec4 vM; // radius px, world radius, view z, seed
void main() {
  vec3 v = bodyView();
  vec3 p = projectView(v);
  float rpx = aB1.x * uCenter.z * perspAt(v.z);
  float half_ = rpx + 2.0 * uRes.z;
  vec2 c = quadCorner();
  vLocal = c * half_;
  vM = vec4(rpx, aB1.x, v.z, aB1.w);
  gl_Position = clipFromPx(vec3(p.xy + c * half_, p.z));
}`;

export const MOON_FS = HEADER + /* glsl */ `
in vec2 vLocal;
in vec4 vM;
out vec4 outColor;
void main() {
  float rpx = vM.x;
  float d = length(vLocal) / rpx;
  float edge = 1.0 - smoothstep(1.0 - 1.3 / rpx, 1.0 + 0.5 / rpx, d);
  if (edge <= 0.002) discard;
  float dd = min(d, 0.9999);
  vec3 n = vec3(vLocal / rpx, sqrt(1.0 - dd * dd));
  vec3 L = normalize(uLight.xyz);
  float diff = smoothstep(-0.15, 1.0, dot(n, L));
  vec2 dirXY = normalize(n.xy + vec2(1e-4));
  float rimDir = 0.40 + 0.60 * smoothstep(-0.3, 0.7, dot(dirXY, L.xy));
  float rim = pow(1.0 - n.z, 2.8);
  float tex = 0.82 + 0.36 * vnoise3(n * 3.2 + vM.w * 40.0);
  vec3 col = vec3(0.034, 0.036, 0.082) + vec3(0.30, 0.31, 0.62) * diff * 0.85 * tex + LAVENDER * rim * rimDir * 1.9;
  float calm = mix(1.0, maskAt(gl_FragCoord.xy), 0.85);
  col *= calm;
  float cover = edge * (0.2 + 0.8 * calm);
  outColor = vec4(col * cover, cover);
  gl_FragDepth = depthFromZ(vM.z + n.z * vM.y);
}`;

export const GLOW_VS = HEADER + quadCorner + BODY_COMMON + /* glsl */ `
out vec2 vUv;
out vec4 vG; // intensity, moon core radius ratio, seed, mask
void main() {
  vec3 v = bodyView();
  vec3 p = projectView(v);
  float s = perspAt(v.z);
  float moon = step(0.001, aB1.x);
  float rpx = aB1.x * uCenter.z * s;
  float half_ = (moon > 0.5 ? rpx * 3.4 : aB1.y * 2.1 * uRes.z * s);
  vec2 c = quadCorner();
  vUv = c;
  vec2 center = p.xy;
  float m = maskAt(center);
  int oi = int(aB0.x + 0.5);
  float side = mix(uOrbE[oi].x, 1.0, smoothstep(-0.45, 0.30, v.z));
  vG = vec4(aB1.z, moon > 0.5 ? rpx / half_ : 0.0, aB1.w, m * (moon > 0.5 ? 1.0 : side));
  gl_Position = clipFromPx(vec3(center + c * half_, p.z));
}`;

export const GLOW_FS = HEADER + /* glsl */ `
in vec2 vUv;
in vec4 vG;
out vec4 outColor;
void main() {
  float t = uRes.w;
  vec2 u = vUv;
  float r = length(u);
  if (r > 1.0) discard;
  float flick = 0.86 + 0.14 * sin(t * (0.9 + vG.z * 1.4) + vG.z * 40.0);
  float fade = 1.0 - smoothstep(0.7, 1.0, r);
  vec3 col;
  float I;
  if (vG.y > 0.0) {
    // Moon: only a soft halo outside the body, hugging the lit side.
    float halo = exp(-pow(max(r - vG.y, 0.0) / (1.0 - vG.y) * 3.4, 2.0)) * smoothstep(vG.y * 0.85, vG.y * 1.1, r);
    I = halo * 0.95 * vG.x * flick * fade;
    col = vec3(0.50, 0.52, 1.0);
  } else {
    float core = exp(-r * r * 220.0);
    float body = exp(-r * r * 11.0) * 1.2 + exp(-r * 3.6) * 0.42;
    float flare = (exp(-abs(u.x) * 36.0) * exp(-abs(u.y) * 3.6) + exp(-abs(u.y) * 36.0) * exp(-abs(u.x) * 3.6)) * 0.34;
    I = (core * 1.8 + body + flare) * vG.x * flick * fade;
    col = mix(vec3(0.50, 0.52, 1.0), vec3(0.95, 0.96, 1.0), clamp(core * 1.5, 0.0, 1.0));
  }
  outColor = vec4(col * I * vG.w, 1.0);
}`;

// ---------------------------------------------------------------------------------------------
// Dust: fine particles drifting along the same orbits (position = Kepler solve + small offsets).
// ---------------------------------------------------------------------------------------------
export const PARTICLE_VS = HEADER + /* glsl */ `
layout(location = 0) in vec4 aP0; // orbit, phase, speed scale, radial jitter
layout(location = 1) in vec4 aP1; // lift, size, brightness, seed
out vec2 vB;
void main() {
  int i = int(aP0.x + 0.5);
  float t = uRes.w;
  float M = aP0.y + uOrbD[i].x * aP0.z * t;
  float E = kepler(M, uOrbA[i].y);
  vec3 w = orbitWorld(i, E);
  float sway = sin(t * 0.21 + aP1.w * 40.0);
  w *= 1.0 + aP0.w + 0.006 * sway;
  w.z += aP1.x + 0.02 * sway;
  vec3 v = viewRot() * w;
  vec3 p = projectView(v);
  float s = perspAt(v.z);
  float front = smoothstep(-0.8, 1.2, v.z);
  float side = mix(uOrbE[i].x, 1.0, front);
  float tw = 0.78 + 0.22 * sin(t * (0.6 + aP1.w) + aP1.w * 60.0);
  float m = maskAt(p.xy);
  vB = vec2(aP1.z * tw * side * m, aP1.w);
  gl_Position = clipFromPx(p);
  gl_PointSize = max(aP1.y * 2.6 * uRes.z * mix(0.85, 1.15, s - 0.9), 3.0);
}`;

export const PARTICLE_FS = HEADER + /* glsl */ `
in vec2 vB;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  float a = exp(-r2 * 14.0) * 1.25 + exp(-r2 * 3.0) * 0.22;
  vec3 col = mix(vec3(0.55, 0.57, 1.0), vec3(0.92, 0.93, 1.0), step(0.82, vB.y));
  outColor = vec4(col * a * vB.x * 1.9, 1.0);
}`;
