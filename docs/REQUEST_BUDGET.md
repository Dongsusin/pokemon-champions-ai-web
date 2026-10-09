# Web request budget

Passive views use a slower cadence so leaving the game open does not keep
invoking server functions unnecessarily. Entering a view, opening chat,
reconnecting, or returning to the tab still requests a current snapshot.

| View | Previous interval | Current interval |
| --- | --- | --- |
| Main queue counter | 15 seconds | 60 seconds |
| Collapsed chat preview | 30 seconds | 120 seconds |
| Open chat | 4 seconds | 8 seconds |
| Ranked lobby without an active queue/match | 10 seconds | 60 seconds |
| Room browser without a joined room/match | 5 seconds | 60 seconds |

Active matching, selection and battle retain their 1.5-second cadence.
Joined waiting rooms and existing queues viewed from the room browser retain
5 seconds; hidden active sessions retain 5 seconds.
Account lease renewal remains 30 seconds and the lease remains 90 seconds.
Saving, authentication and server deadlines are unchanged. Failed chat reads
back off, with a maximum delay of five minutes; manual refresh is immediate.

For a visible, idle main page with collapsed chat and a healthy connection, the
steady scheduled API budget is 8 -> 3.5 requests/minute (56.25% fewer). This
excludes initial loads, focus/reconnect events, actions and saves. It measures
requests, not an equivalent reduction in billed money or accumulated usage.

Fingerprint-named built JS/CSS use a one-year immutable browser cache. HTML,
the resource worker and authenticated APIs are outside these header rules.

Run `npm run validate:request-budget` and `npm run validate:ranked-polling`.
Production verification should check the new asset cache headers, actual idle
requests, opening chat, login and persistence. Compare future usage separately;
the current billing cycle's already accumulated consumption is not reset.
