# 완료된 레이팅 배틀 데이터 보관

`202609130002_completed_battle_retention.sql`은 종료 후 24시간이 지난 레이팅 배틀의 큰 연출 데이터를 정리하는 함수를 정의합니다. 마이그레이션 자체로 데이터를 정리하거나 예약 작업을 등록하지 않습니다.

정리하는 데이터는 종료된 배틀의 엔진 상태, 최종 팀의 상세 데이터, 행동 요청 목록과 해당 배틀의 연출 프레임입니다. 결과·참가 계정·등급 변화·VP 보상 결과는 작은 종료 기록으로 남겨 이전 요청을 다시 받아도 보상이 재지급되지 않도록 합니다. 계정 저장·레이팅 프로필·승패 내역·VP 누적액·사용률·팩토리 랭킹에는 접근하지 않습니다.

진행 중인 배틀과 종료 후 24시간 이내의 배틀은 유지합니다. 함수는 한 번에 최대 100개를 처리하고 잠긴 행은 건너뜁니다. 다른 네임스페이스와 이름이 비슷한 배틀의 연출 데이터도 건드리지 않습니다. 잘못된 형식으로 가져온 기록은 자동으로 삭제하지 않습니다.

## 적용과 예약

운영 프로젝트는 `202609130003_schedule_completed_battle_retention.sql`로 pg_cron을 활성화하고 `champions-completed-battle-retention` 작업을 매시간 15분에 실행하도록 등록한다. 대상은 운영 `ranked` namespace다.

Supabase 공식 문서에 따르면 [Cron은 pg_cron을 사용](https://supabase.com/docs/guides/cron)하며 [데이터베이스 함수를 SQL 작업으로 예약](https://supabase.com/docs/guides/cron/quickstart)할 수 있습니다. 프로젝트에서 Cron 확장을 활성화한 뒤 운영자가 현재 `RANKED_FIRESTORE_PREFIX`와 동일한 네임스페이스를 지정합니다.

아래는 `ranked` 네임스페이스에 대한 적용 예시이며, 운영 네임스페이스가 다르면 함수 인자를 바꿔야 합니다.

```sql
select cron.schedule(
  'champions-completed-battle-retention',
  '15 * * * *',
  $$select champions.prune_completed_battles('ranked');$$
);
```

같은 이름의 작업이 이미 있으면 새 이름의 중복 작업을 만들지 않고 기존 작업을 확인해 수정합니다. 반복 실행 시 이미 정리한 배틀은 건너뜁니다. 이 작업은 논리적인 데이터 용량을 줄이며, 삭제된 PostgreSQL 저장 공간은 일반 VACUUM을 통해 이후 데이터에 재사용될 수 있습니다.

## 로컬 검증

운영 DB에 연결하지 않고 PGlite의 실제 PostgreSQL 엔진에서 SQL을 실행합니다. 테스트 의존성은 추적하지 않는 캐시 폴더에만 설치합니다.

```powershell
npm install --prefix scripts/.cache/retention-test @electric-sql/pglite@0.5.8 --no-save --no-package-lock
node scripts/validateBattleRetention.mjs
```

테스트는 24시간 경계·진행 중인 배틀·네임스페이스 격리·밑줄이 포함된 ID·비슷한 ID·결과 보존·재실행·API의 늦은 명령 및 결과 재조회·계정/통계 데이터 불변을 확인합니다.
