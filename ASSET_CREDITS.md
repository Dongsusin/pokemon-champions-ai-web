# Asset Credits

## Trainer sprites

Trainer pixel sprites are loaded without modification from the [Pokémon Showdown trainer sprite index](https://play.pokemonshowdown.com/sprites/trainers/?view=sprites).

The index contains official-style and community-created sprites. Artist attribution and use restrictions vary by file; refer to the [credited sprite list](https://play.pokemonshowdown.com/sprites/trainers/?filter=credited) before redistributing assets. Credited contributors include Beliot419, Brumirage, Fifty Shades of Rez, Flamibane, Gnomowladny, Grapo, Horo, RADU, Selena, ZacWeavile, hyo-oppa, and kyledove.

Community sprites are displayed as provided and are not edited.

## Pokémon sprites

Pokémon battle sprites and icons use the existing project pipelines backed by [Pokémon Showdown](https://play.pokemonshowdown.com/sprites/) and [PokeAPI sprites](https://github.com/PokeAPI/sprites).

## Battle move effects

The primary move graphics under `public/assets/move-fx/ebdx/` come from the [EBDX Animation Pack](https://eeveeexpo.com/resources/1230/) by Luka S.J. and NikDie. The pack is designed for [Elite Battle DX](https://luka-sj.com/essentials/resources/EBDX) and supplies the 2D particles, backgrounds, and sprite sheets used by the generated move-animation manifest.

Generation 1–5 moves use the pack's Black 2 and White 2-inspired animation definitions. Generation 6 and later moves use the pack's community-made 2D definitions where available. Moves without a dedicated definition use a type/category-matched EBDX animation so every battle move still has a visible 2D effect. These resources are a fan-made BW2-style adaptation and are not presented as an official BW2 ROM extraction.

Run `npm run generate:move-animations -- --source "<extracted EBDX_Anim_Pack>"` to rebuild `src/data/generatedMoveAnimationManifest.json` and copy the source PNG files. The generated manifest records whether each move uses a dedicated or fallback definition.

The legacy fallback images directly under `public/assets/move-fx/` are sourced without modification from the [Pokémon Showdown FX index](https://play.pokemonshowdown.com/fx/). They remain available only when an EBDX record cannot be resolved at runtime.

Pokémon Showdown client code is distributed under the [GNU Affero General Public License v3](https://github.com/smogon/pokemon-showdown-client/blob/master/LICENSE). This project does not copy its animation code; it uses an original React/CSS timeline with the credited image resources.
