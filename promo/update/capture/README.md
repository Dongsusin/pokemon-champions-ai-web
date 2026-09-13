# Update footage capture

Run from the repository root:

```powershell
node promo/update/capture/capture.mjs
node promo/update/capture/capture.mjs --normal-result
```

The first command captures all seven scenes using the current `GameApp`, `RankedBattleScreen`, battle engine, usage screen and equipment screen. The second replaces only the result scene with a complete battle won by knocking out all three opposing Pokémon.

The runner starts a separate Vite origin (port 5268, or the next free port) and a memory-only ranked server on a dynamically allocated loopback port. It does not use production authentication, Firestore, the production API, or the user's browser storage. The existing manual test servers on ports 5186/8788 are not touched. External GETs are allowed only for the game's Showdown/PokeAPI sprite assets. Audio is disabled so the editor can add the game's soundtrack without doubled music.

Owned Pokémon and legal equipment are capture fixtures. Usage counts, item percentages, RP and VP are not fixtures: the runner submits real selections and moves through two independent browser sessions and starts one actual AI battle in `GameApp`. These events produce the statistics. The normal-result pass uses attack, Protect and replacement selections through the actual UI until the battle engine declares a winner.

Outputs are under `promo/update/generated/footage/`:

- `manifest.json`: scene paths, durations, visible-image checks and result evidence.
- Each named MP4: 1920×1080 footage already trimmed to a clean start at **0 seconds**.
- `sourceVideo`/`cleanStartSeconds` in the manifest: the untrimmed session video and its marker-derived offset. Do not apply this offset again to the named MP4.
- Named PNGs and `*-end.png`: first and final frames for visual inspection.
- `actual-local-usage.json`: the unedited aggregate response produced by the recorded local matches.

The solid green sync markers are capture-only and are excluded from every named MP4. No production UI styling, labels, totals or battle outcomes are changed for filming. Lazy image assets are eagerly loaded before recording so hidden list rows do not delay readiness checks.

For a capture interrupted after real play, `--resume-stats` can restore the exact local playback checkpoint and film the usage/equipment scenes again. `--stats-only` performs the local matches again while retaining already captured ranked shots. Both options require the previous manifest; neither inserts synthetic usage samples.
