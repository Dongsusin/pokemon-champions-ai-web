const TYPE_THEMES = {
  노말: ['#d9dee8', '#8792a5', '#ffffff'],
  불꽃: ['#ff6a3d', '#d82331', '#ffe277'],
  물: ['#4bc8ff', '#2672df', '#d5f7ff'],
  전기: ['#ffe83f', '#f29e22', '#ffffff'],
  풀: ['#72df68', '#268e50', '#e7ff8a'],
  얼음: ['#8defff', '#4ba6e5', '#ffffff'],
  격투: ['#ff705c', '#a92c36', '#ffd09a'],
  독: ['#d878e8', '#712c9b', '#f7b3ff'],
  땅: ['#e0a85d', '#8d512e', '#ffe2a1'],
  비행: ['#a5cbff', '#628bd4', '#ffffff'],
  에스퍼: ['#ff79b5', '#9d46ca', '#ffe0f4'],
  벌레: ['#bfd84e', '#667f2d', '#efff99'],
  바위: ['#d6b96b', '#786541', '#fff0ad'],
  고스트: ['#9d84e6', '#402f7c', '#e7d9ff'],
  드래곤: ['#7d8cff', '#343da0', '#d8dcff'],
  악: ['#8c8198', '#302b43', '#d7cadf'],
  강철: ['#b7d3df', '#647e91', '#ffffff'],
  페어리: ['#ff9ed5', '#bd55a0', '#fff0fb'],
  스텔라: ['#76f6ef', '#8e63ff', '#fff59b'],
}

const SIGNATURE_PROFILES = {
  absorb: { archetype: 'drain', motif: 'mote' },
  accelerock: { archetype: 'dash', motif: 'rock' },
  acid: { archetype: 'sludge', motif: 'drop' },
  airslash: { archetype: 'slash', motif: 'wind' },
  aquajet: { archetype: 'dash', motif: 'water' },
  aurasphere: { archetype: 'orb', motif: 'aura' },
  avalanche: { archetype: 'storm', motif: 'ice' },
  bite: { archetype: 'bite', motif: 'fang' },
  blizzard: { archetype: 'storm', motif: 'snow', screen: 'frost' },
  bravebird: { archetype: 'aerial', motif: 'feather' },
  bubblebeam: { archetype: 'stream', motif: 'bubble' },
  bulletpunch: { archetype: 'punch', motif: 'steel' },
  calmmind: { archetype: 'boost', motif: 'psychic' },
  closecombat: { archetype: 'barrage', motif: 'fist' },
  crunch: { archetype: 'bite', motif: 'fang' },
  darkpulse: { archetype: 'pulse', motif: 'dark' },
  dazzlinggleam: { archetype: 'prism', motif: 'sparkle', screen: 'flash' },
  discharge: { archetype: 'lightning', motif: 'spark', screen: 'dark' },
  dracometeor: { archetype: 'meteor', motif: 'dragon', screen: 'dark' },
  dragondance: { archetype: 'dance', motif: 'dragon' },
  dragonpulse: { archetype: 'pulse', motif: 'dragon' },
  earthquake: { archetype: 'quake', motif: 'crack', screen: 'shake' },
  energyball: { archetype: 'orb', motif: 'leaf' },
  eruption: { archetype: 'eruption', motif: 'flame', screen: 'heat' },
  explosion: { archetype: 'explosion', motif: 'burst', screen: 'flash' },
  extremespeed: { archetype: 'dash', motif: 'speed', screen: 'speed' },
  fireblast: { archetype: 'explosion', motif: 'flame', screen: 'heat' },
  firepunch: { archetype: 'punch', motif: 'flame' },
  fissure: { archetype: 'quake', motif: 'fissure', screen: 'shake' },
  flamethrower: { archetype: 'stream', motif: 'flame', screen: 'heat' },
  flashcannon: { archetype: 'beam', motif: 'steel', screen: 'flash' },
  focusblast: { archetype: 'orb', motif: 'aura' },
  freezedry: { archetype: 'beam', motif: 'ice', screen: 'frost' },
  gunkshot: { archetype: 'sludge', motif: 'toxic' },
  hurricane: { archetype: 'storm', motif: 'wind', screen: 'wind' },
  hydropump: { archetype: 'stream', motif: 'water' },
  hyperbeam: { archetype: 'beam', motif: 'energy', screen: 'flash' },
  icebeam: { archetype: 'beam', motif: 'ice', screen: 'frost' },
  icepunch: { archetype: 'punch', motif: 'ice' },
  leafblade: { archetype: 'slash', motif: 'leaf' },
  leechseed: { archetype: 'seed', motif: 'seed' },
  lightscreen: { archetype: 'barrier', motif: 'screen' },
  machpunch: { archetype: 'punch', motif: 'speed' },
  meteorbeam: { archetype: 'beam', motif: 'meteor', screen: 'dark' },
  moonblast: { archetype: 'orb', motif: 'moon', screen: 'moon' },
  nastyplot: { archetype: 'boost', motif: 'dark' },
  nightshade: { archetype: 'spectral', motif: 'ghost', screen: 'dark' },
  outrage: { archetype: 'barrage', motif: 'dragon', screen: 'rage' },
  overheat: { archetype: 'eruption', motif: 'flame', screen: 'heat' },
  petalblizzard: { archetype: 'storm', motif: 'petal' },
  playrough: { archetype: 'barrage', motif: 'fairy' },
  poisonjab: { archetype: 'punch', motif: 'toxic' },
  powerwhip: { archetype: 'whip', motif: 'vine' },
  protect: { archetype: 'barrier', motif: 'shield' },
  psychic: { archetype: 'psychic', motif: 'ring', screen: 'psychic' },
  psyshock: { archetype: 'psychic', motif: 'shard', screen: 'psychic' },
  quickattack: { archetype: 'dash', motif: 'speed' },
  razorleaf: { archetype: 'leaves', motif: 'leaf' },
  reflect: { archetype: 'barrier', motif: 'screen' },
  recover: { archetype: 'restore', motif: 'heal' },
  rest: { archetype: 'sleep', motif: 'sleep' },
  rockslide: { archetype: 'meteor', motif: 'rock', screen: 'shake' },
  seedbomb: { archetype: 'orb', motif: 'seed' },
  shadowball: { archetype: 'orb', motif: 'ghost', screen: 'dark' },
  shadowclaw: { archetype: 'slash', motif: 'ghost' },
  shellsmash: { archetype: 'boost', motif: 'shard' },
  sludgebomb: { archetype: 'sludge', motif: 'toxic' },
  solarbeam: { archetype: 'beam', motif: 'solar', screen: 'sun' },
  stealthrock: { archetype: 'hazard', motif: 'rock' },
  stickyweb: { archetype: 'web', motif: 'web' },
  stoneedge: { archetype: 'hazard', motif: 'rock' },
  surf: { archetype: 'wave', motif: 'water', screen: 'water' },
  swordsdance: { archetype: 'dance', motif: 'sword' },
  tackle: { archetype: 'dash', motif: 'impact' },
  thunder: { archetype: 'lightning', motif: 'bolt', screen: 'dark' },
  thunderbolt: { archetype: 'lightning', motif: 'bolt', screen: 'dark' },
  thunderpunch: { archetype: 'punch', motif: 'spark' },
  toxic: { archetype: 'sludge', motif: 'toxic' },
  vinewhip: { archetype: 'whip', motif: 'vine' },
  watergun: { archetype: 'stream', motif: 'water' },
  waterfall: { archetype: 'wave', motif: 'water' },
  willowisp: { archetype: 'spectral', motif: 'flame', screen: 'dark' },
  xscissor: { archetype: 'slash', motif: 'cross' },
}

const RESTORE_IDS = /^(recover|roost|softboiled|slackoff|moonlight|synthesis|morningsun|milkdrink|shoreup|lifedew|healorder|floralhealing|strengthsap|junglehealing|lunarblessing|purify)$/
const BARRIER_IDS = /(protect|detect|shield|barrier|reflect|screen|bunker|bulwark|wideguard|quickguard|matblock|obstruct|silktrap)/
const WEATHER_IDS = /(sunnyday|raindance|sandstorm|snowscape|hail|chillyreception)/
const TERRAIN_IDS = /(terrain|trickroom|wonderroom|magicroom|gravity)$/
const HAZARD_IDS = /(stealthrock|spikes|toxicspikes|stickyweb|stoneaxe|ceaselessedge)/
const BOOST_IDS = /(dance|plot|mind|polish|agility|amnesia|bulkup|workup|growth|charge|focusenergy|geomancy|coil|clangoroussoul|filletaway|victorydance|tidyup)/
const SLEEP_IDS = /(spore|hypnosis|sing|sleeppowder|grasswhistle|lovelykiss|darkvoid|yawn|rest)$/
const POISON_IDS = /(toxic|poison|sludge|acid|gunk|venom|smog|malignantchain)/
const WEB_IDS = /(web|thread|stringshot)/
const DRAIN_IDS = /(drain|absorb|leech|giga.*drain|paraboliccharge|oblivionwing|strengthsap)/
const QUAKE_IDS = /(earthquake|magnitude|fissure|bulldoze|stompingtantrum|highhorsepower|earthpower|landswrath|precipiceblades)/
const EXPLOSION_IDS = /(explosion|selfdestruct|mistyexplosion|mindblown|chloroblast|searingshot)/
const LIGHTNING_IDS = /(thunder|bolt|discharge|volt|electro|zap|lightning|spark|paraboliccharge|risingvoltage|thunderclap)/
const WAVE_IDS = /(surf|wave|muddywater|originpulse|waterpledge|sparklingaria|hydrosteam)/
const STORM_IDS = /(storm|blizzard|avalanche|hurricane|twister|whirlwind|petalblizzard|leafstorm|sandsearstorm|bleakwindstorm|wildboltstorm|springtidestorm)/
const BEAM_IDS = /(beam|laser|cannon|ray|lusterpurge|prismaticlaser|dynamaxcannon|eternabeam|tachyoncutter)/
const ORB_IDS = /(ball|bomb|sphere|orb|pulse|shot|seed|pebble|barrage|cudchew)/
const METEOR_IDS = /(meteor|rockslide|rockthrow|rockblast|powergem|diamondstorm|stoneedge|ancientpower)/
const SLASH_IDS = /(slash|cut|claw|blade|scissor|furycutter|sacredsword|razorwind|aircutter|psychocut|nightslash|kowtowcleave|mightycleave)/
const BITE_IDS = /(bite|crunch|fang|jaw|hyperdrill)/
const PUNCH_IDS = /(punch|hammer|upperhand|plasmafists|doubleironbash)/
const KICK_IDS = /(kick|stomp|tripleaxel|axekick|thunderouskick|lowkick)/
const WHIP_IDS = /(whip|vine|tentacle|wrap|bind|lash|snaptrap)/
const DASH_IDS = /(tackle|quickattack|extremespeed|rush|charge|slam|headbutt|pounce|lunge|jet|blitz|assault|collisioncourse|glaiverush)/
const SOUND_IDS = /(voice|song|sound|noise|echo|snarl|growl|roar|screech|boomburst|hypervoice|bugbuzz|overdrive|torchsong|alluringvoice)/
const PSYCHIC_IDS = /(psychic|psy|dream|extrasensory|storedpower|future sight|expandingforce|lumina crash)/
const LEAF_IDS = /(leaf|petal|flower|seed|branch|wood|grass|ivy|chloroblast|appleacid|gravapple)/
const ICE_IDS = /(ice|freeze|frost|snow|glacial|icicle|avalanche|tripleaxel)/
const FIRE_IDS = /(fire|flame|burn|heat|eruption|blaze|inferno|pyro|magma|torch|searing|temperflare)/
const AERIAL_IDS = /(fly|dive|bounce|sky|aerial|acrobatics|bravebird|dragonascent|dualwingbeat)/
const SPIN_IDS = /(spin|rollout|gyroball|iceball|rapidspin|mortalspin)/

function hashMoveId(moveId) {
  let hash = 2166136261
  for (let index = 0; index < moveId.length; index += 1) {
    hash ^= moveId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function inferArchetype(moveId, category, type, flags, text) {
  if (SIGNATURE_PROFILES[moveId]) return SIGNATURE_PROFILES[moveId]
  if (EXPLOSION_IDS.test(moveId)) return { archetype: 'explosion', motif: 'burst', screen: 'flash' }
  if (QUAKE_IDS.test(moveId)) return { archetype: 'quake', motif: 'crack', screen: 'shake' }
  if (BARRIER_IDS.test(moveId)) return { archetype: 'barrier', motif: 'shield' }
  if (DRAIN_IDS.test(moveId) || (category !== 'status' && flags.has('heal'))) {
    return {
      archetype: 'drain',
      motif: flags.has('punch') ? 'fist' : 'mote',
      motion: flags.has('contact') ? 'lunge' : 'cast',
    }
  }
  if (RESTORE_IDS.test(moveId) || flags.has('heal')) return { archetype: 'restore', motif: 'heal' }
  if (WEATHER_IDS.test(moveId)) return { archetype: 'weather', motif: type === '물' ? 'rain' : type === '얼음' ? 'snow' : type === '바위' ? 'sand' : 'sun' }
  if (TERRAIN_IDS.test(moveId)) return { archetype: 'terrain', motif: 'field' }
  if (HAZARD_IDS.test(moveId)) return { archetype: 'hazard', motif: type === '벌레' ? 'web' : 'spike' }
  if (SLEEP_IDS.test(moveId)) return { archetype: 'sleep', motif: 'sleep' }
  if (WEB_IDS.test(moveId)) return { archetype: 'web', motif: 'web' }
  if (SOUND_IDS.test(moveId) || flags.has('sound')) return { archetype: 'sound', motif: 'ring' }
  if (category === 'status') {
    if (BOOST_IDS.test(moveId) || flags.has('dance')) return { archetype: flags.has('dance') ? 'dance' : 'boost', motif: flags.has('dance') ? 'sparkle' : 'arrow' }
    if (POISON_IDS.test(moveId)) return { archetype: 'sludge', motif: 'toxic' }
    if (/teleport|substitute|transform|conversion|batonpass/.test(moveId)) return { archetype: 'vanish', motif: 'warp' }
    return { archetype: 'ailment', motif: type === '에스퍼' ? 'ring' : 'sparkle' }
  }
  if (flags.has('punch') || PUNCH_IDS.test(moveId)) return { archetype: 'punch', motif: type === '전기' ? 'spark' : type === '불꽃' ? 'flame' : 'fist' }
  if (KICK_IDS.test(moveId)) return { archetype: 'kick', motif: 'impact' }
  if (flags.has('bite') || BITE_IDS.test(moveId)) return { archetype: 'bite', motif: 'fang' }
  if (flags.has('slicing') || SLASH_IDS.test(moveId)) return { archetype: 'slash', motif: type === '풀' ? 'leaf' : 'blade' }
  if (WHIP_IDS.test(moveId)) return { archetype: 'whip', motif: type === '풀' ? 'vine' : 'lash' }
  if (AERIAL_IDS.test(moveId)) return { archetype: 'aerial', motif: 'feather' }
  if (SPIN_IDS.test(moveId)) return { archetype: 'spin', motif: 'spiral' }
  if (category === 'physical' && (flags.has('contact') || DASH_IDS.test(moveId))) return { archetype: 'dash', motif: 'impact' }
  if (LIGHTNING_IDS.test(moveId) || type === '전기') return { archetype: 'lightning', motif: 'bolt', screen: 'dark' }
  if (WAVE_IDS.test(moveId)) return { archetype: 'wave', motif: 'water', screen: 'water' }
  if (STORM_IDS.test(moveId) || flags.has('wind')) return { archetype: 'storm', motif: flags.has('wind') ? 'wind' : 'storm' }
  if (BEAM_IDS.test(moveId)) return { archetype: 'beam', motif: ICE_IDS.test(moveId) ? 'ice' : FIRE_IDS.test(moveId) ? 'flame' : 'energy' }
  if (METEOR_IDS.test(moveId)) return { archetype: 'meteor', motif: type === '바위' ? 'rock' : 'meteor' }
  if (PSYCHIC_IDS.test(`${moveId} ${text}`) || type === '에스퍼') return { archetype: 'psychic', motif: 'ring', screen: 'psychic' }
  if (POISON_IDS.test(moveId) || type === '독') return { archetype: 'sludge', motif: 'toxic' }
  if (ICE_IDS.test(moveId) || type === '얼음') return { archetype: 'crystal', motif: 'ice', screen: 'frost' }
  if (LEAF_IDS.test(moveId) || type === '풀') return { archetype: 'leaves', motif: 'leaf' }
  if (FIRE_IDS.test(moveId) || type === '불꽃') return { archetype: 'stream', motif: 'flame', screen: 'heat' }
  if (type === '고스트') return { archetype: 'spectral', motif: 'ghost', screen: 'dark' }
  if (type === '드래곤') return { archetype: 'pulse', motif: 'dragon' }
  if (type === '페어리') return { archetype: 'prism', motif: 'sparkle' }
  if (ORBITAL_PROJECTILE.test(moveId) || ORB_IDS.test(moveId)) return { archetype: 'orb', motif: 'energy' }
  return category === 'physical'
    ? { archetype: 'strike', motif: 'impact' }
    : { archetype: 'blast', motif: 'energy' }
}

const ORBITAL_PROJECTILE = /(aura|focus|shadow|energy|moon|weather|terrain)ball/

const ARCHETYPE_MOTION = {
  aerial: 'leap',
  barrage: 'lunge',
  bite: 'lunge',
  dash: 'dash',
  kick: 'lunge',
  punch: 'lunge',
  slash: 'lunge',
  spin: 'spin',
  strike: 'lunge',
  whip: 'cast',
  barrier: 'brace',
  boost: 'rise',
  dance: 'dance',
  restore: 'rise',
  sleep: 'settle',
}

const ARCHETYPE_DURATION = {
  aerial: 900,
  barrage: 920,
  beam: 900,
  dance: 900,
  eruption: 920,
  explosion: 940,
  lightning: 860,
  meteor: 920,
  quake: 900,
  storm: 920,
  wave: 900,
}

export function getMoveAnimationProfile(move = {}) {
  const moveId = String(move.moveId ?? move.id ?? move.englishName ?? move.moveName ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  const category = move.moveCategory ?? move.categoryId ?? (move.category === '변화' ? 'status' : move.category === '물리' ? 'physical' : 'special')
  const type = move.moveType ?? move.type ?? '노말'
  const flags = new Set(move.moveFlags ?? move.flags ?? [])
  const text = `${move.moveName ?? move.name ?? ''} ${move.moveDescription ?? move.description ?? ''}`.toLowerCase()
  const seed = hashMoveId(moveId)
  const inferred = inferArchetype(moveId, category, type, flags, text)
  const theme = TYPE_THEMES[type] ?? TYPE_THEMES.노말
  const power = Math.max(0, Number(move.movePower ?? move.power) || 0)
  const intensity = power >= 120 ? 3 : power >= 75 ? 2 : 1
  const baseDuration = ARCHETYPE_DURATION[inferred.archetype] ?? (category === 'status' ? 840 : 820)
  const duration = baseDuration + (seed % 81) - 40
  const moveTarget = move.moveTarget ?? move.target
  const targetSelf = ['self', 'allySide', 'allyTeam', 'allies', 'adjacentAllyOrSelf'].includes(moveTarget)
    || ['barrier', 'boost', 'dance', 'restore', 'sleep'].includes(inferred.archetype)
  const targetField = ['all', 'allAdjacent'].includes(moveTarget)
    || ['terrain', 'weather'].includes(inferred.archetype)

  return {
    moveId,
    archetype: inferred.archetype,
    motif: inferred.motif,
    screen: inferred.screen ?? 'none',
    motion: inferred.motion ?? ARCHETYPE_MOTION[inferred.archetype] ?? (category === 'physical' ? 'lunge' : 'cast'),
    primary: theme[0],
    secondary: theme[1],
    highlight: theme[2],
    seed,
    variant: seed % 4,
    intensity,
    particleCount: Math.min(18, 7 + (seed % 5) + intensity * 2),
    rotation: (seed % 41) - 20,
    spread: 18 + (seed % 24),
    duration,
    targetSelf,
    targetField,
  }
}

export function summarizeMoveAnimationCoverage(moves) {
  const profiles = moves.map((move) => getMoveAnimationProfile(move))
  return {
    total: profiles.length,
    covered: profiles.filter((profile) => profile.archetype).length,
    archetypes: [...new Set(profiles.map((profile) => profile.archetype))].sort(),
  }
}
