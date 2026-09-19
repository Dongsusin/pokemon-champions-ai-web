# Boss trailer motion assets

The three PNG files are local, unmodified copies of the static front sprites
used by the game through `src/data/trainingData.js`. Their original Pokémon
Showdown URLs and SHA-256 digests are recorded in `manifest.json`.

- Mewtwo: `https://play.pokemonshowdown.com/sprites/gen5/mewtwo.png`
- Ho-Oh: `https://play.pokemonshowdown.com/sprites/gen5/hooh.png`
- Lugia: `https://play.pokemonshowdown.com/sprites/gen5/lugia.png`

The motion scenes also use the existing local brand emblem at
`public/assets/brand/champions-arena-emblem.png` and boss environments from
`public/assets/boss-backgrounds/`: `mewtwo-round-3.webp`, `hooh-round-1.webp`,
and `lugia-round-1.webp`. These are the same environments used by the game.

All assets load locally while rendering. Movement is computed from the
explicit scene time, including particles, with no random or live animation.
Underlying Pokémon artwork ownership and attribution are unchanged.
