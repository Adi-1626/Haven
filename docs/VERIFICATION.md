# Verification record

Latest verification: 2026-10-16. Tests ran on this Windows x64 computer. Localhost peers were separate authenticated Chrome contexts, and the desktop capture test used Electron plus an independent Chrome viewer. Test accounts and SQLite directories were disposable; no production data or Discord accounts were used.

## Version 0.4.1 shutdown hotfix

The user's screenshot exposed a real main-process exception during testing: `TypeError: Object has been destroyed` at the v0.4 `electron/main.cjs:182` settings-read handler. Optional chaining only checked whether the BrowserWindow reference existed; reading its native `webContents` property still threw after window destruction. Queued IPC from an independent client could reach that comparison while the main window was closing. The original passing renderer/transport checks did not detect this teardown exception.

Main-client IPC authorization now verifies live window/webContents state before access, rejects destroyed/detached senders/frames and returns null for unavailable synchronous settings reads. Voice/settings writes are ignored during teardown. Tray/runtime snapshots and shortcut dispatch use the same live-window guard; a backend-switch health check also revalidates its initiating window after the asynchronous request.

`npm test` passes **49 cases** (44 TypeScript and five desktop cases). New regression tests execute the real registered main-process IPC callbacks against a window whose `webContents` getter throws, including a surviving independent client, and cover detached frames and runtime snapshots. Independent Desktop/Chrome/client-close checks pass. Desktop/package verifiers now install test-only main-process exception collectors and assert them after cleanup; the application itself has no blanket uncaught-exception suppression.

The v0.4.1 package passes a disposable v0.4.0 upgrade with retained sessions/community/invitations, restart and existing-account form login. All 43 workspace payload files match. The browser/backend payload is unchanged from v0.4; this patch changes Electron lifecycle guards, not voice encoding or network behavior. See `PACKAGING.md` for native verification and the exact executable.

All 12 packaged native background/tray/shortcut/capture checks pass with main-process exception monitoring enabled, including shutdown/restart. One initial native rerun timed out awaiting injected mute/deafen delivery (PTT had passed; no main-process exception was recorded); an unchanged repeat passed. This is retained as an input-automation reliability limitation, not silently counted as an uninterrupted first-run pass. Captured-window audio/video RTP increased 43,056 → 48,967 bytes over 1.6 seconds in the passing run, with both tracks live and the connection intact. No actual game or hardware acoustic claim is added.

## Version 0.4 community experience

- `npm test`: **47 passing cases** (44 TypeScript client/backend and three desktop cases). Includes additive legacy migration, image container/frame limits, private upload permissions/revocation, cross-server/DM emoji rejection, stable rename/delete tokens, persistent hierarchy-checked voice moderation, live profile snapshots, shortcut recording normalization, arrow aliases and stale-bootstrap overlay behavior.
- `npm run build`: strict TypeScript, Vite and compiled backend pass. Final client asset: `index-D1PR1H_7.js`.
- `npm run test:e2e`: **18 cases pass**, across nine isolated specs. New two-client flows exercise URL-avatar edits during live voice (tiles, roster and already-open profile), original 1024-pixel image viewing, actual receiver volume/local mute, server mute/deafen and release back to retained personal state, friend/DM actions without leaving voice, URL/uploaded server icons and permission-gated settings. A deliberately delayed real bootstrap response cannot erase a newer socket speaking transition.
- Custom emoji E2E uploads static PNG and animated GIF through the manager, uses the member's picker/search, verifies chat/reaction sync, actual animated-image-to-static-poster switching under reduced motion/gaming mode, rename preservation, deletion to literal text and member upload rejection. APNG/WebP container handling is covered by structural backend tests; the end-to-end animated upload fixture is GIF, not every format/encoder.
- Existing chat, returning-account login, invitations, soundboard audio energy, actual WebRTC screen/audio, fullscreen, repeated capture/resize cleanup, synthetic hotplug/mic-test cleanup, signaling recovery and saved settings continue to pass. A short owned-window capture sample matches 1424 × 900 encoded/received dimensions; it is not a sustained throughput/game benchmark.
- Independent Desktop/Chrome/isolated-client verification passes, retaining three authenticated sessions, media permission, fullscreen, cleanup and backend switching.
- The exact packaged v0.4.0 executable passes **12 native Windows checks**: actual injected key press/release and global shortcut bridge delivery behind an owned fullscreen window, recording suppression/restoration, held-key cancellation/repeat safety, tray callbacks, source-picker Cancel/X/Escape and controlled WebRTC media through minimize/close-to-tray. Outgoing combined audio/video RTP increases 30,373 → 37,576 bytes over 1.6 seconds while tracks remain live. Focused application PTT gating is tested separately in the browser suite. Physical taskbar clicking, real startup-at-logon and actual game/anti-cheat delivery remain manual checks.
- The exact packaged executable passes no-system-PATH launch, 42 matching payload hashes, independent sessions, restart persistence and a disposable v0.3.1 → v0.4.0 migration preserving login/community/invitations. See the package ledger and `PACKAGING.md`.

The first expanded all-in-one E2E run exceeded the existing per-IP signup budget. The runner now creates a fresh disposable backend per spec instead of weakening production rate limits. A subsequent speaking-indicator failure exposed an actual stale-bootstrap/event race; the client now overlays newer events and rejects superseded snapshot results, with a deterministic delayed-response regression. No polling workaround was added.

UI screenshots for the new participant menu and community settings were inspected. New upload/menu work is event-driven, and emoji animation remains bounded to 24 visible active items with true static posters in background/gaming states. No fresh CPU/GPU/RAM/game-ping benchmark is claimed for v0.4; earlier bounded baseline/current results and their limitations remain in `PERFORMANCE-MEASUREMENTS.md`. No load-intensive tests were run. See `COMMUNITY-EXPERIENCE.md` for controls and policy boundaries, and `PACKAGING.md` for the exact portable executable verification.

## Version 0.3.1 sign-in hotfix

The reported browser `localhost:3001` address uses a standalone backend, separate from Desktop's database. A read-only aggregate check found existing Desktop accounts but no accounts in the workspace browser-server database. No real passwords, account contents or sessions were changed. The correct browser workflow uses Desktop's exact **Test with another account → Copy backend URL** address.

Additionally reproduced and fixed browser form validation blocking valid dotted/hyphenated usernames and copied `@username` values. Signup/login now share character rules; login trims only the username and accepts optional `@`, while password matching remains exact. Sign-in shows the current host and explains the local-backend distinction.

Validation: 40 unit/integration cases pass; five focused browser cases pass, including existing-account wrong-password rejection, successful form login, reload persistence, sign out/relogin and dotted/hyphenated registration, plus the existing chat/media/layout cases. The packaged v0.3.1 executable passes isolated v0.3.0 upgrade, login/community persistence and actual existing-account form login without replacing the main session. The real user's password was not requested or tested. See `PACKAGING.md` and `MULTI-CLIENT.md`.

## Version 0.3 desktop and gaming update

- `npm test`: 39 passing cases (36 client/backend and three desktop permission/runtime cases).
- `npm run build`: strict TypeScript, Vite and backend compilation pass.
- `npm run test:e2e`: all 12 cases pass, retaining chat/social/media/fullscreen coverage and adding animated messages/reactions, real notification preference gating with a test constructor, device-change and ended-track recovery, microphone-test settings cleanup, configurable browser PTT, and signaling interruption/recovery between two actual Chromium peers. Local microphone/screen streams survive the interruption and remote audio bytes/video resume through rebuilt peer connections. Negotiated Opus FEC/DTX and actual sender bitrate are asserted.
- `npm run test:desktop-clients`: independent authenticated main/browser/isolated accounts, capture permission, HTML fullscreen, client cleanup and safe backend switching pass.
- `npm run test:desktop-gaming`: nine Windows checks pass, including native source-picker Cancel/X/Escape, actual OS-injected key press/release behind an owned fullscreen window, tray menu callbacks and full Quit, media transport through minimization/close-to-tray, separate test preferences, and persisted settings across different embedded backend origins.
- `node scripts/verify-audio-devices.mjs`: real Intel microphone and Realtek speaker/headphone names/IDs are available after fixing Chromium-origin normalization and speaker-selection permission. A brief real default microphone capture ended cleanly; silent non-default sink selection was accepted. No audio was recorded, transmitted or played. Physical endpoint routing and USB plug/unplug still require manual testing.
- `npm audit`: zero known vulnerabilities in the installed lockfile dependency graph.
- Final portable v0.3.0: exact payload hashes, bundled native helper, no-PATH launch, independent accounts, restart persistence and isolated v0.2.0 upgrade pass. All nine native desktop checks also pass against the packaged executable itself. See `PACKAGING.md`.

A final native-window sample encoded and received 1424 × 900 at 60 fps locally. This is a short controlled sample, not sustained 4K or game streaming verification. Source-picker cancellation, minimize/tray and actual Windows shortcuts were tested in isolated app profiles; startup registration is tested with API doubles, not by changing the user's real logon configuration. Tray menu handlers were invoked programmatically rather than by physically clicking the taskbar icon.

See `DESKTOP-GAMING.md` for manual instructions and `PERFORMANCE-MEASUREMENTS.md` for bounded baseline/current CPU, memory, RTP, jitter and localhost latency measurements. There is no demonstrated CPU/RAM reduction versus v0.2, and no Valorant, anti-cheat, game frame-time, WAN congestion or hardware acoustic claim. Old executable folders and the real user profile remain untouched.

## Version 0.2 communication update

The v0.2 update passed 27 unit/integration tests and eight browser/desktop end-to-end cases, plus the independent three-client desktop check. Coverage includes public invitation preview through registration/redemption, normalized friend requests and offline visibility, acceptance/decline/blocks, actual speaking state, microphone input metering and 30% processed test playback, resource release while voice stays active, remote soundboard RTP audio energy with the microphone silenced, actual fullscreen entry/exit in Chrome and Electron, capture termination, and continued voice after stream stop. Backend tests additionally deny blocked DM edits/title changes while preserving history and author deletion.

The update retained native-source capture and lower-resolution/FPS tests. A short real-window sample measured 1424 × 900 encoded/received at 57 fps with a 60 fps target. This is a local sample, not a sustained benchmark. Microphones in automated tests were synthetic; physical audio quality, two physical LAN computers and Internet/TURN paths remain unverified.

See `COMMUNICATION-REVIEW.md` for the implementation/evidence ledger and `MULTI-CLIENT.md` for exact manual steps. The original v0.1 record below is retained as historical evidence.

## Original v0.1 results

| Check | Result |
| --- | --- |
| `npm run build` | Pass: strict TypeScript, Vite production bundle and compiled backend |
| `npm test` | 14 pass: five backend integration cases, five source-quality calculations, four media lifecycle cases |
| `npm run test:e2e` | Five pass: two-user chat/social/files; WebRTC voice/video; responsive settings; actual Electron window capture; repeated joins/source resizing/share-stop cleanup |
| `npm audit` | Zero known vulnerabilities reported for the installed dependency graph |
| Portable executable | Launch, health, account creation, authenticated UI, restart and persistent login pass with system `PATH` removed; see `PACKAGING.md` |

The two-user flow verified invitations, live message delivery, reply relationships, reaction updates, edits visible to the other client, attachment bytes, reload/history restoration, friend acceptance and private DMs. Backend tests exercise access denial, channel membership, author rights, private files, cross-conversation replies, soundboard authorization/events, group access after leaving, forced voice revocation and the exact eight-connection room limit.

Media lifecycle tests cover asynchronous microphone/ICE cancellation, microphone/sound mixer routing, deafen, separate system-audio senders and source-bounded sender scaling. These isolated tests are supplemented by actual browser transport tests, rather than treated as proof that WebRTC packets flow.

## Measured media

These are short local samples, not sustained benchmarks or hardware/network guarantees.

| Source and setting | Observed |
| --- | --- |
| Actual Haven desktop window, native target at 60 fps | Captured-frame native dimensions, encoded dimensions and received video dimensions matched **1424 × 900**. An outgoing sample after warm-up measured **59 fps**, approximately **1.13 Mbps**, with encoder quality-limitation reason `none`. An earlier startup sample measured 21 fps. |
| Synthetic moving 1280 × 720 canvas, native | Actual WebRTC transport delivered a 1280 × 720 video to the independent viewer while voice packets continued. Only this test replaces `getDisplayMedia`; production capture remains native. |
| Same canvas, 480p / 30 fps target | Sender sample **853 × 480**, **30 fps**, approximately **0.376 Mbps**. Viewer height changed to 480. |
| Same canvas, 480p / 15 fps target | Rolling sender sample **853 × 480**, **16 fps** during the transition, approximately **0.240 Mbps**. A requested FPS ceiling and a short rolling statistic need not be numerically identical. |
| Repeated lifecycle regression | Four join/share/stop cycles, source shrink **1280 × 720 → 640 × 360**, source growth to **1920 × 1080**, matching received dimensions, and removal of stopped remote video without ending voice all passed. |

The real desktop test selected **Haven's own window** in the application's source picker. A moving test canvas was added inside that window to create actual changing pixels. The capture API, picker, encoder, network transmission and viewer decode were real. No unrelated window or entire user desktop was selected. Microphone input in automated tests came from Chromium's synthetic test device.

The browser may temporarily report display-sized track settings before window frames arrive. Intrinsic captured-video dimensions correct that initial metadata once available. Tests explicitly wait for native source metadata to match the received real-window dimensions. Sender downscaling never drops below one; source resize does not trigger enlargement.

Packet-loss/jitter fields use the appropriate inbound or remote-inbound report. Missing measurements are represented as `null` / “Unavailable”, not asserted as zero loss. A first bitrate sample has no previous byte/time delta; later samples provide measured throughput.

## Resolved runtime issues

- Initial simultaneous offers could cause Chrome's polite peer to roll back without gathering ICE candidates. A controlled browser trace showed zero local candidates/bytes on that peer. Existing room members now initiate first offers; established connections retain perfect negotiation, bounded early-signal buffering and serialized signaling.
- Capture-track settings can remain stale after resizing. Actual captured video-frame dimensions supplement track settings and drive dynamic quality options.
- Remote screen removal can mute a receiver track without firing `ended`. Sharing state and receiver lifecycle now remove the display while preserving the voice session and allowing a subsequent share.
- Conversation selection now survives reload, and edits/reactions use a distinct update event so they do not generate false new-message unread notifications.

## Not verified / not implemented

Physical microphone/speaker quality, noise suppression with real room acoustics, hot device removal on actual hardware, Windows loopback sound quality, TURN-only NAT paths, public multi-machine internet operation, long-term reconnect behavior, sustained 4K/60 encoding, CPU/GPU utilization, hardware encoder selection, and load/security testing beyond the included cases remain unverified.

The application is a working small-community implementation, not full Discord feature parity. It uses SQLite in one server process and a voice mesh limited to eight connections. It has owner/admin/member permissions, rather than arbitrary custom role matrices or per-channel overrides. An SFU, managed TURN/TLS deployment, password recovery/MFA, signed installer/updater and advanced moderation remain future work. See `README.md` for the supported deployment model.

Discord itself was investigated statically with REA; its active streaming performance was not measured. The independent application's runtime evidence must not be attributed to Discord.
