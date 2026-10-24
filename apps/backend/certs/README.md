# Supabase PostgreSQL trust anchor

Public CA, downloaded from Supabase's distribution over HTTPS:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Subject: Supabase Root 2021 CA. Expires 2031-04-26.
SHA-256 fingerprint: `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`.
The backend validates the bundled fingerprint and certificate validity before constructing its pool.
This contains no credentials. Both source and standalone packages include it; no runtime download occurs.

For an approved CA rotation, mount the replacement PEM and set `HAVEN_DATABASE_CA_FILE`
to its absolute path. Invalid/missing files fail closed. Never use `rejectUnauthorized:false`,
an empty identity checker, or a no-verify/disabled SSL mode to recover connectivity.
Test the replacement against the staging pooler with hostname verification before rollout.

Connection guidance: https://supabase.com/docs/guides/platform/ssl-enforcement
