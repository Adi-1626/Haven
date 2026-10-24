# Haven 0.4.1 — production UI cleanup

## Removed development UI

| Discovered element | Cleanup and reason |
| --- | --- |
| Sidebar “Test with another account” and its modal | Removed the entry, backend URL field/copy action, browser-client action, isolated-client action and multi-account testing instructions. These exist to support QA, not ordinary use. |
| Settings → “connection & testing” | Removed the tab, duplicate test-client launcher and backend-switching instructions. |
| Sign-in “Connect to a Haven host” | Removed the host selector, backend/invitation URL entry and navigation flow. Kept the independent “Join a community” invitation entry. |
| Sign-in current-host address and local account/database testing banner | Removed infrastructure details. Local username authentication remains unchanged. |
| Foreign-invitation host-switch actions | Removed both opening another host and switching the desktop backend from the invitation UI. Invitations for this frontend/API still redeem normally; incompatible links produce an actionable error. |
| Raw screen-sharing statistics dump | Removed the “Detailed samples” JSON view and socket identifiers. Retained useful displayed video quality measurements. Existing tests read those displayed measurements rather than requiring a debug dump in the product. |
| Electron “Independent test client” window title | Normalized the initial title to Haven. Isolated profiles and the automation APIs remain available. |
| Electron default development menu | Suppressed outside explicit `--dev` / `NODE_ENV=development` launches. The product tray menu remains intact. |
| Related technical/development copy | Removed backend terminology from friend requests, authentication and tray descriptions. Kept actionable connection errors in ordinary language. |
| Dead UI implementation | Deleted `desktop-tools.tsx`, the unused Google OAuth handler, unused imports and 17 obsolete selectors, plus raw-statistics styling. The existing invitation entry keeps its layout under a descriptive class name. |

No separate visible Local/Hosted mode toggle, “Supabase Mumbai” label or backend
region selector was present in the inspected frontend/Electron UI.

## Preserved product features and configuration

- Wi-Fi connection-quality icon and its hover/focus tooltip, without changes to
  the diagnostics component or polling implementation.
- RNNoise/native noise suppression, microphone testing, input/output devices,
  Gaming Mode, push-to-talk, global shortcuts, tray and startup controls.
- Voice, screen/source selection, sharing resolution/FPS/bitrate controls and
  useful displayed quality measurements; reconnection/error indicators.
- Profiles, friends, communities, channels, messaging, invitations, moderation,
  server settings, emoji, attachments and soundboard.
- Supabase registration, mandatory email verification, login, recovery, password
  update and logout. The auth implementation and backend/security contracts are
  unchanged by this cleanup.
- Local SQLite accounts/backend startup and all existing development commands.
  `npm run dev`, `npm run desktop`, `npm run dev:hosted` and
  `npm run desktop:hosted` were not redefined.
- Existing desktop `HAVEN_SERVER`, `--server`, profile and saved-connection startup
  resolution; QA-only `getConnection`, `openTestClient`, `openBrowserClient` and
  `connectServer` IPC contracts. They have no launcher in the ordinary UI.
- Existing production environment configuration already specifies
  `https://haven-backend.getvoroa.com` and
  `https://tswmpzeckmquvrlzvtsy.supabase.co`. No environment file, credential,
  database configuration, hosting setting or deployment was changed.

## Exact files changed for this cleanup

Application:

- `apps/desktop/electron/main.cjs`
- `apps/web/src/App.tsx`
- `apps/web/src/Friends.tsx`
- `apps/web/src/Invitations.tsx`
- `apps/web/src/StreamStatistics.tsx`
- `apps/web/src/desktop-settings.tsx`
- `apps/web/src/desktop-tools.tsx` (deleted)
- `apps/web/src/invite-links.ts`
- `apps/web/src/styles.css` (only obsolete rules and invitation-class rename)

Verification:

- `e2e/app.spec.ts`
- `e2e/auth.spec.ts`
- `e2e/communication.spec.ts`
- `e2e/desktop.spec.ts`
- `e2e/hosted-serve.ts`
- `e2e/hosted.config.ts`
- `e2e/hosted-ui.spec.ts` (new)
- `e2e/production-ui-assertions.ts` (new)
- `e2e/production-ui.spec.ts` (new)
- `e2e/stream-statistics.ts` (new)
- `playwright.config.ts`
- `scripts/test-e2e.mjs`
- `scripts/verify-local-mode-regressions.mjs`
- `scripts/desktop-lifecycle.test.cjs`
- `docs/PRODUCTION-UI-CLEANUP.md` (this report)

Other pre-existing changes in the working tree belong to the earlier hosted audit
or the parallel design work and were preserved. No Stitch files or `docs/DESIGN.md`
were edited. No QA suite, script or fixture was deleted.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 116 passed: 23 backend, 85 web, 8 desktop unit cases |
| `npm run check` | All workspace TypeScript checks passed |
| `npm run build` | Shared package, backend and production web build passed |
| Full browser/Electron E2E coverage, isolated per suite | 35 cases passed, including all existing suites and the new cleanup/hosted UI cases |
| `npm run test:desktop-clients` | Passed: independent sessions, native fullscreen, permissions, connection validation, lifecycle and retained IPC utilities |
| `node scripts/verify-local-mode-regressions.mjs` | Passed: four isolated clients, six synchronized Gaming Mode toggles and unauthorized-write rejection |
| UI mechanical detector | No findings |
| Visual inspection | Desktop hosted registration, mobile local registration, profile settings and audio settings checked from rendered screenshots |

The 35 E2E cases comprise app (3), local auth (2), communication (3), community
(3), custom emoji (1), desktop media (3), desktop preferences (1), native desktop
capture (1), message races (6), background/media (3), media/debug fixture (1),
production UI (1), hosted regression (4), and hosted UI/Electron startup (3).
App and auth suites passed in the initial isolated run; after updating one
obsolete invitation-copy assertion, all remaining suites passed in isolation.
The statistics helper and Electron lifecycle mock were also updated to match the
removed dump and native menu behavior, without deleting their media/security
assertions.

Hosted auth tests use intercepted Supabase responses and disposable local
accounts; they do not send verification or recovery emails or change real
Supabase users. Configured hosted Electron is tested with separate disposable
frontend/API origins and an environment-supplied address, with no locally spawned
backend. The production bundle is checked again with the hosted integration
suite after the final production build.

## Remaining development facilities

No identified testing/host-selection control remains in the ordinary application
UI. Native development menus remain available only for explicit development
launches. The retained desktop IPC/CLI utilities are automation/configuration
facilities, not user-facing selectors. Physical audio, real email delivery and
internet/TURN behavior are outside this UI cleanup's verification.

No commit, push, deployment or infrastructure change was performed.
