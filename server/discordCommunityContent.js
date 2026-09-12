const GAME_URL = 'https://pokemon-champions-area-web.co.kr'
const COLOR = 0x31c5ed

export const COMMUNITY_CHANNELS = [
  { key: 'free', name: '자유게시판', topic: '포켓몬, 팀 조합, AI 배틀 이야기와 가벼운 인사를 나눠요. /안내로 게임과 채널 안내를 확인할 수 있어요.' },
  { key: 'bug', name: '오류신고', topic: '/오류로 이상한 동작과 재현 방법을 알려주세요. 스크린샷·영상과 추가 설명은 해당 제보의 스레드에 남겨주세요.' },
  { key: 'idea', name: '개선제안', topic: '/개선으로 더 편하고 재미있는 게임을 위한 아이디어를 남겨주세요. 관련 의견은 각 제안의 스레드에서 나눠요.' },
  { key: 'update', name: '업데이트내역', topic: '새 기능, 배틀 수정과 사용성 개선 소식입니다. 운영진이 /업데이트로 확인된 변경 내용을 안내합니다.' },
]

function channelLink(channelIds, key) {
  const id = String(channelIds?.[key] ?? '')
  return /^\d{17,20}$/.test(id) ? `<#${id}>` : `#${COMMUNITY_CHANNELS.find(channel => channel.key === key).name}`
}

function guide(key, title, description, fields = []) {
  return {
    embeds: [{ color: COLOR, title, description, ...(fields.length ? { fields } : {}),
      footer: { text: `champions-community:${key}:v1` } }],
    allowed_mentions: { parse: [] },
  }
}

export function buildCommunityGuides(channelIds = {}) {
  const channels = Object.fromEntries(COMMUNITY_CHANNELS.map(({ key }) => [key, channelLink(channelIds, key)]))
  const directory = [
    `💬 ${channels.free} — 인사와 팀·배틀 이야기`,
    `🐛 ${channels.bug} — 오류 제보와 확인`,
    `💡 ${channels.idea} — 개선 아이디어와 의견`,
    `📢 ${channels.update} — 새 기능과 수정 소식`,
  ].join('\n')

  return {
    free: guide('free', '포켓몬 챔피언스 아레나에 오신 것을 환영합니다!',
      `좋아하는 포켓몬, 팀 조합, AI 배틀 경험을 편하게 나눠주세요.\n\n🎮 [게임 바로가기](${GAME_URL})`, [
        { name: '어디에 이야기하면 될까요?', value: directory },
        { name: '필요한 명령어', value: '`/안내` 게임과 채널 안내 · `/오류` 오류 제보 · `/개선` 개선 아이디어' },
        { name: '함께 지켜요', value: '서로 존중하며 이야기해 주세요. 같은 내용의 반복 게시와 무관한 광고는 삼가 주세요.' },
      ]),
    bug: guide('bug', '오류를 발견하셨나요?',
      '`/오류`로 제보를 작성해주세요. 작성한 글에 생기는 스레드에서 추가 설명과 확인 내용을 이어갈 수 있어요.', [
        { name: '알려주시면 좋아요', value: '• 어떤 화면이나 배틀에서 발생했나요?\n• 어떤 순서로 눌렀나요?\n• 기대한 동작과 실제 결과는 무엇인가요?\n• PC/모바일, 브라우저 이름을 알려주세요.\n배틀 문제라면 관련 포켓몬·기술·특성·도구도 적어주세요.' },
        { name: '스크린샷과 추가 자료', value: '스크린샷, 짧은 영상, 배틀 로그는 제보 스레드에 첨부해주세요. 기억나는 내용만 적어도 괜찮고, 한 글에는 한 가지 문제를 부탁드려요.' },
        { name: '이미 같은 제보가 있다면', value: '기존 글의 스레드에 경험이나 자료를 보태주세요. 비밀번호·인증번호·이메일 등 개인정보는 적지 말고, 첨부 화면에 보이면 가려주세요.' },
        { name: '다른 이야기', value: `아이디어는 ${channels.idea}에서 \`/개선\`, 일반적인 대화는 ${channels.free}에서 나눠주세요.` },
      ]),
    idea: guide('idea', '어떤 점이 달라지면 더 좋을까요?',
      '`/개선`으로 바꾸거나 추가했으면 하는 점을 알려주세요. 작성한 제안의 스레드에서 관련 의견을 나눌 수 있어요.', [
        { name: '간단히 적어주세요', value: '• 제안: 바꾸거나 추가했으면 하는 것\n• 이유: 어떤 상황에서 도움이 되는지\n• 예시(선택): 원하는 동작이나 참고 화면' },
        { name: '함께 의견을 모아요', value: '비슷한 제안이 있다면 반응이나 스레드 답변으로 의견을 보태주세요. 참고 스크린샷도 스레드에 첨부할 수 있습니다.' },
        { name: '오류와 새 소식', value: `현재 동작의 오류는 ${channels.bug}에서 \`/오류\`, 반영된 변경은 ${channels.update}에서 확인해주세요.` },
      ]),
    update: guide('update', '게임 업데이트 안내',
      '게임에 반영한 새 기능과 수정 내용을 날짜별로 안내합니다. 운영진이 확인된 내용을 `/업데이트`로 게시합니다.', [
        { name: '의견을 남기려면', value: `궁금한 점은 ${channels.free}, 오류는 ${channels.bug}의 \`/오류\`, 아이디어는 ${channels.idea}의 \`/개선\`을 이용해주세요.` },
        { name: '게임 바로가기', value: GAME_URL },
      ]),
  }
}

// Verified against commits f96792c and 82b5bf3; do not describe planned features
// as shipped changes. The footer identifies this exact initial update for upsert.
export const INITIAL_UPDATE = {
  embeds: [{
    color: COLOR,
    title: '최근 업데이트 — 더블 배틀과 기술 효과 수정',
    description: `확인된 배틀 문제와 사용성을 개선했습니다.\n[게임 바로가기](${GAME_URL})`,
    fields: [
      { name: '2026.09.12 · 더블 배틀 명령과 대상 처리', value: [
        '• 교체를 선택한 뒤 다음 아군의 기술 선택으로 이어지도록 수정했습니다.',
        '• 두 자리에서 같은 벤치를 중복 선택할 수 없게 하고, 먼저 고른 포켓몬에 ‘교대 예약’을 표시합니다.',
        '• 집중 공격의 첫 공격으로 적이 쓰러지면, 다음 단일 공격은 다른 공격 가능한 상대에게 향합니다.',
        '• 게임 내 오류 신고 메뉴를 제거했습니다. 새 제보는 이 서버에서 `/오류`를 이용해주세요.',
      ].join('\n') },
      { name: '2026.09.11 · 배틀 효과와 기믹 사용성', value: [
        '• 풍선의 땅 기술 면역과 소모 조건을 바로잡았습니다.',
        '• 사이코필드에서 접지한 사용자의 와이드포스가 상대 전체를 공격하도록 수정했습니다.',
        '• 생명의물방울·멀리짖기 등 아군 범위 기술의 대상별 효과와 회복을 수정했습니다.',
        '• 테라스탈·다이맥스·메가진화·선택형 원시회귀가 일반 교체 후, 기술 사용 전에 발동합니다. 변신한 타입·HP·스피드·특성이 해당 턴부터 반영됩니다.',
        '• 아군 HP 패널·파티 메뉴·테라 버튼에서 사용 전 테라타입을 확인할 수 있습니다.',
      ].join('\n') },
    ],
    footer: { text: 'champions-community:update:f96792c' },
  }],
  allowed_mentions: { parse: [] },
}
