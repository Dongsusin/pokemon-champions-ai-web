# 다이맥스 종 제한과 탱탱겔 힘흡수 수정

## 문제와 변경

- 자시안·자마젠타가 일반 모습과 왕의 모습 모두 다이맥스를 선택할 수 있었다. 공통 기믹 판정에서 자시안(888), 자마젠타(889), 동일한 제한을 가진 무한다이노(890)와 그 폼을 제외한다. UI, AI, 로컬 실행, 레이팅 서버의 명령 검사가 이 판정을 공유한다.
- 변신은 현재 종을 기준으로 판정한다. 일루전은 위장 중인 종도 확인하고 위장이 풀리면 제한을 다시 판정한다. 다른 포켓몬의 다이맥스·거다이맥스나 다른 기믹 사용 규칙은 기존과 같다.
- 탱그릴의 8세대 알 기술인 힘흡수가 PokeAPI의 탱탱겔 개별 학습 목록에 없어, `normalizePokemon`에서 다른 기본 기술로 교체됐다. 검증된 학습 목록 보완에 탱탱겔을 추가하고 암컷 폼에도 상속한다. 생성된 JSON을 직접 고치지 않아 데이터 재생성 후에도 보완을 유지한다.
- 힘흡수는 하락 전 상대 공격 실능력치와 랭크로 회복량을 계산한다. 공격 -6 및 회복/하락 모두 무효인 경우의 실패 기록, 큰뿌리 반올림, 틀깨기로 무시할 수 없는 해감액 처리를 보완했다.

이미 과거 저장 과정에서 다른 기술로 바뀐 슬롯은 원래 선택을 복구할 근거가 없으므로 자동 변경하지 않는다. 트레이닝에서 힘흡수를 다시 선택해 저장하면 유지된다.

## 기준 자료

- [Showdown 다이맥스 요청 판정](https://github.com/smogon/pokemon-showdown/blob/master/sim/pokemon.ts#L983-L995)
- [종별 cannotDynamax 데이터](https://github.com/smogon/pokemon-showdown/blob/master/data/pokedex.ts)
- [탱그릴 Strength Sap 알 기술](https://github.com/smogon/pokemon-showdown/blob/master/data/learnsets.ts#L62445)
- [힘흡수 처리](https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts#L18142-L18160)
- [큰뿌리 아이템](https://github.com/smogon/pokemon-showdown/blob/master/data/items.ts), [고정소수점 계산](https://github.com/smogon/pokemon-showdown/blob/master/sim/battle.ts), [해감액 특성](https://github.com/smogon/pokemon-showdown/blob/master/data/abilities.ts)

위 자료는 2026-09-14에 확인했다. 본 게임은 세대 통합 기술 및 기믹을 제공하므로 이번 변경은 종 제한과 해당 기술의 동작에 적용한다.

## 재현과 검증

```powershell
npm run validate:dynamax-eligibility
npm run validate:strength-sap
npm run validate:pokemon-learnsets
npm run validate:dynamax-strength-sap-ui
```

- 다이맥스: 양 진영과 폼별 후보/기술 미리보기, 위조 명령의 HP 배증·기믹 소비·연출 방지, 변신/일루전, AI 및 레이팅 서버를 검사한다. 수정 전 같은 종별 검사는 35건 중 30건 실패했다.
- 힘흡수: 합법적인 탱탱겔 생성부터 공격 랭크·풀 HP·공격 하락 방지·특성·도구·대타출동·방어·반사·회복봉인·더블 대상 선택까지 검사한다.
- 학습 목록: 전체 종/폼과 함께 탱그릴·탱탱겔 수컷/암컷의 트레이닝 정규화 및 배틀 생성에서 힘흡수를 보존하는지 확인한다.
- UI: 실제 `BattleScreen`을 로컬 테스트 상태로 렌더링한다. PC 1440×900, 모바일 가로 844×390의 싱글/더블에서 제한된 버튼, 일반 포켓몬의 다이맥스 토글, 실제 피해 후 힘흡수 선택·대상 지정·회복 로그·HP 표시를 확인한다. 실제 계정이나 운영 매치는 사용하지 않는다.

UI 증거는 Git에서 제외되는 `scripts/.cache/dynamax-strength-sap-ui/`에 저장한다.

최종 결과: 다이맥스 41/41, 힘흡수 17/17, UI 24/24, PvP 등록 4/4를 통과했다. 전체 학습 목록 1,025종/549폼과 기존 트레이닝, 레이팅, 팩토리, 왕의 모습 기술, 기믹 타이밍, AI, 특성 효과 검증 및 프로덕션 빌드도 통과했다. UI 검증 중 브라우저 오류와 외부 API 호출은 0건이었다.
