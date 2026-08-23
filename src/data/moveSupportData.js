export const STATUS_MOVE_EFFECTS = {
  swordsdance: { self: { attack: 2 } },
  nastyplot: { self: { specialAttack: 2 } },
  dragondance: { self: { attack: 1, speed: 1 } },
  quiverdance: { self: { specialAttack: 1, specialDefense: 1, speed: 1 } },
  irondefense: { self: { defense: 2 } },
  agility: { self: { speed: 2 } },
  rockpolish: { self: { speed: 2 } },
  bulkup: { self: { attack: 1, defense: 1 } },
  workup: { self: { attack: 1, specialAttack: 1 } },
  amnesia: { self: { specialDefense: 2 } },
  calmmind: { self: { specialAttack: 1, specialDefense: 1 } },
  shellsmash: {
    self: { attack: 2, specialAttack: 2, speed: 2, defense: -1, specialDefense: -1 },
  },
  growl: { target: { attack: -1 } },
  charm: { target: { attack: -2 } },
  screech: { target: { defense: -2 } },
  faketears: { target: { specialDefense: -2 } },
  fakeout: {},
}

export const PROTECT_MOVE_IDS = new Set([
  'protect',
  'detect',
  'spikyshield',
  'kingsshield',
  'banefulbunker',
  'silktrap',
  'burningbulwark',
  'maxguard',
])

export const HEAL_MOVE_IDS = new Set([
  'recover',
  'roost',
  'softboiled',
  'slackoff',
  'moonlight',
  'synthesis',
  'morningsun',
  'milkdrink',
  'shoreup',
  'lifedew',
])

const SUPPORTED_VOLATILE_STATUS_IDS = new Set([
  'confusion',
  'flinch',
  'yawn',
  'destinybond',
])

const SCRIPTED_STATUS_MOVE_IDS = new Set([
  ...Object.keys(STATUS_MOVE_EFFECTS),
  ...PROTECT_MOVE_IDS,
  ...HEAL_MOVE_IDS,
  'rest',
  'perishsong',
  'healingwish',
  'lunardance',
  'defog',
  'transform',
])

function hasSupportedEffectPayload(effect) {
  if (!effect) return false
  return Boolean(
    effect.status
    || effect.boosts
    || SUPPORTED_VOLATILE_STATUS_IDS.has(effect.volatileStatus)
    || hasSupportedEffectPayload(effect.self),
  )
}

export function isBattleMoveSupported(move) {
  if (!move) return false

  if (move.categoryId !== 'status') {
    return Number(move.power) > 0
      || move.damage !== undefined
      || Boolean(move.currentHpFraction)
      || Boolean(move.ohko)
      || move.id === 'finalgambit'
  }

  return SCRIPTED_STATUS_MOVE_IDS.has(move.id)
    || Boolean(move.heal)
    || Boolean(move.weather)
    || Boolean(move.terrain)
    || Boolean(move.forceSwitch)
    || Boolean(move.selfSwitch)
    || hasSupportedEffectPayload(move)
}
