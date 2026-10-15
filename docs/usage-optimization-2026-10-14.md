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
- Passive information now reads once per page entry. Idle ranked/rooms lobbies
  and aggregate queue counts schedule zero background reads. Focus and reconnect
  do not refresh passive pages. Explicit refresh/join/leave actions still work.
- Chat reads once on page entry and once when opened; its refresh button fetches
  new messages on demand. Sending uses the response directly. Closing the dialog,
  leaving it open, tab focus and reconnect schedule no reads. Drafts survive page
  navigation. Compact widget width is capped at 360 px; dialog at 460 x 420 px,
  adapting to smaller screens with readable text and 44 px controls.
- New-client account heartbeats opt out of online-player COUNT queries. The page
  badge requests an authenticated aggregate once per page and retains that
  page-entry snapshot, including a clear unknown state on failure. Server count
  coalescing/cache and old-client compatibility remain. No new database schema.
- Active battle/queue cadence stays 1.5 seconds; waiting rooms use 5 seconds,
  hidden active sessions retain five-second renewals, and account heartbeat
  remains 30 seconds with its 90-second lease. Reconnection resumes active
  sessions. Save/outbox retry traffic remains necessary and is not a display poll.
- Static /assets media receives one-day browser caching; fingerprinted JS/CSS
  receives one-year immutable caching. Authentication/API responses remain private
  and no-store. Existing service-worker and resource caching remain in place.

## Verification

- npm run validate:usage-budget: 21 relevant script gates, all exit 0. Includes
  account save/auth/session, SQL adapter, online users, chat/moderation, ranked
  polling/service, rooms/spectators, guest deletion and storage migration.
- Presence header/navigation browser suite: 15/15 on desktop/laptop, including
  page-entry snapshots, unknown/zero counts, account switches and active-battle
  exclusion. The compact mobile header hides this badge by existing design;
  mobile chat geometry is tested with the full production CSS import list.
- Real installed Vercel pool adapter: cleanup wait 600 ms; connection/TLS retained.
- Browser chat suite: 20/20, no browser/server errors or unexpected API calls;
  includes one-hour open/closed idle periods without reads, page transitions,
  manual refresh, delayed initial responses and background-tab entry, two users,
  moderation and desktop/laptop/mobile at 1x/2x text scales.
- Actual adapter-generated PostgreSQL read/update statements passed five checks
  in an isolated transaction: Unicode edit, size result, source bounds, invalid
  update guard and unrelated-key preservation. The transaction rolled back.
  Executed through the existing Supabase connection as postgres; direct-role
  integration is unavailable because the exported connection secret is redacted.
- Independent review identified a hidden active queue reconnect omission. A new
  failing real-scheduler test reproduced it, the handler was fixed, and all 16
  ranked-polling scenarios passed. No additional concrete save/security defects from that initial review.
- Page-entry regression: idle scheduler reads once and creates zero timers;
  repeated focus/reconnect events cause no passive reads. All 16 active/idle
  scheduler scenarios pass. Independent review also found a skipped page read
  behind an in-flight chat response and hidden-tab bootstrap starvation. Both
  now have failing-before/passing-after real-browser regressions. The pending
  page refresh is coalesced after the current read; initial reads work in hidden
  tabs without any periodic or focus-triggered refresh. Presence server tests include authenticated explicit
  page reads and heartbeat count opt-out; session tests retain lease ownership.
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
