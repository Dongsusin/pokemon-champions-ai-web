# Account save and idle request optimization

Vercel project usage inspected on 2026-09-19 showed Fast Origin Transfer dominated
by incoming data (15.07 GB, 98.3%; outgoing 253.18 MB, 1.7%). Account autosave
previously uploaded every storage key, including the collection, after any change.
These observations identify a large avoidable source, but do not attribute every
byte of the dashboard total to account saves.

## Changes

- Negotiate savePatch version 1 during account load; older clients and servers
  retain full-save support. Compare string-valued storage keys with the last
  confirmed snapshot. Send changed keys and explicit deletions only. Skip a save
  when nothing changed.
- Scope the baseline to account and session owner. Invalidate it during uncertain
  writes. Server lease, sequence, base revision, payload whitelist/size and retry
  checks remain authoritative. Only a rejected base revision allows a full retry
  with the same sequence; a stale or failed request cannot be acknowledged locally.
- PostgreSQL merges inside the same serializable transaction. Unchanged collection
  data is neither selected into the function nor sent back in an UPDATE, avoiding
  a transfer-cost shift to Supabase. Memory-store fallback uses the same semantics.
- Session renewal: 20 to 30 seconds (90-second lease unchanged).
- Closed chat: 15 to 30 seconds; opened chat stays at 4 seconds.
- Idle ranked lobby: 1.5 to 10 seconds; joining immediately restores active polling.
  Matchmaking and active battle stay at 1.5 seconds. Hidden-tab rules remain intact.

## Validation and limits

Account client/server, session, online player, chat, ranked polling, PostgreSQL and
production-build validations passed. Live PostgreSQL integration uses an isolated
random validation namespace and removes its fixtures afterward. Covered SQL
patch merge/readback/rollback, concurrency and authentication isolation.

A synthetic 541-Pokemon fixture with a VP-only change reduced its request JSON
from 37,874 bytes to 219 bytes (99.42%). This measures that scenario, not total
billing savings. Changing the collection still transmits that storage key.
Closed-chat periodic calls halve; renewals decrease by one third; idle ranked
polls decrease by 85%, excluding startup, interactions and reconnects.

Existing usage and charges remain. Production savings require comparable live
traffic after clients reload the updated app. No account plan, paid options,
authentication protections or boss-raid deployment settings were changed.
