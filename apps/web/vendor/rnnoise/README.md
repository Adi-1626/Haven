# Vendored RNNoise

These assets are served by Vite from this repository; microphone samples never
leave the browser for noise suppression. RNNoise expects 48 kHz mono audio.
The non-SIMD WASM build also works without SIMD support.

Sources (retrieved 2026-10-16):

- `@sapphi-red/web-noise-suppressor@0.3.5`, npm registry tarball,
  https://github.com/sapphi-red/web-noise-suppressor (MIT).
  Integrity: `sha512-jh3+V9yM+zxLriQexoGm0GatoPaJWjs6ypFIbFYwQp+AoUb55eUXrjKtKQyuC5zShzzeAQUl0M5JzqB7SSrsRA==`.
  `workletProcessor.js` comes from `dist/rnnoise/workletProcessor.js` and
  `rnnoise.wasm` from `dist/rnnoise.wasm`.
- The bundled JavaScript and WASM originate in
  `@shiguredo/rnnoise-wasm@2022.2.0` (Apache-2.0 JavaScript wrapper;
  BSD RNNoise native code), https://github.com/shiguredo/rnnoise-wasm.
  npm integrity: `sha512-WqkBxuqc0WhG1eQW+tKw9asclkysEb9hrbyUieBNiYQnNM9EzNXbNN5o++SwKWou/rsH4LW6LZMe+TpQQtDntg==`.
  Wrapper copyright: 2021-2021 Takeru Ohta (Original Author), Shiguredo Inc.
- Native license copied from
  https://raw.githubusercontent.com/shiguredo/rnnoise/master/COPYING.
  Its SHA-256 is `d597473329bdc1807197a303be09e79882159ea858daa9f06ce780592877534e`.
  All three license texts are retained alongside the assets.

Local patch: only the final AudioWorkletProcessor class was replaced with an
equivalent readable class (marked `Haven patch`). It starts the control port,
posts `ready` after native state is created, reports initialization errors,
returns false after destruction, and destroys native state even when a destroy
message arrives before asynchronous initialization completes. The stale upstream
source-map reference was removed. The RNNoise algorithm and WASM are unchanged.
`noise-suppression.test.ts` exercises this patched class as well as the adapter.

SHA-256 asset checksums:

- `rnnoise.wasm`: `8b60a2ab88fdae2d1a9f940249d0eb072f28ba8e796f7304347b4e07839c8853`
- `workletProcessor.js`: `275a02fe41b2c7eb65decf7d2fc547b1b26a4d8954d24646b3143a7b7596d3b9`

To update, download the exact npm versions with `npm pack`, verify integrity,
copy only these two assets and licenses, reapply the documented suffix patch,
update checksums, and run the web tests and production build. No CDN, install-time
download, or extra runtime package is required.
