# 테라버스트 검증

기술 데이터와 습득 목록에는 이미 테라버스트가 포함되어 있었다. 2026-09-11 점검에서 첫 테라스탈 턴의 미리보기, 분류 판정에 도구·특성이 개입하는 문제, 스텔라 전용 처리를 보완했다.

| 상태 | 타입 / 위력 | 물리·특수 판정 |
| --- | --- | --- |
| 테라스탈 전 | 노말 / 80 | 특수. 노말스킨·페어리스킨 등 일반 타입 변환 특성은 적용 가능 |
| 일반 테라스탈 | 자신의 테라타입 / 80 | 랭크를 반영한 공격이 특수공격보다 높을 때 물리, 같거나 낮으면 특수 |
| 스텔라 테라스탈 | 스텔라 / 100 | 같은 분류 판정. 테라스탈한 상대에게 상성 2배, 그 외 상대에게 1배 |

공격·특공 비교에는 도구·특성·날씨 보정을 포함하지 않는다. 기술 분류가 정해진 후 실제 데미지를 계산할 때에는 해당 보정이 적용된다. 테라스탈한 테라버스트의 타입과 위력은 노말스킨 계열 특성으로 변경되지 않는다.

스텔라 테라버스트가 명중하면 사용자의 공격·특공이 각각 1랭크 하락한다. 방어·빗나감·무효 때는 하락하지 않으며, 대타출동에 명중한 경우에는 하락한다. 심술꾸러기 등 기존 랭크 변화 처리는 같은 엔진 경로를 사용한다.

스텔라 사용 시 원래 방어 타입을 유지한다. 타입별 최초 공격에는 원래 타입이면 자속 2배, 다른 타입이면 약 1.2배 보정이 적용되고 이후에는 원래 자속으로 돌아간다. 소모 이력은 교대해도 유지되며 테라파고스 스텔라폼은 이 보정을 소모하지 않는다. 프리뷰나 AI의 예상 데미지 계산은 보정을 소모하지 않는다.

테라스탈 버튼 선택 즉시 기술 카드와 대상 선택 화면에 변경된 타입·분류·위력·스텔라 상성을 표시한다. 원본 배틀의 PP, 체력, 능력치, 기믹 사용 여부를 변경하지 않고 예상 상태를 계산한다. 실제 사용 시 테라타입별 기존 기술 연출과 효과음에 연결된다.

검증 명령:

```powershell
npm run validate:tera-blast
npm run validate:tera-blast-ui
npm run validate:battle-move-effects
npm run validate:battle-abilities
npm run validate:battle-actions
npm run validate:battle-ai
npm run build
```

참고한 원본: [Pokémon Showdown 기술 구현](https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts), [데미지·스텔라 자속 처리](https://github.com/smogon/pokemon-showdown/blob/master/sim/battle-actions.ts). 기술의 한국어 설명은 `scripts/generateBattleMoveData.mjs`에서도 보존되므로 데이터를 재생성해도 사라지지 않는다.
