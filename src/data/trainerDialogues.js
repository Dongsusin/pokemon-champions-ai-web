export const TRAINER_DIALOGUE_EVENTS = Object.freeze({
  START: 'start',
})

const CURATED_START_DIALOGUES = Object.freeze({
  레드: '…시작하지.',
  그린: '내가 왜 한발 앞인지 보여주지!',
  실버: '약한 방식은 통하지 않아. 덤벼.',
  목호: '용의 기세를 견딜 각오는 되어 있나?',
  성호: '단단함과 아름다움, 어느 쪽도 놓치지 않겠어.',
  난천: '서로의 선택이 어떤 결말을 만드는지 지켜보죠.',
  아이리스: '좋아! 서로 마음껏 강함을 보여주자!',
  카르네: '한 장면 한 장면, 멋진 승부로 완성해 봐요.',
  쿠쿠이박사: '기술도 마음도 전부 부딪쳐 보자고!',
  단델: '관중이 없어도 최고의 챔피언 매치를 만들자!',
  테사: '당신의 실력을 정식으로 평가하겠습니다.',
  N: '네 포켓몬이 바라는 승부인지, 직접 들어볼게.',
  게치스: '네 선택 따위는 이미 내 계획 안에 있다!',
  비주기: '승부도 조직도, 힘 있는 자가 지배하는 법이지.',
  월로: '자, 이 승부 끝에서 어떤 진실이 나타날까요?',
  지우: '좋아! 우리답게 끝까지 부딪쳐 보자!',
  리코: '두렵더라도, 내 방식으로 한 걸음 나아갈게.',
  네모: '드디어 시작이네! 처음부터 전력으로 와 줘!',
  카지: '이번에는 반드시 내 힘을 증명하겠어.',
  청목: '업무라 생각하고 효율적으로 끝내겠습니다.',
  진철: '쓸모없는 움직임은 버려. 결과만 본다.',
  알랭: '더 강해지기 위해, 이 승부에 전부 걸겠다.',
  구즈마: '모조리 박살 내는 승부가 뭔지 보여주지!',
  릴리에: '저도 더는 숨지 않을게요. 함께 맞서겠어요.',
  '로사&로이': '우아하고 화려한 승리는 바로 우리 차지!',
  '덴트&콘&팟': '세 가지 스타일의 풀코스를 맛보게 해 드리죠!',
  아크로마: '포켓몬의 힘을 끌어내는 변수, 직접 측정하겠습니다.',
  택트: '어둠 너머의 힘까지 감당할 수 있겠나?',
  채하루: '우리의 호흡을 믿고, 즐겁게 시작해 보자!',
})

const VOICE_GROUPS = [
  {
    id: 'energetic-rival',
    names: new Set(['태주', '보연', '심향', '금선', '휘웅', '봄이', '광휘', '빛나', '투지', '투희', '공명', '명희', '칼름', '세레나', '공준', '새아', '영태', '미월', '승재', '우리', '영빈', '윤슬', '보민', '푸름', '진우', '하우', '호브', '사나', '티에르노', '트로바', '고우']),
    lines: ['좋아, 망설이지 말고 최고의 승부를 만들자!', '우리 팀의 호흡을 믿고 정면으로 갈게!', '준비됐지? 서로 후회 없이 전력을 내자!'],
  },
  {
    id: 'champion',
    names: new Set(['노간주', '카틀레야', '테사', '할라', '마스터드', '피오니', '마적', '아강', '기선', '윤진', '아단', '사간', '금랑']),
    lines: ['도전자의 각오, 이 무대에서 확인하겠습니다.', '정점의 무게까지 받아낼 준비가 되었습니까?', '서로의 완성도를 전력으로 겨뤄 보죠.'],
  },
  {
    id: 'villain',
    names: new Set(['아폴로', '태홍', '플라드리', '루자미네', '로즈', 'J', '자우보', '마적', '아강', '카라스바']),
    lines: ['방해자는 계획에서 제거할 뿐이다.', '네 의지로 이미 정해진 결말을 바꿀 수 있을까?', '이 힘 앞에서 네 선택은 아무 의미도 없다.'],
  },
  {
    id: 'researcher',
    names: new Set(['오박사', '체렌', '벨', '시트론', '마마네', '멀레인', '자크로', '곤포']),
    lines: ['실전에서만 확인할 수 있는 가능성을 살펴보죠!', '서로의 선택이 어떤 결과를 만드는지 기록하겠습니다.', '좋습니다. 이 승부로 새로운 답을 찾아보죠!'],
  },
  {
    id: 'mystic',
    names: new Set(['국화', '일목', '카렌', '망초', '아세로라', '어니언', '코지카', '피아나', '사비', '마티에르']),
    lines: ['보이지 않는 흐름까지 읽을 수 있을까요?', '고요한 기운이 움직이기 시작했군요.', '마음속 그림자까지 마주할 준비를 하세요.'],
  },
  {
    id: 'performer',
    names: new Set(['루티아', '마슈', '파키라', '카밀레', '멜리사', '라임', '모야모', '포플러', '머스캣']),
    lines: ['관객의 시선을 사로잡을 멋진 무대를 만들어요!', '기술과 연출, 승리까지 완벽하게 보여드리죠!', '자, 우리만의 배틀 쇼를 시작해 볼까요?'],
  },
  {
    id: 'martial',
    names: new Set(['시바', '독수', '연무', '사도', '철구', '자두', '코르니', '채두', '할라', '철권', '동백']),
    lines: ['정면으로 부딪쳐 서로의 단련을 증명하자!', '기술보다 먼저 마음의 자세를 보겠다!', '한계까지 단련한 힘, 여기서 겨뤄 보자!'],
  },
  {
    id: 'calm',
    names: new Set(['칸나', '들국화', '오엽', '블래리', '드라세나', '나누', '카일리', '하푸우', '마리', '모란', '칠리', '뽀삐', '팔자크', '타로', '하솔', '네리네', '제빈', '리파', '그루샤', '핸섬']),
    lines: ['서두르지 않고 정확하게 승부하겠습니다.', '상대의 선택을 존중하며 제 방식대로 가죠.', '차분히 한 수씩 확인해 보겠습니다.'],
  },
]

const DEFAULT_START_LINES = Object.freeze([
  '{typePlan}과 {ace}의 힘을 믿고 승부하겠습니다!',
  '준비는 끝났습니다. {typePlan}을 제대로 보여드리죠!',
  '좋습니다. 서로의 포켓몬을 믿고 시작하죠!',
])

const TYPE_THEMES = Object.freeze({
  불꽃: '뜨겁게 몰아붙이는 불꽃의 흐름',
  물: '상대에 맞춰 유연하게 바뀌는 물의 흐름',
  풀: '차근차근 전장을 장악하는 풀의 흐름',
  전기: '순간의 틈을 놓치지 않는 전격 전술',
  얼음: '상대의 움직임을 차갑게 봉쇄하는 전술',
  격투: '정면에서 한계를 돌파하는 전술',
  독: '시간이 갈수록 압박을 더하는 전술',
  땅: '흔들리지 않는 기반 위의 전술',
  비행: '속도와 위치를 자유롭게 바꾸는 전술',
  에스퍼: '몇 수 앞을 내다보는 전술',
  벌레: '작은 기회를 연쇄적으로 잇는 전술',
  바위: '단단한 수비에서 시작하는 전술',
  고스트: '보이지 않는 틈을 파고드는 전술',
  드래곤: '압도적인 힘으로 주도권을 잡는 전술',
  악: '상대의 허점을 집요하게 노리는 전술',
  강철: '빈틈없이 단단하게 맞물린 전술',
  페어리: '예측을 비트는 신비로운 전술',
  노말: '기본에 충실하며 변화에 대응하는 전술',
})

function hashText(value) {
  let hash = 2166136261
  for (const character of String(value)) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function findVoiceGroup(trainer) {
  const namedGroup = VOICE_GROUPS.find((group) => group.names.has(trainer?.name))
  if (namedGroup) return namedGroup
  if (trainer?.tier === 'S' || trainer?.tier === 'A') {
    return VOICE_GROUPS.find((group) => group.id === 'champion')
  }
  return null
}

function interpolateDialogue(template, trainer, context) {
  const specialty = context.specialty ?? trainer?.specialties?.[0] ?? null
  const ace = context.aceName ?? trainer?.ace?.name ?? context.activeName ?? '에이스'
  const typePlan = TYPE_THEMES[specialty]
    ?? (specialty ? `${specialty} 타입의 흐름` : '우리 팀의 흐름')

  return String(template)
    .replaceAll('{trainer}', trainer?.name ?? '트레이너')
    .replaceAll('{ace}', ace)
    .replaceAll('{type}', specialty ?? '주력')
    .replaceAll('{typePlan}', typePlan)
}

export function getTrainerDialogue(trainer, eventId = TRAINER_DIALOGUE_EVENTS.START, context = {}) {
  if (eventId !== TRAINER_DIALOGUE_EVENTS.START) return null

  const curated = CURATED_START_DIALOGUES[trainer?.name]
  const voiceGroup = findVoiceGroup(trainer)
  const candidates = curated ? [curated] : voiceGroup?.lines ?? DEFAULT_START_LINES
  const seed = hashText(`${trainer?.id ?? trainer?.name ?? 'trainer'}:start`)
  const template = candidates[seed % candidates.length]

  return {
    id: `${trainer?.id ?? trainer?.name ?? 'trainer'}-start`,
    eventId: TRAINER_DIALOGUE_EVENTS.START,
    tone: 'start',
    trainerName: trainer?.name ?? '트레이너',
    text: interpolateDialogue(template, trainer, context),
  }
}
