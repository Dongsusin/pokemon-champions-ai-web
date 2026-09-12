const graphemes = new Intl.Segmenter('ko', { granularity: 'grapheme' })
const cleanName = name => typeof name === 'string' ? name.normalize('NFC')
  .replace(/[\p{Cc}\p{Cs}\p{Bidi_Control}\u00ad\u180e\u200b\u2060-\u2064\ufeff]/gu, '').trim() : ''

export function maskRankedTrainerName(name) {
  const first = [...graphemes.segment(cleanName(name))]
    .find(({ segment }) => /[^\p{M}\p{Cf}\s]/u.test(segment))?.segment
  return `${first || '트'}**`
}

const trainerNames = (value, extra = []) => [...new Set([
  ...extra, value?.you?.name, value?.player?.name, value?.opponent?.name, value?.opponentMeta?.name,
].filter(name => typeof name === 'string' && name))].sort((first, second) => second.length - first.length)

// Legacy battle messages have a handful of explicit trainer positions. Never
// replace a nickname globally: a trainer can also be named after a Pokemon.
export function maskRankedTrainerText(message, names = []) {
  if (typeof message !== 'string') return message
  const candidates = trainerNames(null, names)
  for (const first of candidates) for (const second of candidates) {
    if (message === `${first} vs ${second}, 레이팅 배틀 시작!`) {
      return `${maskRankedTrainerName(first)} vs ${maskRankedTrainerName(second)}, 레이팅 배틀 시작!`
    }
  }
  for (const name of candidates) {
    if (!message.startsWith(name)) continue
    const rest = message.slice(name.length)
    const trainerPosition = /^은\(는\) .+을\(를\) (?:내보냈다|불러들였다)!$/u.test(rest)
      || /^ 진영에 .+(?:의 효과가 펼쳐졌다!|가 펼쳐졌다!|이\(가\) 설치되었다!)$/u.test(rest)
      || /^ 진영이 .+을\(를\) 막아냈다!$/u.test(rest)
      || /^ 진영의 .+ 효과가 사라졌다\.$/u.test(rest)
      || rest === ' 팀의 상태 이상이 회복되었다!'
      || rest === '의 그 위치에는 이미 미래의 공격이 예정되어 있다!'
      || rest === '의 승리!'
      || rest === '과의 승부에서 이겼다!'
      || rest === '에게 패배했다…'
      || /^: (?:되살릴|다음) 포켓몬을 선택하고 있습니다\.$/u.test(rest)
      || /^의 .+이\(가\) .+타입으로 테라스탈했다!$/u.test(rest)
      || /^의 .+이\(가\) (?:거다이맥스|다이맥스)했다!$/u.test(rest)
      || /^의 .+! (?:메가진화|원시회귀) 성공!$/u.test(rest)
      || /^와 .+의 전력! Z파워가 기술에 모인다!$/u.test(rest)
    if (trainerPosition) return `${maskRankedTrainerName(name)}${rest}`
  }
  return message
}

function opaqueLogId(value) {
  // A stable, non-display key avoids collisions when two different trainer
  // names have the same public initial. Never put the original text in the ID.
  let first = 2166136261, second = 2246822519
  for (const character of String(value)) {
    const point = character.codePointAt(0)
    first = Math.imul(first ^ point, 16777619)
    second = Math.imul(second ^ point, 3266489917)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function maskLog(log, names) {
  if (!Array.isArray(log)) return log
  return log.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return entry
    const message = maskRankedTrainerText(entry.message, names)
    // appendLog embeds its original message in the ID. Preserve only an opaque
    // key and the public text, including when client and server both mask it.
    const existingKey = typeof entry.id === 'string' ? entry.id.match(/^ranked-log-v1-([a-f0-9]{16})-/)?.[1] : null
    const key = existingKey ?? opaqueLogId(entry.id ?? `${index}-${entry.message ?? ''}`)
    return { ...entry, message, id: `ranked-log-v1-${key}-${message ?? ''}` }
  })
}

const maskNamedTrainer = value => value && typeof value === 'object'
  ? { ...value, name: maskRankedTrainerName(value.name) } : value

export function maskRankedBattleState(state, names = []) {
  if (!state || typeof state !== 'object') return state
  const known = trainerNames(state, names)
  return {
    ...state,
    ...(state.player ? { player: maskNamedTrainer(state.player) } : {}),
    ...(state.opponent ? { opponent: maskNamedTrainer(state.opponent) } : {}),
    ...(state.opponentMeta ? { opponentMeta: maskNamedTrainer(state.opponentMeta) } : {}),
    ...(state.log ? { log: maskLog(state.log, known) } : {}),
  }
}

export function maskRankedTimelineStep(step, names = []) {
  if (!step || typeof step !== 'object') return step
  const known = trainerNames(step.state, names)
  return {
    ...step,
    ...(typeof step.message === 'string' ? { message: maskRankedTrainerText(step.message, known) } : {}),
    ...(step.state ? { state: maskRankedBattleState(step.state, known) } : {}),
  }
}

export function maskRankedMatch(match) {
  if (!match || typeof match !== 'object') return match
  let names = trainerNames(match)
  names = trainerNames(match.state, names)
  for (const step of match.timeline ?? []) names = trainerNames(step?.state, names)
  return {
    ...match,
    ...(match.you ? { you: maskNamedTrainer(match.you) } : {}),
    ...(match.opponent ? { opponent: maskNamedTrainer(match.opponent) } : {}),
    ...(match.state ? { state: maskRankedBattleState(match.state, names) } : {}),
    ...(Array.isArray(match.timeline) ? { timeline: match.timeline.map(step => maskRankedTimelineStep(step, names)) } : {}),
  }
}
