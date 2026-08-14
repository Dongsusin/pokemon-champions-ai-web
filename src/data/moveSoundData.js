import { getMoveAnimationProfile } from './moveAnimationData.js'

const clamp = (minimum, value, maximum) => Math.min(maximum, Math.max(minimum, value))

const TYPE_SOUND_THEMES = {
  노말: { root: 220, wave: 'square', texture: ['hit', 'punch'], impact: ['hit', 'punch'] },
  불꽃: { root: 247, wave: 'sawtooth', texture: ['fire1', 'fire2', 'fire3'], impact: ['fire2', 'explosion'] },
  물: { root: 196, wave: 'triangle', texture: ['waterBubbles', 'waterImpact'], impact: ['waterImpact', 'hit'] },
  전기: { root: 294, wave: 'square', texture: ['electricCrackle', 'electricHit'], impact: ['electricGround', 'electricHit'] },
  풀: { root: 208, wave: 'triangle', texture: ['wood1', 'wood2', 'spell1'], impact: ['wood1', 'hit'] },
  얼음: { root: 330, wave: 'sine', texture: ['ice1', 'ice2', 'ice3'], impact: ['ice2', 'ice3'] },
  격투: { root: 165, wave: 'square', texture: ['punch', 'hit'], impact: ['punch', 'hit'] },
  독: { root: 185, wave: 'sawtooth', texture: ['slime1', 'slime2'], impact: ['slime2', 'hit'] },
  땅: { root: 147, wave: 'sawtooth', texture: ['stone1', 'stone2'], impact: ['stone1', 'electricGround'] },
  비행: { root: 294, wave: 'triangle', texture: ['wind', 'spell2'], impact: ['wind', 'hit'] },
  에스퍼: { root: 349, wave: 'sine', texture: ['magic1', 'magic2', 'magic3'], impact: ['magic3', 'gem1'] },
  벌레: { root: 208, wave: 'square', texture: ['chain1', 'wood2'], impact: ['chain2', 'hit'] },
  바위: { root: 131, wave: 'square', texture: ['stone1', 'stone2'], impact: ['stone2', 'electricGround'] },
  고스트: { root: 175, wave: 'triangle', texture: ['magic4', 'magic5', 'slime1'], impact: ['magic5', 'hit'] },
  드래곤: { root: 233, wave: 'sawtooth', texture: ['magic6', 'magic7', 'fire3'], impact: ['magic7', 'explosion'] },
  악: { root: 156, wave: 'sawtooth', texture: ['magic4', 'slime2'], impact: ['magic4', 'hit'] },
  강철: { root: 262, wave: 'square', texture: ['metal1', 'metal2', 'blade2'], impact: ['metal2', 'hit'] },
  페어리: { root: 392, wave: 'sine', texture: ['gem1', 'gem2', 'magic2'], impact: ['gem2', 'magic3'] },
  스텔라: { root: 415, wave: 'sine', texture: ['gem1', 'magic6', 'magic7'], impact: ['gem2', 'magic7'] },
}

const ARCHETYPE_SOUND_BANKS = {
  aerial: { launch: ['wind', 'spell2'], impact: ['hit', 'wind'] },
  ailment: { launch: ['spell1', 'magic1', 'magic4'], impact: ['magic3', 'slime1'] },
  barrage: { launch: ['punch', 'hit'], impact: ['punch', 'hit'] },
  barrier: { launch: ['magic2', 'gem1', 'metal1'], impact: ['gem2', 'metal2'] },
  beam: { launch: ['magic6', 'electricCrackle', 'spell2'], impact: ['electricHit', 'magic7', 'explosion'] },
  bite: { launch: ['punch', 'slime1'], impact: ['hit', 'punch'] },
  blast: { launch: ['spell1', 'magic6', 'fire1'], impact: ['magic7', 'explosion', 'hit'] },
  boost: { launch: ['magic1', 'magic2', 'gem1'], impact: ['magic3', 'gem2'] },
  crystal: { launch: ['ice1', 'ice2', 'gem1'], impact: ['ice2', 'ice3'] },
  dance: { launch: ['magic2', 'gem1', 'blade1'], impact: ['gem2', 'magic3'] },
  dash: { launch: ['wind', 'punch', 'hit'], impact: ['punch', 'hit'] },
  drain: { launch: ['magic4', 'slime1', 'spell1'], impact: ['magic1', 'slime2'] },
  eruption: { launch: ['fire2', 'fire3', 'explosion'], impact: ['explosionHeavy', 'fire3'] },
  explosion: { launch: ['fire3', 'explosion'], impact: ['explosionHeavy', 'explosion'] },
  hazard: { launch: ['stone1', 'chain1', 'wood1'], impact: ['stone2', 'chain2'] },
  kick: { launch: ['wind', 'punch'], impact: ['punch', 'hit'] },
  leaves: { launch: ['wood1', 'wood2', 'wind'], impact: ['wood2', 'hit'] },
  lightning: { launch: ['electricCrackle', 'electricHit'], impact: ['electricGround', 'electricHit'] },
  meteor: { launch: ['wind', 'stone1', 'magic6'], impact: ['stone2', 'explosionHeavy'] },
  orb: { launch: ['spell1', 'magic1', 'magic6'], impact: ['magic7', 'explosion', 'hit'] },
  prism: { launch: ['gem1', 'magic2', 'magic6'], impact: ['gem2', 'magic7'] },
  psychic: { launch: ['magic1', 'magic3', 'magic5'], impact: ['magic4', 'gem2'] },
  pulse: { launch: ['magic4', 'magic6', 'spell2'], impact: ['magic7', 'explosion'] },
  punch: { launch: ['punch', 'wind'], impact: ['punch', 'hit'] },
  quake: { launch: ['stone1', 'electricGround'], impact: ['stone2', 'explosionHeavy'] },
  restore: { launch: ['magic1', 'magic2', 'gem1'], impact: ['magic3', 'gem2'] },
  seed: { launch: ['wood1', 'spell1'], impact: ['wood2', 'hit'] },
  slash: { launch: ['blade1', 'blade2', 'blade3'], impact: ['blade2', 'hit'] },
  sleep: { launch: ['magic1', 'magic5'], impact: ['magic2', 'spell1'] },
  sludge: { launch: ['slime1', 'slime2'], impact: ['slime2', 'hit'] },
  sound: { launch: ['magic2', 'magic6', 'spell2'], impact: ['magic7', 'hit'] },
  spectral: { launch: ['magic4', 'magic5', 'slime1'], impact: ['magic5', 'hit'] },
  spin: { launch: ['wind', 'chain1'], impact: ['chain2', 'hit'] },
  storm: { launch: ['wind', 'magic6', 'waterBubbles'], impact: ['wind', 'electricHit', 'waterImpact'] },
  stream: { launch: ['waterBubbles', 'wind', 'fire1'], impact: ['waterImpact', 'fire2', 'hit'] },
  strike: { launch: ['punch', 'hit'], impact: ['punch', 'hit'] },
  terrain: { launch: ['magic1', 'magic3', 'spell1'], impact: ['magic2', 'gem1'] },
  vanish: { launch: ['magic4', 'magic5', 'wind'], impact: ['magic1', 'hit'] },
  wave: { launch: ['waterBubbles', 'wind', 'magic6'], impact: ['waterImpact', 'hit'] },
  weather: { launch: ['wind', 'waterBubbles', 'magic6'], impact: ['wind', 'magic3'] },
  web: { launch: ['chain1', 'slime1'], impact: ['chain2', 'slime2'] },
  whip: { launch: ['chain1', 'wind'], impact: ['chain2', 'hit'] },
}

const MOVE_SOUND_OVERRIDES = {
  blizzard: { launchSample: 'wind', textureSample: 'ice1', impactSample: 'ice3', semitones: [0, 12, 7, 15], cadence: 0.052 },
  closecombat: { launchSample: 'punch', impactSample: 'punch', pulseCount: 4, pulseGap: 0.075, semitones: [0, -2, 3] },
  dracometeor: { launchSample: 'magic7', textureSample: 'wind', impactSample: 'explosionHeavy', semitones: [12, 7, 3, -5], cadence: 0.07 },
  earthquake: { launchSample: 'electricGround', textureSample: 'stone1', impactSample: 'stone2', sampleRate: 0.72, semitones: [0, -5, -12] },
  explosion: { launchSample: 'explosion', impactSample: 'explosionHeavy', sampleRate: 0.76, semitones: [12, 0, -12], cadence: 0.045 },
  fireblast: { launchSample: 'fire3', impactSample: 'explosionHeavy', semitones: [0, 7, 12, 19], cadence: 0.048 },
  flamethrower: { launchSample: 'fire1', textureSample: 'fire2', impactSample: 'fire3', semitones: [0, 3, 7, 10], cadence: 0.043 },
  fissure: { launchSample: 'stone1', impactSample: 'explosionHeavy', sampleRate: 0.68, semitones: [-12, -7, -19] },
  hydropump: { launchSample: 'waterBubbles', textureSample: 'wind', impactSample: 'waterImpact', semitones: [0, 5, 12, 17], cadence: 0.04 },
  hyperbeam: { launchSample: 'magic6', textureSample: 'electricCrackle', impactSample: 'explosionHeavy', sampleRate: 0.8, semitones: [-12, 0, 7, 19], cadence: 0.06 },
  icebeam: { launchSample: 'ice1', textureSample: 'magic2', impactSample: 'ice3', semitones: [0, 12, 16, 19], cadence: 0.05 },
  protect: { launchSample: 'gem1', textureSample: 'metal1', impactSample: 'gem2', semitones: [0, 7, 12], cadence: 0.065 },
  psychic: { launchSample: 'magic3', textureSample: 'magic5', impactSample: 'magic4', semitones: [0, 6, 12, 18], cadence: 0.058 },
  recover: { launchSample: 'magic1', textureSample: 'gem1', impactSample: 'magic3', semitones: [0, 4, 7, 12], cadence: 0.082 },
  shadowball: { launchSample: 'magic4', textureSample: 'slime1', impactSample: 'magic5', semitones: [-5, 0, 6, 12], cadence: 0.057 },
  surf: { launchSample: 'waterBubbles', textureSample: 'wind', impactSample: 'waterImpact', sampleRate: 0.84, semitones: [-5, 0, 5, 12], cadence: 0.068 },
  swordsdance: { launchSample: 'blade1', textureSample: 'magic2', impactSample: 'blade3', semitones: [0, 7, 12, 19], cadence: 0.07 },
  thunder: { launchSample: 'electricCrackle', impactSample: 'electricGround', sampleRate: 0.78, semitones: [12, 7, 0, -12], cadence: 0.04 },
  thunderbolt: { launchSample: 'electricCrackle', textureSample: 'electricHit', impactSample: 'electricGround', semitones: [0, 12, 7, 19], cadence: 0.036 },
  toxic: { launchSample: 'slime1', textureSample: 'magic4', impactSample: 'slime2', semitones: [0, -3, -7, -12], cadence: 0.073 },
}

const SEMITONE_SCALE = [-12, -7, -5, -2, 0, 3, 5, 7, 10, 12, 15, 19]

function chooseSample(samples, seed, shift = 0) {
  if (!samples?.length) return null
  return samples[(seed >>> shift) % samples.length]
}

function multihitCount(value, archetype) {
  if (Array.isArray(value)) return Math.min(4, Math.max(2, Number(value[0]) || 2))
  if (Number(value) > 1) return Math.min(4, Number(value))
  return archetype === 'barrage' ? 3 : 1
}

function generatedSemitones(seed, count) {
  return Array.from({ length: count }, (_, index) => {
    const shift = index * 5
    return SEMITONE_SCALE[(seed >>> shift) % SEMITONE_SCALE.length]
  })
}

export function getMoveSoundProfile(move = {}) {
  const animation = getMoveAnimationProfile(move)
  const typeTheme = TYPE_SOUND_THEMES[animation.type] ?? TYPE_SOUND_THEMES.노말
  const archetypeBank = ARCHETYPE_SOUND_BANKS[animation.archetype] ?? ARCHETYPE_SOUND_BANKS.blast
  const override = MOVE_SOUND_OVERRIDES[animation.moveId] ?? {}
  const power = Math.max(0, Number(move.movePower ?? move.power) || 0)
  const powerWeight = power >= 120 ? 3 : power >= 75 ? 2 : 1
  const pulseCount = override.pulseCount ?? multihitCount(move.moveMultihit ?? move.multihit, animation.archetype)
  const semitones = override.semitones ?? generatedSemitones(animation.seed, 3 + (animation.seed % 2))
  const launchSample = override.launchSample ?? chooseSample(archetypeBank.launch, animation.seed, 1)
  const typeTextureSample = chooseSample(typeTheme.texture, animation.seed, 7)
  const textureSample = override.textureSample
    ?? (typeTextureSample !== launchSample ? typeTextureSample : chooseSample(archetypeBank.launch, animation.seed, 11))
  const impactSample = override.impactSample
    ?? chooseSample([...archetypeBank.impact, ...typeTheme.impact], animation.seed, 13)
  const isChargeMove = (move.moveFlags ?? move.flags ?? []).includes('charge')
  const isSoundMove = (move.moveFlags ?? move.flags ?? []).includes('sound') || animation.archetype === 'sound'
  const isSelfDestruct = Boolean(move.moveSelfdestruct ?? move.selfdestruct)
  const sampleRate = clamp(0.62, override.sampleRate ?? (0.9 + ((animation.seed >>> 3) % 29) / 100 - powerWeight * 0.035), 1.28)
  const cadence = clamp(0.032, override.cadence ?? (0.045 + ((animation.seed >>> 9) % 43) / 1000), 0.094)
  const signatureFrequencies = semitones.map((semitone) => typeTheme.root * (2 ** (semitone / 12)))

  return {
    ...animation,
    root: typeTheme.root,
    wave: isSoundMove ? 'sine' : typeTheme.wave,
    launchSample: isSelfDestruct ? 'explosion' : launchSample,
    textureSample: isSelfDestruct ? 'fire3' : textureSample,
    impactSample: isSelfDestruct ? 'explosionHeavy' : impactSample,
    sampleRate: isSelfDestruct ? 0.7 : sampleRate,
    sampleDuration: isChargeMove ? 0.74 : clamp(0.24, 0.3 + animation.intensity * 0.1 + (animation.seed % 17) / 100, 0.72),
    textureRate: clamp(0.65, sampleRate * (0.88 + ((animation.seed >>> 15) % 23) / 100), 1.35),
    textureDelay: isChargeMove ? 0.18 : 0.075 + ((animation.seed >>> 19) % 70) / 1000,
    textureDuration: isChargeMove ? 0.82 : clamp(0.2, 0.28 + (animation.seed % 21) / 100, 0.64),
    signatureFrequencies,
    signatureCadence: cadence,
    signatureDuration: clamp(0.04, cadence * 1.5, 0.13),
    signatureVolume: 0.055 + animation.intensity * 0.012,
    pulseCount,
    pulseGap: override.pulseGap ?? clamp(0.055, 0.074 + (animation.seed % 45) / 1000, 0.12),
    impactRate: clamp(0.58, sampleRate * (0.9 + ((animation.seed >>> 23) % 19) / 100), 1.3),
    impactDuration: clamp(0.18, 0.25 + animation.intensity * 0.08, 0.58),
    lowpass: 1450 + ((animation.seed >>> 4) % 2800),
    highpass: 120 + ((animation.seed >>> 12) % 520),
    isChargeMove,
    isSoundMove,
    soundFingerprint: animation.seed.toString(36).padStart(7, '0'),
  }
}
