# Haven 0.4.1 — Local Mode blocker verification

Date: 17 October 2026 (Asia/Calcutta).

**Verdict: PASS for a controlled Local Mode pilot within the tested scope.** This is a source-checkout Electron sign-off using synthetic microphones and localhost peers. It is not a physical microphone, actual game, anti-cheat, Internet/TURN, sustained performance, or packaged-distribution release sign-off. A transient native input timeout remains an inconclusive reliability finding, described below.

## Root causes and corrections

1. **Whole media payloads were rejected.** `MediaSettings` always includes `outputVolume`, but the desktop allowlist omitted it. Validation rejected the entire JSON object, including PTT and RNNoise. The write IPC was fire-and-forget, invalid writes returned silently, filesystem errors were only logged, and a debounced cache could appear saved before disk replacement. The allowlist now covers all 17 current media fields, including device identity metadata, and validates types, finite numeric bounds, suppression choices, shortcuts and share settings. Saves return an acknowledgement after atomic file replacement; rejected/failed writes preserve the last cached successful settings. No pending debounce remains at quit.

2. **Read/save errors could select open mic.** Read exceptions returned ordinary defaults with `pushToTalk: false`; failed writes were invisible to the renderer. Structured status IPC now distinguishes missing settings, read errors and secondary ownership. Invalid/corrupt media preferences select PTT and block transmission; invalid mute/deafen preferences restore muted/deafened and block transmission. Save failures immediately disable microphone and mixed outbound tracks and display a persistent alert, including inside Settings. Recovery requires a successful settings save. A small failure marker preserves the warning across restart when an older open-mic payload remains on disk. The marker is best effort if the entire filesystem is unwritable; it cannot recover unsaved preferences from unavailable storage. Browser storage failures also surface and block transmission.

3. **Named devices had origin-scoped IDs.** Restart assigns the embedded backend a different port/origin. Chromium changes non-default device IDs, so storing only the old ID left a named selection blank/unusable. Input/output labels now accompany IDs. Device enumeration resolves a missing ID only when exactly one device of the same kind has the saved label. Duplicate names are not guessed. Existing unplug/default fallback remains. Legacy origin preferences migrate when no main-profile value exists; corrupt main-profile data never silently falls back to origin defaults.

4. **Window activity was process-wide.** Desktop runtime stored one `background` flag, updated from the primary window, and broadcast it to secondary clients. A focused secondary therefore detached its video when the primary was unfocused. Every client now attaches its own activity listeners and stores its own background state keyed by webContents. Main-only tray, shortcut-recording and persistence ownership remain intact. Background video sinks still detach without stopping capture/audio/receiver tracks and reattach when their own window is foregrounded.

5. **Native capture dimensions remained stale.** The complete E2E run exposed display-sized `getSettings()` metadata (1920×1080) while actual window frames were 1424×900. The media-source stats report now supplies measured input-frame dimensions, matched to the capture track. Quality calculations update from those dimensions without retaining another background video decoder. The original exact source/receiver-size assertion is retained.

6. **E2E controls had moved/been renamed.** Tests now use exact `Settings` and scoped `Mute microphone` controls. Existing assertions and tests remain. The native verifier's historical partial settings fixture now includes every media field, retaining exact restart equality instead of permitting extra/defaulted fields.

## Changed files for this task

Production:

- `apps/desktop/electron/client-settings.cjs` — validation, acknowledged atomic saves, read/save status and safety marker.
- `apps/desktop/electron/main.cjs` — authorized status/write responses; attach activity for every window.
- `apps/desktop/electron/preload.cjs` — synchronous acknowledged settings writes and status bridge.
- `apps/desktop/electron/desktop-runtime.cjs` — per-window activity; main-only tray/recording behavior.
- `apps/web/src/desktop.d.ts` — typed bridge responses.
- `apps/web/src/media-persistence.ts` — main-profile authority, legacy migration, isolated local storage and surfaced failures.
- `apps/web/src/media-devices.ts` — unique-label device restoration across origin changes.
- `apps/web/src/media.ts` — fail-closed transmission, safe restoration, device metadata and measured capture dimensions. Prior Gaming Mode no-echo ownership guards remain.
- `apps/web/src/App.tsx` — persistent audio settings error banners. Prior message-origin/race guards remain.

Regression and QA:

- `apps/web/src/media-persistence.test.ts`
- `apps/web/src/media-devices.test.ts`
- `apps/web/src/media.test.ts`
- `scripts/desktop-client-settings.test.cjs`
- `scripts/desktop-lifecycle.test.cjs`
- `scripts/desktop-runtime.test.cjs`
- `scripts/verify-desktop-gaming.mjs` — complete fixture and failure diagnostics; assertions retained.
- `e2e/desktop-media.spec.ts` — real Electron restart, named devices, persistence failure safety, integrated minimized global PTT, bidirectional native capture and cleanup.
- `e2e/app.spec.ts`, `e2e/auth.spec.ts`, `e2e/communication.spec.ts`, `e2e/community.spec.ts`, `e2e/custom-emoji.spec.ts`, `e2e/desktop-settings.spec.ts`, `e2e/media-background.spec.ts` — current control selectors only in this task. Earlier test additions in these files are preserved.
- This verification ledger.

Other pre-existing working-tree changes, including restructuring and hosted infrastructure work, are not attributed to this task.

## Final verification

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm test` | PASS: 23 backend + 81 web + 8 desktop = 112 | `test-results/qa-blockers-unit-final.log` |
| Desktop tests after final unknown-key validation guard | PASS: 8 | `test-results/qa-blockers-desktop-unit-final.log` |
| `node --test scripts/package-windows.test.mjs` | PASS: 2 | `test-results/qa-blockers-package-tests.log` |
| `npm run check` | PASS: shared, backend, web | `test-results/qa-blockers-types-final.log` |
| `npm run build` | PASS; existing Vite large-chunk advisory remains | `test-results/qa-blockers-build-final.log` |
| `npm run test:e2e` | PASS: all 27 cases across 11 isolated specs | `test-results/qa-blockers-e2e-final.log` |
| `node scripts/verify-local-mode-regressions.mjs` | PASS: 4 clients, 6 Gaming Mode toggles, unauthorized writes denied | `test-results/qa-blockers-gaming-sync.log` |
| `npm run test:desktop-clients` | PASS: 11 checks | `test-results/qa-blockers-clients.log` |
| `npm run test:desktop-gaming` | PASS: 12 checks on two consecutive final runs | `test-results/qa-blockers-native-rerun.log`, `test-results/qa-blockers-native-repeat.log` |

Desktop checks use the installed Electron runtime against the source checkout and production web/backend build. No portable executable was rebuilt or certified.

### Concrete media observations

- A UI-selected non-default synthetic input and output, RNNoise selection, PTT state, input/output volume, sensitivity, bitrate, complete settings payload and global shortcut survive a full Electron exit/relaunch with a different backend origin. Device IDs may change; selected device identities and other preferences remain.
- Real Windows injected Control+Shift+F10 press/release gates the actual Haven microphone capture while its window is minimized behind an owned test window. All captured microphone tracks stop on disconnect. This verifies OS shortcut delivery and application gating using synthetic audio, not physical speech or a game.
- A test-owned blocked temporary settings path produces a visible error and disables microphone transmission, even when the UI subsequently requests open mic. A restart retains the failure warning and safe PTT state. Corrupt-profile startup is separately covered. No existing user profile is used.
- Main-to-secondary and secondary-to-main use the native source picker to capture only owned Haven windows with changing pixels. Tests assert attached/playing video, advancing decoded frames, detachment on genuine minimize, reattachment on restore, 480p selection, native-quality restoration and remote-video removal after stop. Captures end and peer connections close after voice disconnect.
- The final existing native-capture case measured matching source/received **1424×900**, approximately **58 fps** and **1.42 Mbps** in one short local sample. This is not sustained performance evidence.
- Original six delayed channel/DM message-race regressions pass. Browser reconnect, mute/deafen persistence, RNNoise runtime switching, hotplug simulation, mic-test resource cleanup and four repeated voice/share/resize cycles pass.
- The native verifier checks source-picker cancellation, tray callbacks and full Quit, modifier-release PTT, recording suppression/re-arm, background transport, restart preferences and main-process exception monitoring.

## Failures investigated and residual limits

- The initial native source-size assertion found the stale-metadata bug above; it was fixed, not relaxed.
- The new sharing test once attempted receiver focus before its modal source picker finished closing. It now waits for actual picker closure before asserting native foreground state. Assertions remain unchanged.
- The older native verifier initially compared a partial legacy fixture against its normalized complete payload. Its fixture was expanded and exact equality retained.
- **Inconclusive native input reliability:** one run timed out at `scripts/verify-desktop-gaming.mjs` waiting for PTT to reactivate after cancellation of shortcut recording while the key remained held, followed by key release/repress. No main-process exception was captured. Failure diagnostics were added; two consecutive subsequent runs passed all 12 checks, and integrated minimized application PTT passed in the final E2E run. The timeout's cause is not established. It remains a follow-up reliability risk and is not claimed as a fixed native helper defect.
- Physical microphone/speaker routing, acoustic RNNoise/AEC quality, actual USB hotplug, real-game/anti-cheat delivery, physical tray clicking, startup-at-logon, WAN/TURN and long-duration load remain unverified. Identically named devices require explicit selection if identity cannot be resolved uniquely.

No confirmed outstanding defect remains in the requested persistence and isolated-screen-sharing fixes under the tested conditions. Pilot participation should remain controlled and should validate hardware/PTT behavior before relying on it in an actual game. Full release readiness is not claimed.

## Boundaries

No Supabase service, migration, SMTP, authentication implementation or hosted configuration was changed. Existing auth-related unit fixtures ran as part of the requested complete test suite; no hosted service was contacted for this work. Authentication E2E edits only update a Settings button selector. No existing user data/profile was deleted. Tests create and remove only their own disposable profiles. No commit, push, deployment or package publication was performed.
