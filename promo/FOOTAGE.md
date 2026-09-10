# 실제 게임 영상 촬영

이 폴더의 `capture.html`은 광고 제작용으로 분리한 Vite 진입점이다. 실제 제품의 `BattleScreen`, `battleEngine`, `PokemonSprite`, `TrainerSprite`, 기술 Canvas 연출, 기믹 연출과 `battleAudio`를 그대로 사용한다. 전투 화면을 새로 그리거나 HP·데미지·변신 결과를 영상용으로 합성하지 않는다.

132초 편집은 포켓몬을 확대하고 양 진영을 가까이 배치한 현재 웹게임 화면으로 기믹 배틀 36개와 싱글·더블 원본을 다시 촬영해 사용한다. 교대·기절·기술 이펙트도 현재 게임의 위치 계산과 연출을 그대로 따른다. 최종 촬영·렌더의 통과 여부는 `output/validation.json`에서 확인한다.

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

시간은 준비 완료 후 `play()` 호출을 기준으로 한 예상값이다. 플레이어 연출이 끝나면 상대 AI의 행동이 이어진다. 더블 장면은 **13초를 촬영한 뒤 2.4초부터 8초**, 싱글 `battle`은 10초 원본에서 6초를 사용한다. 더블에서 냉동빔과 스톤샤워의 타격 및 후속 반응을 더 길게 보여준다. `timeline.json`의 `captureDuration`과 `sourceOffset`을 영상과 효과음에 동일하게 적용하며, 최종 장면을 연결할 0.4초 여유 구간도 원본에 확보한다.

배틀 외에 `showcase.html?scene=competition`에서 실제 `CompetitionScreen`의 128강 토너먼트 대회 준비 화면을 8초 소개한다. `cinematic.html?scene=challenges`의 10초 장면은 실제 업적 데이터로 무기절 리그·토너먼트 우승과 1,025종 수집 조건을 보여준다. 이 화면은 완료한 대회나 획득한 보상을 가장하는 플레이 기록이 아니라 기능 소개다. 전체 1,025종 포켓몬, 238명 트레이너, 실제 아이템 이미지 몽타주는 유지하고, 엔딩은 `https://pokemon-champions-area-web.co.kr`로 안내한다.

## 기믹별 아홉 화면 확장

메가진화·Z기술·거다이맥스·테라스탈 소개는 각각 12초다. 대표 배틀 하나를 처음 1.2초 동안 크게 보여주고, 약 5.6초에 걸쳐 화면이 멀어지면서 서로 다른 아홉 배틀이 3×3으로 나타난다. 주변 네 칸과 모서리 네 칸을 순서대로 드러내며, 후반에는 아홉 화면을 유지한 채 카메라가 천천히 멈춘다.

각 타일은 서로 다른 실제 배틀을 독립적으로 실행해 촬영한 동영상이다. 포켓몬 이미지를 기존 배틀 위에 덧씌우거나 포켓몬 이름만 바꾼 장면이 아니다. `gimmickVariants.mjs`가 추가 32개 매치를 정의하고, `fixtures.mjs`의 `PROMO_GIMMICK_GROUPS`가 기존 대표 장면 네 개와 합쳐 총 36개를 제공한다. 각 그룹은 서로 다른 포켓몬 9종과 공격 타입 9가지를 사용한다.

| 기믹 | 등장 포켓몬 9종 | 기술·타입 구성 |
| --- | --- | --- |
| 메가진화 | 리자몽, 거북왕, 이상해꽃, 가디안, 루카리오, 전룡, 후딘, 보만다, 메타그로스 | 호환 메가스톤으로 실제 변신 후 불꽃·물·풀·페어리·격투·전기·에스퍼·드래곤·강철 기술 |
| Z기술 | 피카츄, 개굴닌자, 윈디, 로즈레이드, 에브이, 앱솔, 눈여아, 루카리오, 루가루암 | 맞는 Z크리스털과 원본 기술로 전기·물·불꽃·풀·에스퍼·악·얼음·격투·바위 Z기술 |
| 거다이맥스 | 팬텀, 리자몽, 거북왕, 이상해꽃, 피카츄, 버터플, 아머까오, 라프라스, 두랄루돈 | 게임이 지원하는 전용 폼 9종과 거다이환영·옥염·포격·편달·만뢰·고혹·풍격·선율·감쇠 |
| 테라스탈 | 가디안, 한카리아스, 리자몽, 개굴닌자, 루카리오, 망나뇽, 메타그로스, 마기라스, 팬텀 | 페어리·드래곤·불꽃·물·전기·얼음·에스퍼·악·독의 테라 타입과 해당 타입 공격 |

원본은 각 10초씩 촬영한다. `prepareGimmickClips.mjs`는 실제 1920×1080 화면의 전장 영역 `1920×792`, 시작 좌표 `(0, 68)`을 잘라 명령 패널을 제외한다. 대표 클립은 1920×792, 주변 클립은 960×396이며, 포켓몬·변신·기술·HP 변화는 녹화 그대로 유지한다. `gimmickWall.html`은 실제 동영상과 큰 기믹 제목·핵심 문구를 배치한다. 작은 타일 자막·영문 분류·수치 설명·상하단 제작 메모는 표시하지 않는다. 포켓몬·실제 기술명·타입은 manifest, 영상의 접근성 설명, `status()`에 남기며 Z기술·거다이맥스 기술명은 게임의 변환 결과를 사용한다.

아홉 타일의 효과음을 동시에 겹치지 않도록 화면 모음의 동영상은 무음으로 재생한다. 최종 편집에서는 처음 크게 보여주는 대표 배틀의 실제 효과음·울음소리만 해당 기믹 구간에 사용하고, 현재 웹게임의 배틀 BGM을 별도로 믹싱한다. 배틀 원본과 효과음의 시작점은 녹화 시 동기화 마커로 맞춘다.

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
http://127.0.0.1:5184/promo/capture.html?scene=mega-blastoise
http://127.0.0.1:5184/promo/gimmickWall.html?scene=mega
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

기믹 화면 모음의 재현 순서는 다음과 같다. 먼저 위의 Vite 서버를 실행해 둔다.

```powershell
# 36개 매치가 실제 엔진에서 정상 작동하는지 확인
node promo/scripts/validateGimmickFixtures.mjs
# 각 독립 배틀 10초 촬영: promo/raw/take-{sceneId}.*
node promo/scripts/captureTrailer.mjs --variants
# 전장 크롭 및 영상 메타데이터 manifest 생성
node promo/scripts/prepareGimmickClips.mjs
# 각 12초 확장 화면의 로딩·실시간 동작 검증용 녹화
node promo/scripts/captureTrailer.mjs mega zmove dynamax tera
# 최종 화면은 각 시점을 정확히 30fps로 렌더링
node promo/scripts/renderSceneFrames.mjs --workers=2 --reuse
# 준비한 전체 타임라인과 음악을 최종 영상으로 편집
node promo/scripts/renderTrailer.mjs --reuse-clips
node promo/scripts/validateSmoothness.mjs
node promo/scripts/validateTrailer.mjs
```

한 매치만 다시 촬영하려면 `node promo/scripts/captureTrailer.mjs --variants take-mega-blastoise`처럼 `take-` 접두사가 있는 촬영 ID를 지정한다. 크롭 단계는 원본·메타데이터·스크립트의 변경을 확인하여 필요한 클립을 갱신한다. `promo/generated/gimmick-clips.json`은 화면 모음이 읽는 생성 파일이다. `window.promoWall.ready`, `play()`, `stop()`, `setTime(seconds)`, `status()`로 준비·재생·지정 시점과 9개 영상의 로드·재생 상태를 확인할 수 있다.

## 검증

새 촬영 전에 `createBattleTurnTimeline`으로 원하는 플레이어 기믹·공격·명중이 생성되는지 확인한다. 촬영 후에는 브라우저 오류, 실제 영상 디코딩, 플레이 진행과 영상·효과음 동기화를 별도로 확인한다. 이전 촬영의 통과 결과를 새 원본의 검증 결과로 사용하지 않는다.

36개 기믹 매치는 `node promo/scripts/validateGimmickFixtures.mjs`로 재검증한다. 기술의 실제 습득 가능 여부, 기믹 활성화, 첫 연출의 주체, 공격·명중·양의 데미지, 첫 턴 패배 여부, 메타데이터와 엔진의 기술명·타입 일치를 검사한다. 거다이맥스는 지원 전용 폼과 `gmax` 기술, 테라스탈은 선택한 9가지 타입까지 확인한다. 결과·타임라인·소스 해시는 `promo/generated/gimmick-fixtures-validation.json`에 기록한다. 최종 편집의 13개 진입 전환은 `timeline.json`의 `smoothup`, `smoothleft`, `smoothright`, `diagbr`, `fade`를 사용해 각 챕터 경계에서 0.4초 동안 진행하며 효과음도 교차 페이드한다. 새 최종 파일의 판정과 측정값은 `output/validation.json`을 기준으로 한다.

저장소 루트에서 간단히 장면별 기믹과 기술 이벤트를 재확인할 수 있다.

```powershell
node --input-type=module -e "import {PROMO_SCENES,createPromoFixture} from './promo/fixtures.mjs'; import {createBattle,createBattleTurnTimeline} from './src/data/battleEngine.js'; for (const id of Object.keys(PROMO_SCENES)) { const f=createPromoFixture(id); const actions=f.playerPokemon.map((p,i)=>({type:'move',actorSlot:i,targetSlot:0,moveIndex:0,gimmick:i===0?f.scene.mechanic:null})); const r=createBattleTurnTimeline(createBattle(f),actions,()=>0.5); console.log(id,r.timeline.filter(s=>s.phase==='gimmick'||s.phase==='attack').map(s=>[s.sideId,s.phase,s.mechanicId??s.moveId])); }"
```

캐릭터·포켓몬·픽셀 에셋의 기존 출처 표기는 저장소의 크레딧 문서를 따른다. 이 문서는 새로운 게임 기능이나 공식 포켓몬 서비스와의 제휴를 주장하지 않는다.
