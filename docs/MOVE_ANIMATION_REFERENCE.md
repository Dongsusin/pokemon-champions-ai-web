# 기술 애니메이션 레퍼런스 적용

`pokemon_gen5_move_animation_all_in_one_ko.txt`의 971개 기술 매니페스트와 62개 수동 작업 큐를 웹 배틀 연출용 마스터 인덱스로 사용합니다.

## 적용 범위

- 현재 배틀 기술 863개를 레퍼런스 레코드와 전부 연결합니다.
- 숨겨진파워 타입별 내부 ID는 공통 `HIDDEN_POWER` 레코드에 연결합니다.
- Z기술, 다이맥스, 거다이맥스, 테라버스트, 폼별 덩굴방망이, 섀도 기술을 별도 변형으로 구분합니다.
- 렌더링 기준은 256×192 논리 캔버스, 60 tick, 픽셀 스냅, nearest 필터입니다.
- 기존 EBDX 5세대풍 리소스는 그대로 사용하고, 매니페스트가 지정한 변형·가용성·수동 QA 상태를 런타임 메타데이터로 덧붙입니다.

## 재생성

```powershell
npm run import:move-animation-reference -- --source "C:\path\to\pokemon_gen5_move_animation_all_in_one_ko.txt"
npm run validate:move-animations
```

생성 파일은 `src/data/generatedMoveAnimationReference.json`과 `docs/move-animation-qa-checklist.csv`입니다. 원본 문서는 저장소에 포함하지 않으며 생성 파일에 원본 SHA-256을 기록합니다.

## 정확도 원칙

- 1~5세대 원작과 완전히 동일한 재현에는 사용자가 합법적으로 보유한 B2W2 데이터의 스크립트·SPA·팔레트·배경·카메라·SFX가 모두 필요합니다.
- 6세대 이후 기술과 배틀 기믹은 공식 5세대 원본이 없으므로 현재 구현은 EBDX와 절차적 효과를 이용한 5세대풍 재구성입니다.
- `MISSING_MANUAL`, `PARTIAL_MANUAL` 항목은 QA 체크리스트에서 원작 캡처와 별도로 대조해야 합니다.
