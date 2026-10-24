# Repository layout

| Path | Contents | In git | Ships in the Windows app |
| --- | --- | --- | --- |
| `apps/web` | Authenticated web client (Vite). Build: `apps/web/dist` | yes | `dist/` only |
| `apps/desktop` | Electron main/preload, capture picker, native hotkey helper source; `installer/` holds the NSIS configuration and artwork | yes | `electron/` only |
| `apps/backend` | Express/Socket.IO server, SQLite (Local Mode) and Postgres/Supabase (Hosted Mode). Build: `apps/backend/build` | yes | `build/` without source maps, plus its production dependencies |
| `apps/landing` | Public landing website (separate Vite app) | yes | no |
| `packages/shared` | Shared types and auth helpers | yes | `dist/` |
| `supabase/` | Hosted database migrations and manual rollout/rollback SQL | yes | no |
| `e2e/` | Playwright regression suites (`npm run test:e2e`, `test:e2e:hosted`, `test:e2e:streams`) | yes | no |
| `scripts/` | Build, packaging and verification tooling (`package-*.mjs`, `verify-*.mjs`, `desktop-*.test.cjs` unit tests) | yes | no |
| `scripts/qa/` | Ad-hoc visual QA and screenshot capture tools; run from the repository root against a running dev server | yes | no |
| `docs/` | Product, packaging, verification and audit documentation | yes | no |
| `measurements/` | Background performance baselines used by `npm run measure:background` | yes | no |
| `artifacts/` | Generated evidence kept for reference: `audits/`, `screenshots/`, `reference-images/`, `web-test-artifacts/`, `legacy-root-build/` (pre-monorepo `dist/` and `build/`) | no | no |
| `output/`, `scratch/` | Working output of in-progress agent tasks; move finished evidence into `artifacts/` | no | no |
| `test-results/` | Playwright output and verification ledgers such as `package-upgrade-*.json` and `installer-verification-*.json` | no | no |
| `release/` | Portable bundles and installers produced by `npm run package:win`; packaging never overwrites an existing directory | no | — |
| `data/`, `.hosted-profile/` | Local development databases and the isolated Hosted Mode Electron profile. Never delete or commit | no | no |

`scripts/package-audit.mjs` enforces the last column for every packaged build.
