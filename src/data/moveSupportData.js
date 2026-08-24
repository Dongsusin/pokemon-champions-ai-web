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
  'obstruct',
  'silktrap',
  'burningbulwark',
  'maxguard',
])

export const PROTECT_CONTACT_EFFECTS = {
  spikyshield: { damageFraction: [1, 8] },
  kingsshield: { stages: { attack: -1 } },
  banefulbunker: { status: 'poison' },
  obstruct: { stages: { defense: -2 } },
  silktrap: { stages: { speed: -1 } },
  burningbulwark: { status: 'burn' },
}

export const STATUS_CURE_BERRIES = {
  'cheri-berry': { name: '버치열매', statuses: ['paralysis'] },
  'chesto-berry': { name: '유루열매', statuses: ['sleep'] },
  'pecha-berry': { name: '복슝열매', statuses: ['poison', 'toxic'] },
  'rawst-berry': { name: '복분열매', statuses: ['burn'] },
  'aspear-berry': { name: '배리열매', statuses: ['freeze'] },
  'lum-berry': { name: '리샘열매', statuses: ['burn', 'paralysis', 'poison', 'toxic', 'sleep', 'freeze'] },
}

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

export const MOVE_DAMAGE_STAT_RULES = {
  bodypress: {
    category: 'physical',
    attackSource: 'attacker',
    attackStat: 'defense',
    defenseStat: 'defense',
  },
  foulplay: {
    category: 'physical',
    attackSource: 'defender',
    attackStat: 'attack',
    defenseStat: 'defense',
  },
  psyshock: {
    category: 'special',
    attackSource: 'attacker',
    attackStat: 'specialAttack',
    defenseStat: 'defense',
  },
  psystrike: {
    category: 'special',
    attackSource: 'attacker',
    attackStat: 'specialAttack',
    defenseStat: 'defense',
  },
  secretsword: {
    category: 'special',
    attackSource: 'attacker',
    attackStat: 'specialAttack',
    defenseStat: 'defense',
  },
  shellsidearm: { adaptive: 'best-damage' },
  photongeyser: { adaptive: 'higher-offense' },
  lightthatburnsthesky: { adaptive: 'higher-offense' },
  terablast: { adaptive: 'tera-only' },
}

export const SUPPORTED_VOLATILE_STATUS_IDS = new Set([
  'confusion',
  'flinch',
  'yawn',
  'destinybond',
  'sparklingaria',
  'saltcure',
  'syrupbomb',
  'healblock',
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
