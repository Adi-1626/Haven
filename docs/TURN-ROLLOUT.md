# TURN relay (Turnix) rollout

Hosted Mode only. Local Mode ignores the Turnix token and keeps serving `ICE_SERVERS_JSON`.
Behavior of `GET /api/rtc` is documented in [apps/backend/API.md](../apps/backend/API.md).

## What ships

- **Backend (Voroa):** `apps/backend/src/turn.ts` mints a per-user Turnix credential
  (`POST https://turnix.io/api/v1/credentials/ice`, 12h `ttl`, reused 1h) and prepends it to the STUN list.
  On any Turnix failure the STUN list is served. No new dependencies; the Dockerfile build picks it up.
- **Frontend (Cloudflare Pages):** during a voice session the client refetches `/api/rtc` every 6h and hands
  the fresh servers to open connections. Old frontends keep working against the new backend (same response
  shape); they just do not refresh.

## Environment (Voroa)

| Variable | Required | Value |
|---|---|---|
| `TURNIX_API_TOKEN` | yes | Project token from Turnix Console → haven-voice → API Tokens. Platform secret only; never in Git, `.env*` files or chat. |
| `TURNIX_PREFERRED_REGION` | no | **Leave unset**: Turnix selects the region (any region the plan allows). |
| `TURNIX_FIXED_REGION` | no | **Leave unset.** If Turnix refuses a fixed region, every join gets STUN only. |
| `DIAGNOSTICS_SALT` | recommended | Keeps the `u_` pseudonyms sent to Turnix as `initiator_client` stable across restarts. |

## Gates before deploying

1. **Token rotated.** The token pasted in chat on 25 October 2026 must be revoked.
2. **TTL honored (hard gate).** In a shell with the token set (`$s = Read-Host -AsSecureString;
   $env:TURNIX_API_TOKEN = [Net.NetworkCredential]::new('', $s).Password`), run
   `node scripts/turnix-region-check.mjs`. The `form preferred_region` variant must say `ttl HONORED`.
   If it does not, Turnix is ignoring the form body (credentials would last 30 s): do not deploy.
   The backend also guards this at runtime (`rtc.turn_short_ttl`, no reuse), but relays would still break
   for calls longer than 30 s.
3. **Region.** No region is requested; whatever relay region Turnix returns is used unmodified. Turnix sees
   the backend's IP (Voroa), not the user's, so its GeoIP choice is relative to the backend.
4. **Optional relay probe** (consumes < 1 MB of quota; needs approval):
   `node scripts/turn-relay-probe.mjs --yes --ttl 60 --hold 300` (no region hint, like the backend).
   Expect the UDP and TCP URLs to connect as relay/relay. Expect `turns:…:443` to fail while Turnix's
   `*.turnix.io` certificate stays expired (expired 4 June 2026 on every relay host checked); those failures
   are reported but do not fail the run unless `--require-tls`.

   **Result, 25 October 2026 (home network, no region hint):** Turnix selected `eu-central`
   (`eu-central.turnix.io`, 5.75.187.137) and returned `turn:` 3478 UDP/TCP plus `turns:` 443 UDP/TCP.
   UDP 3478: relay/relay, connected in 1.9 s, ICE RTT 350 ms, data-channel median 340 ms. TCP 3478:
   relay/relay, connected in 9.6 s, ICE RTT 321 ms, median 343 ms. `turns:…:443?transport=udp`: no relay
   candidates (browsers do not support TURN over DTLS). The probe then crashed before `turns:…:443` TCP;
   it now isolates each URL in its own browser context. TURN/TLS stays unsupported until Turnix renews its
   certificate. RTTs cross the client-to-relay path four times (both peers were on the test machine).

## Deploy (each step needs approval)

1. Voroa: set `TURNIX_API_TOKEN` (plus `DIAGNOSTICS_SALT` if missing), deploy the backend from this revision.
2. Cloudflare Pages (Git builds are broken; direct upload):
   `npm run build:web`, then
   `NODE_OPTIONS=--dns-result-order=ipv4first npx wrangler pages deploy apps/web/dist --project-name haven --branch main --commit-hash <sha>`.
   Run `npm run build:web` right before uploading: `npm run test:e2e` leaves a test-mode bundle in `apps/web/dist`.

## Verify after deploy

- Voroa logs: one `rtc.turn_servers` with the relay URLs; no `rtc.turn_unavailable` (401/403 = wrong token);
  no `rtc.turn_short_ttl`. `rtc.turn_region_fallback` cannot occur while no region is configured.
- The user who previously failed every peer (`u_f75ea5859272`) joins a call: their `voice.*` diagnostics
  should show a connected pair with candidate type `relay`. Everyone else should stay `host`/`srflx`.
- Turnix Console: credentials appear under `initiator_client` pseudonyms; usage moves only for relayed calls.

## Quota

Free plan: 10 GB/month, overages unavailable; what happens at the limit is undocumented (if minting fails,
users fall back to STUN). Only relayed connections count:

- voice, 24–64 kbps: about 35–70 MB per relayed peer pair per hour;
- screen sharing, 8 Mbps default: about 3.6 GB per hour; one relayed share can exhaust the month in under 3 hours.

Check usage with `node scripts/turnix-account-check.mjs` (no relay traffic).

## Rollback

Unset `TURNIX_API_TOKEN` on Voroa and restart: `/api/rtc` serves STUN only. Credentials already issued stay
valid for up to 12h; revoke the token in the Turnix Console to stop new mints immediately.
