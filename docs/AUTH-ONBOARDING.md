# Authentication and first-time profile setup (hosted accounts)

## The flow

| Stage | Screen | Collects | Notes |
| --- | --- | --- | --- |
| 1. Authentication | Sign in / Create your account | email + password | Registration sends **credentials only** to Supabase Auth. Email verification is unchanged: no session exists until the address is verified. |
| 2. Profile setup | "Make it yours." (`ProfileOnboarding`) | profile picture (circular preview), username (live availability), display name | Shown after verified sign-in **only while the account's profile is incomplete**. |
| — | Haven | | Accounts with a completed profile go straight here. |

Entry points that all go through the same gate (`needsProfileSetup` in `App.tsx`): password sign-in, the email-verification link, token refresh, password recovery and a plain page reload.

Self-hosted **local mode** (username + password, no email) is intentionally unchanged: there the username *is* the login credential, so it cannot be split from authentication.

## How the profile is stored (what the code actually does)

* The prepared migration `20261018145338_trusted_profile_onboarding.sql` updates **`on_auth_user_created`** to create a neutral `user_<10 hex>` identity with an explicit boolean `settings.profileCompleted = false`. It ignores editable Auth metadata and retries username collisions. This migration has not been applied.
* `SupabaseAuthVerifier.ensureHavenUser` trusts only the persisted boolean. A missing Haven row is created incomplete; an existing Hosted row with missing/invalid state returns HTTP 503 for explicit migration review, without renaming or classifying that row. Auth metadata never establishes completion.
* The separately approved legacy backfill may grandfather exactly two reviewed verified Auth-linked accounts while preserving all other fields. The four unmatched Haven rows are outside its scope.
* Local-mode accounts without a flag keep their existing behavior; they do not run the Supabase verifier. The client shows onboarding when the flag is exactly `false`, and the backend independently denies incomplete application HTTP/Socket.IO access.
* New backend endpoints (all authenticated, rate limited): `GET /api/users/username-available`, `POST /api/users/me/profile` (atomic: username + display name + completion flag), `POST /api/users/me/avatar` (multipart, static PNG/JPEG/WebP/GIF up to 1 MB), `GET /api/users/:id/avatar`.
* Pictures are cropped to a centred square and re-encoded to ≤ 512×512 in the browser (so EXIF/location data is dropped), then stored in the existing **`avatars`** Storage bucket. `users.avatar` holds `/api/users/<id>/avatar?v=<version>`, served only to signed-in users.

## Schema / production changes

**Local proposals only; production application is not approved.** The trigger migration, two-account backfill and coordinated application rollout are required before enabling the new Hosted authentication version. See [HOSTED-AUTH-ROLLOUT.md](HOSTED-AUTH-ROLLOUT.md) for approval inputs, ordering, transactions, staging checks and rollback.

The prior read-only audit verified these configurations; recheck them at rollout:

1. The `avatars` bucket from migration `20261016000002` exists (private, 1 MB, PNG/JPEG/WebP/GIF). If it was never applied, avatar upload returns an error and the profile can still be completed without a picture.
2. `haven.users` has a unique, case-insensitive index on `username` (`users_username_lower_idx`, same migration). The backend relies on it to reject a username taken between the availability check and submit.

Every new account, including dashboard-created accounts, must start incomplete regardless of metadata. Existing unknown states require review rather than automatic conversion.

## Visual design

* One glass card (`.auth-card`) is shared by sign-in, registration, recovery and onboarding. Layers: lifted/saturated backdrop blur → light cool tint (~32 % alpha) → directional key light and bounce → specular sheen → neutral white rim light. In Chromium (Chrome, Edge, Electron) the bevel also **refracts** the backdrop through an SVG displacement map generated from the card's real size and corner radius (`glass-refraction.ts`); other engines get the lit glass without displacement.
* The animated WebGL orbital background is unchanged.
* **Reduced transparency**: when the OS reports `prefers-reduced-transparency: reduce` (Windows → Settings → Personalization → Colors → *Transparency effects* off), the card drops blur and refraction and becomes a dense (~94 %) surface with the same lighting. `prefers-contrast: more`, forced colors and the weak-GPU quality tiers behave the same way. **If the glass looks opaque on your machine, check that setting first.**

## What each test proves

| Suite | Command | What it is |
| --- | --- | --- |
| Mock UI test mode | `npm run dev:ui`, then `npx playwright test -c e2e/dev-ui.config.ts` | The real web app in real Chrome against a dev-server **stand-in** for Supabase Auth and the Haven API (`apps/web/src/ui-mode`). Verifies UI flow, layout, glass and contrast. **Not** real integration. |
| Hosted-mode integration | `npm run build:web`, then `npx playwright test -c e2e/hosted.config.ts hosted-ui.spec.ts` | The production web build + the **real Haven backend** (SQLite and local file storage in a disposable directory) using the backend's real Supabase token path (`SupabaseAuthVerifier` → `ensureHavenUser`). Only the GoTrue HTTP service and JWT lookup are simulated. |
| Backend | `npm test --workspace=@haven/backend` | `profile-onboarding.test.ts`: placeholder identity, legacy accounts, trigger-created rows, availability, races, persistence, avatar validation/serving. |

**Not covered by any automated test here:** a real Supabase project, real email delivery/verification links, the production Postgres adapter and Storage bucket, and real-GPU frame-rate cost of the refracting glass.
