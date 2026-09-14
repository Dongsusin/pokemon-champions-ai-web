import { getSpeciesProfile } from './trainingData.js'

const STATUS = { burn: '화상', poison: '독', toxic: '맹독', paralysis: '마비', sleep: '잠듦', freeze: '얼음' }
const menuPreview = move => ({ ...move, power: Number.isFinite(move?.power) ? Math.round(move.power) : move?.power })
export function activeRaidActors(battle, sideId) {
  const direct = battle?.[sideId === 'player' ? 'allies' : 'enemies']
  if (Array.isArray(direct)) return direct
  const side = battle?.[sideId]
  return (side?.activeIndexes ?? []).map(index => side.team[index]).filter(Boolean)
}

export function normalizeRaidActor(actor = {}) {
  const profile = getSpeciesProfile(actor.speciesId)
  return { ...actor, battleId: actor.battleId ?? actor.actorId, actorId: actor.actorId ?? actor.battleId,
    name: actor.name ?? profile?.name ?? '포켓몬', types: actor.types ?? profile?.types ?? [],
    hp: actor.hp ?? 0, maxHp: actor.maxHp ?? 1, moves: actor.moves ?? [],
    status: typeof actor.status === 'string' ? { id: actor.status, label: STATUS[actor.status] ?? actor.status } : actor.status,
    icon: actor.icon ?? profile?.icon, iconFallback: actor.iconFallback ?? profile?.iconFallback,
    spriteFront: actor.spriteFront ?? profile?.spriteFront, spriteBack: actor.spriteBack ?? profile?.spriteBack,
    spriteFrontFallback: actor.spriteFrontFallback ?? profile?.spriteFrontFallback,
    spriteBackFallback: actor.spriteBackFallback ?? profile?.spriteBackFallback,
  }
}

// Adapt the public command projection to the existing battle menus. Missing
// variants remain disabled; the client never guesses a server-legal action.
export function createRaidCommandBattle(battle, raid) {
  const player = activeRaidActors(battle, 'player').map(normalizeRaidActor)
  const opponent = activeRaidActors(battle, 'opponent').map(normalizeRaidActor)
  const ownId = raid?.ownActorId ?? battle?.ownActorId
  const activeSlot = player.findIndex(actor => actor.battleId === ownId)
  const moves = [...(battle?.moves ?? [])]
  if (battle?.canStruggle && !moves.some(move => !move.disabled)) {
    moves.splice(0, moves.length, { moveIndex: -1, id: 'struggle', name: '발버둥', type: '노말', category: '물리', power: 50,
      description: '사용할 수 있는 기술이 없어 발버둥을 사용합니다.', currentPp: 1, maxPp: 1,
      targets: opponent.flatMap((actor, slot) => actor.hp > 0 && !actor.fainted ? [{ actorId: actor.battleId, sideId: 'opponent', slot }] : []) })
  }
  if (player[activeSlot]) player[activeSlot] = { ...player[activeSlot], moves: (battle?.moves ?? []).map(move => ({ ...move })) }
  const options = moves.map(move => ({ ...move, preview: menuPreview(move.preview ?? move),
    variants: Object.fromEntries(Object.entries(move.variants ?? {}).map(([key, variant]) => [key, { ...variant, preview: menuPreview(variant.preview ?? move) }])) }))
  return {
    activeSlot,
    battle: { ...battle, player: { name: '아군', team: player, activeIndexes: player.map((_, index) => index) },
      opponent: { name: '보스 진영', team: opponent, activeIndexes: opponent.map((_, index) => index) },
      environment: battle?.environment ?? {}, rules: { ...battle?.rules, format: { ...battle?.rules?.format, id: 'raid', activeSlots: 3, actionSlots: 3 } },
      commandOptions: player.map((_, index) => ({ moves: index === activeSlot ? options : [], mechanics: index === activeSlot ? battle?.mechanics ?? [] : [] })),
    },
  }
}
