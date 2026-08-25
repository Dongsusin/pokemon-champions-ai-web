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
  'aquaring',
  'attract',
  'banefulbunker',
  'bide',
  'burningbulwark',
  'charge',
  'confusion',
  'curse',
  'defensecurl',
  'disable',
  'dragoncheer',
  'embargo',
  'electrify',
  'encore',
  'endure',
  'flinch',
  'focusenergy',
  'followme',
  'foresight',
  'gastroacid',
  'glaiverush',
  'grudge',
  'helpinghand',
  'imprison',
  'ingrain',
  'kingsshield',
  'laserfocus',
  'leechseed',
  'magiccoat',
  'magnetrise',
  'minimize',
  'mindreader',
  'miracleeye',
  'nightmare',
  'noretreat',
  'obstruct',
  'octolock',
  'powder',
  'partiallytrapped',
  'powershift',
  'powertrick',
  'protect',
  'ragepowder',
  'rage',
  'roost',
  'silktrap',
  'smackdown',
  'spikyshield',
  'snatch',
  'spiderweb',
  'spotlight',
  'stockpile',
  'substitute',
  'taunt',
  'telekinesis',
  'tarshot',
  'torment',
  'uproar',
  'lockedmove',
  'mustrecharge',
  'yawn',
  'destinybond',
  'sparklingaria',
  'saltcure',
  'syrupbomb',
  'healblock',
])

export const NO_EFFECT_MOVE_IDS = new Set([
  'celebrate',
  'happyhour',
  'holdhands',
  'splash',
])

export const CALL_MOVE_IDS = new Set([
  'assist',
  'copycat',
  'instruct',
  'mefirst',
  'metronome',
  'mirrormove',
  'naturepower',
  'sleeptalk',
])

export const SIDE_CONDITION_MOVE_RULES = {
  auroraveil: { key: 'auroraVeilTurns', turns: 5 },
  craftyshield: { key: 'craftyShieldTurns', turns: 1 },
  lightscreen: { key: 'lightScreenTurns', turns: 5 },
  luckychant: { key: 'luckyChantTurns', turns: 5 },
  matblock: { key: 'matBlockTurns', turns: 1 },
  mist: { key: 'mistTurns', turns: 5 },
  quickguard: { key: 'quickGuardTurns', turns: 1 },
  reflect: { key: 'reflectTurns', turns: 5 },
  safeguard: { key: 'safeguardTurns', turns: 5 },
  tailwind: { key: 'tailwindTurns', turns: 4 },
  wideguard: { key: 'wideGuardTurns', turns: 1 },
}

export const HAZARD_MOVE_RULES = {
  ceaselessedge: { key: 'spikes', maximum: 3 },
  spikes: { key: 'spikes', maximum: 3 },
  stealthrock: { key: 'stealthRock', maximum: 1 },
  stoneaxe: { key: 'stealthRock', maximum: 1 },
  stickyweb: { key: 'stickyWeb', maximum: 1 },
  toxicspikes: { key: 'toxicSpikes', maximum: 2 },
}

export const FIELD_EFFECT_MOVE_RULES = {
  fairylock: { key: 'fairyLockTurns', turns: 2 },
  gravity: { key: 'gravityTurns', turns: 5 },
  iondeluge: { key: 'ionDelugeTurns', turns: 1 },
  magicroom: { key: 'magicRoomTurns', turns: 5, toggle: true },
  mudsport: { key: 'mudSportTurns', turns: 5 },
  trickroom: { key: 'trickRoomTurns', turns: 5, toggle: true },
  watersport: { key: 'waterSportTurns', turns: 5 },
  wonderroom: { key: 'wonderRoomTurns', turns: 5, toggle: true },
}

export const SCRIPTED_DAMAGE_MOVE_IDS = new Set([
  'bide',
  'comeuppance',
  'counter',
  'endeavor',
  'fling',
  'metalburst',
  'mirrorcoat',
  'magnitude',
  'naturalgift',
  'present',
  'psywave',
])

export const SCRIPTED_STATUS_MOVE_IDS = new Set([
  ...Object.keys(STATUS_MOVE_EFFECTS),
  ...PROTECT_MOVE_IDS,
  ...HEAL_MOVE_IDS,
  ...SUPPORTED_VOLATILE_STATUS_IDS,
  ...NO_EFFECT_MOVE_IDS,
  ...CALL_MOVE_IDS,
  ...Object.keys(SIDE_CONDITION_MOVE_RULES),
  ...Object.keys(HAZARD_MOVE_RULES),
  ...Object.keys(FIELD_EFFECT_MOVE_RULES),
  'acupressure',
  'afteryou',
  'allyswitch',
  'aromatherapy',
  'bestow',
  'bellydrum',
  'block',
  'camouflage',
  'conversion',
  'conversion2',
  'corrosivegas',
  'courtchange',
  'doodle',
  'electrify',
  'entrainment',
  'flowershield',
  'floralhealing',
  'gearup',
  'guardsplit',
  'guardswap',
  'haze',
  'healbell',
  'healpulse',
  'heartswap',
  'junglehealing',
  'lunarblessing',
  'magicpowder',
  'magneticflux',
  'mimic',
  'painsplit',
  'powersplit',
  'powerswap',
  'psychoshift',
  'psychup',
  'purify',
  'quash',
  'recycle',
  'reflecttype',
  'refresh',
  'roleplay',
  'rototiller',
  'simplebeam',
  'skillswap',
  'sketch',
  'soak',
  'speedswap',
  'strengthsap',
  'spite',
  'stuffcheeks',
  'swallow',
  'switcheroo',
  'takeheart',
  'teatime',
  'tidyup',
  'topsyturvy',
  'trick',
  'trickortreat',
  'venomdrench',
  'wish',
  'lockon',
  'meanlook',
  'worryseed',
  'forestscurse',
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
      || Boolean(move.basePowerCallback)
      || move.damage !== undefined
      || Boolean(move.currentHpFraction)
      || Boolean(move.ohko)
      || move.id === 'finalgambit'
      || SCRIPTED_DAMAGE_MOVE_IDS.has(move.id)
  }

  return SCRIPTED_STATUS_MOVE_IDS.has(move.id)
    || Boolean(move.heal)
    || Boolean(move.weather)
    || Boolean(move.terrain)
    || Boolean(move.forceSwitch)
    || Boolean(move.selfSwitch)
    || hasSupportedEffectPayload(move)
}
