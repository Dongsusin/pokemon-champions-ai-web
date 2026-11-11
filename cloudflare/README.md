# Cloudflare account storage — production

Both games switched from Supabase to free Cloudflare Workers + D1 on 2026-10-26.
DigiRogue: https://digirouge.co.kr
Arena: https://pokemon-champions-area-web.co.kr

## Current production storage (2026-11-11)

Arena uses its dedicated Supabase Free PostgreSQL project through the existing
Vercel account and ranked services. Production uses GAME_STORAGE_PROVIDER=supabase
and VITE_GAME_STORAGE_PROVIDER=supabase. The dedicated server role is restricted
to the private champions schema with forced row level security on documents.

The last D1 export matched the verified copy byte for byte. All 27,955
documents and 18,376 save slots were reconciled. The retired D1 Worker has
DATA_READY=false and the database is write fenced. The October Supabase table
remains a private archive. Restoring the retired D1 copy would require
reconciling newer PostgreSQL writes first.

DigiRogue has its own Cloudflare account and D1 database. Arena storage
requests use PostgreSQL directly from the Vercel server.

The client skips duplicate tab-return lease renewals. PostgreSQL returns save
metadata alone when the active account session supplies the current revision
and the exact fingerprint of its local save. A stale or incomplete local save
uses the normal complete load.

## October migration architecture

- Digi Google progress is cloud-only; guests keep local saves. Firebase Auth,
  player presence and Hall remain separate. Game assets stay on Vercel.
- Digi sends verified Google account requests directly to its Worker.
- Arena retains its Vercel authentication and battle service and sends database
  operations through its private Worker. STORE_TOKEN must never enter VITE_*.
- Workers DATA_READY=true. Digi ALLOW_LOCAL=false. No paid plan was added.
- Arena saves are gzip-compressed per key; patches send only changed slots.
  Metadata reads omit save blobs, lease renewal is one atomic request, and
  mutation queries use complete primary keys rather than scanning accounts.
- Digi polls session ownership every five minutes and stops in hidden tabs.
- Arena reloads retry an occupied lease only briefly, allowing the previous
  page's keepalive release to finish. They never reuse owner IDs or take over
  another live device. Ordinary navigation adds no retry traffic. Embedded games
  also observe the parent window closing; closing releases are fenced by their
  unique owner ID, so an in-flight renewal cannot strand the destroyed page.

## Data preservation and evidence

Protected evidence: C:/Users/pdwea/Develop/artifacts/cloudflare-migration-20261026

The final source snapshot contains 301 Digi profiles / 303 sessions and 19,936
Arena documents. Complete local source roundtrips and SQLite integrity passed.
The target pre-copy was compared field-for-field using keyset pagination.
After source writes were fenced, final journal deltas were applied and read
back exactly; source manifests before and after the final copy matched.
Initial target comparison consumed 9,720 Digi + 64,022 Arena reads.

Both production builds passed. Google callback, persisted Google login, existing
Digi continue slots and Arena teams/VP were checked in Chrome. Digi production
Worker session claim and profile read returned HTTP 200. The actual Arena
Worker passed all 16 account-service cases including two-player battle logic.
Focused suites: Digi 92; Arena store/Worker 17; Arena session checks 25 on
Cloudflare, 25 on Supabase and 21 on Firestore.

## Retired source and recovery

Supabase data is retained read-only for recovery. Source write-fence triggers
remain active. Export endpoints are closed, RPC permissions revoked and change
capture triggers removed. Temporary synthetic test namespaces were deleted.

Do not switch back to Supabase without copying new Cloudflare writes back first.
Old source copies are not an up-to-date rollback target after activation.
Free quotas are hard limits, not a promise of unlimited service. No automatic
paid upgrade is configured. Long-term usage and physical cross-device/mobile
play are not established by these checks.

## Checks

Digi: node --test scripts/verify-cloudflare-account.mjs scripts/verify-cloudflare-export.mjs
Arena: node --test scripts/validateCloudflareStore.mjs scripts/validateCloudflareWorker.mjs
Arena session: node scripts/validateAccountSession.mjs --cloudflare
Arena account: node scripts/validateCloudflareAccountService.mjs
Both: git diff --check; production builds.
