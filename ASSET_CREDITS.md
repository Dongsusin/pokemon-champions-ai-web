# Asset Credits

## Battle audio

The 29 WAV files under `public/assets/audio/battle/retro/` are original project-generated effects. They include 19 distinct move-type motifs and ten effects for a ball throw, ball opening, recall, fainting, healing, stat increases/decreases, status ailments, barriers, and missed attacks. `node scripts/generateBattleSoundAssets.mjs` reproduces the same mono PCM files from deterministic chip voices and filtered noise. These samples contain no recordings from commercial Pokémon games.

Battle moves combine these original motifs with the existing local CC0 effects and original Web Audio synthesis. `src/data/moveSoundData.js` selects sounds using structured move identifiers, type, category, flags and animation variants; it includes authored recipes for common moves and an intentional type/archetype fallback for every other move. Translated names and descriptions do not select audio.

The existing music, CC0 effect packs, and Pokémon cries have their individual sources and licenses listed in [Battle Audio Credits](public/assets/audio/battle/CREDITS.md). Pokémon cries use the existing PokeAPI collection and remain the property of their respective rights holders.

## Trainer sprites

Most trainer pixel sprites are loaded without modification from the [Pokémon Showdown trainer sprite index](https://play.pokemonshowdown.com/sprites/trainers/?view=sprites).

The index contains official-style and community-created sprites. Artist attribution and use restrictions vary by file; refer to the [credited sprite list](https://play.pokemonshowdown.com/sprites/trainers/?filter=credited) before redistributing assets. Credited contributors include Beliot419, Brumirage, Fifty Shades of Rez, Flamibane, Gnomowladny, Grapo, Horo, RADU, Selena, ZacWeavile, hyo-oppa, and kyledove.

Community sprites are displayed as provided and are not edited.

The ten transparent sprites under `public/assets/trainers/generated/` are project-local, AI-generated fan adaptations created with OpenAI's built-in image generation tool for trainers that do not have a trustworthy exact match in the Showdown index: Honey, Pokémon Hunter J, Tobias, Looker, Bonnie, Paul, Cameron, Sawyer, Goh, and Chloe. They use the characters' recognizable clothing and color references while translating them into a consistent Black 2 and White 2-inspired battle-sprite format. They are not official Pokémon game assets.

Run `scripts/prepareTrainerSprite.ps1` to remove the generated chroma background and normalize a source image onto a transparent `512×512` game canvas.

## Pokémon sprites

Pokémon battle sprites and icons use the existing project pipelines backed by [Pokémon Showdown](https://play.pokemonshowdown.com/sprites/) and [PokeAPI sprites](https://github.com/PokeAPI/sprites).

Mega Absol Z, Mega Garchomp Z, Mega Lucario Z, Mega Golisopod, and Mega Baxcalibur use the exact PokeAPI front, back, and shiny pixel sprites for form IDs 10307, 10309, 10310, 10316, and 10325. Their fallback images were verified on 2026-09-10 because the Showdown Gen 5 directories do not yet contain matching sprites. These community pixel adaptations are used without modification through the existing sprite fallback pipeline.

## Mega Stone item sprites

The 39 transparent PNGs under `public/assets/items/za-mega-stones/` come from the [Serebii ItemDex](https://www.serebii.net/itemdex/). This includes Absolite Z, Garchompite Z, Lucarionite Z, Golisopite, and Baxcalibrite. Images are stored without modification; individual source paths are recorded in [Mega Stone sources](public/assets/items/za-mega-stones/SOURCES.md). Pokémon item artwork belongs to its respective rights holders.

## Battle move effects

The primary move graphics under `public/assets/move-fx/ebdx/` come from the [EBDX Animation Pack](https://eeveeexpo.com/resources/1230/) by Luka S.J. and NikDie. The pack is designed for [Elite Battle DX](https://luka-sj.com/essentials/resources/EBDX) and supplies the 2D particles, backgrounds, and sprite sheets used by the generated move-animation manifest.

Generation 1–5 moves use the pack's Black 2 and White 2-inspired animation definitions. Generation 6 and later moves use the pack's community-made 2D definitions where available. Moves without a dedicated definition use a type/category-matched EBDX animation so every battle move still has a visible 2D effect. These resources are a fan-made BW2-style adaptation and are not presented as an official BW2 ROM extraction.

Run `npm run generate:move-animations -- --source "<extracted EBDX_Anim_Pack>"` to rebuild `src/data/generatedMoveAnimationManifest.json` and copy the source PNG files. The generated manifest records whether each move uses a dedicated or fallback definition.

The legacy fallback images directly under `public/assets/move-fx/` are sourced without modification from the [Pokémon Showdown FX index](https://play.pokemonshowdown.com/fx/). They remain available only when an EBDX record cannot be resolved at runtime.

Pokémon Showdown client code is distributed under the [GNU Affero General Public License v3](https://github.com/smogon/pokemon-showdown-client/blob/master/LICENSE). This project does not copy its animation code; it uses an original React/CSS timeline with the credited image resources.

The additional move choreography and Canvas shapes are original project code. Direction, staging, and timing were informed by the [PokéRogue animation implementation](https://github.com/pagefaultgames/pokerogue/blob/main/src/data/battle-anims.ts) and its public frame configurations. Young's [Pokémon Another Red creator post](https://m.cafe.naver.com/ca-fe/web/cafes/31111679/articles/12376) informed the pixel-art and battle-background direction; no Another Red code or graphics were imported. See [move animation quality notes](docs/move-animation-quality.md) for the implementation and comparison scope.
