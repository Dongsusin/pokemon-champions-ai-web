# Reported battle fixes and chat retirement — 2026-10-17

The repository was cloned from Dongsusin/pokemon-champions-ai-web into the Develop folder. Battle mechanics use the existing engine, summary, factory settlement, and ranked perspective mapping.

## Result handling

The engine previously defaulted to an opponent victory in AI battles, or a draw in PvP, when both teams had no remaining Pokemon. It now records the cause of the final double knockout. Ordinary move recoil and Life Orb award the attack user the win; self-sacrifice and Destiny Bond retain distinct outcomes. Mind Blown and Steel Beam cost users lose the final double knockout, including when Life Orb is held. Factory settlement consumes the actual battle summary, so a recoil victory increments wins and opens the rental exchange screen.

Rule references: [official VG recoil/Life Orb and self-sacrifice rules](https://assets.pokemon.com/assets/cms/pdf/op/tournaments/2014/Play_Pokemon_VG_Rules_and_Formats_2014.pdf), [Mind Blown direct game research](https://www.smogon.com/forums/threads/ultra-sun-ultra-moon-battle-mechanics-research-read-post-2.3620030/page-2), and [Champions Steel Beam direct game research](https://www.smogon.com/forums/threads/champions-battle-mechanics-research.3780372/page-10). Chloroblast uses the ordinary recoil outcome based on the [source move definition](https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts#L2431-L2443) and [target-faint-before-recoil order](https://github.com/smogon/pokemon-showdown/blob/master/sim/battle-actions.ts#L922-L927); its tie outcome is an inference from that implementation, without a direct game experiment in this task.

## Terrain seeds

Terrain seed activation was embedded in entry-hazard processing. It missed opening terrain and terrain generated while the holder was already active, and Magic Guard bypassed it. A shared item helper now runs on opening, entry, revival, terrain creation, and actual item acquisition. Airborne holders can activate seeds; fainted holders cannot. Consumption occurs once and respects held-item suppression. Suppression expiry alone does not create a terrain/start event.

## Chat retirement

The chat component, hook, client, CSS, server handlers and API entry point were removed. Mobile header layout now has two columns. Nickname moderation remains in its own module, and authenticated guest deletion can still erase messages left by older releases. See [GLOBAL_CHAT.md](GLOBAL_CHAT.md).

## Verification

- New focused regressions are available through npm run validate:battle-recoil-seeds and are included in the normal battle audit.
- Original-code negative controls establish that the new regression cases catch the reported failures.
- The full battle audit and factory validation run against the final engine.
- Account/network validation includes chat API rejection, working ranked requests, legacy guest cleanup, nickname moderation, and existing save/session behavior.
- The GameApp UI harness uses the current mode, persistence, reward, and intro flows on desktop and mobile. It checks real battle commands and no chat DOM/API requests. Explicit victory fixtures test controller progression separately from engine correctness.
- Existing stale fixtures were corrected: Psychic Noise has a legal alternative to forced Struggle while healing is blocked; final Explosion user loses instead of drawing; a real residual double knockout still draws.

Final results: new regressions 77/77; original-code negative control 17 passed / 60 failed (exit 1); battle/factory scripts 35/35; ranked engine 23/23; account/network gate 20/20 scripts with 237 reported checks; desktop/mobile GameApp UI 20/20 with zero browser errors and zero API requests; production build exit 0. The engine SHA-256 remained b0440f26716d5eebd3c542eda0986eb4a354ecbdd13266eb947150c1369eebd6 throughout the final regression runs. Live PostgreSQL integration was explicitly skipped without connection secrets.

Local artifacts are under scripts/.cache/reported-fixes/, scripts/.cache/usage-budget/, and scripts/.cache/battle-factory-ui/.

## Boundaries

The browser harness isolates Firebase and external APIs. Production database integration, real-account online end-to-end play, physical mobile devices and deployed-site behavior are not established by these local checks. Historical chat data was not bulk-deleted remotely. Contact-ability double knockouts are outside this change.
