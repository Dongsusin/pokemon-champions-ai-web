# 희귀 업적 보상 이미지 출처

## 아머드 뮤츠

- 원본 정적 스프라이트: **Othienka**
- 애니메이션: **DarkwarePX**
- 앞면 원작자 페이지: https://www.deviantart.com/darkwarepx/art/Armored-Mewtwo-943552525
- 뒷면 원작자 페이지: https://www.deviantart.com/darkwarepx/art/Armored-Mewtwo-Back-943552689
- 수록일: 2026-09-10

두 원작자 페이지는 공개 사용을 허용하며, 원본 정적 스프라이트 제작자 Othienka의 크레딧 표기와 자신의 작품이라고 주장하지 않을 것을 요청한다. DarkwarePX의 크레딧 표기는 선택 사항이지만, 이 프로젝트에서는 두 제작자를 모두 표기한다. 이는 제작자 페이지에 명시된 사용 조건이며 별도의 Creative Commons 라이선스로 표시하지 않는다.

배포용 크레딧: **Armored Mewtwo sprites: Othienka (original static sprites), DarkwarePX (animation). Used under the creators' stated public-use terms.**

원작자 페이지에서 제공하는 서명된 이미지 URL로 받은 GIF를 변환하거나 편집하지 않고 그대로 포함했다. 서명 토큰이 달라질 수 있으므로 재취득할 때 위 원작자 페이지의 이미지 URL을 사용한다.

| 로컬 파일 | 형식·크기 | 바이트 | SHA-256 |
| --- | --- | ---: | --- |
| `public/assets/pokemon/skins/armored-mewtwo-front.gif` | 애니메이션 GIF, 96×96 | 44817 | `25e3bac86b15765982dc49bd2bfd9979bc11dcd16c1b1b8d48241bb66fa93dc9` |
| `public/assets/pokemon/skins/armored-mewtwo-back.gif` | 애니메이션 GIF, 96×96 | 41149 | `259253d4b3ef7753062b84dc3f2a62ad300dc6c739384980756283b23f7d4d85` |

## 다크루기아

- 스프라이트 제작자: **Shadowgate31**
- 원작자 페이지: https://www.deviantart.com/shadowgate31/art/Shadow-Lugia-sprites-for-fangames-410361664
- 로컬 파일: `public/assets/pokemon/skins/shadow-lugia-sheet.png`
- 수록일: 2026-09-10
- 형식·크기: 투명 PNG, 270×376, 11833바이트
- SHA-256: `e2c886cc999ef2569384e5ec98798e85724c458de30e8ac31f9b66284e30cf6e`

원작자 페이지는 자유로운 사용을 명시하며, 완성된 팬게임의 크레딧 표기를 권장한다. 이 프로젝트에서는 **Shadow Lugia sprites: Shadowgate31. Used under the creator's stated free-use terms.**로 표기한다. 별도의 Creative Commons 라이선스로 표시하지 않는다.

원작자 페이지에서 제공하는 원래 크기의 PNG 시트를 변환하거나 편집하지 않고 그대로 포함했다. 앞뒤 이미지는 게임의 `SpriteImage`가 SVG `viewBox` 영역으로 표시한다. 좌표 원점은 시트 왼쪽 위이며, 다음 영역에는 인접한 스프라이트가 포함되지 않는다.

| 모습 | 시트 표시 영역 (x, y, w, h) | 실제 불투명 픽셀 경계 (x, y, w, h) |
| --- | --- | --- |
| B/W 앞면 | `172, 0, 96, 90` | `172, 2, 96, 85` |
| B/W 뒷면 | `129, 90, 96, 90` | `129, 91, 96, 88` |

각 표시 영역은 96×90이며, 정사각형 공간이 필요하면 화면 배치에서 여백을 준다. 시트에서 96×96을 직접 표시하면 다음 줄의 다른 스프라이트가 들어갈 수 있다.

## 크리스털 칠색조 / 아스트랄 레쿠쟈

현재 게임이 이미 사용하는 Pokémon Showdown의 5세대 애니메이션 GIF를 아래 경로에 원본 그대로 보관했다. 앞뒤 애니메이션을 유지하면서 게임 렌더러에서 전용 색상과 광채 필터를 적용하는 **팔레트 스킨**이다. 별도 생성 원화나 수정된 비트맵이라고 표시하지 않는다. Pokémon 원본 캐릭터·스프라이트의 권리는 Nintendo / Creatures / GAME FREAK에 있으며, 이 문서는 원본의 소유권이나 별도 라이선스를 주장하지 않는다.

| 원본 | 프로젝트 파일 |
| --- | --- |
| https://play.pokemonshowdown.com/sprites/gen5ani/hooh.gif | `public/assets/pokemon/skins/crystal-ho-oh-front.gif` |
| https://play.pokemonshowdown.com/sprites/gen5ani-back/hooh.gif | `public/assets/pokemon/skins/crystal-ho-oh-back.gif` |
| https://play.pokemonshowdown.com/sprites/gen5ani/rayquaza.gif | `public/assets/pokemon/skins/astral-rayquaza-front.gif` |
| https://play.pokemonshowdown.com/sprites/gen5ani-back/rayquaza.gif | `public/assets/pokemon/skins/astral-rayquaza-back.gif` |

필터는 `src/data/rareRewards.js`의 `filter` 필드에서 관리한다. 크리스털 칠색조는 청백색의 수정빛, 아스트랄 레쿠쟈는 짙은 청자색과 은은한 금빛 광채를 사용한다. `isShiny` 및 이로치 획득 기록과 독립된 외형이며, 능력치·타입·특성에는 영향을 주지 않는다.

## 레전드플레이트 아이콘

- 원작: **Pokémon LEGENDS 아르세우스**의 레전드플레이트 가방 아이콘
- 사용자 제공 참고 문서: https://pokemon.fandom.com/ko/wiki/%EB%A0%88%EC%A0%84%EB%93%9C%ED%94%8C%EB%A0%88%EC%9D%B4%ED%8A%B8
- 이미지 출처·파일 정보: https://archives.bulbagarden.net/wiki/File:Bag_Legend_Plate_LA_Sprite.png
- 원본 PNG: https://archives.bulbagarden.net/media/upload/0/02/Bag_Legend_Plate_LA_Sprite.png
- 자료 등록자: **ShiroKuro-chan**, Bulbagarden Archives, 2022-02-02
- 수록일: 2026-09-10
- 최종 파일: `public/assets/items/legend-plate-la.png`
- 형식·크기: 투명 PNG, 128×128, 5498바이트
- SHA-256: `f7c9f2317aec8bb56b769a4778bdff606a62fa9ecff96c0573f2ee52696275fc`

참고 문서가 가리키는 실제 아이템을 표시하도록 기존 생성 이미지를 게임 원본 스프라이트로 교체했다. 받은 PNG를 변환·재색칠·확대 가공하지 않고 그대로 포함한다. 화면에서만 아이템 영역에 맞게 표시한다. 리소스 서비스 워커가 쿼리 문자열을 무시하고 경로 기준으로 캐시를 재사용하므로 새 파일명으로 제공해 이전 생성 아이콘이 표시되지 않게 했다.

크레딧: **Legend Plate inventory sprite — Pokémon LEGENDS: Arceus; Nintendo / Creatures / GAME FREAK. Source: Bulbagarden Archives, uploaded by ShiroKuro-chan.** 출처 파일 페이지는 이 이미지를 포켓몬 게임 스프라이트의 공정 이용 자료로 분류한다. 위키 본문의 CC-BY-SA 조건이 게임 이미지에도 적용된다고 표시하지 않으며, 이 프로젝트의 생성 원화나 소유 이미지라고 주장하지 않는다.

현재 배틀에서는 아르세우스의 지닌 도구로 사용하며, 심판의뭉치가 상대의 약점을 기준으로 타입을 선택하고 아르세우스의 타입과 폼도 변경한다. 이는 표준 배틀 엔진에 맞춘 사용 방식이며, 이미지 교체로 효과·획득 조건·미획득 보상 숨김 규칙을 변경하지 않는다.
