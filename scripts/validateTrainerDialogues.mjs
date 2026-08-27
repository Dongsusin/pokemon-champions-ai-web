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

if (dialogueTexts.size < TRAINERS.length) {
  errors.push(`전체 대사 다양성이 부족함: ${dialogueTexts.size}/${TRAINERS.length}`)
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`트레이너 ${TRAINERS.length}명 × 상황 ${events.length}종 대사 검증 완료 (${dialogueTexts.size}개 고유 대사)`)
}
