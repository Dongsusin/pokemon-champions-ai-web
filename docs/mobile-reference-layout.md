# 모바일 레퍼런스 레이아웃

모바일 가로(`html[data-mobile-layout="landscape"]`) 화면을 디자인 레퍼런스에 맞춰 재배치한다. PC(`desktop`)와 레이드(`.raid-view`)는 기존 레이아웃을 그대로 쓴다. 규칙은 `src/mobileReferenceLayout.css`에 두고 `mobileUiV2.css` 뒤에 불러온다.

## 하단 탭바

`App.jsx`의 `MOBILE_TABS`가 메인 · 박스 · 트레이닝 · 상점 · 업적을 렌더링한다. 셸이 세로 flex이므로 탭바는 `position:relative`인 flex 항목으로 두고, 화면 본문은 `flex:1 1 0`으로 남은 높이를 가져간다. 뷰포트 높이를 계산하지 않으므로 상단바 높이가 바뀌어도 어긋나지 않는다.

전투·대회 화면과 뽑기 튜토리얼에서는 `mobileTabsVisible`이 거짓이 되어 탭바를 감춘다. 데스크톱에서는 CSS로 감추므로 DOM은 항상 같다.

셸은 기본 스타일대로 `overflow:clip`을 유지한다. `hidden`이면 장식용 `.ambient`가 만든 오버플로 때문에 포커스 이동이 셸 전체를 스크롤시켜 상단바가 화면 밖으로 밀린다. 대신 긴 내용은 각 화면 본문이 스크롤한다.

## 원칙

- **세로 스크롤을 만들지 않는다.** 가로는 넓고 세로는 짧은 프레임이므로 세로로 쌓는 대신 남는 가로 폭을 쓴다. 능력치는 2×3, 기술은 2×2, 프로필 선택은 2×2로 편다.
- **`overflow:hidden`으로 스크롤을 없애지 않는다.** 내용이 잘리면 스크롤보다 나쁘다. 들어갈 만큼만 배치하거나 페이지를 나눈다.
- **터치 타깃은 26px 이상**을 유지한다. 이 값 아래로 내려서 밀도를 얻지 않는다. 앱의 기존 기준은 `mobileTouch.css`의 40–44px이다.
- 남는 공간은 위아래·좌우로 **가운데 정렬**한다.

## 화면별 구성

- **메인**: 팀 레일(2열×3행) · 선택 포켓몬 상세 · 모드 보드의 3열. 폭 820px 미만에서는 상세 열을 접고 기존 2열로 돌아간다. 상세 카드는 `LobbyPokemonDetail.jsx`이며 `LobbyTeamPanel`의 카드를 눌러 대상을 바꾼다.
- **박스**: `.team-box-panel`을 grid-area로 재배치해 왼쪽은 6열 로스터, 오른쪽은 선택 포켓몬 상세 열로 만든다. 헤더는 한 줄로 줄이고 검색·타입·편성 필터는 한 줄 flex로 둔다. 박스는 한 화면보다 훨씬 많으므로 모바일에서는 12마리씩 **페이지로 나눈다**(`BoxScreen`의 `rosterPageSize`). 상세 열의 도구·테라 버튼은 2열로 짝지어 패널이 넘치지 않게 한다.
- **트레이닝**: 모바일은 **팀 편성 포켓몬만** 트레이닝한다. `TrainingScreen`이 `useIsCompactLayout()`으로 검색·정렬 행을 렌더링하지 않고 `teamOnly`를 강제하므로 좌측 레일은 정확히 6칸(2×3)이다. 저장/초기화 버튼은 별도 행 대신 에디터 헤딩 옆으로 올려 본문 높이를 확보하고, 능력 보정은 능력치 제목 줄을 공유한다. 세 페이지 모두 스크롤이 없다.
- **사용률**: 헤더·툴바·페이지네이션을 줄이고 목록이 남은 높이를 차지하게 한다.

`useMobileLayout.js`의 `useIsCompactLayout()`은 `mobileViewport.js`가 레이아웃을 바꿀 때 보내는 `champions:mobile-layout` 이벤트를 구독한다. 스타일이 아니라 **구성 자체가 달라져야 할 때만** 쓴다.

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

## 남은 작업

상점과 업적은 탭바에서 닿지만 아직 데스크톱 구성을 그대로 쓰므로 모바일에서 스크롤한다. 카드 한 장이 아이콘·이름·효과·가격·구매 버튼으로 75px 남짓이라 CSS로 줄이면 내용이 카드 밖으로 넘친다. 페이지당 개수 축소와 카드 자체의 재설계가 함께 필요하다.
