# Update trailer motion assets

The twelve PNG files in this directory are static copies of the sprite URLs
already used by the game. `manifest.json` records each character or item,
the original URL, and its SHA-256 digest. They are loaded locally so that a
network change cannot alter a rendered trailer frame.

- Pokémon sprites: the exact `spriteFrontFallback` values from
  `src/data/trainingData.js`, served by Pokémon Showdown.
- Held-item sprites: the exact `sprite` values from
  `src/data/shopData.js`, served by the PokeAPI sprites repository.
- The existing lobby banner and emblem remain at
  `public/assets/champions-lobby-bg.jpg` and
  `public/assets/brand/champions-arena-emblem.png`.
- Rank names and colors come directly from `RANKED_TIERS` in
  `src/data/rankedRules.js`. Their CSS ball emblems follow the actual game
  component in `src/ranked.css`, scaled for video.
- The starting VP title reads `INITIAL_VP_BALANCE` from the current game data.

The motion scenes contain no usage statistics, simulated player counts, or
generated Pokémon illustrations. The featured Pokémon and item arrangements
illustrate the feature and do not assert that those specimens lead a ranking.
Ownership and attribution for the underlying Pokémon artwork are unchanged.
