# Haven 0.4.1

An independent, self-hosted desktop community application inspired by Discord's interaction model. Electron, React, TypeScript, SQLite, Socket.IO and WebRTC. No Discord code, assets, services or accounts are used.

Version 0.4 adds live profile-picture updates during voice, original-picture viewing, recorded keyboard shortcuts, permission-checked custom server emoji (including animation), expanded server settings and right-click menus with local volume/mute and community moderation. See the [community experience guide](docs/COMMUNITY-EXPERIENCE.md) for controls, limits and validation.

Version 0.4.1 fixes a desktop shutdown race: queued settings/voice IPC and tray snapshots no longer dereference a destroyed main window. Desktop verification now fails on uncaught main-process exceptions during teardown instead of checking renderer errors alone.

Version 0.3 adds optional Windows tray/startup behavior, global hold-to-talk and mute/deafen shortcuts, stable desktop preferences across changing local ports, audio hot swapping, automatic voice recovery, animated emoji and a low-resource gaming mode. It fixes source-picker cancellation and reduces background visual/network work. See the [desktop and gaming guide](docs/DESKTOP-GAMING.md) for settings, manual tests and limitations. The [two-account guide](docs/MULTI-CLIENT.md) covers Desktop Account A plus browser Account B, LAN and Internet hosting. The [communication review](docs/COMMUNICATION-REVIEW.md) retains the previous communication update's evidence.

## Run

Requirements for source development: Windows x64, Node.js 22.12 or newer, npm. The portable Windows build includes both Electron and Node and requires neither npm nor a separate Node installation.

```powershell
npm ci
npm run build
npm run desktop
```

Or double-click `Start-Haven.cmd` after installing Node. The updated portable copy is at `release/Haven-0.4.1-win32-x64/Haven.exe`; keep its entire folder together. This is an unsigned portable application, not an installed, signed release. The older builds are retained separately. Fully quit the old version, including its tray if enabled, before launching the updated executable; the existing Haven data/profile is preserved.

Version 0.3.1 fixes login form validation for supported dotted/hyphenated usernames and copied `@username` values. Accounts are local to their Haven backend: a separately started browser server at `localhost:3001` does not contain your Desktop accounts. To use a Desktop account in a browser, open Desktop → **Test with another account → Copy backend URL**, then use that exact address. Do not copy account databases between running backends or recreate the account to work around a wrong address.

The desktop opens its own local server and stores its database and uploaded files under `%APPDATA%/Haven/server`. Choose **Test with another account** above your profile controls to open a browser or an isolated client on this exact backend while keeping Account A signed in. Create Account B there, then redeem Account A’s community invite and exchange friend requests. Separate default desktop installations have separate servers and accounts. To talk across computers, host one shared server and connect each desktop from **Connect to a Haven host** on the sign-in screen, or launch:

```powershell
npm run desktop -- --server=https://haven.example.com
```

The selected remote address persists in `%APPDATA%/Haven/connection.json`. Delete that one file to return to the local server. CLI `--server=` overrides the saved address. Remote addresses require HTTPS; localhost HTTP is also supported.

For browser access to the local source server:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:3001`. `npm run dev` runs the UI on port 5173 and API on 3001 with hot reload. `npm run desktop:dev` opens that UI in Electron.

## Working features

- Accounts with asynchronous scrypt password hashing, expiring hashed cookie sessions, profiles, presence and notification permission controls.
- Communities, shareable invitation links/codes with previews, expiration and revocation; owner/admin/member roles, membership removal, deletion and channel management/reordering. Server-side permissions apply to HTTP, files and signaling.
- Persistent text channels, individual and group DMs, friend requests, typing indicators, message editing/deletion, replies, reactions, history pagination and message search.
- Private attachments up to 25 MB, with authenticated downloads and explicit scope checks.
- Persistent WebRTC voice rooms with speaking state, retained mute/deafen, customizable global desktop push-to-talk, automatic recovery, named device detection/hot swapping, measured microphone testing, sensitivity, noise suppression/echo cancellation and per-peer volume.
- Optional Windows tray/background/startup behavior, global mute/deafen, stable desktop settings and low-resource gaming mode; original animated emoji in messages, reactions and picker with motion/background controls.
- Recorded editable key combinations, live voice avatars, original profile-picture viewing, participant context menus with local audio controls, and persistent community mute/deafen/disconnect actions with role checks.
- Server name/description/icon editing and authenticated static/animated custom emoji uploads, renaming and deletion, integrated with chat, reactions and the server-scoped picker.
- Custom audio soundboards with stored uploads up to 5 MB. Sounds mix into the user's outgoing voice track; remote listeners hear that mix through WebRTC.
- Window/display capture through a desktop source picker. Browser clients use their native screen picker. Optional Windows system audio requires explicit selection in the desktop picker and captures the computer's whole audio output.
- Native and dynamically derived lower resolution choices; 15/30/60 fps targets; per-viewer bitrate budget; actual outgoing/incoming WebRTC video statistics.
- Expanded stream viewing and actual fullscreen with voice controls and explicit Stop Sharing; voice remains connected during text navigation and after capture ends.
- Responsive layout, keyboard message controls, saved conversation selection, unread badges, background notifications, friend request management and persistent blocking.

There are no seed accounts or invented chat messages. Browser tests create disposable accounts and databases outside the normal application profile.

## Screen sharing policy

The captured video's intrinsic dimensions are the source of truth, with the track's `getSettings()` as a fallback while frames initialize. Chromium can retain stale track dimensions after resizing, so the application also observes actual captured frames. The highest offered resolution is the captured source's current width and height. Lower presets preserve its aspect ratio. Sender `scaleResolutionDownBy` is always at least 1. Native selection applies no enlargement. Capture uses `resizeMode: none`; lower resolution is applied to the sender so the source's dimensions remain observable when a window is resized. Source changes refresh the allowed targets every second.

The 60 fps control requests a ceiling, not a guaranteed result. Chromium chooses supported capture/codec/hardware paths and WebRTC adapts to hardware and network capacity. The quality panel distinguishes target settings from sampled **encoded/received** dimensions, fps, bitrate and loss. Native 60 fps requires enough source motion, hardware capacity and upstream bandwidth. Keep stable voice prioritized by reducing screen bitrate/FPS when a connection is constrained. No independent GPU encoder or packet prioritization scheduler is claimed.

Voice uses a mesh with a hard **eight connection limit per room**. A screen sender uploads one encoded stream per viewer: a budget of 8 Mbps with seven viewers can require roughly 56 Mbps upstream plus audio and transport overhead. Large rooms require an SFU; this implementation does not claim Discord-scale infrastructure. Multiple browser tabs count as separate connections.

## Shared hosting

Copy `.env.example` to `.env`; the API entry loads it automatically. Bind to loopback behind an HTTPS reverse proxy. A remote browser microphone/display capture needs a secure context. Configure authenticated TURN for real internet connectivity: STUN alone cannot bridge every NAT/firewall.

Example `.env`:

```dotenv
HOST=127.0.0.1
PORT=3001
DATA_DIR=./data
PUBLIC_URL=https://haven.example.com
TRUST_PROXY=1
SECURE_COOKIES=1
ALLOWED_ORIGINS=https://haven.example.com
ICE_SERVERS_JSON=[{"urls":"stun:your-turn-host.example.com:3478"},{"urls":["turn:your-turn-host.example.com:3478?transport=udp","turns:your-turn-host.example.com:5349?transport=tcp"],"username":"your-user","credential":"your-credential"}]
```

Only set `TRUST_PROXY=1` behind a trusted proxy that replaces forwarded headers. Use `SECURE_COOKIES=1` with HTTPS. `ICE_SERVERS_JSON` is sent to authenticated clients, so use appropriately scoped TURN credentials and rotate them. TURN credential issuance, relay hosting, TLS certificates and public DNS are deployment responsibilities.

A Caddy example is in `deploy/Caddyfile`. Keep the API port inaccessible to the public when trusting a local proxy. Store `DATA_DIR` on a durable local disk, not an unreliable network share. Run one API process for this SQLite deployment. Back up the complete data directory while the server is stopped; the database, WAL and uploaded file bytes belong together. Never commit `.env` or `data/`.

## Check and package

```powershell
npm test
npm run build
npm run test:e2e
npm run test:desktop-clients
npm run test:desktop-gaming
node scripts/verify-audio-devices.mjs
npm audit
npm run package:win
```

Browser tests use installed Chrome with synthetic microphone input; Electron tests select **Haven's own window or an owned test surface**, not another application or the whole desktop. The E2E runner starts a fresh disposable backend per spec so account creation across the growing suite does not exceed production signup protection; production rate limits are unchanged. The explicit device-check script briefly opens the real default microphone to verify Windows device names, stops it immediately and saves no audio. Runtime tests exercise real HTTP, SQLite, Socket.IO and WebRTC connections. Packaging refuses to overwrite an existing release folder. See `docs/PACKAGING.md` for runtime ABI and license details. `npm run measure:background -- current` records bounded localhost CPU/memory/RTP/latency samples under `measurements/`, not a game benchmark.

## Boundaries

This is a working small-community implementation. It does not yet provide arbitrary custom roles/channel permission overrides, a media SFU, public hosted infrastructure, email recovery/MFA, an installer/auto-updater, advanced moderation, full mobile background calling, message virtualization, or full Discord feature parity. Group DMs support text; voice lives in server voice channels. Window/system audio support and sustained native 60 fps vary by OS, driver, source and network.

Physical microphone/speaker quality, echo under real devices, TURN-only paths, 4K/60 fps sustained throughput, CPU/GPU utilization under load, long-running reliability and broad adversarial security testing require separate environment/hardware validation. Do not interpret a passing local test as those guarantees. Verification evidence is recorded in `docs/VERIFICATION.md`.

## Source map

| Path | Purpose |
| --- | --- |
| `server/app.ts` | Authenticated HTTP, SQLite, file access and realtime authorization |
| `server/index.ts` | API startup and shutdown |
| `shared/types.ts` | Shared API objects |
| `server/API.md` | HTTP/socket contract and limits |
| `client/App.tsx` | Community, chat, account and settings interface |
| `client/media.ts` | Voice session lifecycle, sound mixing, capture and WebRTC |
| `client/media-quality.ts` | Source-bounded quality calculations |
| `electron/` | Isolated desktop shell and capture picker |
| `e2e/` | Independent browser and real desktop-window transport checks |
| `docs/INVESTIGATION.md` | REA findings, evidence IDs and explicit unknowns |

The [Electron capture API](https://www.electronjs.org/docs/latest/api/desktop-capturer), [W3C WebRTC statistics](https://www.w3.org/TR/webrtc-stats/) and [REA](https://github.com/morluto/rea) informed the independent implementation. Static Discord findings do not establish its native algorithms or live stream performance.
