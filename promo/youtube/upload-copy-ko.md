# YouTube 업로드 문구 · 한국어

현재 `promo/output/champions-arena-promo-1080p.mp4`의 2분 2초 편집본을 기준으로 작성했습니다. 아래 설명란의 코드 블록 내용만 복사해 붙여 넣으면 됩니다.

## 추천 제목

```text
[비공식 팬메이드] 1,025종 포켓몬 × 238명 AI 트레이너 | 챔피언스 아레나
```

## 대안 제목

```text
팬이 만든 포켓몬 배틀! 메가진화부터 테라스탈까지 | 비공식 팬메이드
```

```text
나만의 드림팀으로 128강에 도전! 포켓몬 챔피언스 아레나 | 비공식 팬메이드
```

## 설명란

```text
메가진화, Z기술, 거다이맥스, 테라스탈.
나만의 드림팀과 당신의 한 수로 승부를 뒤집어 보세요!

이 영상은 비공식 팬메이드 웹게임 Pokémon Champions Arena의 소개 영상입니다.
게임 바로가기 → https://pokemon-champions-area-web.co.kr

1,025종의 포켓몬, 238명의 AI 트레이너, 344종의 배틀 아이템.
포켓몬의 조합과 도구, 기믹을 선택하고 싱글·더블배틀과 128강 토너먼트에 도전해 보세요.

영상에는 실제 게임 엔진으로 진행한 배틀과 포켓몬·트레이너·아이템 소개 연출을 담았습니다.
배틀은 촬영용으로 구성한 매치를 사용했습니다.

당신이라면 어떤 포켓몬과 기믹으로 팀을 만들고 싶나요? 댓글로 알려주세요!

⏱ 영상 순서
00:00 오프닝 · 1,025종의 포켓몬
00:18 238명의 AI 트레이너 · 128강 토너먼트
00:40 아이템으로 완성하는 전략
00:54 메가진화
01:06 Z기술
01:18 거다이맥스
01:30 테라스탈
01:42 더블·싱글배틀 · 다음 챔피언은 당신

🎵 음악 크레딧
Face The Champion! — Spring Spring
Produced by Julie Damsgaard/Spring Spring/Spring Enterprises @ https://spring-enterprises.neocities.org
원본: https://opengameart.org/content/face-the-champion
라이선스: Creative Commons Attribution 3.0 Unported (CC BY 3.0)
https://creativecommons.org/licenses/by/3.0/
편집: 원곡의 첫 122초 발췌, 시작·종료 페이드, 48 kHz 스테레오 변환, 음량 조정, 게임 효과음에 따른 음악 감쇠 및 혼합.
음악 사용 및 크레딧은 음악 제작자의 게임 후원이나 제휴를 의미하지 않습니다.

📌 비공식 팬메이드 안내
이 게임과 영상은 팬이 제작한 비공식 프로젝트입니다.
The Pokémon Company, Nintendo, Creatures, GAME FREAK의 공식 제품이나 공식 홍보 영상이 아니며, 해당 회사들과 제휴·후원 관계가 없습니다.
포켓몬 관련 캐릭터·명칭·이미지·음향의 권리는 각 권리자에게 있습니다.

#포켓몬팬게임 #팬메이드게임 #포켓몬배틀
```

## 업로드 참고

- 공식 작품으로 오해받지 않도록 제목의 `비공식 팬메이드`와 설명란의 안내를 유지합니다.
- 음악 크레딧은 출처 페이지의 제작자 표기, 원본 링크, 라이선스 링크와 편집 사실을 포함합니다. 공식 포켓몬 게임 BGM으로 소개하지 않습니다.
- 비공식·출처 표기는 사용 허락을 대신하지 않습니다. 이 문구만으로 영상이나 게임 전체의 저작권 문제가 해결되거나 Content ID 청구가 없어진다고 보장할 수 없습니다.
- 무료 이용, 비영리 운영, 수익화 여부는 이 문구에서 주장하지 않았습니다.
- 6~8초짜리 짧은 장면은 인접 주제로 묶었습니다. 챕터는 실제 편집 경계에서 시작하며 각 구간은 12~22초입니다.

## 제작 근거

- 영상 구성: `promo/timeline.json`의 13개 장면, 총 122초.
- 데이터 확인: `NATIONAL_DEX.length = 1025`, `TRAINERS.length = 238`, `BATTLE_ITEMS.length = 344`.
- 영상 확인: 실제 MP4의 SHA-256가 `promo/output/validation.json`의 `82512a8c363faf9c5f44c6e634eade6137f38d939bff01f1ed3c2589f2de0eed`와 일치합니다.
- BGM: `public/assets/audio/battle/battle-theme.ogg`. 로컬 SHA-256가 `promo/SOUNDTRACK.md`, `promo/generated/soundtrack.json`, 영상 검증 기록의 `5f9e9bbea3a3ce9023e13c148808787264365e673e99cbd7fc2addccc71f6540`와 일치합니다.
- 음악 출처 및 편집 기록: `promo/SOUNDTRACK.md`, `promo/scripts/prepareWebSoundtrack.mjs`, `promo/output/champions-arena-promo-credits.txt`. 업로드 문구에는 원본 출처 페이지의 요구 제작자 표기를 추가했습니다.
- 효과음·울음소리 출처: `public/assets/audio/battle/CREDITS.md`. 이 출처 문서는 포켓몬 캐릭터·스프라이트·울음소리 전체에 대한 별도 권리자 사용 허락을 제공하지 않습니다.
