# Windows installer

Current public bundles are **Hosted-first**. See the "Hosted-first release candidate — 22 October 2026" section below for production endpoints, explicit separate Local Mode, build provenance and acceptance limits. Older bundle records below describe historical Local Mode verification and are not production approval.

`npm run package:win` builds the application, creates the portable bundle below, then wraps it in an NSIS installer: `release/Haven-<version>-installer/Haven-Setup.exe`, with `Haven-Setup.exe.sha256` and `INSTALLER-INFO.json`. The steps also run separately: `npm run package:win:portable` and `npm run package:installer -- --portable <bundle> [--output release/<NewDirectory>]`. The first installer build downloads electron-builder's NSIS toolchain into its cache.

- **Technology:** electron-builder (exact-pinned devDependency) with `--prepackaged`, so the installer ships the already verified portable payload unchanged (separate Node runtime for `better-sqlite3`, compiled hotkey helper, license notices). Configuration: `apps/desktop/installer/electron-builder.config.cjs`; NSIS hooks: `apps/desktop/installer/installer.nsh`; sidebar artwork: `apps/desktop/installer/sidebar.bmp` (regenerate with `make-sidebar.ps1`).
- **Install:** per-user wizard (no administrator prompt) into `%LOCALAPPDATA%\Programs\Haven` by default, changeable directory, Start Menu shortcut, optional desktop shortcut and "Launch Haven" on the finish page, Apps & Features entry with publisher, version and uninstaller. Silent: `Haven-Setup.exe /S [/D=C:\Path\Haven]` (run it from PowerShell or cmd; Git Bash rewrites `/S`).
- **Data:** Haven keeps data in `%APPDATA%\Haven`, outside the install directory. Install and update never touch it. Uninstall keeps it unless the user answers Yes to the removal prompt (default No), or a silent uninstall passes `--delete-app-data`. Uninstall removes the desktop shortcut and a "start at sign-in" entry only when that entry points at the installation being removed. Running Haven processes inside the install directory (including the bundled backend and hotkey helper) are closed before files are replaced; portable copies elsewhere are not touched.
- **Identity:** `appId` is `electron.app.Haven`, Electron's default AppUserModelID for `app.setName('Haven')`, so shortcuts, taskbar grouping and the login item match the running app.
- **Payload hygiene:** `scripts/package-audit.mjs <bundle>` fails a build containing development packages (Playwright, Electron, TypeScript, Vite, React and other frontend-only packages, `@types`), Haven source maps or tests, logs, databases, `.env` files, landing or test/evidence directories, or missing runtime files. The installer build runs it before packaging.
- **Verification:** `npm run verify:installer` installs silently into a temporary directory, audits the installed tree, compares it byte-for-byte with the portable source, checks the Apps & Features entry and Start Menu shortcut, launches Haven in Local Mode with a disposable profile, reinstalls over it (update) and signs in again, then uninstalls and confirms shortcuts, startup entry and data handling. It refuses to run if Haven is already installed for the user and never opens the real profile; it only compares a listing of `%APPDATA%\Haven` before and after. Results: `test-results/installer-verification-<version>.json`.
- **Distribution:** the installer is unsigned (Windows SmartScreen will warn) and has no auto-update channel. For GitHub Releases, attach `Haven-Setup.exe` under that exact name so `https://github.com/Adi-1626/Haven/releases/latest/download/Haven-Setup.exe` always serves the newest release.

# Windows portable build

Run `npm run package:win:portable` from the project directory after dependencies are installed. The command builds the application and runs `scripts/package-windows.mjs` on Windows x64. Only the backend's production dependency closure is copied (`npm ls --omit=dev --workspace=@haven/backend`); Electron main uses Node built-ins, and the web client is already bundled into `dist/`. Type declarations and source maps are excluded. The result is `release/Haven-<version>-win32-x64/Haven.exe`, currently `release/Haven-0.4.1-win32-x64/Haven.exe`; distribute the entire directory together.

The build includes the installed Electron runtime, compiled client and server, desktop capture picker, production dependency closure, and the exact Node executable running the packaging script. It requires no system Node installation on the destination computer. Node is a separate backend process so `better-sqlite3` keeps its Node ABI; do not rebuild that binding for Electron. Packaging checks an in-memory SQLite query before copying and repeats it using the copied Node runtime and dependencies.

The script requires `node_modules/electron/dist` with its downloaded Windows runtime, plus existing `build/` and `dist/` outputs. It does not install dependencies or download Electron. If Electron's runtime was not downloaded during dependency installation, run `node node_modules/electron/install.js` first. Missing build/runtime files, failed dependency inventory, or incompatible SQLite bindings fail the build. Reinstall the production native binding with the intended Node version before packaging if its ABI differs.

Packaging creates a new output directory and never deletes an existing release. If the same version's output directory already exists, preserve it under another name before rebuilding or increment the package version. The older `release/Haven-win32-x64` v0.1 bundle and earlier preliminary directories are preserved. Failed builds retain `PACKAGING-INCOMPLETE.txt`; distribute a build only after `PACKAGING-COMPLETE.txt` and `PACKAGE-INFO.json` exist. The metadata records the Node version, ABI, executable digest, package count and SQLite verification result. This verifies files and native binding compatibility; it does not establish microphone, networking or capture performance on another machine.

Electron's `LICENSE` and `LICENSES.chromium.html` remain at the bundle root. Dependency packages retain their upstream licensing files. `THIRD_PARTY_NOTICES.txt` indexes their package names, versions, declared licenses and paths. Node's matching license is copied from beside its executable when available. Otherwise packaging downloads only the license from the exact Node version tag in the official Node.js repository. For offline packaging, set `HAVEN_NODE_LICENSE` to that version's local `LICENSE` file.

This is an unsigned portable directory, without an installer, update service or code-signing certificate. Windows may display an unknown-publisher warning. Its backend data belongs in the user's application data directory selected by Electron, outside the portable bundle. Use `Haven.exe --server=https://your-server.example` to connect to an independently deployed compatible server instead of starting a local backend. TLS, public routing and TURN deployment remain operator responsibilities.

## Version 0.4.1 shutdown hotfix

Use `release/Haven-0.4.1-win32-x64/Haven.exe` for the destroyed-window IPC fix. It contains **6,447 files / 541,344,366 bytes**, with all **43** workspace payload files verified. The served client asset/hash remains identical to v0.4.0 because this hotfix only changes Electron main/runtime code. Previous release directories remain unchanged.

The exact package passes no-system-PATH launch, independent accounts, existing-account form login, restart persistence and a disposable v0.4.0 → v0.4.1 upgrade preserving login/community/invitations. `test-results/package-upgrade-0.4.1.json` contains hashes and checks. Verification now collects main-process exceptions through shutdown and fails if any occur; it no longer relies only on renderer errors.

The exact executable also passes all 12 native background/tray/hotkey/capture checks with no collected main-process exceptions. An initial injected mute/deafen timeout passed on an unchanged rerun; see `VERIFICATION.md` for that limitation and the RTP continuity sample. Quit the old process, including its tray, before opening v0.4.1; the old folders and normal user data were not replaced by verification.

## Historical version 0.4.0 community experience

The new portable executable is `release/Haven-0.4.0-win32-x64/Haven.exe`. The whole directory contains **6,446 files / 541,343,581 bytes**, including 141 production packages, Node v22.23.2 / ABI 127, SQLite 3.53.2 and the newly compiled Windows shortcut helper. Old releases and the real user profile remain untouched.

`node scripts/verify-package.mjs --previous "C:\Users\adity\OneDrive\Desktop\space\release\Haven-0.3.1-win32-x64\Haven.exe"` passes against the exact executable: all **42** current workspace payload files match, launch works without system PATH/Node, independent Desktop/Chrome/isolated accounts work, restart retains login/community/friendship, and a disposable v0.3.1 profile upgrades without signing in again. Existing and new invitations work after additive migration. Detailed hashes/checks: `test-results/package-upgrade-0.4.0.json`.

The served client is `index-D1PR1H_7.js`, SHA-256 `884fd859d6b0ede69c581e65303e489093c767ea70b5fc2696a2f51d0f309023`. Packaged `index.html` SHA-256: `b4926e3f8d67e820674b3aa3fc504a75f177528e1d7387da91698c6885645a3e`. The Electron executable itself is unchanged from the previous runtime; application payload hashes distinguish the update.

`node scripts/verify-desktop-gaming.mjs "C:\Users\adity\OneDrive\Desktop\space\release\Haven-0.4.0-win32-x64\Haven.exe"` passes **12 native checks** using the bundled helper: source-picker Cancel/X/Escape, native recording suppression/restoration, held-key release-before-rearm, actual Windows-injected global shortcuts behind an owned fullscreen surface, tray callbacks and full Quit, media continuity through minimize/close-to-tray, and settings restored across changing backend ports. Captured-window video plus synthetic microphone remained live/connected, with sampled outgoing RTP bytes increasing **30,373 → 37,576 over 1.6 seconds**. This sample includes audio/video transport and is not a voice-only bandwidth or gaming benchmark.

The native test observes bridge shortcut events and controlled WebRTC transport; focused push-to-talk microphone gating and multi-client application voice are covered separately by the browser suite. Physical microphone/speaker routing, actual taskbar clicking/startup, real games/anti-cheat and WAN behavior remain unverified. This is still an unsigned portable folder, not an installer or auto-update.

## Historical version 0.3.1 sign-in hotfix

`release/Haven-0.3.1-win32-x64/Haven.exe` includes matching registration/login username rules, copied `@username` normalization, explicit Sign in controls and guidance about separate localhost/Desktop account databases. No real account/password/database migration or reset was performed. The fix does not make accounts portable across independent backends.

The exact package passes a v0.3.0 → v0.3.1 upgrade in a disposable profile, independent authenticated clients and actual existing-account sign-in through the form in an isolated desktop client while the main account stays signed in. All 40 workspace payload files match the bundle, containing 6,444 files / 541,254,292 bytes. Served asset `index-CzZL8IQ8.js` has SHA-256 `dee811a5cdd164d1f5c067addf1c102583927d60dac5142b9e899e71e6c0491a`. Details are in `test-results/package-upgrade-0.3.1.json`.

## Historical version 0.3.0 bundle

The portable application is `release/Haven-0.3.0-win32-x64/Haven.exe`. Packaging includes Node v22.23.2, ABI 127 SQLite 3.53.2, all 141 production packages, and a compiled `resources/app/electron/HavenHotkeys.exe` alongside its independent C# source. The recipient needs the Windows .NET Framework 4 runtime, but no compiler, Node or npm installation. Source development can compile the helper lazily if the .NET Framework compiler is available. Missing/blocked helper execution is reported in settings and does not silently enable global PTT.

This remains an unsigned portable application. No installer, auto-updater, process injection, anti-cheat bypass or privileged game integration is included. Old release directories and the real Haven profile are preserved.

The final v0.3 bundle has **6,442 files / 541,251,643 bytes**. All 38 workspace `electron/`, `build/` and `dist/` payload files match the package by SHA-256. Served client `index-CS5I2vtb.js` has SHA-256 `730aafb18f66b79610da51a20b5308374944f628c603923f80c7171727d5ac53`. The full payload ledger is `test-results/package-upgrade-0.3.0.json`.

The exact executable passed the no-PATH/no-HAVEN_NODE smoke test and an actual isolated v0.2.0 → v0.3.0 upgrade, preserving desktop login, community, friendships and invitation redemption without using the real profile. `node scripts/verify-desktop-gaming.mjs "C:\Users\adity\OneDrive\Desktop\space\release\Haven-0.3.0-win32-x64\Haven.exe"` also passed all nine native background/tray/hotkey checks with the bundled keyboard helper. In that packaged run, captured-window video plus synthetic microphone remained connected/live in background and RTP bytes increased from 32,138 to 49,416 over the sample. Shortcut delivery behind an owned fullscreen window is not Valorant/anti-cheat verification; real startup-at-logon and physical tray clicks remain manual checks.

## Historical verified v0.2.0 bundle

The current portable executable is `release/Haven-0.2.0-win32-x64/Haven.exe`. Its complete directory contains **6,435 files / 541,193,106 bytes**, including 141 production packages, Node `v22.23.2` / ABI `127`, and SQLite `3.53.2`. The previous v0.1 directory and the user's existing application-data profile were not modified during packaging or verification.

All 32 current files from `electron/`, `build/`, and `dist/` match the copied bundle byte-for-byte by SHA-256. The application serves `index-DKFqDSzQ.js`, SHA-256 `0aa26121fa741a76b6728ab65c029f71b0b42dfcc2a224a4f2e378c3021d9e57`; copied `dist/index.html` is `3ba561549e86011dcaef852f6b8d56b733b18c9effb1de4e2248d04366890c78`. The portable `Haven.exe` SHA-256 is `1f41127064012c5e74422b2e0dfc35ff0b0fe8d7908b97d01503becd1b7fa9e1`. The bundled Node executable SHA-256 is `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`. Electron, Chromium, Node and dependency licensing files remain in the bundle.

`node scripts/verify-package.mjs` launched this exact packaged executable with every `PATH` environment variable removed and `HAVEN_NODE` unset. It used a disposable `HAVEN_PROFILE_DIR`, created Account A through the visible desktop UI, verified the served client asset and health endpoint, then created Account B in real headless Chrome and Account C in an isolated Electron window on the same embedded backend. Account B redeemed an invitation and accepted Account A's friend request. All three account sessions stayed independent; closing C preserved A's session.

After closing Haven, the copied Node executable directly opened the disposable persisted SQLite database and verified all three accounts and the community. Restarting the packaged executable with the same disposable profile preserved Account A's login, community and friendship, and password login also returned HTTP 200. A reopened isolated test client started signed out; closing the main client closed its dependent client. Both runs used the bundled backend runtime with no system `PATH`. The temporary profile was removed after validating that it remained within the expected temporary directory.

Repeat the smoke test with `node scripts/verify-package.mjs`, or pass an absolute packaged executable path as its argument. The script compares the package with the current workspace payload and requires Chrome for its independent browser client. Full hashes and measured results are written to `test-results/package-verification-0.2.0.json`. This packaged smoke test does not exercise real microphone acoustics, native screen capture or cross-device networking; separate media tests document those boundaries.

The upgrade check also passed: `node scripts/verify-package.mjs --previous "C:\Users\adity\OneDrive\Desktop\space\release\Haven-win32-x64\Haven.exe"` launched the original v0.1.0 executable against a newly created temporary profile, created Account A, a community and an invitation, then closed it and opened v0.2.0 against that same disposable profile. Account A remained authenticated without another sign-in and the community was preserved. The old invitation successfully previewed and Account B redeemed it after migration; creating a new invitation also worked. The script then repeated the independent-browser/isolated-client and restart checks. Both versions' actual Electron user-data paths were verified to equal the temporary profile; the real user's profile was never opened. Upgrade evidence is in `test-results/package-upgrade-0.2.0.json`.

## Historical v0.1 bundle

The previous local bundle is `release/Haven-win32-x64/Haven.exe`. Its recorded complete directory size was 541,482,040 bytes and included 141 production packages, Node `v22.23.2` / ABI `127`, and SQLite `3.53.2`. Earlier preliminary and incomplete outputs were preserved under `release/preliminary-20261015Tfinal`. The remaining records in this section describe that earlier build, not v0.2.0.

After the last build, all 32 current files from `electron/`, `build/`, and `dist/` were copied into the bundle and compared against their source SHA-256 hashes. The served client asset is `index-DBZeCjPR.js`, SHA-256 `55ed6bc2381b8e339df4b5413e2d18a239be18427269ecd51ede9ab8ad659451`; copied `dist/index.html` is `46fa344f18ec2311f1f9a55820c99c8a90abc2c69af2e471fc51ce66985bf223`. `PACKAGE-INFO.json` records these payload comparisons. Older unused hashed assets may remain from the initial candidate; the final HTML references the verified current asset.

A standalone Playwright Electron smoke test launched this exact executable with all `PATH` variables removed/empty and `HAVEN_NODE` unset. It verified the visible account page, the final served client asset, `/api/health` returning `{ok:true}`, account creation returning HTTP 201, the authenticated account API and UI, and successful HTTP 200 login after closing and restarting the packaged application against the same isolated profile. This exercises persistent packaged SQLite storage and the bundled backend runtime. Both application instances were closed and the temporary profile was removed after validating its path. This smoke test does not replace real-device media or cross-machine network tests.
# Hosted-first release candidate — 22 October 2026

Public Windows bundles now include a strictly validated `resources/app/release-config.json` with Hosted Mode, backend `https://haven-backend.getvoroa.com` and frontend `https://haven-ea6.pages.dev`. A fresh packaged launch loads that frontend directly and supplies the backend through the existing native API bridge. Missing/invalid packaged defaults fail closed; no automatic Local Mode fallback occurs. A historical saved localhost connection cannot replace the public default. Explicit `--server` / `HAVEN_SERVER` and saved HTTPS server selection remain deliberate connection choices.

Source development (`npm run desktop`, `npm run desktop:dev`) keeps its existing Local Mode behavior. For explicit Local Mode from a packaged app, use `Haven.exe --local-mode`. Without an explicit test profile it uses `%APPDATA%/Haven Local`, keeping personal development data separate from Hosted. `--local-mode` ignores the saved Hosted server and conflicts with `--server` / `--dev`. Startup registration retains that Local Mode argument. Existing `%APPDATA%/Haven` data is neither moved nor migrated. To open an existing personal Local profile deliberately, supply its path with the existing `--profile=...` or `HAVEN_PROFILE_DIR` override.

`package-windows.mjs` writes only public configuration; `package-installer.mjs` rejects absent/invalid defaults and stale main/config modules before preserving the existing NSIS wizard, shortcuts and reinstall/uninstall behavior. The payload audit rejects private key/profile/environment/database artifacts, recognizable secret keys, service-role JWTs and credential-bearing PostgreSQL URLs. The bundled backend and SQLite runtime remain available for explicit Local Mode; no personal databases are copied.

Build into new directories because existing release outputs are preserved:

```powershell
npm run build
node scripts/package-windows.mjs --output release/Haven-hosted-review-r2-20261022
node scripts/package-installer.mjs --portable release/Haven-hosted-review-r2-20261022 --output release/Haven-hosted-review-20261022-installer
node scripts/verify-installer.mjs release/Haven-hosted-review-20261022-installer/Haven-Setup.exe
```

This unsigned, unpublished candidate retains the existing package version; it is not an approved public release. Hosted loads the deployed frontend, whose current bundle is older than this workspace and lacks current stream/onboarding/refresh markers. Do not infer feature compatibility from the health endpoint or matching version number. See `docs/AGY-PRODUCTION-REVIEW-20261022.md` and `output/production-review-20261022/REPORT.md` for evidence and remaining release gates.

## Pre-push audit — 24 October 2026

Preserved candidate: `release/Haven-hosted-candidate-r2-20261024-installer/Haven-Setup.exe`, version
0.4.1, 128,438,544 bytes, SHA-256
`b3891683f46e86d5a5049dd6fdf83ccf3d11d8c6979e527398aef48fa3be8641`.
It remains unsigned and unpublished. This audit did not overwrite or rebuild it.

The candidate **must not be publicly released**: its native media-settings schema predates the
`soundboardVolume`/`soundboardMuted` fields sent by the current renderer. Rejected saves can trigger
the microphone safety block. The source schema and acknowledgement/restoration tests are now fixed;
all three real Electron media E2E cases pass. The candidate also predates the patched Electron 44.9.1
and dependency lockfile. A fresh build and clean-profile installation verification are required after
these source fixes. Earlier native bridge smoke checks did not cover this renderer/schema mismatch.
Run `npm ci` before that rebuild. Packaging now verifies both the installed Electron package and its
runtime version file against the exact manifest pin, records that version, and rejects stale runtimes
when wrapping a portable bundle in NSIS. This also prevents a changed lockfile from giving false
confidence while an older development `node_modules` remains installed.

The runtime still opens the actual Hosted authentication app, with no landing payload or personal
SQLite data. The deployed Hosted frontend remains older than the source planetary authentication,
onboarding, refresh and opt-in stream protocol. A coordinated, approved web/backend/database rollout
and production acceptance remain separate release gates; rebuilding the installer cannot satisfy them.

## Version 1.0.0 — 24 October 2026

All workspace manifests and the lockfile are **1.0.0**. Electron, the NSIS installer (Apps & Features
`DisplayVersion`) and `Haven.exe` file/product version (`1.0.0.0`) take it from the root `package.json`;
the backend reports it from its own manifest on `/health`, `/api/health`, `/api/ready` and `/`. The UI
shows no version badge. No 1.0.0 portable bundle or installer has been built yet; every 0.4.1 candidate
above remains unpublishable. Build into the default, new directories:

```powershell
npm ci
npm run package:win
npm run verify:installer
```

This produces `release/Haven-1.0.0-win32-x64` and `release/Haven-1.0.0-installer/Haven-Setup.exe`.

## Version 1.0.1 — 28 October 2026

All workspace manifests and the lockfile are **1.0.1** (commit `923a2a7`, tag `v1.0.1`). Version sources
are unchanged: Electron, the NSIS installer and `Haven.exe` file/product version (`1.0.1`) take it from the
root `package.json`; the backend reports its own manifest's version on its health endpoints.

1.0.1 is the first release with automatic updates. From now on every release publishes three assets
from `release/Haven-<version>-installer/` together, under a tag that contains the version:

| Asset | Bytes | SHA-256 |
|---|---|---|
| `Haven-Setup.exe` | 145,036,025 | `731e0bf15e07a4b245411d4b4b43f0534c531a7ca51c70fe594ad5ad5b50179d` |
| `Haven-Setup.exe.blockmap` | 152,163 | `133d17ad23f1216d2882cc761611814c97f2f39da4e799048559e5f231e321ab` |
| `latest.yml` | 327 | `47712d122a1cb39d4fbcba4cbe901e106cfe1fbbc0e008232eb8c3f0ba0febaa` |

The installer is unsigned. 1.0.0 contains no updater, so its users install 1.0.1 once by hand. The v1.0.0
GitHub Release was replaced by the v1.0.1 release; the `v1.0.0` tag remains, and the original 1.0.0
installer had SHA-256 `76bb06a6cf3a8fd005bc125a7cebfa87a32ddec956961272b6a72f0eab63dd52`.
