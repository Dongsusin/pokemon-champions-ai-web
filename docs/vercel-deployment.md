# Vercel 배포 확인

## 연결 대상

- Git 저장소: `Dongsusin/pokemon-champions-ai-web`
- 운영 브랜치: `main`
- Vercel 팀: `dongsusins-projects`
- Vercel 프로젝트: `pokemon-champions-ai-web`
- 대표 운영 주소: <https://pokemon-champions-area-web.co.kr>
- www 주소: <https://www.pokemon-champions-area-web.co.kr> → 대표 주소로 308 이동
- 기존 접속 주소: <https://pokemon-champions-ai-web.vercel.app>
- 관리 화면: <https://vercel.com/dongsusins-projects/pokemon-champions-ai-web>

프로젝트의 **Settings → Git**에서 위 저장소가 연결되어 있어야 한다. 로컬의 `.vercel/project.json`은 CLI 연결 정보이며, 이 파일이 존재하거나 GitHub 푸시가 성공했다는 사실만으로 자동 배포가 연결되었다고 판단하지 않는다.

## 빌드 설정

- Framework Preset: `Vite`
- Root Directory: 저장소 루트(빈 값)
- Node.js: `24.x`
- 기본 빌드: `npm run build` (`prebuild`에서 리소스 목록 생성)
- Output Directory: `dist`
- Ignored Build Step: `Automatic`

Firebase Web App 환경 변수는 Vercel의 Production 환경에도 설정해야 한다. 필요한 변수 목록과 Firestore 규칙 배포 절차는 [Firebase 설정](firebase-setup.md)을 따른다. 인증·저장 형식이 바뀌는 변경은 웹과 실제 Firestore 규칙의 호환성을 확인한 후 함께 반영한다.

버그 신고는 루트 `api/bug-report.js`의 Node 함수로 처리한다. 수신 주소와 활성화 여부는 서버 전용 환경변수로 설정하며, 메일 수신함 활성화·검증 절차는 [버그 신고 운영](bug-reports.md)을 따른다. 환경변수 변경도 새 배포가 필요하다.

## 푸시 이후 확인

1. 관련 검증을 통과한 변경을 커밋하고 현재 브랜치로 푸시한다.
2. `git ls-remote origin refs/heads/main`과 `git rev-parse HEAD`로 원격 커밋을 확인한다.
3. Vercel **Deployments**에서 해당 커밋의 배포가 생성되고 `Ready`가 되는지 확인한다. 운영 배포의 Source가 최신 `main` 커밋인지도 확인한다.
4. 운영 주소를 직접 열어 변경된 화면 또는 새 정적 파일이 실제로 제공되는지 확인한다. GitHub 푸시 성공과 운영 배포 성공은 따로 보고한다.

Git 연결을 나중에 추가한 경우 기존 커밋이 이미 운영에 반영되었다고 가정하지 않는다. 새 푸시가 배포를 생성하는지 확인하거나 **Deployments → Create Deployment**에서 `main`을 선택하고, 표시된 커밋을 확인한 뒤 배포한다. 오래된 배포의 **Redeploy**는 최신 `main` 대신 기존 소스를 다시 배포할 수 있으므로 Source를 확인한다.

Vercel 연동 도구가 빈 프로젝트 목록이나 403/404를 반환하더라도 프로젝트가 삭제되었다고 단정하지 않는다. 로그인된 관리 화면에서 프로젝트 ID와 Git 연결을 확인하고, 도구의 프로젝트 접근 권한 문제와 실제 서비스 배포 문제를 구분한다. 연결 확인을 위해 기존 프로젝트나 도메인을 삭제하거나 새 프로젝트를 만들 필요는 없다.

## 가비아 도메인 연결

`pokemon-champions-area-web.co.kr`은 가비아 DNS를 사용한다. 2026-09-10 Vercel 관리 화면에서 안내받아 등록한 레코드는 다음과 같다. 이후 변경할 때에는 프로젝트의 Domains 화면에서 현재 권장값을 먼저 확인한다.

| 유형 | 호스트 | 값 | TTL |
| --- | --- | --- | --- |
| A | `@` | `216.198.79.1` | 600 |
| CNAME | `www` | `c387ae514dac3d57.vercel-dns-017.com.` | 600 |

루트 도메인은 Production에 연결하고 `www`는 루트 도메인으로 308 리다이렉트한다. DNS 저장 이후 Vercel의 도메인 인증과 HTTPS 인증서 발급을 확인한다. 인증서 검사를 끄거나 브라우저 보안 경고를 우회해서 정상 연결로 판단하지 않는다.

Firebase Authentication 승인 도메인에도 루트와 `www`를 등록한다. 현재 `authDomain`은 기존 Firebase 도메인을 사용하므로 변경하지 않는다. 자세한 설정은 [Firebase 설정](firebase-setup.md)을 따른다.

브라우저 저장소는 주소별로 분리된다. 기존 Google 계정의 진행 상황은 새 주소에서 같은 계정으로 로그인해 불러온다. 기존 주소의 게스트 기록은 해당 주소에서 Google 계정에 연결한 뒤 새 주소로 옮긴다. 이를 위해 기존 Vercel 주소도 계속 접속 가능하게 유지한다.
