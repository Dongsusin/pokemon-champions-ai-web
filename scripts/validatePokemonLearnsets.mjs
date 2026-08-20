import {
  NATIONAL_DEX,
  SPECIES_PROFILES,
  canPokemonLearnMove,
  getDefaultMoves,
  getLearnableMoves,
  getMoveById,
  normalizePokemon,
} from '../src/data/trainingData.js'
import { createBattlePreviewPokemon } from '../src/data/battleEngine.js'

const profiles = Object.values(SPECIES_PROFILES)
const failures = []

for (const profile of profiles) {
  const learnableMoves = getLearnableMoves(profile.id)
  const learnableMoveNames = new Set(learnableMoves.map((move) => move.name))
  const defaultMoves = getDefaultMoves(profile.id)
  const normalized = normalizePokemon({ speciesId: profile.id, moves: defaultMoves })

  if (learnableMoves.length === 0) {
    failures.push(`${profile.name}(${profile.id}): 매핑 가능한 학습 기술 없음`)
    continue
  }

  if (defaultMoves.length === 0 || defaultMoves.length > 4) {
    failures.push(`${profile.name}(${profile.id}): 기본 기술 수 ${defaultMoves.length}`)
  }

  if (new Set(defaultMoves).size !== defaultMoves.length) {
    failures.push(`${profile.name}(${profile.id}): 기본 기술 중복`)
  }

  for (const moveName of [...defaultMoves, ...normalized.moves]) {
    if (!learnableMoveNames.has(moveName) || !canPokemonLearnMove(profile.id, moveName)) {
      failures.push(`${profile.name}(${profile.id}): 배울 수 없는 기술 ${moveName}`)
    }
  }
}

const surf = getMoveById('surf')
const transform = getMoveById('transform')
const dittoPreview = createBattlePreviewPokemon({
  captureId: 'learnset-validation-ditto',
  speciesId: 132,
  moves: [surf.name, transform.name],
})

if (dittoPreview.moves.length !== 1 || dittoPreview.moves[0].id !== transform.id) {
  failures.push('메타몽: 배틀 생성 과정에서 불법 기술이 제거되지 않음')
}

if (failures.length > 0) {
  console.error(failures.slice(0, 30).join('\n'))
  if (failures.length > 30) console.error(`외 ${failures.length - 30}건`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `Validated ${NATIONAL_DEX.length} species and ${profiles.length - NATIONAL_DEX.length} forms with legal learnsets.\n`,
  )
}
