# 배틀팩토리 NPC 투명 이미지

- 원본: `public/assets/trainers/factory-clown.png` — 사용자가 제공한 440×440 이미지, 보존.
- 적용: `public/assets/trainers/factory-clown-cutout.png` — 같은 크기의 RGBA PNG.
- 출처·해시·알파 검사: `public/assets/trainers/factory-clown-cutout.json`.
- 재현: `uv run --with pillow --with numpy --with scipy python scripts/extractFactoryTrainer.py`.

편집 요구는 **원본 캐릭터의 얼굴·포즈·색·흰 의상·공을 유지하고 주변 흰 배경만 투명하게 제거**하는 것입니다. 기본 imagegen 도구로 두 번 시도했으나 실제 알파 대신 체크무늬가 포함된 RGB 결과가 반환되어 해당 결과는 게임과 영상에 사용하지 않았습니다. 사용자가 원본에 직접 배경 제거를 진행하도록 승인한 뒤 일반 이미지 처리를 적용했습니다. CLI 이미지 생성/API 방식은 사용하지 않았습니다.

바깥과 연결된 흰색 영역을 제거하고 작은 압축 잡음과 가장자리의 흰색 잔상을 정리했습니다. 원본 해상도와 내부 RGB 픽셀은 유지하며 새로운 그림을 생성하거나 의상을 다시 그리지 않습니다. 캐릭터의 흰색 부분을 일괄 투명화하지 않습니다.

로비·AI 대전 인트로·홍보 영상이 같은 투명 자산을 사용합니다. 인물 이미지 주위의 흰 배경·테두리·사진 프레임을 제거하고 기존 AI 트레이너처럼 배치했습니다. 새 파일명으로 참조하여 이전 불투명 이미지 캐시와 구별합니다.

`scripts/validateBattleFactoryUi.mjs`에서 실제 PNG 알파와 로비·전투 인물 컨테이너의 투명 배경·테두리를 확인하며 데스크톱과 모바일 화면을 캡처합니다. 홍보 영상은 변경된 UI에서 다시 촬영합니다.
