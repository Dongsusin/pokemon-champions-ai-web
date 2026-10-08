# 포켓몬 챔피언스 아레나

브라우저에서 Google 계정 또는 게스트로 플레이하는 웹 게임입니다.

## 실행과 빌드

Node.js 24에서 `npm ci` 후 `npm run dev`로 개발 화면을 실행하고, `npm run build`로 웹 배포 파일을 만듭니다.

인증은 기존 Firebase 프로젝트를 사용합니다. 운영 플레이 기록과 계정 세션은 기존 계정 API와 PostgreSQL 저장소를 사용하며, Vercel에 설정된 운영 환경 변수를 유지합니다. 개인 환경 파일과 플레이 데이터 백업은 저장소나 배포에 포함하지 않습니다.

## 주요 검증

- `npm run validate:z-mirror-move`
- `npm run validate:account-api`
- `npm run validate:account-session`
- `npm run validate:account-sync`
- `npm run validate:guest-identity`
- `npm run validate:guest-identity-client`

런처 전용 저장 브리지는 웹 실행에서 사용하지 않습니다. 기존 로컬 기록은 별도로 보관한 백업에서 복구할 수 있으며, 웹 복원 과정에서 Google 계정 기록을 삭제하지 않습니다.
