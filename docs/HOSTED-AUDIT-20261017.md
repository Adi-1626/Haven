# Hosted browser audit — October 17, 2026

The live frontend and backend use separate origins. The existing browser tests
used same-origin cookie sessions, which concealed missing bearer tokens outside
the JSON API helper.

## Confirmed issues fixed

| Trigger | Previous behavior | Fix |
| --- | --- | --- |
| Join voice with Supabase login | ICE request omitted the token and returned 401 | Use the authenticated JSON API helper |
| Play an uploaded sound | Audio fetch omitted the token | Authenticate binary API requests |
| Download an attachment | Native navigation could not attach the token | Fetch the authorized file and download a temporary blob |
| Display custom emoji or an uploaded community icon | Native image requests omitted the token | Fetch protected images as blobs; share active requests and release blob URLs on unmount |
| Paste a frontend invitation into Join a server | Frontend origin was treated as another installation | Recognize this frontend and its configured API as the same installation |
| Generate an invitation without PUBLIC_URL | Link pointed at the API origin instead of the browser frontend | Default browser invitations to the frontend origin; retain configured public URLs and desktop host behavior |
| Sign out in hosted mode | Token was cleared before the backend logout request | Notify the backend before signing out of the provider |
| Sign out while a bootstrap refresh is pending | Old response restored the signed-in screen | Discard responses from earlier authentication revisions; clean up the auth subscription and stop voice on sign-out |

`fetchResource` sends tokens only to this installation's API origin/path.
External profile-image hosts receive no Haven credentials. Image URLs never
contain access tokens. Existing backend file membership checks stay in place.

## Repeatable coverage

- `npm test`: backend, web and desktop unit tests.
- `npm run check`: all workspace TypeScript checks.
- `npm run test:e2e:hosted`: two separate local origins, a real backend, temporary
  SQLite data and token-only browser sessions. Covers authorized downloads,
  decoded emoji/icons, sound loading, Socket.IO chat, two-party WebRTC audio,
  invitation origins, logout ordering and delayed refresh after cross-tab logout.
- `npm run test:e2e`: builds the test-mode frontend and runs each existing suite
  against a separate disposable backend, then runs the hosted integration suite.
  Test mode avoids baking the production API/Supabase settings into local tests.
- CI now runs the hosted integration suite after its build and unit checks.

The hosted fixture seeds synthetic Supabase-format client sessions backed by
disposable backend bearer sessions. It exercises the actual browser request and
signaling paths without creating production accounts or contacting Supabase.
The logout and delayed-refresh checks were observed failing before their fixes.

Final validation: 116 unit tests passed (23 backend, 85 web, 8 desktop); all
workspace type checks passed; 23 browser cases passed across app, authentication,
community, communication, custom emoji, message races, media/background behavior,
screen resizing and persisted preferences. All four hosted browser cases passed,
including actual inbound WebRTC audio bytes between the two token-only clients.
The first broad browser invocation shared one backend between suites and reached
the signup rate limit; the suites were then rerun with the runner's intended
per-suite isolation and all passed. Production rate limits were not changed.

## Limits

This audit does not certify absence of all bugs. The integration fixture does not
exercise PostgreSQL, real Supabase email delivery/password recovery, signed Storage
redirects, or media between separate internet networks requiring TURN. Production
user accounts and data were not changed by the test suite. Native Electron UI
suites are separate from the browser audit; desktop unit checks still run.
