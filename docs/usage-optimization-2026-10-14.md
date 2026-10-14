# Vercel usage reduction — 2026-10-14

## Scope and existing architecture

Keep Vite, four Vercel API functions, Firebase token authentication and the existing
Supabase document store. Reuse the current save-patch negotiation, account lease,
sequence/revision guards, PostgreSQL serializable transactions, bounded pool and
ranked polling scheduler. No new runtime dependency or database migration.

The prior billing snapshot attributed $25.51 of usage to this project, with
$12.17 provisioned memory and $6.72 Fast Origin Transfer. These are historical
billing totals, not the savings measured by this change.

## Changes and directly measured scenarios

- The installed @vercel/functions adapter calls waitUntil after pool release for
  idleTimeoutMillis + 100 ms. Reduce the idle connection window from 5,000 to
  500 ms. A test using the real adapter measured 5,100 -> 600 ms cleanup hold
  (88.24% less). Keep three connections, TLS verification, transaction isolation,
  active-query timeouts and pool lifecycle management. Sparse requests may need
  a new database connection; this is a measured cleanup saving, not a guarantee
  of an 88% total bill reduction.
- Negotiate savePatch version 2. For a large changed string storage key, transmit
  only its differing Unicode code-point range when smaller. Apply it in SQL,
  retaining the collection in PostgreSQL. Version 1 and full saves remain valid.
  Owner/lease, base revision, sequence, retry digest, merged size and splice bounds
  remain authoritative. A synthetic 1,000-Pokemon training edit decreased from
  12,262 bytes (previous gzip/base64 estimate) to 70 bytes for the delta body;
  transport/authentication header overhead is excluded.
- Closed chat: 30 -> 120 seconds (75% fewer scheduled reads). Open chat: 4 seconds
  after new activity, progressively up to 30 seconds when unchanged. Sending,
  expanding and reconnecting refresh immediately. Hidden/offline polling stops.
- Idle ranked lobby: 10 -> 60 seconds (83.33% fewer scheduled reads); rooms lobby:
  5 -> 15 seconds (66.67% fewer); aggregate queue counts: 15 -> 60 seconds (75%
  fewer). Active battle/queue cadence stays 1.5 seconds, hidden active sessions
  retain five-second renewals, and account heartbeat remains 30 seconds with its
  90-second lease. Reconnection resumes hidden active sessions.
- Static /assets media receives one-day browser caching; fingerprinted JS/CSS
  receives one-year immutable caching. Authentication/API responses remain private
  and no-store. Existing service-worker and resource caching remain in place.

## Verification

- npm run validate:usage-budget: 21 relevant script gates, all exit 0. Includes
  account save/auth/session, SQL adapter, online users, chat/moderation, ranked
  polling/service, rooms/spectators, guest deletion and storage migration.
- Real installed Vercel pool adapter: cleanup wait 600 ms; connection/TLS retained.
- Browser chat suite: 17/17, no browser/server errors or unexpected API calls;
  includes actual closed-chat timer/offline/reconnect behavior, two users,
  moderation and desktop/laptop/mobile at 1x/2x text scales.
- Actual adapter-generated PostgreSQL read/update statements passed five checks
  in an isolated transaction: Unicode edit, size result, source bounds, invalid
  update guard and unrelated-key preservation. The transaction rolled back.
  Executed through the existing Supabase connection as postgres; direct-role
  integration is unavailable because the exported connection secret is redacted.
- Independent review identified a hidden active queue reconnect omission. A new
  failing real-scheduler test reproduced it, the handler was fixed, and all 16
  ranked-polling scenarios passed. No additional concrete save/security defects.
- Production build exit 0. Existing large-chunk warning remains.
- Production smoke command (after release): node scripts/validateUsageBudgetProduction.mjs
  --url https://pokemon-champions-area-web.co.kr. Uses only one new anonymous
  fixture, checks the deployed save API/SQL via round-trip, then deletes its
  guest data and Firebase account. Never sends chat, queues or ranking reports.

## Limits and operations

Existing billed usage does not decrease. Server cleanup improvements apply to
new requests; client polling/splice changes require loading the new app. Real
billing savings depend on traffic, shared function concurrency, connection cost,
client refreshes and which storage keys change. Compare later equal-length
traffic windows; synthetic byte/timer reductions are not total monthly savings.

No subscription change, account migration or existing-user data cleanup.
One normal main-branch push/release avoids duplicate manual and automatic builds.
