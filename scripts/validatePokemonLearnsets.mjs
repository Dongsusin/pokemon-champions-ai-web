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

// Evolution must retain Frillish's legal egg move through training, saved-team
// normalization and battle construction, for both male and female profiles.
const strengthSap = getMoveById('strengthsap')
for (const slug of ['frillish', 'frillish-f', 'jellicent', 'jellicent-f']) {
  const profile = profiles.find((candidate) => candidate.slug === slug)
  const saved = { captureId: `learnset-validation-${slug}`, speciesId: profile?.id, moves: [strengthSap.name] }
  const normalized = normalizePokemon(saved)
  const battlePokemon = createBattlePreviewPokemon(normalized)
  if (!profile || !canPokemonLearnMove(profile.id, strengthSap.name)
    || normalized.moves[0] !== strengthSap.name || battlePokemon.moves[0]?.id !== strengthSap.id) {
    failures.push(`${slug}: 합법적인 힘흡수가 트레이닝/저장/배틀에서 유지되지 않음`)
  }
}
for (const speciesId of [25, 132, 321]) {
  if (canPokemonLearnMove(speciesId, strengthSap.name)) {
    failures.push(`${speciesId}: 힘흡수 보완이 관련 없는 포켓몬에 적용됨`)
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
