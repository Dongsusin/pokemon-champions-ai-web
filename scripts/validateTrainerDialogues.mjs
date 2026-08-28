import { TRAINERS } from '../src/data/trainerTeams.js'
import { getTrainerDialogue, TRAINER_DIALOGUE_EVENTS } from '../src/data/trainerDialogues.js'

const events = Object.values(TRAINER_DIALOGUE_EVENTS)
const placeholderPattern = /\{[^}]+\}/
const errors = []
const dialogueTexts = new Set()

for (const trainer of TRAINERS) {
  for (const eventId of events) {
    const dialogue = getTrainerDialogue(trainer, eventId, {
      aceName: trainer.ace?.name,
      activeName: trainer.teams?.[0]?.pokemon?.[0]?.name,
      turn: 4,
    })

    if (!dialogue.text?.trim()) errors.push(`${trainer.name}/${eventId}: 빈 대사`)
    if (placeholderPattern.test(dialogue.text)) errors.push(`${trainer.name}/${eventId}: 치환되지 않은 변수`)
    if (dialogue.text.length > 90) errors.push(`${trainer.name}/${eventId}: 대사가 너무 김 (${dialogue.text.length})`)
    dialogueTexts.add(dialogue.text)
  }
}

const minimumUniqueDialogueCount = Math.min(TRAINERS.length, 30)
if (dialogueTexts.size < minimumUniqueDialogueCount) {
  errors.push(`시작 대사 다양성이 부족함: ${dialogueTexts.size}/${minimumUniqueDialogueCount}`)
}

if (getTrainerDialogue(TRAINERS[0], 'mid', {}) !== null) {
  errors.push('배틀 시작 외 NPC 대사가 남아 있음')
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`트레이너 ${TRAINERS.length}명 시작 대사 검증 완료 (${dialogueTexts.size}개 고유 대사)`)
}
