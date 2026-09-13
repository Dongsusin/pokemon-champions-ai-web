# Champions Arena — 레이팅·통계 업데이트 영상 크레딧

이 파일의 음악 표기를 영상 업로드 설명이나 영상과 함께 제공하는 크레딧에 포함해 주세요. 영상 안에는 작은 제작 설명·크레딧 문구를 넣지 않습니다.

## 음악

- **Face The Champion! — Spring Spring**
- 원저작자 표기: **Produced by Julie Damsgaard / Spring Spring / Spring Enterprises**
- 원문: https://opengameart.org/content/face-the-champion
- 제작자: https://spring-enterprises.neocities.org
- 선택 라이선스: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)** — https://creativecommons.org/licenses/by/3.0/
- 사용 파일: 현재 웹게임의 `public/assets/audio/battle/battle-theme.ogg`
- 편집: 원곡 앞부분 발췌, 0.2초 페이드 인·1.6초 페이드 아웃, 음량 정규화, 48 kHz 스테레오 변환 및 최종 영상의 효과음 믹싱.
- 원문과 라이선스 확인일: **2026-09-13**. 최종 발췌 길이·음량·원본 해시는 생성된 `generated/music.json`에 기록됩니다.

업로드 설명에 사용할 표기:

> Music: “Face The Champion!” by Spring Spring. Produced by Julie Damsgaard / Spring Spring / Spring Enterprises (https://spring-enterprises.neocities.org). Licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://opengameart.org/content/face-the-champion . Edited for this update trailer: excerpt, fades, loudness adjustment, resampling and procedural transition-effects mix. The music creator does not endorse this project.

## 게임 화면과 효과음

게임 화면은 이 저장소의 Champions Arena에서 촬영합니다. 촬영용 계정·대전·통계 표본을 사용하는 장면은 실제 서비스 전체 유저 수나 사용률 수치를 증명하는 자료가 아닙니다. 사용률 화면의 기능과 동작을 소개하기 위한 장면입니다.

이번 영상의 전환 효과음 `generated/whoosh.wav`, `generated/impact.wav`, `generated/chime.wav`는 `scripts/prepareAudio.mjs`에서 노이즈 필터, 사인파와 진폭·주파수 변화를 이용해 절차적으로 합성했습니다. 외부 녹음, 상용 게임 사운드 샘플, 사운드폰트를 사용하지 않았습니다. 각각 스테레오 48 kHz, 최대 피크 −14 dBFS로 생성하고 최종 편집에 맞춰 배치합니다.

게임 화면 촬영본은 무음으로 사용하며, 연속 BGM과 위 전환 효과음을 별도로 합성합니다. 포켓몬 이름·이미지 및 관련 시청각 자료의 권리는 각 권리자에게 있습니다.

본 프로젝트는 **비공식 팬메이드 게임**입니다. Pokémon, Nintendo, GAME FREAK, Creatures 및 원저작권자와 공식적인 제휴·후원 관계가 없으며, 공식 Pokémon Champions의 광고가 아닙니다. 음악 라이선스는 포켓몬 이름·캐릭터·이미지 등 다른 자료의 권리까지 허락하는 것은 아닙니다.
