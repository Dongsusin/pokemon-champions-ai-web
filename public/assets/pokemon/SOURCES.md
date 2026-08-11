# Pokémon Image Sources

- `egg.png`: Pokémon Emerald Generation III egg sprite from Bulbagarden Archives.
  - https://bulbapedia.bulbagarden.net/wiki/File:Spr_3e_Egg.png
- 전투 이미지는 Pokémon Showdown의 `gen5ani` 앞·뒤·이로치 GIF를 우선 사용합니다. 6세대 이후 이미지는 Smogon Sprite Project가 제작한 Black/White풍 팬메이드 스프라이트이며 프로젝트 또는 제작자 표기를 조건으로 사용할 수 있습니다.
  - https://play.pokemonshowdown.com/sprites/
  - https://www.smogon.com/forums/threads/smogon-sprite-project.3647722/
- 애니메이션이 아직 없는 포켓몬은 같은 저장소의 `gen5`, `gen5-back`, `gen5-shiny`, `gen5-back-shiny` 정적 도트로 대체합니다. 전국도감 1,025종과 특수 폼을 합친 1,351개 프로필의 앞·뒤·이로치 폴백을 모두 검사한 매핑은 `src/data/generatedGen5SpriteManifest.json`에 저장합니다.
  - 다시 생성: `npm run generate:sprite-manifest`
- 박스와 도감은 PokéAPI Sprites의 8세대 인게임 박스 아이콘을 사용하며, 아이콘이 없는 후세대 포켓몬은 검증된 BW풍 정적 도트로 자동 대체합니다.
  - https://github.com/PokeAPI/sprites
- 전국도감 전체 항목은 PokéAPI의 한국어 이름, 타입, 종족값, 특성, 진화 계통과 폼 데이터를 사용해 `src/data/generatedPokemonData.json`으로 생성합니다.
  - https://pokeapi.co/
  - 다시 생성: `npm run generate:pokemon-data`
- Showdown 파일명과 연결되지 않는 일부 최신 특수 폼은 PokéAPI Sprites의 5세대풍 기본 도트를 사용합니다. 생성 스크립트가 이 폼들의 앞·뒤·이로치 파일까지 확인하며, 애니메이션 로딩 전에는 정적 도트를 먼저 표시합니다.
  - https://github.com/PokeAPI/sprites

Pokémon and related sprites are trademarks and copyrighted works of their respective owners. These local copies are used for a non-commercial prototype.
