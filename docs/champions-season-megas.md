# Champions Regulation M-C Mega forms

Data checked on 2026-09-10. Regulation M-C started on 2026-09-09 at 02:00 UTC.
The five previously excluded forms below are now supported, including their
Mega Stones, battle transformation, abilities, and training previews. The sixth
Mega in the season announcement, Mega Salamence, was already supported.

| Form | PokeAPI ID | Types | Ability | Held item |
| --- | --- | --- | --- | --- |
| 메가앱솔Z / `absol-mega-z` | 10307 | 악·고스트 | 예리함 / Sharpness | 앱솔나이트Z / `absolite-z` |
| 메가한카리아스Z / `garchomp-mega-z` | 10309 | 드래곤 | 부유 / Levitate | 한카리아스나이트Z / `garchompite-z` |
| 메가루카리오Z / `lucario-mega-z` | 10310 | 격투·강철 | 파동의방호 / Aura Guard | 루카리오나이트Z / `lucarionite-z` |
| 메가갑주무사 / `golisopod-mega` | 10316 | 벌레·강철 | 단단한발톱 / Tough Claws | 갑주무사나이트 / `golisopite` |
| 메가드닐레이브 / `baxcalibur-mega` | 10325 | 드래곤·얼음 | 열교환 / Thermal Exchange | 드닐레이브나이트 / `baxcalibrite` |

## Sources and data decisions

- [Official M-C announcement](https://www.pokemon.com/uk/news/get-ready-for-regulation-set-m-c-in-pokemon-champions)
  establishes the season dates and added Mega forms.
- [Showdown Pokédex source](https://github.com/smogon/pokemon-showdown/blob/master/data/pokedex.ts)
  and [Serebii Champions Mega abilities](https://www.serebii.net/pokemonchampions/megaabilities.shtml)
  agree on the five ability assignments. Serebii is an unofficial game reference.
- `https://pokeapi.co/api/v2/pokemon/<slug>/` supplies IDs, weights, types, and
  base stats. At refresh time all five records had empty move lists, and
  Golisopod/Baxcalibur had empty abilities. Mega forms inherit the checked-in
  parent species learnset when upstream has no form learnset. Abilities are
  explicitly fixed in `ZA_MEGA_ABILITY_OVERRIDES`; the base Baxcalibur's hidden
  Ice Body must not become a selectable Mega ability.
- [Aura Guard data](https://pokeapi.co/api/v2/ability/aura-guard/) and
  [Showdown ability implementation](https://github.com/smogon/pokemon-showdown/blob/master/data/abilities.ts)
  specify half damage from contact moves, including special contact moves.
  Long Reach and Punching Glove's punch contact removal bypass the reduction;
  Protective Pads do not remove contact. The engine follows Showdown's current
  `breakable` flag for Mold Breaker, which upstream still marks
  `TODO check breakable`. That particular interaction is provisional.
- Korean 파동의방호 is corroborated by the
  [Korean Champions battle reference](https://poke-korea.com/champions/single/list/448/mega/M0448072)
  and [Bulbapedia language table](https://bulbapedia.bulbagarden.net/wiki/Aura_Guard_(Ability)).

The remaining excluded Mega forms stay in `ZA_MEGA_UNAVAILABLE_FORM_SLUGS` until
their Champions availability and abilities are confirmed.

## Targeted regeneration and checks

The scoped generator commands preserve the existing species and unrelated item
snapshot. Full generation remains available through the existing npm scripts.

```powershell
node scripts/generatePokemonData.mjs --forms=absol-mega-z,garchomp-mega-z,lucario-mega-z,golisopod-mega,baxcalibur-mega
node scripts/generateBattleItemData.mjs --za-mega-only
node scripts/generateGen5SpriteManifest.mjs --forms=absol-mega-z,garchomp-mega-z,lucario-mega-z,golisopod-mega,baxcalibur-mega
npm run validate:season-megas
npm run validate:pokemon-learnsets
npm run validate:battle-content
npm run build
```
