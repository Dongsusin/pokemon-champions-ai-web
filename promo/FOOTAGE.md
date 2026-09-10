# 실제 게임 영상 촬영

이 폴더의 `capture.html`은 광고 제작용으로 분리한 Vite 진입점이다. 실제 제품의 `BattleScreen`, `battleEngine`, `PokemonSprite`, `TrainerSprite`, 기술 Canvas 연출, 기믹 연출과 `battleAudio`를 그대로 사용한다. 전투 화면을 새로 그리거나 HP·데미지·변신 결과를 영상용으로 합성하지 않는다.

촬영에서는 로그인 없이 준비된 매치를 연다. 플레이어에게 게임에서 배울 수 있는 기술과 사용할 수 있는 아이템·기믹을 지정하고, 상대는 게임에 등록된 실제 AI 트레이너의 1번 팀에서 포켓몬을 선택한다. 싱글은 1대1, 더블은 2대2의 촬영용 매치이며, 전체 6마리 팀을 플레이한 기록은 아니다. 상대의 원래 기술·아이템을 유지하고 정상 AI가 행동을 선택한다. 이 구성이 기존 계정, 저장 데이터, 일반 게임 흐름을 바꾸지 않는다.

`fixtures.mjs`는 플레이어의 기술 습득 가능 여부를 검사한다. 레벨·스탯·데미지는 게임의 정규 데이터와 계산을 사용한다. 촬영 진입점에서만 `Math.random`을 `0.5`로 고정해 배틀 판정과 AI 행동을 재현한다. 브라우저 렌더링 시점에 따른 애니메이션 프레임 차이는 생길 수 있다.

## 장면 목록

| `scene` | 매치 | 플레이어의 첫 행동 | 상대 선택 출전 | 플레이어 연출 종료 예상 |
| --- | --- | --- | --- | --- |
| `mega` | 1대1 | 리자몽 → 메가리자몽X → 불대문자; 리자몽나이트X | 난천의 화강돌 | 시작 후 약 5.4초 |
| `zmove` | 1대1 | 피카츄 → 스파킹기가볼트; 전기Z + 10만볼트 | 레드의 거북왕 | 약 5.3초 |
| `dynamax` | 1대1 | 팬텀 → 거다이맥스 → 거다이환영; 섀도볼 | 성호의 보스로라 | 약 6.2초 |
| `tera` | 1대1 | 가디안 → 페어리 테라스탈 → 문포스 | 목호의 갸라도스 | 약 5.6초 |
| `battle` | 1대1 | 리자몽의 불대문자 | 성호의 무장조 | 약 2.4초 |
| `double` | 2대2 | 개굴닌자의 냉동빔, 한카리아스의 스톤샤워 | 난천의 밀로틱·화강돌 | 두 기술 타격까지 약 7.5초 |

시간은 준비 완료 후 `play()` 호출을 기준으로 한다. 플레이어 연출이 끝나면 상대 AI의 행동이 이어진다. 더블 장면은 10초를 촬영한 뒤 시작 후 2.4초부터 6초를 사용하여 대상 선택 대기를 덜고 냉동빔과 스톤샤워의 타격을 모두 담는다. `timeline.json`의 `captureDuration`과 `sourceOffset`으로 이 범위를 지정하며, 영상과 효과음에 같은 편집 오프셋을 적용한다. 정확한 편집 지점은 촬영 결과에서 확인한다.

Z기술 장면은 레드의 실제 1번 팀에 있는 거북왕과 대전한다. 고정 판정에서는 피카츄가 먼저 스파킹기가볼트를 사용해 거북왕을 쓰러뜨리고 승리한다. 피카츄는 HP 112/112를 유지한다. 상대의 체력이나 능력치를 조정하지 않은 정규 배틀 계산 결과다.

음향은 게임의 효과음 100%, 울음소리 90%, 마스터 100%로 켠다. 배틀 BGM과 메뉴 클릭음은 0%로 설정하여 광고 음악과 중첩되지 않게 한다. 실제 브라우저 입력으로 오디오를 활성화하거나 촬영용 브라우저에서 자동 재생을 허용해야 한다. 운영체제의 모션 줄이기 설정을 따른 정적인 버전을 녹화하지 않으려면 촬영 브라우저를 `reducedMotion: 'no-preference'`로 설정한다.

## 실행과 제어

저장소 루트에서 Vite를 실행한다. 사용 중인 다른 프로젝트 서버와 겹치지 않는 포트를 사용한다.

```powershell
node node_modules/vite/bin/vite.js --config promo/vite.config.mjs
```

브라우저 뷰포트는 1920×1080을 권장한다. 예시 주소:

```text
http://127.0.0.1:5184/promo/capture.html?scene=mega
http://127.0.0.1:5184/promo/capture.html?scene=double&autoplay=1
```

직접 촬영할 때는 게임의 배틀 개시, 트레이너 대사, 싸운다, 기믹, 첫 번째 기술 버튼을 차례로 사용한다. 자동 녹화 스크립트에서는 아래 API를 사용할 수 있다.

```js
await window.promo.ready;   // 배틀 핵심 에셋과 현재 이미지·글꼴 준비
await window.promo.start(); // 실제 배틀 개시·대사·기술 메뉴를 차례로 조작
await window.promo.play();  // 실제 기믹·기술·대상 버튼으로 첫 턴 실행
window.promo.status();      // 현재 phase 클래스, 메시지, 진행 여부
window.promo.events;        // performance.now() 기준 장면 클래스 변화 기록
```

새로운 장면이나 같은 장면의 재촬영은 페이지를 다시 연다. `?autoplay=1`은 에셋 준비 후 첫 턴까지 자동 진행한다. `start()`와 `play()`는 중복 호출을 막는다. `play()`는 `{ sceneId, startedAt }`을 반환하며 `startedAt`은 실제 재생 요청 시각이다.

## 검증

촬영 준비 과정에서 여섯 장면의 `createBattleTurnTimeline`을 실행해 원하는 플레이어 기믹과 첫 공격이 실제로 생성되는지 확인했다. 메가진화 화면과 더블배틀 자동 진행은 브라우저에서도 확인했고, 더블은 정상적으로 다음 턴까지 진행되었다. 촬영 페이지 콘솔에서 오류·경고가 발견되지 않았다.

저장소 루트에서 간단히 장면별 기믹과 기술 이벤트를 재확인할 수 있다.

```powershell
node --input-type=module -e "import {PROMO_SCENES,createPromoFixture} from './promo/fixtures.mjs'; import {createBattle,createBattleTurnTimeline} from './src/data/battleEngine.js'; for (const id of Object.keys(PROMO_SCENES)) { const f=createPromoFixture(id); const actions=f.playerPokemon.map((p,i)=>({type:'move',actorSlot:i,targetSlot:0,moveIndex:0,gimmick:i===0?f.scene.mechanic:null})); const r=createBattleTurnTimeline(createBattle(f),actions,()=>0.5); console.log(id,r.timeline.filter(s=>s.phase==='gimmick'||s.phase==='attack').map(s=>[s.sideId,s.phase,s.mechanicId??s.moveId])); }"
```

캐릭터·포켓몬·픽셀 에셋의 기존 출처 표기는 저장소의 크레딧 문서를 따른다. 이 문서는 새로운 게임 기능이나 공식 포켓몬 서비스와의 제휴를 주장하지 않는다.
