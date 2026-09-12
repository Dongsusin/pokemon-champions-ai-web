# Discord 커뮤니티 봇 설치

이 봇은 Discord 슬래시 명령을 Vercel의 HTTP 함수로 처리한다. 개인 PC를 계속 켜 놓을 필요가 없다. 자유게시판·오류신고·개선제안·업데이트내역 채널, 고정 안내 4개, 확인된 최근 업데이트 1개를 최초 설정 CLI로 구성한다. 게시 문구는 [커뮤니티 콘텐츠](discord-community-content.md)와 [콘텐츠 원본](../server/discordCommunityContent.js)에 있다.

## 앱과 서버 연결

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 앱을 만들고 **Application ID**, **Public Key**, **Bot Token**을 확인한다. 일반 Discord 사용자 계정 토큰은 사용하지 않는다.
2. 앱을 **Guild Install**로 설치하고 OAuth2 범위 `bot`, `applications.commands`를 선택한다. 아래 권한으로 사용자가 지정한 서버 한 곳에만 초대한다. 설치하려는 서버 ID를 `DISCORD_GUILD_ID`에 명시해야 하며, CLI가 다른 서버를 찾아 설정하지 않는다.
3. **Interactions Endpoint URL**은 서버 환경 변수와 배포를 완료한 뒤 `https://pokemon-champions-area-web.co.kr/api/discord-interactions`로 저장한다. Discord의 서명된 PING 검증이 성공해야 저장된다.

Gateway 연결과 Message Content/Server Members 같은 privileged intent는 사용하지 않는다. HTTP 방식의 봇은 Discord 멤버 목록에서 오프라인으로 보일 수 있지만 슬래시 명령을 처리할 수 있다. 새 멤버 환영은 Discord 기본 시스템 입장 알림과 자유게시판의 고정 안내가 담당한다. 개인별 맞춤 환영 메시지나 DM을 자동 발송하는 기능은 없다.

## 최초 설치 권한

OAuth2 권한 값은 `2252177770892336`이다. `Administrator`, `Manage Roles`, `Manage Messages`는 요구하지 않는다.

| 권한 | 용도 |
| --- | --- |
| Manage Channels | 없는 채널 생성 및 네 채널의 소개 수정 |
| Manage Server (`MANAGE_GUILD`) | 자유게시판을 시스템 입장 알림 채널로 설정 |
| View Channels, Read Message History | 채널 접근과 기존 안내 중복 확인 |
| Send Messages, Embed Links | 안내와 명령 결과 게시 |
| Create Public Threads, Send Messages in Threads | 오류·개선 글의 공개 스레드와 답변 |
| Create Private Threads | 새 공지 채널을 생성할 때 비공개 스레드 생성 **거부** overwrite를 지정하기 위해 필요 |
| Pin Messages (`PIN_MESSAGES`, bit 51) | 안내 메시지 4개 고정 |

Discord는 새 채널 생성 시 봇이 서버에서 보유한 권한만 overwrite에서 허용·거부할 수 있다. 따라서 설정 권한 값에는 공지 채널에서 거부할 Create Private Threads도 포함한다. 봇이 비공개 스레드를 생성하는 기능은 구현하지 않았다. 기존 채널의 권한 overwrite 변경에는 Manage Roles가 필요하므로 CLI는 기존 채널 권한을 수정하지 않는다. 해당 권한이 다르면 서버 소유자가 Discord의 채널 설정에서 맞춘 뒤 다시 실행한다. [채널 생성 규칙](https://docs.discord.com/developers/resources/guild#create-guild-channel), [채널 권한 변경](https://docs.discord.com/developers/resources/channel#edit-channel-permissions), [권한 비트 표](https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags)

현재 Pin Messages는 Manage Messages와 별개의 권한이다. API는 `PUT /channels/{channel.id}/messages/pins/{message.id}`를 사용한다. [메시지 고정 API](https://docs.discord.com/developers/resources/message#pin-message)

## 서버 환경 변수

아래 값은 Vercel **Production 서버 환경 변수**로 넣는다. `VITE_` 접두어를 붙이거나 클라이언트 코드·Git·공개 로그에 봇 토큰을 넣지 않는다. Preview 배포에 같은 봇 토큰을 복제할 필요는 없다.

| 이름 | 값 |
| --- | --- |
| `DISCORD_APPLICATION_ID` | 봇 앱의 Application ID |
| `DISCORD_PUBLIC_KEY` | 앱의 Public Key; HTTP 서명 검증용 |
| `DISCORD_BOT_TOKEN` | 접두어 없는 봇 토큰 |
| `DISCORD_GUILD_ID` | 설정할 Discord 서버 하나의 ID |
| `DISCORD_FREE_CHANNEL_ID` | 자유게시판 채널 ID |
| `DISCORD_BUG_CHANNEL_ID` | 오류신고 채널 ID |
| `DISCORD_IDEA_CHANNEL_ID` | 개선제안 채널 ID |
| `DISCORD_UPDATE_CHANNEL_ID` | 업데이트내역 채널 ID |
| `DISCORD_MODERATOR_ROLE_ID` | 선택: 이미 존재하는 운영진 역할 ID |

최초 CLI 실행에는 앱 ID·봇 토큰·서버 ID가 필요하다. 채널 ID가 없으면 정확히 같은 이름의 일반 텍스트 채널을 재사용하거나 없을 때 생성한다. 같은 이름이 둘 이상이면 임의로 선택하지 않고 해당 채널 ID를 요구한다. ID를 직접 지정하면 채널 이름이 달라도 지정한 서버의 해당 텍스트 채널을 사용한다. 한 채널 ID를 여러 용도에 지정할 수 없다.

Public Key는 CLI에서 사용하지 않는다. 운영 HTTP 함수에는 Public Key와 채널 ID 4개까지 모두 설정하고 재배포한다. 환경 변수 변경만으로 기존 배포 코드의 설정이 바뀌었다고 간주하지 않는다.

## 조회와 적용

토큰은 터미널 명령문에 직접 쓰지 말고, Git에서 제외되는 `.env.discord.local` 같은 로컬 환경 파일이나 현재 프로세스 환경 변수로 제공한다. 로컬 파일에는 위 변수 이름을 사용한다. 아래 npm 명령은 `--env-file-if-exists`를 사용하므로 Node.js 22.9 이상이 필요하며, 이 작업에서는 Node.js 24.14.0으로 검증했다. [Node.js 환경 파일 옵션](https://nodejs.org/api/cli.html#--env-file-if-existsfile)

```powershell
# 기본 실행은 조회만 한다. Discord 변경과 결과 파일 저장이 없다.
npm run discord:setup

# 계획을 실제로 적용한다.
npm run discord:setup -- --apply

# 자격 증명 없이 옵션과 권한 값을 확인한다.
npm run discord:setup -- --help
```

`--dry-run`도 조회 전용이며 기본 실행과 같다. 조회 결과의 `blockers`가 비어 있어야 적용할 수 있다. CLI는 봇 계정 여부, 토큰과 Application ID의 일치, 지정 서버·역할·채널과 필요한 권한을 먼저 확인한다. 기존 채널 소개 변경, 입장 알림 설정, 명령·메시지 생성/수정/고정 계획을 JSON으로 출력한다. 제목·소개·본문의 전체 초안은 콘텐츠 문서에서 확인할 수 있다.

적용 결과는 `scripts/.cache/discord-community/setup-result.json`에 저장된다. 이 경로는 Git에서 제외되며 ID·적용 시각·작업 결과만 담고 토큰과 Public Key는 담지 않는다. 결과의 `environment` 값을 운영 서버 환경 변수에 반영한다.

설정 동작은 다음과 같다.

- 자유게시판·오류신고·개선제안은 일반 멤버의 보기·기록 읽기·메시지·공개 스레드 생성·스레드 답글 권한을 확인한다. 기존 채널에 명시적인 overwrite가 없어도 역할로 받은 **유효 권한**이 맞으면 사용할 수 있다.
- 업데이트내역은 `@everyone`의 보기·기록 읽기를 허용하고 메시지 보내기·공개/비공개 스레드 생성·스레드 답글을 명시적으로 거부한다. 봇은 자신의 역할 또는 멤버 overwrite로 필요한 읽기·게시·스레드·고정 권한을 가져야 한다. 새 채널에는 봇 멤버 overwrite를 생성한다. 다른 일반 역할이나 멤버의 쓰기 허용이 있으면 적용을 중단한다.
- 선택한 기존 운영진 역할은 새 공지 채널에서 게시할 수 있다. CLI가 역할을 생성하거나 관리자로 승격하거나 사용자에게 역할을 부여하지 않는다. 서버 소유자는 Discord의 기본 소유자 권한으로 관리한다.
- 자유게시판을 `system_channel_id`로 지정하고 `system_channel_flags`의 입장 알림 억제 bit 0만 해제한다. 부스트·안내 알림 등 다른 플래그는 유지한다. [시스템 채널 플래그](https://docs.discord.com/developers/resources/guild#guild-object-system-channel-flags)
- `/안내`, `/오류`, `/개선`, `/업데이트`를 해당 앱의 해당 서버 명령으로 개별 생성·수정한다. 전체 명령을 덮어쓰는 bulk overwrite를 사용하지 않고 다른 명령은 유지한다. [서버 명령 등록](https://docs.discord.com/developers/interactions/application-commands#create-guild-application-command)
- 고정 안내 4개와 확인된 초기 업데이트 1개를 게시한다. 같은 봇이 작성했고 embed footer의 `champions-community:...` 마커가 정확히 같은 메시지만 재사용·수정·고정한다. 일반 멤버가 같은 마커를 쓴 메시지는 건드리지 않는다. 재실행 시 같은 메시지를 또 게시하지 않으며 사용자 메시지와 다른 채널을 삭제하지 않는다.

기존 안내 확인은 고정 메시지와 최대 최근 2,500개 메시지를 조회한다. 그 범위에서 필요한 확인을 끝내지 못하면 새 메시지를 임의로 중복 게시하지 않고 중단한다. API 오류나 Discord 속도 제한이 발생하면 원인을 해결한 뒤 다시 실행한다. 일부 단계만 완료된 경우에도 이미 생성된 채널·명령·봇 안내는 재사용한다. 오류 응답에는 토큰이나 원문 네트워크 오류를 출력하지 않는다.

## 운영 확인

1. Vercel 배포가 준비된 뒤 Developer Portal에서 Interactions Endpoint URL의 검증과 저장을 확인한다. 임의 브라우저 GET이나 서명 없는 POST의 오류는 Discord의 서명 검증 성공 여부를 대신하지 않는다.
2. 서버에서 `/안내`가 호출자에게만 안내를 표시하는지 확인한다. `/오류`·`/개선`은 입력 창 → 공개 게시 → 게시글의 공개 스레드 생성까지 확인한다. 입력한 오류·개선 내용은 이메일로 보내지 않고 Discord 채널에 공개된다.
3. 일반 멤버가 업데이트내역에 직접 글·스레드를 작성할 수 없는지, 봇과 운영진은 필요한 기능을 사용하는지 확인한다. 사진·영상·반응을 허용하려면 일반 멤버의 Attach Files·Add Reactions 권한도 Discord 설정에서 확인한다.
4. `/업데이트`는 기본적으로 Manage Server 권한이 있는 멤버에게 제공된다. 선택한 운영진 역할에 Manage Server를 주지 않을 경우 서버 설정 → 연동 → 해당 앱에서 `/업데이트` 명령 권한에 그 역할을 추가한다. 서버 측에서도 서버 소유자/관리 권한 또는 설정한 운영진 역할을 다시 확인한다.
5. 새 멤버 입장 시 자유게시판에 Discord 기본 입장 알림이 나타나는지 확인한다. 기존 멤버에게 과거 입장 알림을 다시 보내지는 않는다.

게임 업데이트를 배포했다고 자동으로 게시하지 않는다. 운영진이 확인한 내용을 `/업데이트`로 작성한다. 로컬 PC는 최초 설정 CLI 실행 때만 필요하고 이후 명령 처리는 Discord와 Vercel이 담당한다. Vercel·Discord API 장애 중에는 기능이 실패할 수 있으며, 개인 PC에서 봇을 계속 실행하는 방식으로 보완하지 않는다.

## 검증

```powershell
# HTTP 서명·명령 처리·최초 설정 전체 검증
npm run validate:discord

# 최초 설정만 검증
node scripts/validateDiscordSetup.mjs
```

외부 Discord 요청 없이 실제 콘텐츠와 REST mock으로 조회 전용 실행, 최초 설정, 재실행, 기존 채널 유효 권한, 공지 쓰기 차단, 사용자 메시지 보존, 개별 명령 갱신, 부분 실패 후 재개, 비밀값 없는 오류를 확인한다. 실제 서버 게시·입장 알림·Vercel 처리 검증은 위 운영 확인 절차로 별도 확인한다.
