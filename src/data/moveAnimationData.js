import moveAnimationManifest from './generatedMoveAnimationManifest.json' with { type: 'json' }
import moveAnimationReference from './generatedMoveAnimationReference.json' with { type: 'json' }

const clamp = (minimum, value, maximum) => Math.min(maximum, Math.max(minimum, value))

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

const TYPE_MOTIFS = {
  노말: 'impact',
  불꽃: 'flame',
  물: 'water',
  전기: 'bolt',
  풀: 'leaf',
  얼음: 'ice',
  격투: 'fist',
  독: 'toxic',
  땅: 'crack',
  비행: 'wind',
  에스퍼: 'psychic',
  벌레: 'web',
  바위: 'rock',
  고스트: 'ghost',
  드래곤: 'dragon',
  악: 'dark',
  강철: 'steel',
  페어리: 'sparkle',
  스텔라: 'prism',
}

const SPECIAL_ARCHETYPES_BY_TYPE = {
  노말: 'blast',
  불꽃: 'eruption',
  물: 'wave',
  전기: 'lightning',
  풀: 'leaves',
  얼음: 'storm',
  격투: 'barrage',
  독: 'sludge',
  땅: 'quake',
  비행: 'aerial',
  에스퍼: 'psychic',
  벌레: 'storm',
  바위: 'meteor',
  고스트: 'spectral',
  드래곤: 'beam',
  악: 'pulse',
  강철: 'meteor',
  페어리: 'prism',
  스텔라: 'prism',
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
  aerial: 980,
  barrage: 1040,
  beam: 1180,
  bite: 860,
  dance: 980,
  dash: 820,
  drain: 1100,
  eruption: 1240,
  explosion: 1180,
  lightning: 1080,
  meteor: 1200,
  punch: 840,
  quake: 1120,
  slash: 860,
  storm: 1240,
  stream: 1120,
  wave: 1200,
}

const MOVE_PIXEL_FX_FILES = [
  'alpha.png',
  'angry.png',
  'blackwisp.png',
  'bluefireball.png',
  'bone.png',
  'bottombite.png',
  'caltrop.png',
  'electroball.png',
  'energyball.png',
  'feather.png',
  'fireball.png',
  'fist.png',
  'fist1.png',
  'flareball.png',
  'foot.png',
  'gear.png',
  'heart.png',
  'hitmarker.png',
  'iceball.png',
  'icicle.png',
  'impact.png',
  'leaf1.png',
  'leaf2.png',
  'leftchop.png',
  'leftclaw.png',
  'leftslash.png',
  'lightning.png',
  'mistball.png',
  'moon.png',
  'mudwisp.png',
  'petal.png',
  'poisoncaltrop.png',
  'poisonwisp.png',
  'rainbow.png',
  'rightchop.png',
  'rightclaw.png',
  'rightslash.png',
  'rock1.png',
  'rock2.png',
  'rock3.png',
  'rocks.png',
  'shadowball.png',
  'shell.png',
  'shine.png',
  'sound.png',
  'stare.png',
  'sword.png',
  'topbite.png',
  'waterwisp.png',
  'web.png',
  'wisp.png',
  'weather-electricterrain.png',
  'weather-grassyterrain.png',
  'weather-gravity.png',
  'weather-hail.png',
  'weather-magicroom.png',
  'weather-mistyterrain.png',
  'weather-psychicterrain.png',
  'weather-raindance.jpg',
  'weather-sandstorm.png',
  'weather-strongwind.png',
  'weather-sunnyday.jpg',
  'weather-trickroom.png',
  'weather-wonderroom.png',
]

const fxAsset = (fileName) => `/assets/move-fx/${fileName}`
const ebdxAsset = (asset) => ({
  ...asset,
  src: `${moveAnimationManifest.assetRoot}/${asset.file}`,
})
const normalizeMoveId = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
const MOVE_RESOURCE_BY_ID = new Map(
  Object.entries(moveAnimationManifest.moves).map(([moveId, resource]) => [normalizeMoveId(moveId), resource]),
)
const MOVE_REFERENCE_BY_RECORD_NO = new Map(
  moveAnimationReference.records.map((record) => [record.recordNo, record]),
)
const MOVE_REFERENCES_BY_ALIAS = new Map()

moveAnimationReference.records.forEach((record) => {
  record.aliases.forEach((alias) => {
    const references = MOVE_REFERENCES_BY_ALIAS.get(alias) ?? []
    references.push(record)
    MOVE_REFERENCES_BY_ALIAS.set(alias, references)
  })
})

const GMAX_REFERENCE_BY_SPECIES = [
  ['urshifurapidstrike', 'gmaxrapidflow'],
  ['urshifusinglestrike', 'gmaxoneblow'],
  ['charizard', 'gmaxwildfire'],
  ['butterfree', 'gmaxbefuddle'],
  ['pikachu', 'gmaxvoltcrash'],
  ['meowth', 'gmaxgoldrush'],
  ['machamp', 'gmaxchistrike'],
  ['gengar', 'gmaxterror'],
  ['lapras', 'gmaxresonance'],
  ['eevee', 'gmaxcuddle'],
  ['snorlax', 'gmaxreplenish'],
  ['garbodor', 'gmaxmalodor'],
  ['drednaw', 'gmaxstonesurge'],
  ['corviknight', 'gmaxwindrage'],
  ['toxtricity', 'gmaxstunshock'],
  ['alcremie', 'gmaxfinale'],
  ['duraludon', 'gmaxdepletion'],
  ['orbeetle', 'gmaxgravitas'],
  ['coalossal', 'gmaxvolcalith'],
  ['sandaconda', 'gmaxsandblast'],
  ['grimmsnarl', 'gmaxsnooze'],
  ['flapple', 'gmaxtartness'],
  ['appletun', 'gmaxsweetness'],
  ['hatterene', 'gmaxsmite'],
  ['copperajah', 'gmaxsteelsurge'],
  ['melmetal', 'gmaxmeltdown'],
  ['kingler', 'gmaxfoamburst'],
  ['centiskorch', 'gmaxcentiferno'],
  ['venusaur', 'gmaxvinelash'],
  ['blastoise', 'gmaxcannonade'],
  ['rillaboom', 'gmaxdrumsolo'],
  ['cinderace', 'gmaxfireball'],
  ['inteleon', 'gmaxhydrosnipe'],
]

function normalizeReferenceVariant(value = '') {
  return String(value).trim().toUpperCase().replace(/[-\s]+/g, '_')
}

function referencesForAlias(value) {
  return MOVE_REFERENCES_BY_ALIAS.get(normalizeMoveId(value)) ?? []
}

function referenceForAlias(value, predicate = () => true) {
  return referencesForAlias(value).find(predicate) ?? null
}

function referenceForGmaxSpecies(move, type) {
  const species = normalizeMoveId(move.actorSpeciesSlug ?? move.actorName ?? '')
  const mappedAlias = GMAX_REFERENCE_BY_SPECIES.find(([speciesAlias]) => species.includes(speciesAlias))?.[1]
  const mappedReference = mappedAlias ? referenceForAlias(mappedAlias) : null
  if (mappedReference?.type === type) return mappedReference
  return moveAnimationReference.records.find((record) => (
    record.variant === 'MAX_MOVE'
    && record.type === type
    && record.moveKey !== 'MAX_GUARD'
  ))
    ?? null
}

function referenceForRequestedVariant(move, variant, category, type) {
  if (!variant) return null
  if (move.animationReferenceKey) {
    const explicit = referenceForAlias(move.animationReferenceKey, (record) => record.variant === variant)
    if (explicit) return explicit
  }

  if (variant === 'GMAX_MOVE') {
    if (category === 'status') return referenceForAlias('maxguard')
    return referenceForGmaxSpecies(move, type)
  }
  if (variant === 'MAX_MOVE') {
    if (category === 'status') return referenceForAlias('maxguard')
    return moveAnimationReference.records.find((record) => (
      record.variant === 'MAX_MOVE'
      && record.type === type
      && record.moveKey !== 'MAX_GUARD'
    )) ?? null
  }
  if (variant === 'Z_GENERIC_PHYSICAL' || variant === 'Z_GENERIC_SPECIAL') {
    return moveAnimationReference.records.find((record) => record.variant === variant && record.type === type) ?? null
  }

  return referenceForAlias(move.moveId ?? move.id ?? move.englishName ?? move.moveName, (record) => record.variant === variant)
}

export function getMoveAnimationReference(move = {}) {
  const moveId = normalizeMoveId(move.moveId ?? move.id ?? move.englishName ?? move.moveName ?? 'unknown')
  const category = move.moveCategory ?? move.categoryId ?? (move.category === '변화' ? 'status' : move.category === '물리' ? 'physical' : 'special')
  const type = move.animationType ?? move.moveType ?? move.type ?? '노말'
  const requestedVariant = normalizeReferenceVariant(move.animationVariant ?? move.recordVariant)
  const requestedReference = referenceForRequestedVariant(move, requestedVariant, category, type)
  if (requestedReference) return requestedReference

  const indexedRecordNumber = moveAnimationReference.activeMoveIndex[moveId]
  if (indexedRecordNumber) return MOVE_REFERENCE_BY_RECORD_NO.get(indexedRecordNumber) ?? null

  const aliases = [moveId, move.englishName, move.moveName, move.name]
  const candidates = aliases.flatMap(referencesForAlias)
  return candidates.find((record) => ['STANDARD_MOVE', 'STANDARD_WITH_HEAL_BRANCH'].includes(record.variant))
    ?? candidates[0]
    ?? null
}

function getReferenceAnimationStyle(reference, category, type, move, inferred) {
  const variant = reference?.variant ?? 'UNMAPPED'
  const typeMotif = TYPE_MOTIFS[type] ?? inferred.motif
  const specialArchetype = SPECIAL_ARCHETYPES_BY_TYPE[type] ?? inferred.archetype

  if (variant === 'MAX_MOVE') {
    if (reference?.moveKey === 'MAX_GUARD') {
      return { archetype: 'barrier', motif: 'shield', screen: 'max', motion: 'brace', intensity: 3, durationScale: 1.12 }
    }
    return { archetype: specialArchetype, motif: typeMotif, screen: 'max', intensity: 3, durationScale: 1.16 }
  }
  if (variant === 'GMAX_MOVE') {
    return { archetype: specialArchetype, motif: typeMotif, screen: 'gmax', intensity: 3, durationScale: 1.24 }
  }
  if (variant === 'Z_GENERIC_PHYSICAL') {
    return { archetype: category === 'physical' ? 'barrage' : specialArchetype, motif: typeMotif, screen: 'zpower', motion: 'lunge', intensity: 3, durationScale: 1.18 }
  }
  if (variant === 'Z_GENERIC_SPECIAL' || variant === 'Z_SIGNATURE') {
    return { archetype: specialArchetype, motif: typeMotif, screen: 'zpower', motion: 'cast', intensity: 3, durationScale: 1.2 }
  }
  if (variant === 'SHADOW_MOVE') {
    return { archetype: 'spectral', motif: 'ghost', screen: 'shadow', intensity: 3, durationScale: 1.08 }
  }
  if (variant === 'STARMOBILE_TORQUE') {
    return { archetype: 'spin', motif: typeMotif, screen: 'torque', motion: 'spin', intensity: 2, durationScale: 1.04 }
  }
  if (variant === 'TERA_TYPE_VARIANTS') {
    return { archetype: 'prism', motif: typeMotif, screen: 'tera', intensity: 3, durationScale: 1.12 }
  }
  if (variant === 'FORM_TYPE_VARIANTS') {
    return { archetype: 'strike', motif: typeMotif, screen: 'mask', motion: 'lunge', intensity: 3, durationScale: 1.08 }
  }
  if (variant === 'PLZA_NEW_MOVE') {
    return { archetype: 'beam', motif: 'dragon', screen: 'nihil', motion: 'cast', intensity: 3, durationScale: 1.22 }
  }
  if (variant === 'LGPE_PARTNER_MOVE') {
    return { intensity: Math.max(2, Number(move.movePower ?? move.power) >= 100 ? 3 : 2), durationScale: 1.04 }
  }
  if (variant === 'STANDARD_WITH_HEAL_BRANCH' && move.animationBranch === 'HEAL_RESULT') {
    return { archetype: 'restore', motif: 'heal', screen: 'flash', motion: 'rise', intensity: 2, durationScale: 1.04 }
  }
  return {}
}

export const MOVE_PIXEL_FX_ASSETS = MOVE_PIXEL_FX_FILES.map(fxAsset)

const TYPE_PIXEL_ASSETS = {
  노말: 'impact.png',
  불꽃: 'fireball.png',
  물: 'waterwisp.png',
  전기: 'electroball.png',
  풀: 'energyball.png',
  얼음: 'iceball.png',
  격투: 'fist.png',
  독: 'poisonwisp.png',
  땅: 'mudwisp.png',
  비행: 'feather.png',
  에스퍼: 'mistball.png',
  벌레: 'leaf2.png',
  바위: 'rock2.png',
  고스트: 'shadowball.png',
  드래곤: 'alpha.png',
  악: 'blackwisp.png',
  강철: 'gear.png',
  페어리: 'shine.png',
  스텔라: 'rainbow.png',
}

const MOTIF_PIXEL_ASSETS = {
  aura: 'mistball.png',
  blade: 'leftslash.png',
  bolt: 'lightning.png',
  bubble: 'waterwisp.png',
  burst: 'flareball.png',
  crack: 'rocks.png',
  cross: 'leftslash.png',
  dark: 'blackwisp.png',
  dragon: 'alpha.png',
  drop: 'poisonwisp.png',
  energy: 'alpha.png',
  fang: 'topbite.png',
  feather: 'feather.png',
  field: 'shine.png',
  fist: 'fist.png',
  flame: 'fireball.png',
  ghost: 'shadowball.png',
  heal: 'shine.png',
  ice: 'iceball.png',
  impact: 'impact.png',
  leaf: 'leaf1.png',
  meteor: 'rock3.png',
  moon: 'moon.png',
  mote: 'wisp.png',
  petal: 'petal.png',
  psychic: 'mistball.png',
  prism: 'rainbow.png',
  rain: 'waterwisp.png',
  ring: 'sound.png',
  rock: 'rock2.png',
  sand: 'mudwisp.png',
  screen: 'alpha.png',
  seed: 'energyball.png',
  shard: 'icicle.png',
  shield: 'alpha.png',
  snow: 'icicle.png',
  sparkle: 'shine.png',
  speed: 'impact.png',
  spike: 'caltrop.png',
  spiral: 'rainbow.png',
  steel: 'gear.png',
  sun: 'flareball.png',
  sword: 'sword.png',
  toxic: 'poisonwisp.png',
  vine: 'leaf2.png',
  water: 'waterwisp.png',
  web: 'web.png',
  wind: 'feather.png',
}

const ARCHETYPE_PIXEL_MODES = {
  aerial: 'dash',
  ailment: 'status',
  barrage: 'melee',
  barrier: 'self',
  beam: 'beam',
  bite: 'bite',
  blast: 'projectile',
  boost: 'self',
  crystal: 'projectile',
  dance: 'self',
  dash: 'dash',
  drain: 'drain',
  eruption: 'eruption',
  explosion: 'burst',
  hazard: 'hazard',
  kick: 'melee',
  leaves: 'stream',
  lightning: 'lightning',
  meteor: 'rain',
  orb: 'projectile',
  prism: 'rings',
  psychic: 'rings',
  pulse: 'projectile',
  punch: 'melee',
  quake: 'ground',
  restore: 'self',
  seed: 'projectile',
  slash: 'slash',
  sleep: 'self',
  sludge: 'projectile',
  sound: 'rings',
  spectral: 'projectile',
  spin: 'dash',
  storm: 'rain',
  stream: 'stream',
  strike: 'melee',
  terrain: 'field',
  vanish: 'vanish',
  wave: 'wave',
  weather: 'field',
  web: 'hazard',
  whip: 'stream',
}

const CONTACT_PIXEL_MODES = new Set(['dash', 'melee', 'slash', 'bite'])
const INLINE_IMPACT_MODES = new Set(['self', 'field', 'hazard', 'vanish'])
const HEAVY_PIXEL_MODES = new Set(['burst', 'eruption', 'ground', 'lightning', 'rain', 'wave'])
const HIDDEN_TRAJECTORY_MODES = new Set(['lightning', 'slash', 'bite', 'self', 'field', 'vanish'])

function uniqueAssets(assets) {
  return [...new Map(assets.filter(Boolean).map((asset) => [asset.src, asset])).values()]
}

function assetVisualDimensions(asset) {
  return {
    width: Math.max(1, Number(asset?.frame?.frameWidth) || Number(asset?.width) || 1),
    height: Math.max(1, Number(asset?.frame?.frameHeight) || Number(asset?.height) || 1),
  }
}

function isSceneAsset(asset) {
  if (asset?.kind === 'background') return true
  if (asset?.frame?.count > 1) return false
  const width = Number(asset?.width) || 0
  const height = Number(asset?.height) || 0
  return width >= 1600 || height >= 900 || (width >= 900 && height >= 460)
}

function isBeamStripAsset(asset) {
  if (isSceneAsset(asset)) return false
  const { width, height } = assetVisualDimensions(asset)
  return width >= 180 && width / height >= 3.2
}

function isTallImpactAsset(asset) {
  if (isSceneAsset(asset)) return false
  const { width, height } = assetVisualDimensions(asset)
  return height >= 150 && height / width >= 2.35
}

function isCompactParticleAsset(asset) {
  if (isSceneAsset(asset) || isBeamStripAsset(asset)) return false
  const { width, height } = assetVisualDimensions(asset)
  const largestSide = Math.max(width, height)
  const aspect = width / height
  return largestSide <= 132 && aspect >= 0.38 && aspect <= 2.65
}

function animationTempoForMode(mode) {
  if (CONTACT_PIXEL_MODES.has(mode)) return 'quick'
  if (HEAVY_PIXEL_MODES.has(mode)) return 'heavy'
  if (['beam', 'stream', 'projectile', 'drain'].includes(mode)) return 'travel'
  if (['rings', 'status', 'self', 'field', 'hazard'].includes(mode)) return 'ritual'
  return 'standard'
}

function roleAssetsForMove(mode, resourceAssets, fallbackPrimary, fallbackSecondary, profile) {
  const sceneAssets = uniqueAssets(resourceAssets.filter(isSceneAsset))
  const effectAssets = uniqueAssets(resourceAssets.filter((asset) => !isSceneAsset(asset)))
  const beamAsset = mode === 'beam'
    ? effectAssets.find(isBeamStripAsset) ?? null
    : null
  const reusableAssets = effectAssets.filter((asset) => asset !== beamAsset)
  const compactAssets = reusableAssets.filter(isCompactParticleAsset)
  const tallAssets = reusableAssets.filter(isTallImpactAsset)
  const fallbackTrajectory = uniqueAssets([fallbackPrimary, fallbackSecondary])
  const fallbackImpact = impactAssetsForMode(mode, profile).map((file) => ({ file, src: fxAsset(file), kind: 'sprite' }))

  let sourceAssets = []
  if (!CONTACT_PIXEL_MODES.has(mode) && !INLINE_IMPACT_MODES.has(mode)) {
    sourceAssets = uniqueAssets([
      fallbackPrimary,
      fallbackSecondary,
    ]).slice(0, 2)
  }

  let trajectoryAssets = []
  if (!HIDDEN_TRAJECTORY_MODES.has(mode)) {
    const preferredTrajectory = mode === 'beam'
      ? compactAssets
      : mode === 'rain' || mode === 'ground' || mode === 'eruption'
        ? reusableAssets.filter((asset) => !isTallImpactAsset(asset))
        : reusableAssets.filter((asset) => asset !== beamAsset)
    trajectoryAssets = uniqueAssets(
      preferredTrajectory.length ? preferredTrajectory : fallbackTrajectory,
    ).slice(0, mode === 'stream' || mode === 'rain' ? 4 : 3)
  }

  const usedTrajectoryFiles = new Set(trajectoryAssets.map((asset) => asset.file))
  const dedicatedImpact = mode === 'lightning'
    ? uniqueAssets([...tallAssets, ...reusableAssets])
    : CONTACT_PIXEL_MODES.has(mode) || ['ground', 'burst', 'eruption', 'rings', 'self', 'hazard'].includes(mode)
      ? reusableAssets
      : reusableAssets.filter((asset) => !usedTrajectoryFiles.has(asset.file))
  const impactAssets = uniqueAssets([
    ...dedicatedImpact,
    ...fallbackImpact,
  ]).slice(0, 3)

  return {
    sourceAssets,
    trajectoryAssets,
    impactAssets,
    sceneAssets,
    beamAsset,
  }
}

function fieldAssetForMove(profile) {
  if (!profile.targetField && !['terrain', 'weather'].includes(profile.archetype)) return null
  if (profile.moveId.includes('electricterrain')) return 'weather-electricterrain.png'
  if (profile.moveId.includes('grassyterrain')) return 'weather-grassyterrain.png'
  if (profile.moveId.includes('mistyterrain')) return 'weather-mistyterrain.png'
  if (profile.moveId.includes('psychicterrain')) return 'weather-psychicterrain.png'
  if (profile.moveId.includes('trickroom')) return 'weather-trickroom.png'
  if (profile.moveId.includes('magicroom')) return 'weather-magicroom.png'
  if (profile.moveId.includes('wonderroom')) return 'weather-wonderroom.png'
  if (profile.moveId.includes('gravity')) return 'weather-gravity.png'
  if (/rain|water/.test(profile.moveId)) return 'weather-raindance.jpg'
  if (/sand/.test(profile.moveId)) return 'weather-sandstorm.png'
  if (/hail|snow|chilly/.test(profile.moveId)) return 'weather-hail.png'
  if (/wind/.test(profile.moveId)) return 'weather-strongwind.png'
  if (/sun|day/.test(profile.moveId)) return 'weather-sunnyday.jpg'
  return null
}

function impactAssetsForMode(mode, profile) {
  if (mode === 'bite') return ['topbite.png', 'bottombite.png']
  if (mode === 'slash') return ['leftslash.png', 'rightslash.png', 'leftclaw.png']
  if (mode === 'lightning') return ['lightning.png', 'electroball.png']
  if (mode === 'melee') return [profile.archetype === 'kick' ? 'foot.png' : 'fist1.png', 'hitmarker.png']
  if (mode === 'ground') return ['rocks.png', 'rock1.png', 'rock2.png', 'rock3.png']
  if (mode === 'hazard') return [profile.archetype === 'web' ? 'web.png' : profile.type === '독' ? 'poisoncaltrop.png' : 'caltrop.png']
  if (mode === 'rings') return [profile.motif === 'moon' ? 'moon.png' : 'rainbow.png', 'shine.png']
  if (mode === 'self') return [profile.motif === 'sword' ? 'sword.png' : profile.moveId === 'rest' ? 'wisp.png' : 'shine.png']
  if (mode === 'wave') return ['waterwisp.png', 'impact.png']
  if (mode === 'burst' || mode === 'eruption') return ['flareball.png', 'fireball.png', 'impact.png']
  return ['impact.png', 'shine.png']
}

export function getMovePixelAnimationPlan(profile) {
  const mode = ARCHETYPE_PIXEL_MODES[profile.archetype] ?? 'projectile'
  const primaryFile = MOTIF_PIXEL_ASSETS[profile.motif] ?? TYPE_PIXEL_ASSETS[profile.type] ?? 'impact.png'
  const secondaryFile = TYPE_PIXEL_ASSETS[profile.type] ?? 'shine.png'
  const fieldFile = fieldAssetForMove(profile)
  const fallbackPrimary = { file: primaryFile, src: fxAsset(primaryFile), kind: 'sprite' }
  const fallbackSecondary = { file: secondaryFile, src: fxAsset(secondaryFile), kind: 'sprite' }
  const rawResourceAssets = profile.resource?.assets ?? []
  const resourceAssetRecords = rawResourceAssets.length > 24
    ? (() => {
        const anchor = rawResourceAssets[0]?.file?.match(/^eb\d+/i)?.[0]
        const family = anchor
          ? rawResourceAssets.filter((asset) => asset.file?.startsWith(anchor))
          : []
        return (family.length ? family : rawResourceAssets).slice(0, 12)
      })()
    : rawResourceAssets
  const resourceAssets = resourceAssetRecords.map(ebdxAsset)
  const resourceBackgrounds = profile.resource?.backgrounds?.map(ebdxAsset) ?? []
  const primaryAsset = resourceAssets[0] ?? fallbackPrimary
  const secondaryAsset = resourceAssets[1] ?? resourceAssets[0] ?? fallbackSecondary
  const roleAssets = roleAssetsForMove(mode, resourceAssets, fallbackPrimary, fallbackSecondary, profile)
  const smallestParticle = roleAssets.trajectoryAssets.reduce(
    (smallest, asset) => Math.min(smallest, Number(asset.width) || 999, Number(asset.height) || 999),
    999,
  )
  const referenceScale = profile.recordVariant === 'GMAX_MOVE'
    ? 1.16
    : ['MAX_MOVE', 'Z_GENERIC_PHYSICAL', 'Z_GENERIC_SPECIAL', 'Z_SIGNATURE'].includes(profile.recordVariant)
      ? 1.1
      : profile.recordVariant === 'TERA_TYPE_VARIANTS'
        ? 1.06
        : 1
  const baseCopies = mode === 'stream' || mode === 'rain'
    ? 4 + (profile.seed % 2)
    : mode === 'projectile' || mode === 'drain'
      ? 1 + (profile.seed % 2)
      : mode === 'wave'
        ? 2
        : smallestParticle <= 48
          ? 3 + (profile.seed % 2)
          : 2
  const extraCopies = profile.intensity >= 3 && ['stream', 'rain', 'projectile'].includes(mode) ? 1 : 0
  const fallbackFieldAsset = fieldFile ? { file: fieldFile, src: fxAsset(fieldFile), kind: 'background' } : null
  const sceneAssets = uniqueAssets([...resourceBackgrounds, ...roleAssets.sceneAssets, fallbackFieldAsset])
  const impactDuration = clamp(
    500,
    450 + profile.intensity * 58 + (HEAVY_PIXEL_MODES.has(mode) ? 92 : 0),
    760,
  )

  return {
    mode,
    primaryAsset: roleAssets.sourceAssets[0] ?? roleAssets.trajectoryAssets[0] ?? primaryAsset,
    secondaryAsset: roleAssets.sourceAssets[1] ?? roleAssets.trajectoryAssets[1] ?? secondaryAsset,
    sourceAssets: roleAssets.sourceAssets,
    trajectoryAssets: roleAssets.trajectoryAssets,
    impactAssets: roleAssets.impactAssets,
    sceneAssets,
    beamAsset: roleAssets.beamAsset,
    fieldAsset: sceneAssets[0] ?? null,
    copies: Math.min(7, baseCopies + extraCopies),
    scale: (0.84 + (profile.seed % 29) / 100) * referenceScale,
    impactScale: (1 + ((profile.seed >>> 5) % 36) / 100) * referenceScale,
    arc: (profile.seed % 31) - 15,
    stagger: Math.max(54, 74 + (profile.seed % 37) - extraCopies * 5),
    tempo: animationTempoForMode(mode),
    impactDuration,
    inlineImpact: profile.category === 'status' || profile.targetSelf || INLINE_IMPACT_MODES.has(mode),
  }
}

export function getMoveAnimationProfile(move = {}) {
  const moveId = normalizeMoveId(move.moveId ?? move.id ?? move.englishName ?? move.moveName ?? 'unknown')
  const category = move.moveCategory ?? move.categoryId ?? (move.category === '변화' ? 'status' : move.category === '물리' ? 'physical' : 'special')
  const rawType = move.animationType ?? move.moveType ?? move.type ?? '노말'
  const type = rawType === '다크' ? '악' : rawType
  const flags = new Set(move.moveFlags ?? move.flags ?? [])
  const text = `${move.moveName ?? move.name ?? ''} ${move.moveDescription ?? move.description ?? ''}`.toLowerCase()
  const reference = getMoveAnimationReference({ ...move, moveId, moveCategory: category, animationType: type })
  const isSpecialReference = Boolean(move.animationVariant)
    || !['STANDARD_MOVE', 'STANDARD_WITH_HEAL_BRANCH'].includes(reference?.variant)
  const seed = hashMoveId(isSpecialReference ? `${moveId}:${reference?.recordNo ?? 'unmapped'}:${move.animationVariantKey ?? ''}` : moveId)
  const inferred = inferArchetype(moveId, category, type, flags, text)
  const referenceStyle = getReferenceAnimationStyle(reference, category, type, move, inferred)
  const archetype = referenceStyle.archetype ?? inferred.archetype
  const motif = referenceStyle.motif ?? inferred.motif
  const screen = referenceStyle.screen ?? inferred.screen ?? 'none'
  const motion = referenceStyle.motion ?? inferred.motion ?? ARCHETYPE_MOTION[archetype] ?? (category === 'physical' ? 'lunge' : 'cast')
  const theme = TYPE_THEMES[type] ?? TYPE_THEMES.노말
  const power = Math.max(0, Number(move.movePower ?? move.power) || 0)
  const powerIntensity = power >= 120 ? 3 : power >= 75 ? 2 : 1
  const intensity = Math.max(powerIntensity, referenceStyle.intensity ?? 1)
  const baseDuration = ARCHETYPE_DURATION[archetype] ?? (category === 'status' ? 1460 : 1480)
  const resource = MOVE_RESOURCE_BY_ID.get(moveId) ?? null
  const unscaledDuration = resource?.durationMs
    ? Math.round(clamp(760, resource.durationMs * 0.46, 1500))
    : Math.round(clamp(780, baseDuration + (seed % 101) - 50, 1450))
  const duration = Math.round(clamp(760, unscaledDuration * (referenceStyle.durationScale ?? 1), 1720))
  const moveTarget = move.moveTarget ?? move.target
  const targetSelf = ['self', 'allySide', 'allyTeam', 'allies', 'adjacentAllyOrSelf'].includes(moveTarget)
    || ['barrier', 'boost', 'dance', 'restore', 'sleep'].includes(archetype)
  const targetField = ['all', 'allAdjacent'].includes(moveTarget)
    || ['terrain', 'weather'].includes(archetype)
  const targetSpread = ['allAdjacentFoes', 'foeSide'].includes(moveTarget)
  const runtimeCoverage = resource?.specific
    ? 'dedicated-ebdx'
    : resource
      ? 'fallback-ebdx'
      : 'procedural-reference'

  return {
    moveId,
    archetype,
    category,
    motif,
    type,
    screen,
    motion,
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
    generation: Number(reference?.generation ?? move.moveGeneration ?? move.generation ?? resource?.generation) || null,
    sourceKind: resource?.sourceKind ?? 'procedural-reference',
    runtimeCoverage,
    resource,
    reference,
    referenceRecordNo: reference?.recordNo ?? null,
    referenceMoveKey: reference?.moveKey ?? null,
    referenceName: reference?.koreanName ?? reference?.englishName ?? null,
    recordVariant: reference?.variant ?? 'UNMAPPED',
    referenceAvailability: reference?.availability ?? 'UNMAPPED',
    fidelityGrade: reference?.fidelity ?? null,
    manualPriority: reference?.manualPriority ?? null,
    manualVariants: reference?.manualVariants ?? [],
    logicalCanvas: moveAnimationReference.logicalCanvas,
    targetSelf,
    targetField,
    targetSpread,
  }
}

export function getMoveAnimationAssets(move = {}) {
  const profile = getMoveAnimationProfile(move)
  const plan = getMovePixelAnimationPlan(profile)
  return [...new Set([
    ...plan.sceneAssets.map((asset) => asset.src),
    plan.beamAsset?.src,
    ...plan.sourceAssets.map((asset) => asset.src),
    ...plan.trajectoryAssets.map((asset) => asset.src),
    ...plan.impactAssets.map((asset) => asset.src),
  ].filter(Boolean))]
}

export function summarizeMoveAnimationCoverage(moves) {
  const profiles = moves.map((move) => getMoveAnimationProfile(move))
  return {
    total: profiles.length,
    covered: profiles.filter((profile) => profile.archetype).length,
    referenceMatched: profiles.filter((profile) => profile.referenceRecordNo).length,
    dedicatedEbdx: profiles.filter((profile) => profile.runtimeCoverage === 'dedicated-ebdx').length,
    fallbackEbdx: profiles.filter((profile) => profile.runtimeCoverage === 'fallback-ebdx').length,
    archetypes: [...new Set(profiles.map((profile) => profile.archetype))].sort(),
  }
}
