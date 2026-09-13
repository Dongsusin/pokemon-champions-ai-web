# 게임 글자 크기

설정 → 게임 → **글자 크기**에서 0.5배 / 1배 / 1.5배 / 2배를 선택한다. 1배는 기존 화면의 크기다. 선택 즉시 배틀·메뉴·설정·툴팁에 적용하며, `champions-settings-v1`의 `game.textScale`로 기존 설정 저장/계정 동기화 흐름을 사용한다. 이전 저장 데이터에 값이 없거나 허용 값이 아니면 1배를 적용한다. 설정 기본값 복원 시에도 1배가 된다.

`main.jsx`가 첫 렌더 전에 저장값을 적용하고 `GameApp`은 설정 변경을 layout effect로 반영한다. 배율은 `html`의 `--game-text-scale`에 저장한다. 루트 글꼴 크기와 페이지 확대율, 포켓몬 이미지 크기는 변경하지 않는다.

`postcss.config.js`의 변환기는 `src` CSS의 명시적인 `font-size`에 배율을 곱한다. `clamp()`·미디어/컨테이너 쿼리·가상 요소와 명시적인 `font` 단축 선언도 포함한다. `em`·퍼센트·`inherit`는 이미 확대된 부모 글꼴을 상속하며, 숨김용 0은 유지한다. `rem`의 기준이 되는 `html`은 변환하지 않고 `body` 기본 글꼴만 1rem에 배율을 적용한다. 홍보 영상과 외부 패키지의 CSS는 제외한다.

새 글자 스타일은 인라인 `fontSize` 대신 CSS에 선언한다. 배율이 1.5/2일 때 필요한 레이아웃 보완은 `gameTextScale.css`에 두며, 큰 글자에서는 내용에 맞춘 줄바꿈과 패널 내부 스크롤을 허용한다.

검증:

```powershell
npm run validate:game-text-scale
npm run validate:game-text-scale-ui
npm run build
```
