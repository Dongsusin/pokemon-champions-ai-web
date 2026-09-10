import battleMoves from './generatedBattleMoves.json' with { type: 'json' }

const MOVE_BY_ID = new Map(battleMoves.moves.map((move) => [move.id, move]))
const normalizeId = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const bounded = (value, fallback, low, high) => {
  const number = Number(value)
  return Math.min(high, Math.max(low, Number.isFinite(number) ? number : fallback))
}

export const MOVE_CHOREOGRAPHY_FAMILIES = Object.freeze([
  'beam', 'stream', 'bolt', 'orb', 'slash', 'melee', 'dash', 'drain', 'wave',
  'eruption', 'meteor', 'vortex', 'barrier', 'heal', 'boost', 'status', 'field', 'burst',
])

const FAMILY_DEFAULTS = Object.freeze({
  beam: { motion: 'cast', density: 18, impact: 'shatter', release: 0.34, arrival: 0.84 },
  stream: { motion: 'cast', density: 24, impact: 'splash', release: 0.22, arrival: 0.8 },
  bolt: { motion: 'cast', density: 18, impact: 'spark', release: 0.24, arrival: 0.69 },
  orb: { motion: 'cast', density: 16, impact: 'ring', release: 0.3, arrival: 0.79 },
  slash: { motion: 'lunge', density: 10, impact: 'slash', release: 0.25, arrival: 0.65 },
  melee: { motion: 'lunge', density: 14, impact: 'spark', release: 0.2, arrival: 0.67 },
  dash: { motion: 'dash', density: 16, impact: 'spark', release: 0.2, arrival: 0.62 },
  drain: { motion: 'cast', density: 20, impact: 'pulse', release: 0.25, arrival: 0.78 },
  wave: { motion: 'cast', density: 26, impact: 'splash', release: 0.25, arrival: 0.83 },
  eruption: { motion: 'pulse', density: 24, impact: 'shatter', release: 0.33, arrival: 0.79 },
  meteor: { motion: 'cast', density: 20, impact: 'shatter', release: 0.28, arrival: 0.81 },
  vortex: { motion: 'cast', density: 28, impact: 'ring', release: 0.22, arrival: 0.83 },
  barrier: { motion: 'still', density: 12, impact: 'none', release: 0.2, arrival: 0.62 },
  heal: { motion: 'rise', density: 18, impact: 'none', release: 0.18, arrival: 0.8 },
  boost: { motion: 'rise', density: 16, impact: 'none', release: 0.22, arrival: 0.74 },
  status: { motion: 'cast', density: 16, impact: 'none', release: 0.26, arrival: 0.76 },
  field: { motion: 'still', density: 28, impact: 'none', release: 0.18, arrival: 0.8 },
  burst: { motion: 'pulse', density: 30, impact: 'ring', release: 0.32, arrival: 0.75 },
})

const ARCHETYPE_FAMILY = Object.freeze({
  beam: 'beam', stream: 'stream', lightning: 'bolt', orb: 'orb', slash: 'slash',
  punch: 'melee', kick: 'melee', bite: 'melee', barrage: 'melee', strike: 'melee',
  dash: 'dash', aerial: 'dash', drain: 'drain', wave: 'wave', pulse: 'wave', sound: 'wave',
  eruption: 'eruption', quake: 'eruption', meteor: 'meteor', storm: 'vortex', spin: 'vortex',
  barrier: 'barrier', restore: 'heal', boost: 'boost', dance: 'boost', ailment: 'status',
  sleep: 'status', seed: 'status', web: 'status', vanish: 'status', hazard: 'field',
  weather: 'field', terrain: 'field', explosion: 'burst', blast: 'burst', prism: 'burst',
  psychic: 'wave', spectral: 'orb', sludge: 'stream', leaves: 'wave', whip: 'slash',
  crystal: 'meteor',
})

const MOTIF_FAMILY = Object.freeze({
  bolt: 'bolt', spark: 'bolt', flame: 'stream', water: 'wave', ice: 'meteor',
  rock: 'meteor', meteor: 'meteor', blade: 'slash', vine: 'slash', lash: 'slash',
  fang: 'melee', fist: 'melee', impact: 'melee', feather: 'dash', wind: 'vortex',
  spiral: 'vortex', storm: 'vortex', ring: 'wave', sound: 'wave', dragon: 'wave',
  toxic: 'stream', ghost: 'orb', energy: 'orb', leaf: 'wave', sparkle: 'burst',
})

const TRANSFORMED_VARIANTS = new Set([
  'MAX_MOVE', 'GMAX_MOVE', 'Z_GENERIC_PHYSICAL', 'Z_GENERIC_SPECIAL', 'Z_SIGNATURE',
  'TERA_TYPE_VARIANTS', 'FORM_TYPE_VARIANTS', 'SHADOW_MOVE', 'STARMOBILE_TORQUE', 'PLZA_NEW_MOVE',
])

// Authored poses, silhouettes, pacing and color accents. Moves in a group share a
// visual phrase; the remaining catalog uses structured family/type fallbacks.
const AUTHORED_GROUPS = [
  ['fireblast', 'eruption', 'fire-cross', { scale: 1.4, density: 26, release: 0.34 }],
  ['flamethrower', 'stream', 'flame-jet', { density: 30, scale: 1.2 }],
  ['ember', 'stream', 'flame-jet', { density: 10, scale: 0.8, release: 0.2 }],
  ['overheat eruption blastburn', 'eruption', 'volcano', { scale: 1.5, density: 32, release: 0.38 }],
  ['firespin inferno', 'vortex', 'fire-spiral', { density: 26 }],
  ['heatwave', 'wave', 'fire-spiral', { density: 24, scale: 1.3 }],
  ['flareblitz sacredfire', 'dash', 'comet', { scale: 1.25, density: 24 }],
  ['hydropump', 'stream', 'water-jet', { density: 32, scale: 1.4, release: 0.3 }],
  ['watergun', 'stream', 'water-jet', { density: 12, scale: 0.8, release: 0.18 }],
  ['scald hydrosteam', 'stream', 'water-jet', { density: 22, palette: ['#66dfff', '#2b95dc', '#eefcff'] }],
  ['bubble bubblebeam', 'stream', 'poison-bubble', { density: 20, scale: 0.95 }],
  ['surf muddywater originpulse sparklingaria', 'wave', 'tidal-wave', { density: 32, scale: 1.45 }],
  ['aquajet wavecrash waterfall', 'dash', 'comet', { scale: 1.15 }],
  ['whirlpool', 'vortex', 'wind-spiral', { density: 24 }],
  ['thunderbolt', 'bolt', 'forked-bolt', { density: 20, scale: 1.1 }],
  ['thunder', 'bolt', 'sky-bolt', { density: 30, scale: 1.5, anticipation: 0.18, release: 0.39 }],
  ['discharge', 'bolt', 'forked-bolt', { density: 30, scale: 1.35 }],
  ['chargebeam', 'beam', 'energy-ray', { density: 12, scale: 0.85 }],
  ['electroball', 'orb', 'aura', { density: 18 }],
  ['volttackle wildcharge', 'dash', 'comet', { density: 26, scale: 1.2 }],
  ['thunderwave', 'status', 'hex-web', { density: 14 }],
  ['solarbeam', 'beam', 'solar-charge', { scale: 1.4, density: 26, anticipation: 0.2, release: 0.43, arrival: 0.88, palette: ['#ceff65', '#61c542', '#ffffd5'] }],
  ['solarblade', 'slash', 'leaf-blade', { scale: 1.45, anticipation: 0.2, release: 0.4 }],
  ['energyball', 'orb', 'leaf-core', { density: 18, scale: 1.05 }],
  ['razorleaf leafage magicalleaf', 'wave', 'petal', { density: 18, scale: 0.95 }],
  ['leafblade vinewhip powerwhip', 'slash', 'leaf-blade', { density: 12, scale: 1.15 }],
  ['leafstorm', 'vortex', 'leaf-spiral', { density: 32, scale: 1.45 }],
  ['petaldance petalblizzard', 'vortex', 'petal', { density: 30, palette: ['#ff9fc8', '#b656a5', '#fff3fa'] }],
  ['seedbomb bulletseed', 'orb', 'leaf-core', { density: 12, scale: 0.9, release: 0.2 }],
  ['leechseed', 'status', 'seed-vine', { density: 14, release: 0.2 }],
  ['spore sleeppowder', 'status', 'sleep-mote', { density: 24, scale: 1.1 }],
  ['icebeam freezedry', 'beam', 'ice-crystal', { density: 20, scale: 1.15 }],
  ['aurorabeam', 'beam', 'ice-crystal', { density: 18, palette: ['#8defff', '#bb91ff', '#faffff'] }],
  ['blizzard', 'vortex', 'wind-spiral', { density: 32, scale: 1.45 }],
  ['iciclecrash iciclespear avalanche', 'meteor', 'rock-fall', { density: 20, scale: 1.2 }],
  ['glaciallance', 'slash', 'cross-cut', { density: 18, scale: 1.5, release: 0.35 }],
  ['aurasphere', 'orb', 'aura', { density: 18, palette: ['#66d8ff', '#2458c4', '#eefcff'] }],
  ['focusblast', 'orb', 'aura', { density: 26, scale: 1.4, release: 0.36, palette: ['#ffce67', '#b96927', '#fff5cd'] }],
  ['closecombat armthrust doublehit', 'melee', 'fist-barrage', { density: 22, scale: 1.2, arrival: 0.72 }],
  ['machpunch bulletpunch firepunch icepunch thunderpunch dynamicpunch', 'melee', 'fist-barrage', { density: 12, release: 0.2, arrival: 0.6 }],
  ['drainpunch', 'drain', 'life-mote', { motion: 'lunge', density: 18 }],
  ['shadowball', 'orb', 'shadow', { density: 20, scale: 1.15, palette: ['#a88af0', '#37215f', '#eae0ff'] }],
  ['shadowclaw shadowforce phantomforce', 'slash', 'shadow-claw', { density: 16, release: 0.35 }],
  ['hex nightshade', 'orb', 'hex-web', { density: 20 }],
  ['willowisp', 'status', 'ghost-flame', { density: 10, palette: ['#afa0ff', '#5849c6', '#e7ffff'] }],
  ['shadowsneak', 'dash', 'speed-lines', { density: 12, release: 0.14, arrival: 0.54 }],
  ['astralbarrage', 'orb', 'shadow', { density: 32, scale: 1.45 }],
  ['dracometeor', 'meteor', 'dragon-meteor', { density: 28, scale: 1.5, anticipation: 0.17, release: 0.37 }],
  ['dragonpulse', 'wave', 'sound-ring', { density: 18, scale: 1.25 }],
  ['dragonclaw', 'slash', 'cross-cut', { density: 12, scale: 1.15 }],
  ['outrage', 'melee', 'fist-barrage', { density: 28, scale: 1.4 }],
  ['dragonascent', 'dash', 'comet', { motion: 'leap', density: 28, scale: 1.5 }],
  ['dynamaxcannon eternabeam', 'beam', 'energy-ray', { density: 30, scale: 1.6, release: 0.4 }],
  ['hyperbeam', 'beam', 'energy-ray', { density: 26, scale: 1.5, release: 0.39, palette: ['#ffd891', '#e68c52', '#fffdf1'] }],
  ['gigaimpact', 'dash', 'comet', { density: 28, scale: 1.5 }],
  ['tackle quickattack extremespeed return', 'dash', 'speed-lines', { density: 12, scale: 0.95, release: 0.16, arrival: 0.58 }],
  ['swift', 'meteor', 'star-fall', { density: 18, scale: 0.9 }],
  ['boomburst hypervoice snarl bugbuzz disarmingvoice', 'wave', 'sound-ring', { density: 18 }],
  ['triattack', 'orb', 'prism', { density: 18, palette: ['#ffe07b', '#78bcff', '#ff91a9'] }],
  ['explosion selfdestruct mistyexplosion mindblown', 'burst', 'explosion', { density: 32, scale: 1.6, release: 0.36 }],
  ['stoneedge precipiceblades', 'eruption', 'ground-fissure', { density: 20, scale: 1.3, release: 0.35 }],
  ['rockslide rockthrow rockblast', 'meteor', 'rock-fall', { density: 20, scale: 1.15 }],
  ['earthquake earthpower magnitude bulldoze fissure', 'eruption', 'ground-fissure', { density: 26, scale: 1.35 }],
  ['powergem meteorbeam flashcannon', 'beam', 'metal-ray', { density: 20, scale: 1.2 }],
  ['psychic psyshock expandingforce', 'wave', 'sound-ring', { density: 22, scale: 1.2 }],
  ['storedpower', 'orb', 'aura', { density: 20 }],
  ['futuresight', 'orb', 'moon', { density: 18, anticipation: 0.18, release: 0.4 }],
  ['darkpulse', 'wave', 'sound-ring', { density: 20, palette: ['#ad85d4', '#39224f', '#ead4ff'] }],
  ['bite crunch thunderfang icefang firefang', 'melee', 'fangs', { density: 10, scale: 1.15 }],
  ['nightslash xscissor sacredsword kowtowcleave', 'slash', 'cross-cut', { density: 12, scale: 1.2 }],
  ['suckerpunch ironhead meteormash gigatonhammer', 'melee', 'fist-barrage', { density: 18, scale: 1.3 }],
  ['makeitrain', 'meteor', 'star-fall', { density: 30, scale: 1.3, palette: ['#ffd766', '#a66f2d', '#fff7c7'] }],
  ['moonblast', 'orb', 'moon', { density: 22, scale: 1.25, palette: ['#ffc7ef', '#967ad6', '#fffaff'] }],
  ['dazzlinggleam fleurcannon', 'burst', 'prism', { density: 26, scale: 1.35 }],
  ['playrough', 'melee', 'fairy-flurry', { density: 20, scale: 1.2 }],
  ['drainingkiss', 'drain', 'heart', { density: 14, scale: 0.9 }],
  ['absorb megadrain gigadrain oblivionwing paraboliccharge', 'drain', 'life-mote', { density: 24 }],
  ['strengthsap', 'drain', 'seed-vine', { density: 18, scale: 0.95 }],
  ['pollenpuff', 'orb', 'pollen', { density: 18, palette: ['#f2e58e', '#a4b85f', '#fff9d9'] }],
  ['airslash aircutter aerialace', 'slash', 'cross-cut', { density: 14, scale: 1.15 }],
  ['hurricane twister', 'vortex', 'wind-spiral', { density: 30, scale: 1.35 }],
  ['bravebird acrobatics', 'dash', 'comet', { motion: 'leap', density: 24, scale: 1.25 }],
  ['sludgebomb sludgewave gunkshot acid', 'stream', 'poison-bubble', { density: 22, scale: 1.15 }],
  ['poisonjab', 'melee', 'fist-barrage', { density: 12 }],
  ['toxic poisonpowder poisongas', 'status', 'venom-mote', { density: 20 }],
  ['protect detect kingsshield spikyshield banefulbunker silktrap', 'barrier', 'shield-dome', { density: 12, scale: 1.2 }],
  ['reflect lightscreen auroraveil wideguard quickguard', 'barrier', 'light-wall', { density: 14, scale: 1.35 }],
  ['recover roost softboiled slackoff milkdrink lifedew healpulse floralhealing rest', 'heal', 'heal-orbit', { density: 20, scale: 1.05 }],
  ['moonlight synthesis morningsun lunarblessing', 'heal', 'moon-heal', { density: 22, scale: 1.2 }],
  ['swordsdance', 'boost', 'sword-orbit', { density: 12, scale: 1.25 }],
  ['calmmind dragondance quiverdance agility nastyplot bulkup growth', 'boost', 'inner-halo', { density: 18, scale: 1.15 }],
  ['shellsmash', 'boost', 'shell-break', { density: 18, scale: 1.2 }],
  ['hypnosis sing yawn darkvoid lovelykiss grasswhistle', 'status', 'sleep-mote', { density: 18 }],
  ['stringshot', 'status', 'hex-web', { density: 16 }],
  ['stickyweb', 'field', 'hex-web', { density: 16 }],
  ['sunnyday raindance sandstorm snowscape hail chillyreception', 'field', 'weather', { density: 28, scale: 1.3 }],
  ['electricterrain grassyterrain psychicterrain mistyterrain trickroom wonderroom magicroom gravity', 'field', 'terrain', { density: 26, scale: 1.3 }],
  ['stealthrock spikes toxicspikes', 'field', 'hazard', { density: 16, scale: 1.1 }],
]

const authoredEntries = AUTHORED_GROUPS.flatMap(([moveIds, family, signature, options]) => (
  moveIds.split(' ').map((id) => [id, Object.freeze({
    family, signature, ...options,
    ...(options.palette ? { palette: Object.freeze([...options.palette]) } : {}),
  })])
))
export const AUTHORED_MOVE_CHOREOGRAPHIES = Object.freeze(Object.fromEntries(authoredEntries))
export const MOVE_CHOREOGRAPHY_SIGNATURES = Object.freeze([...new Set(authoredEntries.map(([, entry]) => entry.signature))])

const NO_HIT_RESULTS = new Set(['miss', 'immune', 'blocked', 'failed', 'reflected', 'charging', 'waiting', 'protect-contact'])
const ALLY_TARGETS = new Set(['adjacentAlly', 'adjacentAllyOrSelf', 'allies', 'allySide', 'allyTeam'])
const FIELD_ARCHETYPES = new Set(['terrain', 'weather', 'hazard'])
const HEAL_TARGET_IDS = new Set(['healpulse', 'floralhealing', 'healbell', 'aromatherapy', 'junglehealing', 'lunarblessing', 'purify'])

function resolveTarget(rawTarget, cue) {
  if (rawTarget === 'all' || rawTarget === 'allAdjacent') return 'field'
  if (rawTarget === 'foeSide' || rawTarget === 'allAdjacentFoes') return 'foe-side'
  if (['allySide', 'allyTeam', 'allies'].includes(rawTarget)) return 'ally-side'
  if (rawTarget === 'self') return 'self'
  if (cue.sideId && cue.targetSideId === cue.sideId) {
    return (cue.targetSlot ?? 0) === (cue.actorSlot ?? 0) ? 'self' : 'ally'
  }
  if (cue.targetSideId && cue.sideId && cue.targetSideId !== cue.sideId) return 'foe'
  return ALLY_TARGETS.has(rawTarget) ? 'ally' : 'foe'
}

function familyFor(profile, move, category, target, flags) {
  if (move.id === 'strengthsap') return 'drain'
  if (move.drain) return 'drain'
  if (category === 'status') {
    if (move.heal || HEAL_TARGET_IDS.has(move.id) || flags.has('heal')) return 'heal'
    if (move.weather || move.terrain || move.pseudoWeather || FIELD_ARCHETYPES.has(profile.archetype)) return 'field'
    if (profile.archetype === 'barrier' && ['self', 'ally', 'ally-side'].includes(target)) return 'barrier'
    if (move.boosts && Object.values(move.boosts).some((amount) => amount > 0) && ['self', 'ally', 'ally-side'].includes(target)) return 'boost'
    return 'status'
  }
  if (flags.has('slicing')) return 'slash'
  if (flags.has('punch') || flags.has('bite')) return 'melee'
  if (flags.has('sound')) return 'wave'
  return ARCHETYPE_FAMILY[profile.archetype] ?? MOTIF_FAMILY[profile.motif]
    ?? (category === 'physical' ? 'melee' : 'orb')
}

/** A deterministic visual recipe. Mechanics and recipient choice come from fields, never prose. */
export function getMoveChoreography(profile = {}, cue = {}) {
  const id = normalizeId(cue.moveId ?? profile.moveId ?? cue.id ?? 'unknown') || 'unknown'
  const transformed = TRANSFORMED_VARIANTS.has(profile.recordVariant)
  const isMaxGuard = profile.referenceMoveKey === 'MAX_GUARD'
  // A Max/Z move no longer inherits a base move's drain, contact or authored pose.
  const move = transformed ? { id } : MOVE_BY_ID.get(id) ?? { id }
  const authored = transformed ? {} : AUTHORED_MOVE_CHOREOGRAPHIES[id] ?? {}
  const category = cue.moveCategory ?? profile.category ?? move.categoryId ?? 'special'
  const flags = new Set(transformed ? [] : cue.moveFlags ?? move.flags ?? [])
  const rawTarget = isMaxGuard ? 'self' : cue.moveTarget ?? move.target
    ?? (profile.targetSelf ? 'self' : profile.targetField ? 'all' : profile.targetSpread ? 'allAdjacentFoes' : 'normal')
  const target = resolveTarget(rawTarget, cue)
  const pollenHeal = !transformed && id === 'pollenpuff' && (cue.healsTarget || cue.animationBranch === 'HEAL_RESULT'
    || profile.category === 'status' && profile.archetype === 'restore'
    || Boolean(cue.sideId && cue.targetSideId === cue.sideId && (cue.targetSlot ?? 0) !== (cue.actorSlot ?? 0)))
  let family = isMaxGuard ? 'barrier' : transformed
    ? ARCHETYPE_FAMILY[profile.archetype] ?? MOTIF_FAMILY[profile.motif] ?? (category === 'physical' ? 'melee' : 'orb')
    : authored.family ?? familyFor(profile, move, category, target, flags)
  if (pollenHeal) family = 'heal'
  else if (category === 'status' && !['drain', 'barrier', 'heal', 'boost', 'status', 'field'].includes(family)) {
    family = familyFor(profile, move, category, target, flags)
  }
  // Hostile debuff dances and sleep moves remain on their actual target.
  if (category === 'status' && family === 'boost' && ['foe', 'foe-side'].includes(target)) family = 'status'
  const defaults = FAMILY_DEFAULTS[family] ?? FAMILY_DEFAULTS.orb
  const supportive = pollenHeal || family === 'heal'
    || category === 'status' && ['self', 'ally', 'ally-side'].includes(target)
  const field = family === 'field' || ['field', 'ally-side', 'foe-side'].includes(target)
  const noImpact = NO_HIT_RESULTS.has(cue.result) || cue.effectiveness === 0
    || category === 'status' || supportive || (cue.phase === 'impact' && Number(cue.damage) === 0)
  const palette = [profile.primary, profile.secondary, profile.highlight].map((color, index) => (
    /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : ['#d9dee8', '#8792a5', '#ffffff'][index]
  ))
  const intensity = bounded(profile.intensity, 1, 1, 3)
  const anticipation = bounded(authored.anticipation, family === 'dash' ? 0.08 : 0.12, 0.04, 0.22)
  const release = bounded(authored.release, defaults.release, anticipation + 0.08, 0.48)
  const arrival = bounded(authored.arrival, defaults.arrival, release + 0.15, 0.9)
  return {
    id,
    family,
    signature: authored.signature ?? null,
    palette: [...(authored.palette ?? palette)],
    timing: { anticipation, release, arrival, settle: 1 },
    density: Math.round(bounded(authored.density, defaults.density + (intensity - 1) * 2, 8, 32)),
    scale: bounded(authored.scale, 0.9 + intensity * 0.1, 0.75, 1.6),
    impact: {
      style: noImpact ? 'none' : defaults.impact === 'none' ? 'ring' : defaults.impact,
      strength: noImpact ? 0 : bounded(cue.critical ? 0.9 : 0.35 + intensity * 0.16, 0.5, 0, 1),
    },
    motion: authored.motion ?? defaults.motion,
    field,
    supportive,
    target,
  }
}
