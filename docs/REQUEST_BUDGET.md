# Web request budget

Passive views use a slower cadence so leaving the game open does not keep
invoking server functions unnecessarily. Entering a view, opening chat,
reconnecting, or returning to the tab still requests a current snapshot.

| View | Previous interval | Current interval |
| --- | --- | --- |
| Main queue counter | 15 seconds | 120 seconds |
| Collapsed chat preview | 30 seconds | 300 seconds |
| Open chat | 4 seconds | 8 seconds |
| Ranked lobby without an active queue/match | 10 seconds | 120 seconds |
| Room browser without a joined room/match | 5 seconds | 120 seconds |
| Active matching, selection, battle and spectating | 1.5 seconds | 3 seconds |

Active matching, selection and battle make 20 scheduled reads/minute, down from 40.
Joined waiting rooms and existing queues viewed from the room browser retain
5 seconds; hidden active sessions retain 5 seconds.
Account lease renewal remains 30 seconds and the lease remains 90 seconds.
Saving and server deadlines are unchanged. Failed chat reads
back off, with a maximum delay of five minutes; manual refresh is immediate.

For a visible, idle main page with collapsed chat and a healthy connection, the
steady scheduled API budget is 8 -> 2.7 requests/minute (66.25% fewer, or 22.86%
below the preceding 3.5/minute release). This
excludes initial loads, focus/reconnect events, actions and saves. It measures
requests, not an equivalent reduction in billed money or accumulated usage.

Fingerprint-named built JS/CSS use a one-year immutable browser cache. HTML,
the resource worker and authenticated APIs are outside these header rules.

Only overlapping checks of the identical token share one Firebase revocation
check. Completed successes and failures are never cached; the next request
checks revocation again. Queue aggregates and chat reads skip caller labels;
public writes, status and rooms retain canonical nickname/title reads.

Git builds for this working branch are disabled to avoid building a second time
when a validated production release is deployed manually.

Run `npm run validate:request-budget`, `npm run validate:server-request-budget`
and `npm run validate:ranked-polling`.
Production verification should check the new asset cache headers, actual idle
requests, opening chat, login and persistence. Compare future usage separately;
the current billing cycle's already accumulated consumption is not reset.
