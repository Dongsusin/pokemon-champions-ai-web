import { createHash } from 'node:crypto'
import { TRAINERS } from '../src/data/trainerTeams.js'
import { getTrainerSpriteCandidates } from '../src/data/trainerSprites.js'

const trainerById = new Map(TRAINERS.map(trainer => [trainer.id, trainer]))
const eligibleTrainers = TRAINERS.filter(trainer => trainer.teams?.some(team => team.pokemon?.length)
  && getTrainerSpriteCandidates(trainer).length)

function randomStream(seed) {
  let value = createHash('sha256').update(`raid-trainers:${seed}`).digest().readUInt32LE(0)
  return () => {
    value += 0x6D2B79F5
    let mixed = value
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61)
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296
  }
}

// Store catalog coordinates rather than accepting a client-authored NPC or
// copying every AI team into each room. Names and portraits use the same
// catalog as AI battles; the selected set is restored by the battle server.
export function getRaidNpcTrainer(assignment) {
  const trainer = trainerById.get(assignment?.trainerId)
  const team = trainer?.teams.find(candidate => candidate.number === assignment?.teamNumber)
  const pokemon = Number.isInteger(assignment?.pokemonIndex) ? team?.pokemon[assignment.pokemonIndex] : null
  if (!trainer || !pokemon) return null
  return {
    trainerId: trainer.id,
    trainer: { id: trainer.id, name: trainer.name, tier: trainer.tier, region: trainer.region },
    name: trainer.name,
    image: getTrainerSpriteCandidates(trainer)[0] ?? null,
    teamNumber: team.number,
    pokemonIndex: assignment.pokemonIndex,
    speciesId: pokemon.speciesId,
  }
}

export function getRaidNpcLoadout(assignment) {
  const profile = getRaidNpcTrainer(assignment)
  if (!profile) return null
  const trainer = trainerById.get(profile.trainerId)
  const team = trainer.teams.find(candidate => candidate.number === profile.teamNumber)
  return structuredClone(team.pokemon[profile.pokemonIndex])
}

export function createRaidNpcAssignments(seed) {
  if (eligibleTrainers.length < 2) throw new Error('At least two AI trainers are required for raid partners.')
  const random = randomStream(seed)
  const candidates = [...eligibleTrainers]
  return Array.from({ length: 2 }, () => {
    const trainer = candidates.splice(Math.floor(random() * candidates.length), 1)[0]
    const teams = trainer.teams.filter(team => team.pokemon?.length)
    const team = teams[Math.floor(random() * teams.length)]
    const aceIndexes = team.pokemon.flatMap((pokemon, index) => (
      pokemon.speciesId === trainer.ace?.speciesId || pokemon.dexSpeciesId === trainer.ace?.dexSpeciesId
        ? [index] : []
    ))
    const indexes = aceIndexes.length ? aceIndexes : team.pokemon.map((_, index) => index)
    return getRaidNpcTrainer({ trainerId: trainer.id, teamNumber: team.number,
      pokemonIndex: indexes[Math.floor(random() * indexes.length)] })
  })
}

// Old local waiting rooms get the same pair on every read and server restart.
// Newly created rooms persist the assignments once, before any player readies.
export function getRaidNpcAssignments(room) {
  const persisted = Array.isArray(room?.npcTrainers) ? room.npcTrainers.map(getRaidNpcTrainer).filter(Boolean) : []
  if (persisted.length === 2 && persisted[0].trainerId !== persisted[1].trainerId) return persisted
  return createRaidNpcAssignments(room?.id ?? 'raid-room')
}
