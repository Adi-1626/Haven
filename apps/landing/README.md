# Haven public website

A single-page tour through Haven's own orbital system. The background is the authentication screen's WebGL scene (`apps/web/src/orbital`), imported directly rather than copied, and driven as a camera: each part of the site lives on the planet or one of its four moons. Zenith Minimal / Obsidian, the official logo, local Space Grotesk / Inter / JetBrains Mono, lavender and emerald are preserved.

## Develop and verify

From the repository root:

```powershell
npm run dev --workspace=@haven/landing      # http://127.0.0.1:5174
npm run build --workspace=@haven/landing
npm run test --workspace=@haven/landing     # builds must exist; serves dist on 4184
```

The suite runs in installed Chrome, Edge and Playwright WebKit (`HAVEN_INCLUDE_FIREFOX=1` adds Firefox). `scripts/capture.mjs` renders stations, flights and demo states with GPU WebGL for visual review; `scripts/audit-performance.mjs` records transfer size and main-thread load against a running preview. Evidence lives in `output/landing-premium-20261024`.

Building needs the monorepo checkout, because the orbital scene is imported from `apps/web/src/orbital` through the `@orbital` alias (`vite.config.ts`, `tsconfig.json`). Nothing in `apps/web` is modified by the website.

## How the planetary camera works

- `src/cosmos/camera.ts` defines the stations in page order (`top`, `product`, `communities`, `desktop`, `how-it-works`, `faq`, `home`). A station keeps one body at a chosen point and size on screen, per breakpoint. The scene positions everything from one planet centre and radius, so a camera move is just a new layout; flights interpolate in log-zoom and pull back mid-flight when the two bodies are far apart.
- `src/cosmos/projection.ts` mirrors the shader's Kepler maths on the CPU so moons can be labelled, clicked and tracked while they orbit.
- `src/cosmos/engine.ts` owns the canvas, quality tiers and frame pacing (60 fps while something moves, 30 fps when still, paused when hidden). Scrolling scrubs the camera between stations; `data-calm` on copy calms the scene behind it.
- `src/cosmos/nav.ts` choreographs a click: copy fades, the camera flies, the page moves while nothing is visible, the destination settles in and focus lands on its heading.
- Waypoints on the moons are pointer conveniences and are hidden from assistive technology; the hero's "Explore Haven" list, the header and the position rail are the accessible routes.
- Reduced motion renders still frames and jumps instantly. Without WebGL2 the approved still artwork is shown and everything else works.

## Publishing the Windows installer

`src/config.ts` → `WINDOWS_RELEASE` is the only switch. It is `'available'` for Haven 1.0.1: every Windows download links directly to `https://github.com/Adi-1626/Haven/releases/download/v1.0.1/Haven-Setup.exe`, and the download panel shows the published SHA-256 with a PowerShell command to verify it. For a later release:

1. Update `url`, `version`, `size`, `sha256` and `notesUrl` from the newly published asset; the asset name must stay exactly `Haven-Setup.exe`.
2. Keep `signed: false` unless the published installer is code-signed (it controls the SmartScreen guidance in the download panel and FAQ).
3. Rebuild and run the suite; update the installer URL and checksum in the "honest primary actions" test.

Setting `status: 'pending'` again restores **Installer coming soon**, a disabled download button and no `.exe` link.

## Boundaries

Open Haven always points to `https://haven-ea6.pages.dev`. All demos are page-local: nothing typed is sent, no microphone or screen is captured, and sample people, servers and timestamps are labelled as samples. Avoid invented operational status, metrics, or security, privacy and release claims. The website does not touch Electron, packaging, backend, production data or deployment.
