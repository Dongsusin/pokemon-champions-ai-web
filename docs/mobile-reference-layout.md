# 모바일 레퍼런스 레이아웃

모바일 가로(`html[data-mobile-layout="landscape"]`) 화면을 디자인 레퍼런스에 맞춰 재배치한다. PC(`desktop`)와 레이드(`.raid-view`)는 기존 레이아웃을 그대로 쓴다. 규칙은 `src/mobileReferenceLayout.css`에 두고 `mobileUiV2.css` 뒤에 불러온다.

## 하단 탭바

`App.jsx`의 `MOBILE_TABS`가 메인 · 박스 · 트레이닝 · 상점 · 업적을 렌더링한다. 셸이 세로 flex이므로 탭바는 `position:relative`인 flex 항목으로 두고, 화면 본문은 `flex:1 1 0`으로 남은 높이를 가져간다. 뷰포트 높이를 계산하지 않으므로 상단바 높이가 바뀌어도 어긋나지 않는다.

전투·대회 화면과 뽑기 튜토리얼에서는 `mobileTabsVisible`이 거짓이 되어 탭바를 감춘다. 데스크톱에서는 CSS로 감추므로 DOM은 항상 같다.

셸은 기본 스타일대로 `overflow:clip`을 유지한다. `hidden`이면 장식용 `.ambient`가 만든 오버플로 때문에 포커스 이동이 셸 전체를 스크롤시켜 상단바가 화면 밖으로 밀린다. 대신 긴 내용은 각 화면 본문이 스크롤한다.

## 화면별 구성

- **메인**: 팀 레일(2열×3행) · 선택 포켓몬 상세 · 모드 보드의 3열. 폭 820px 미만에서는 상세 열을 접고 기존 2열로 돌아간다. 상세 카드는 `LobbyPokemonDetail.jsx`이며 `LobbyTeamPanel`의 카드를 눌러 대상을 바꾼다.
- **박스**: `.team-box-panel`을 grid-area로 재배치해 왼쪽은 6열 로스터, 오른쪽은 선택 포켓몬 상세 열로 만든다. 헤더는 한 줄로 줄이고 검색·타입·편성 필터는 한 줄 flex로 둔다.
- **트레이닝**: 헤더와 에디터 크롬을 줄여 본문이 높이를 갖게 한다. 모바일은 `data-mobile-training-page`로 프로필/능력치/기술 한 면씩 보여주므로, 활성 열이 본문 폭을 모두 쓰도록 `grid-template-columns`를 한 트랙으로 덮는다. 능력치 6행과 기술 4칸이 스크롤 없이 들어간다.
- **사용률**: 헤더·툴바·페이지네이션을 줄이고 목록이 남은 높이를 차지하게 한다.

## 글자 크기

모바일은 1배 고정이다. 자세한 내용은 [game-text-scale.md](game-text-scale.md)를 참고한다.

## 검증

```powershell
npm run validate:mobile-touch-ui
npm run validate:game-text-scale
npm run validate:game-text-scale-ui
npm run validate:scaled-pokemon-cards-ui
npm run validate:training-move-slots-ui
npm run validate:trainer-nicknames-ui
npm run build
```

UI 스위트의 `styles` 목록에는 `mobileReferenceLayout`을 포함해야 실제로 배포되는 레이아웃을 검증한다. 모바일 구간은 페이지 분할 에디터를 쓰므로 능력치·기술 단언 전에 해당 페이지 탭을 먼저 눌러야 한다.
