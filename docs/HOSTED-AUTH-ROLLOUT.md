# Hosted authentication: proposed rollout and recovery

Status: LOCAL PREPARATION ONLY, 18 October 2026. No live SQL, migrations, backfills,
configuration changes, account changes or deployment were performed in this preparation stage.
Target for a later approved rollout: Mumbai project `tswmpzeckmquvrlzvtsy`.

> **Executed, 24 October 2026.** With approval, `20261018145338_trusted_profile_onboarding` and
> `20261021180000_auth_session_check` were applied to production through the Supabase MCP migration
> runner, which owns the transaction, so the files' own `BEGIN`/`COMMIT` were removed. History records them as
> `20261024094331` and `20261024094349`. The history table does not list `20261016000001`..`04` under
> their file versions; the catalog matches their end state. Production `haven.users` was empty, so W4
> (backfill) and the postflight's backfill checks did not apply. The Voroa backend (`3779d6b`) then
> reported `sessionRevocation: "enforced"`. The trigger rollback capture is kept outside Git. The sections
> below are the preparation record.

## Mode separation (owner decision, 21 October 2026)

Local Mode and Hosted Mode are separate products that share code, not data.

- **Local Mode is private testing on the owner's PC.** It uses the desktop's own loopback backend and
  SQLite under the app profile. Its databases, accounts, messages, communities and uploads are never
  migrated, uploaded, synchronized or merged into production. Local Mode must keep working on its own.
- **Hosted Mode is production.** It is real users, Supabase Auth and PostgreSQL only. No Supabase account
  is created for a local identity, and no local identity is carried over to Hosted Mode.
- **Rows in production `haven.users` without an Auth account are not migration candidates.** The audit
  found four legacy local-auth records. **Their origin is unverified.** Nothing establishes which
  machine, backend version or person created them, so do not attribute them to the owner's PC or to
  any Local Mode database. Whether each holds a local password hash is confirmed only by the
  preflight's `with_local_password` count. This rollout and any follow-up do not convert, link,
  complete, rename, reassign or delete them, and do not match them by email or metadata. The
  postflight verifies they are byte-for-byte unchanged. Any later change to them would be a separate,
  Hosted-only decision with its own approval.
- **Only genuine Hosted accounts are backfilled.** That means a verified Supabase Auth account with the
  same UUID and no Local Mode password, and each one's identity and ownership is reviewed individually.
  The candidate preflight and the backfill both refuse any row with a local password.
- **Enforced in code:** the desktop starts its Local Mode backend with `HAVEN_MODE=local` and strips every
  `SUPABASE*`, `DATABASE_URL` and `HAVEN_ENV_FILE` variable it inherited. The backend exits at startup
  if `HAVEN_MODE=local` is combined with a database URL or Supabase URL/service key, instead of
  switching databases.
- **`npm run dev:hosted` / `desktop:hosted` on the PC is production, not a test environment.**
  `.env.hosted` and `.env.voroa` point at this project's production database (`haven_app`) with the
  service-role key. Such a run is an extra production instance running unreviewed code. Do not use it
  for testing, and do not run it during or after the rollout until that code is the approved release.
  These commands now go through `scripts/hosted-target-guard.mjs`. When any database, Supabase or API
  target is not loopback, the guard starts nothing until the operator types the project ref at the
  prompt. Without a prompt, the explicit override `HAVEN_HOSTED_TARGET=<project ref>` is required. An
  override for a different project does not apply. Production deployments do not run these scripts
  (`node build/index.js`, `vite build`), so the guard does not affect them.
- **The production platform must use `HAVEN_MODE=hosted`.** The repository and generated production
  Dockerfiles now set this default explicitly. Keep it in the platform configuration for older images
  and non-Docker launches: `DATA_DIR=/data` disables the `NODE_ENV=production` inference, so an older
  image without this setting could silently fall back to SQLite when `DATABASE_URL` is missing.

## Artifacts and trust boundary

- `supabase/migrations/20261018145338_trusted_profile_onboarding.sql`: one explicit transaction;
  replaces only the existing Auth trigger function, preserving its owner/ACL/trigger identity.
  The preflight refuses unexpected ownership, trigger attachment, firing mode or event.
  New identities are neutral and completion is always boolean false. No Auth metadata or
  metadata avatar is copied. A bounded retry handles neutral-username uniqueness races.
  An existing Haven id is never overwritten. Reapplying the function definition is idempotent.
- `supabase/manual/approved-legacy-profile-backfill.sql`: deliberately outside migration discovery.
  One explicit transaction, two supplied UUIDs only, verified Auth links, exact Auth creation
  timestamps and protected row fingerprints. It only adds the missing completion key.
  An explicit false or malformed flag aborts; already-true approved accounts are a no-op.
- `supabase/manual/legacy-profile-preflight.sql`: proposed read-only candidate/fingerprint query.
  Results are review inputs, not an automatic classification rule.
- The backend accepts only a persisted boolean flag. New missing rows are created incomplete;
  existing rows with missing/invalid state return HTTP 503 and remain unchanged. This deliberately
  prevents an accidental deploy from renaming/classifying legacy or unmatched accounts.
  The validated atomic onboarding endpoint is the only normal false-to-true transition.
  General preferences updates cannot set/remove completion state. Local username/password mode
  keeps its existing behavior because it does not run the Supabase profile verifier.
- The PostgreSQL adapter uses a bundled public Supabase CA, checks its fingerprint/validity, and
  verifies the peer hostname. URL SSL options cannot replace its secure TLS object. Disabled or
  no-verify modes are rejected. Missing/invalid/expired CA fails closed; no runtime CA download.
  `HAVEN_DATABASE_CA_FILE` optionally selects a separately approved replacement PEM for rotation.
  Standalone packaging includes `certs/`; the repository Dockerfile copies it into the runtime stage.

## Audit baseline, not a fresh production observation

The prior read-only audit observed six Haven rows, all missing the completion flag; two were
linked by UUID to verified Auth accounts. Both stored usernames matched their metadata and both
profiles met format limits. Four rows had no matching Auth account and no active local sessions.
Those four rows referenced two owned servers, three memberships, four messages and three attachments.
They are legacy local-auth records of unverified origin, not Hosted accounts (see "Mode separation").
They are not migration candidates. Preserve them, and their relationships, exactly as they are. Do not
delete, merge, reassign, complete, classify or match them by email.

The prior audit also observed the required private avatar bucket and a valid case-insensitive
username index. `haven_app` had BYPASSRLS and CRUD grants; browser roles lacked Haven access.
This package changes neither that role nor any RLS/storage policy. The running backend role,
SMTP delivery and redirect allowlists still require environment verification.

## Required approvals and inputs

Approval is required separately for staging writes/tests, production migration, legacy backfill,
production deployment and any maintenance/signup pause. Preparing these files grants none of them.
The two actual approved UUIDs/timestamps/fingerprints are NOT populated here: the prior audit report
retained aggregates, not identifiers. Do not guess IDs, infer them from email or silently select all
Auth-linked accounts. An authorized reviewer must approve exactly two candidate IDs and their
snapshots before the backfill can run. The template is intentionally not directly executable without
six explicit psql input variables.

Use the correct project's reviewed administrator connection, with verified TLS and a protected
libpq service/credential store. Do not put connection passwords in shell arguments or logs.
`psql -X --set=ON_ERROR_STOP=on` must be used when an approved operator later runs the manual script.
The required inputs are `approved_id_1`, `approved_auth_created_at_1`, `approved_profile_sha256_1`
and the corresponding `_2` variables. Duplicate ids fail the temporary-table primary key.

## Preflight before any approved write

1. Confirm the project reference, Mumbai endpoint, running backend's actual database role, and
   that the deployed artifact/revision is known. A Dashboard administrator's current_user does
   not establish the backend's role. Preserve the existing role/RLS model.
2. Recheck trigger definition/ACL/owner and trigger event, unique index validity, duplicate count,
   private bucket restrictions, and browser-role access. Inspect pending migrations; do not use
   an unreviewed `db push` that also applies unrelated files.
3. Capture the current trigger definition/ACL and migration history; take a supported database
   backup and protected before-images of all six Haven rows plus relevant relationship counts.
   Do not store personal profile data or database credentials in Git or test output.
4. Review the two verified Auth-linked accounts individually; collect their exact Auth creation
   timestamps and SHA-256 fingerprints using the separate read-only preflight. The fingerprint
   includes all Haven columns except the completion key, so avatar/settings/identity drift is detected.
5. Record `local_only_rows` and `local_only_rows_sha256` from the preflight. The candidate list cannot
   include those rows: it lists only verified Auth-linked rows with no Local Mode password.
6. Confirm the CA file is present in the exact deployment artifact and the real runtime can verify
   both its chain and its configured pooler hostname. Do not disable verification to pass startup.
7. Confirm real email confirmation/recovery links, frontend/API origins, Auth redirect allowlists,
   email templates and SMTP configuration in staging. Configuration inspection is not proof of delivery.

## Rollout order and transactions (only after approval)

> Superseded in detail by **"Exact production runbook (revision of 21 October 2026, evening)"** at the
> end of this document. That section has the command-level steps, the prepared scripts and their
> rehearsal. The principles below still apply.

1. Rehearse the entire sequence on disposable staging, with a synthetic copy of six-row topology.
2. Obtain approval for a short maintenance window; drain old backend instances and block signups
   through the approved operational mechanism. Old application code can still infer completion
   from metadata while the schema is being changed; do not leave mixed versions serving traffic.
3. Capture final snapshots/fingerprints while profile writes are paused.
4. Apply only the reviewed trigger migration in its own transaction. A preflight failure, timeout,
   syntax error or permission error must roll back the entire file. Do not wrap scripts containing
   BEGIN/COMMIT in another ad-hoc transaction. Use an execution runner whose transaction behavior
   has been rehearsed; if it automatically owns the transaction, adapt the wrapper before approval.
5. Run the separately approved two-account backfill in a second transaction. Its row locks cover
   only the two approved Haven and Auth rows. Any stale fingerprint, deleted/recreated Auth id,
   unconfirmed email, unexpected completion flag or count mismatch rolls back both updates.
   Do not hold either transaction open while collecting approval or performing external calls.
6. Read-only postflight: the two approved accounts have true flags with every other field and
   relationship unchanged; the local-only rows are byte-for-byte unchanged (asserted by the postflight's
   `local_only_rows_sha256` check). Recheck trigger
   owner/ACL and that no role/policy changed. If this step fails, keep traffic paused.
7. Deploy the prepared backend and CA artifact; activate no old instances afterward. Verify the
   two existing accounts skip onboarding and a fresh staging account remains incomplete despite
   forged metadata. Resume traffic/signups only after approved smoke tests and health checks.

## Staging acceptance checklist

- Apply/reapply the migration; verify owner/ACL and trigger event remain unchanged. Execute real
  PostgreSQL trigger tests: email-only and forged-metadata registrations, same-prefix UUIDs,
  username collisions, concurrent inserts, unrelated unique violations and repeated existing id.
- Run the backfill twice: exactly two identities/settings-only changes on first run, no changes
  on second. Reject a missing input, duplicate id, wrong Auth timestamp, missing/unconfirmed Auth
  user, changed snapshot, explicit false and an Auth-linked row with a Local Mode password. Verify every
  relationship and that all local-only rows are unchanged.
- Both approved accounts retain usernames, names, avatars, sessions and community relationships;
  metadata changes/removal cannot reopen onboarding. An unreviewed missing flag yields 503 without mutation.
- New accounts cannot bypass onboarding via HTTP, bootstrap data, preferences, metadata or Socket.IO.
  Reload, sign-out/in, token refresh and password recovery all retain the correct onboarding gate.
- Race two different accounts for case variants of one username, and two requests for one account.
  Exactly one completion wins; the loser stays incomplete; a database failure leaves no partial changes.
- Upload/replace/download avatars through the actual private Storage bucket, exercise denied direct
  browser access, signed URL expiry, missing bucket, storage outage and database failure cleanup.
- Verify TLS with the configured CA and hostname. Wrong hostname, untrusted/expired CA, missing CA
  file and certificate rotation mistakes must refuse connectivity. Exercise an approved replacement CA.

## Failure scenarios and rollback

- **Trigger migration fails:** transaction rollback leaves the old function intact. Keep signups paused,
  diagnose in staging and prepare a corrected migration. Do not remove unique constraints or bypass errors.
- **Backfill fails:** its transaction changes neither account. Leave the secure new trigger in place;
  keep the new app inactive until the two legacy states have been explicitly reviewed and corrected.
- **App deployed too early:** legacy accounts see review-required 503, not a renamed identity. Restore
  the last approved completion-aware backend or finish the approved rollout while traffic stays paused.
- **TLS startup fails:** preserve verification. Fix CA packaging, configured hostname or approved trust
  anchor and redeploy the secure artifact. Never restore `rejectUnauthorized:false` as a workaround.
- **Application rollback:** use a known compatible backend that honors persisted false flags and
  enforces onboarding authorization. Keep the secure trigger, completion flags and verified TLS.
  A pre-onboarding release is not a safe rollback target.
- **Trigger recovery:** favor a reviewed forward correction. Restoring the captured older function
  reintroduces email-derived identity and metadata behavior; it requires separate approval and signups
  must remain paused until a secure trigger is restored. Never drop/recreate Auth or Haven users.
- **Backfill undo:** normally retain the additive flags. Only before any reopened traffic, under separate
  approval, compare the two rows against their before-images and restore only their prior completion
  key (missing in the audit). Abort if any other field changed. Do not restore whole rows, delete keys
  from all six users, unset completion after legitimate use, or overwrite relationships.
- **Local-only rows:** nothing to roll back, because nothing touches them. They are never restored,
  linked or converted to Hosted accounts, and no Supabase account is created for them.

## Local verification limits

Automated backend/API tests use disposable SQLite; PostgreSQL adapter tests mock the pg driver.
TLS tests instantiate the real pg client configuration without connecting to a database. SQL safety
checks inspect the prepared source; they do not execute PL/pgSQL. No SQL migration/backfill has been
executed in this preparation stage. The staging SQL/real Storage/email acceptance checks above remain
required after approval; passing local unit tests does not certify those infrastructure behaviors.

Local results on 18 October 2026:

| Check | Result |
| --- | --- |
| Backend tests, including auth, driver errors, TLS and static SQL scope safeguards | 46 passed |
| Web tests | 103 passed |
| Hosted auth browser/Electron tests | 8 passed |
| Local auth browser tests | 2 passed |
| Workspace TypeScript check | Passed |
| Production workspace build and web test build | Passed; existing bundle-size warning |
| Standalone backend package | Passed; packaged CA fingerprint and Docker COPY checked |

An earlier workspace check caught a syntax error during parallel UI edits; the subsequent
check/build passed. No UI source changes were made for this preparation task.

## Update, 21 October 2026: Phase 1 backend fixes and local rehearsal

Still LOCAL ONLY. No production SQL, migration, backfill, deployment or configuration change was made.

### Changes that affect this rollout

- **Hosted Mode refuses local accounts.** With PostgreSQL plus Supabase configured, `POST /api/auth/register`
  and `/login` return 403, and `relay_session` cookies and local session bearer tokens are ignored on HTTP and
  Socket.IO. Any existing `haven.sessions` rows stop working. This is intended. The four local-only rows
  are legacy local-auth records of unverified origin, and Hosted Mode does not serve them. Their data
  stays unchanged and they are not queued for any migration. The preflight counts `haven.sessions` rows and rows with a
  non-empty `password`, so the numbers are known in advance.
- **Hosted socket lifetime.** Sockets enforce the access token's `exp`, are disconnected on logout (the
  ended session's sockets; see "Logout scope" below), and are rechecked with Supabase about every two minutes. A provider outage
  is not treated as a revocation. A signed-out access token is refused for its remaining lifetime on that
  backend instance. Current clients send `auth:refresh` on `TOKEN_REFRESHED`. Older clients reconnect when
  their token expires (about hourly), which interrupts an active call.
- **Migration 20261016000004 is replay-safe.** The five `ALTER POLICY *_modify` statements now run only if
  those policies exist (migration 03 drops them), and `haven_app` gets `BYPASSRLS`, matching the observed
  production role. Production already shows 04's end state, so the edit only matters for clean rebuilds.
  Before any `db push`, confirm read-only that `supabase_migrations.schema_migrations` records
  `20261016000004`. If it does not, re-applying the corrected file is idempotent against the observed
  production catalog, but review it first; on Supabase, `ALTER ROLE ... BYPASSRLS` needs the migration role
  to hold BYPASSRLS itself.

### Operator note: Auth timestamps need microsecond precision

`auth.users.created_at` has microsecond precision. Copy `auth_created_at` from the preflight exactly as psql
prints it. A dashboard export or script that converts it to a millisecond `Date` truncates it, and the
backfill then refuses with "Expected exactly two approved verified Auth-linked Hosted accounts". That failure is
safe, but it is confusing in a maintenance window.

### Local rehearsal on disposable PostgreSQL 18 (`apps/backend/src/supabase-migrations.integration.test.ts`)

The repository's actual migration files and the prepared `supabase/manual/*.sql` scripts were executed with
minimal auth/storage stubs. psql `:'var'` interpolation was emulated with libpq literal quoting.

1. The full chain 01→05 applies. It ends with no `*_modify` policies, service_role-only storage policies,
   `haven_app` LOGIN NOINHERIT BYPASSRLS, and no browser-role access. Re-applying 05 is idempotent, and a
   forged-metadata signup gets a neutral, incomplete profile.
2. The production-like topology was built with 01–04 and the legacy trigger: two verified Auth-linked rows
   and four unmatched rows with 2 servers, 3 memberships, 4 messages and 3 attachments. The current backend
   returned the 503 review response without mutating anything, which reproduces H-01.
3. Migration 05 changed no existing row. The read-only preflight listed exactly the two Auth-linked
   candidates.
4. The backfill refused each of these, with zero rows changed: a stale fingerprint, a wrong or
   ms-truncated Auth timestamp, an unmatched id, a duplicate id, and a missing variable.
5. The approved backfill added only `profileCompleted:true` to the two rows. All four unmatched rows stayed
   byte-identical, and relationship counts were unchanged. A second run was a no-op.
6. The approved accounts then bootstrapped with their original usernames. A new signup with forged metadata
   stayed in onboarding, and the server routes returned 403 for it.

Still open, and needing staging or an approved window: the real Supabase migration runner and transaction
semantics, real Auth/GoTrue session revocation, `ALTER ROLE BYPASSRLS` privileges on Supabase, Storage, email
delivery, and the production preflight values themselves.

## Independent verification, 21 October 2026 (still local only)

See `output/release-verification/REPORT.md` for the executed checks and remaining gates. The real local
PostgreSQL rehearsal passed, including the exact two-account scope, stale-input refusals, idempotence and
preservation of unmatched rows/relationships. Production rollout remains unexecuted and unapproved.

The independent review additionally fixed cached JWT expiry, replay of previously observed account tokens
after logout, reaction-toggle parity under three concurrent callers, and lost concurrent server patches.
Current sockets are disconnected at logout and tokens observed by that backend instance are denied until
expiry, including tokens superseded by a socket refresh and tokens seen only on HTTP. This denylist is
in memory. Do not interpret it as durable or cross-instance revocation, or as proof that `getUser` will
reject every JWT after provider sign-out: Supabase access JWTs can remain valid until expiry. Strict
global immediate logout requires separately validated shared/session-id enforcement. The local tests
simulate provider lookup; they do not certify real provider revocation semantics.

## Exact production runbook (revision of 21 October 2026, evening)

Still LOCAL ONLY: nothing below has been run against production. Every numbered **write** step needs
its own approval. The complete sequence, including every rollback and a re-roll forward, was rehearsed on
disposable PostgreSQL 18 by `apps/backend/src/hosted-rollout-rehearsal.integration.test.ts`, executing these
exact files.

### What changed since the previous revision

- **Durable, cross-instance logout** (closes the gap noted in "Independent verification" above):
  - New additive migration `20261021180000_auth_session_check.sql` adds `haven.auth_session_active(uuid, uuid)`.
    It is a `SECURITY DEFINER` function, executable only by `haven_app`, that reports whether a JWT's
    `session_id` still exists in `auth.sessions`. Supabase documents this as the way to detect a signed-out
    session. `haven_app` gets no auth-schema grant.
  - The backend runs that check on every provider-cache miss: at most every 30 s per token, and on each
    2-minute socket recheck.
  - At logout, the backend also signs the provider session out server-side (`admin.signOut`). The
    scope is `local` (this device) by default and `global` (every device) only on the explicit
    all-devices action. See "Logout scope".
  - Result: a logged-out token is rejected by every instance, and after restarts, within the 30 s cache window.
    The instance that handled the logout rejects it immediately.
  - Without the function, the backend logs a warning and falls back to the previous behavior, and
    `/api/ready` reports `sessionRevocation: "unavailable"`.
- **Crash fix:** an idle pooled connection terminated by a database restart, failover or pooler recycle
  (SQLSTATE 57P01) used to crash the backend through an unhandled pool `'error'` event. This was reproduced
  locally and is now handled. TCP keep-alive is on, startup retries the database 5 times with backoff,
  shutdown is bounded at 15 s, and over-limit JSON bodies return 413 instead of 500.
- **Readiness:** new unauthenticated `GET /api/ready` returns 200 only when the database answers within 3 s,
  503 otherwise and during shutdown. `/api/health` remains liveness-only.
- **New operator scripts** in `supabase/manual/`:
  - `rollout-preflight-readonly.sql`
  - `rollout-postflight-readonly.sql` (asserting)
  - `rollback-approved-legacy-profile-backfill.sql`
  - `rollback-auth-trigger-function.sql`
  - `rollback-auth-session-check.sql`

### Logout scope (revision of 21 October 2026, late evening)

- **Default: this device only.** `POST /api/auth/logout` without a body (or with `{"scope":"local"}`) ends
  only the current Supabase session. That covers every access token carrying that JWT `session_id`,
  including tokens refreshed earlier in the session, and every socket of that session (for example a
  second tab sharing it). The provider is asked for `admin.signOut(token, 'local')`, and clients call
  `supabase.auth.signOut({ scope: 'local' })`. The supabase-js default would otherwise be `global`.
- **Explicit: every device.** "Sign out of all devices" in Settings (Hosted Mode only) sends
  `{"scope":"global"}` and calls `signOut({ scope: 'global' })`. That ends every session and socket of the
  account. Any other scope value is rejected with 400.
- **Other devices keep working.** After a local-scope logout, another device's HTTP requests, socket,
  `auth:refresh` token rotation, periodic recheck and reconnect are unaffected. Each Electron client and
  origin has its own session vault, so each is its own device.
- The response includes `scope`. Older deployed clients send no body and get the device-only default.

### Connection and tooling rules

- Run every SQL step with `psql -X --set=ON_ERROR_STOP=on` over a **direct or session (port 5432)**
  admin connection with verified TLS. Never use the transaction pooler (6543) that the backend uses.
  Keep credentials in a protected libpq service file, not on the command line.
- Do **not** use `supabase db push` for this rollout. Migration 05 manages its own transaction, and an
  unreviewed push could apply unrelated files. Apply the two files with psql, then record them in
  history (step W3).
- Save every output to a timestamped file in the private operator record (not Git): `psql ... > step-<n>-<UTC>.txt`.

### Read-only steps (no approval beyond read access)

- **P1. Preflight:** `psql -X --set=ON_ERROR_STOP=on -f supabase/manual/rollout-preflight-readonly.sql`.
  Stop and re-plan if any of these hold:
  - the `migration_history` notice lacks `20261016000001`..`04`, or already contains
    `20261018145338` or `20261021180000`
  - `already_trusted_onboarding` is true
  - `function_owner` is not `postgres`
  - `can_read_auth_sessions` or `auth_sessions_shape_ok` is false (then skip W2 and accept non-durable logout)
  - `duplicate_usernames` > 0, `legacy_modify_policies` > 0, or `browser_roles_reach_haven` is true
  - profile or session counts differ from the approved plan (audit baseline: 6 users, 0 boolean,
    2 verified Auth-linked, 4 without an Auth account)

  Save the `rollback_capture_definition` value verbatim as `captured-handle_new_auth_user.sql`, and
  record `definition_md5`, the relationship counts, `with_local_password`, `live_local_sessions`,
  `local_only_rows` and `local_only_rows_sha256` (the fingerprint of the rows without an Auth account).
- **P2. Candidates:** `psql ... -f supabase/manual/legacy-profile-preflight.sql`. It lists only verified
  Auth-linked rows with no Local Mode password. A reviewer checks each listed account's identity and
  ownership as a genuine Hosted sign-up, then approves exactly two ids. Record each id with its
  `auth_created_at` **exactly as psql prints it (microseconds)** and its `profile_sha256`. If fewer than
  two genuine Hosted accounts qualify, stop and re-plan; never fill the list with a local-only row.
- **P3. Artifact and environment check:** confirm the backend artifact to deploy includes `certs/` and
  this revision, and note its SHA-256. Confirm that the platform environment sets `HAVEN_MODE=hosted`
  explicitly (see "Mode separation").

### Maintenance window (approval A1 needed to start)

- **M1.** Pause sign-ups and drain or stop every old backend instance, using the platform's approved mechanism.
  This includes any `dev:hosted` / `desktop:hosted` process on a PC, because those connect to this
  production database. No old and new versions may serve together.
- **M2.** Re-run P1 and P2 inside the window. If anything changed, stop: the approval was for the old values.

### Writes (each needs its own approval)

- **W1 (A2). Trigger migration:**
  `psql ... -f supabase/migrations/20261018145338_trusted_profile_onboarding.sql`. Applying it is
  all-or-nothing: on any error it rolls back and the old function stays.
- **W2 (A3). Session check:** `psql ... -f supabase/migrations/20261021180000_auth_session_check.sql`.
  Optional; the backend works without it, but then logout is not durable.
- **W3 (A4). Record history:**
  `supabase migration repair --status applied 20261018145338 20261021180000` (only for the ones applied).
  If P1 showed no history table, decide separately whether to create history.
- **W4 (A5). Backfill:**
  `psql ... -v approved_id_1=... -v approved_auth_created_at_1=... -v approved_profile_sha256_1=... (and _2) -f supabase/manual/approved-legacy-profile-backfill.sql`.
  Any stale or wrong input aborts with zero changes; re-running is a no-op.
- **V1. Postflight (read-only):**
  `psql ... -v approved_id_1=... -v approved_id_2=... -v expected_missing_completion=<P1 missing_completion − 2> -v expected_local_only_sha256=<P1 local_only_rows_sha256> -f supabase/manual/rollout-postflight-readonly.sql`.
  It must print `postflight: OK`, and its relationship counts must equal P1's. It fails if any local-only
  row changed. On failure, keep traffic paused.
- **W5 (A6). Deploy** the P3 artifact as a **single instance**, since voice and stream state live in one
  process. Then:
  - `GET /api/ready` must return `{"ok":true,"database":"ok","sessionRevocation":"enforced"}`
    (`"unavailable"` if W2 was skipped).
  - Smoke: both approved accounts sign in without onboarding; a test sign-up stays in onboarding; sign-out
    then reuse of the old token returns 401, while the same account on a second device stays signed in.
    "Sign out of all devices" then ends the second device too.
- **W6 (A7). Reopen sign-ups and traffic.** Optional but recommended (also approval A8): point the platform
  health check at `/api/ready` (H-02 cold-start finding).

### Rollback (each needs its own approval; newest change first; keep sign-ups paused)

| Undo | Command | Effect, rehearsed locally |
|---|---|---|
| W5 deploy | Redeploy the previous approved artifact | A pre-onboarding release is not a safe target; prefer fixing forward. |
| W4 backfill | `psql ... -v approved_id_1/_2 ... -v approved_profile_sha256_1/_2 ... -f supabase/manual/rollback-approved-legacy-profile-backfill.sql` | Refused if either row changed since approval. Otherwise both rows return byte-for-byte to the P1 state, and those accounts get 503 again. |
| W2 session check | `psql ... -f supabase/manual/rollback-auth-session-check.sql`, then `supabase migration repair --status reverted 20261021180000` | Requests keep working; logout is no longer durable. |
| W1 trigger | `psql ... -v capture_file=captured-handle_new_auth_user.sql -v expected_definition_md5=<P1 md5> -f supabase/manual/rollback-auth-trigger-function.sql`, then repair `--status reverted 20261018145338` | A wrong checksum is refused. Otherwise it restores the exact captured function, owner, ACL and trigger. This **reintroduces metadata-trusting sign-ups**, so keep sign-ups paused. |

After any rollback, the same forward steps re-apply cleanly; this was rehearsed.

### Risks to accept explicitly

1. **Local-only rows stay in the database but cannot sign in, by design.** The four rows without an Auth
   account are legacy local-auth records of unverified origin. Hosted Mode refuses local login, and
   they are not migrated. Their rows, servers, memberships, messages and attachments remain unchanged.
   The communities they own keep existing, but they have no active Hosted owner.
2. **Unverified provider behavior.** The local rehearsal used a superuser, stub `auth` and `storage` schemas,
   emulated psql variables, and a stub provider whose `getUser` ignores sessions (the worst case). Real
   Supabase permissions are unverified for: owning `SECURITY DEFINER` functions, reading `auth.sessions`,
   `admin.signOut`, and the `migration repair` command.
3. **Older clients drop calls about hourly.** Clients without `auth:refresh` reconnect at token expiry, which
   interrupts an active call.
4. **Bounded propagation and no scale-out.** Durable logout reaches other instances within the 30 s provider
   cache. Voice, stream and rate-limit state is in-process, so do not run more than one instance.
5. **Production values must be fresh.** Use the P1, P2 and M2 outputs, not the audit's snapshot.

