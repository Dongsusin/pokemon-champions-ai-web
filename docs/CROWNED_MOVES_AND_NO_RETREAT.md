# 거수 기술 및 배수의진 수정 (2026-09-14)

## 자시안 / 자마젠타

- 저장된 팀에는 아이언헤드를 유지한다. 배틀에서 검왕 자시안으로 바뀌면 같은 슬롯을 거수참으로, 방패왕 자마젠타로 바뀌면 거수탄으로 교체한다. 처음부터 해당 폼인 배틀 데이터에도 적용한다.
- 기술 이름만 바꾸지 않고 카탈로그의 전체 정의를 사용한다. 위력 100, 기본 PP 5, 전용 설명과 효과가 적용되며 아이언헤드의 풀죽음 효과는 남지 않는다.
- 이미 소모한 PP는 보존하고, 교체 후 다시 등장해도 PP를 채우지 않는다. 아이언헤드가 없는 팀에는 기술을 추가하지 않는다.
- 거수참 / 거수탄 / 다이맥스포는 다이맥스 상대에게 데미지 2배를 적용한다. 실제 계산과 AI의 예상 데미지 계산에 같은 조건을 사용한다.

근거: [Pokémon Showdown의 폼 시작 및 다이맥스 처리](https://github.com/smogon/pokemon-showdown/blob/master/data/conditions.ts), [저장 팀의 기술 정규화](https://github.com/smogon/pokemon-showdown/blob/master/sim/team-validator.ts).

## 배수의진

- 첫 성공 시 공격·방어·특수공격·특수방어·스피드가 각각 1단계만 오른다. 중복으로 상승시키던 volatile 처리를 제거한다.
- 이미 배수의진이 적용된 상태에서는 기술 전체가 실패한다. PP는 소모하지만 능력치가 다시 오르지 않는다. AI도 이 확정 실패를 공격 후보에서 제외한다.
- 고스트 타입이나 아름다운허물로 교체할 수 있는 경우에도 필드에 남아 있는 동안은 재사용할 수 없다. 실제 교체가 이루어지면 일반 일시 상태와 함께 초기화된다. 배턴터치로 전달되는 제한도 처리한다.
- 먼저 검은눈빛·블록·거미집 등의 `trapped` 상태에 걸린 경우는 반복 상승이 허용되는 원본 예외를 유지한다. 조이기 등 부분 구속, 문어굳히기, 그림자밟기는 이 예외가 아니다.
- 배수의진의 교체 금지와 상대 기술로 인한 구속을 독립적으로 관리한다. 상대의 교체·기절 또는 부분 구속 만료로 배수의진이 해제되지 않는다.

근거: [Pokémon Showdown 기술 규칙](https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts), [구속 상태](https://github.com/smogon/pokemon-showdown/blob/master/data/conditions.ts), [고스트 타입 및 상태 전달](https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts).

## 재현 검증

- `npm run validate:crowned-moves`: 일반 폼 / 전용 도구 / 직접 검왕·방패왕 폼 / PP / 교체 / 잘못된 도구 / 다이맥스 데미지 대조군.
- `npm run validate:crowned-moves-ui`: 일반전과 레이팅 양측 시점의 기술 버튼·툴팁·사용 후 PP, PC·모바일 화면 검증. 운영 사용자를 대상으로 실행하지 않는다.
- `npm run validate:no-retreat`: 양쪽 진영의 첫 사용·재사용·흑안개·교체·구속 종류·고스트·배턴터치·AI 선택 검증.

기존 검증의 선봉 자동 선택 및 불법 기술 fixture도 실제 의도한 기술을 실행하도록 고정한다. 기술을 선택하지 않았는데 그 기술의 효과를 기대하는 검증은 사용하지 않는다.
