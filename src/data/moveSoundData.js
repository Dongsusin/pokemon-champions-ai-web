import { getMoveAnimationProfile } from './moveAnimationData.js'

const clamp = (minimum, value, maximum) => Math.min(maximum, Math.max(minimum, value))

const TYPE_RETRO_SAMPLES = {
  노말: 'retroNormal', 불꽃: 'retroFire', 물: 'retroWater', 전기: 'retroElectric',
  풀: 'retroGrass', 얼음: 'retroIce', 격투: 'retroFighting', 독: 'retroPoison',
  땅: 'retroGround', 비행: 'retroFlying', 에스퍼: 'retroPsychic', 벌레: 'retroBug',
  바위: 'retroRock', 고스트: 'retroGhost', 드래곤: 'retroDragon', 악: 'retroDark',
  강철: 'retroSteel', 페어리: 'retroFairy', 스텔라: 'retroStellar',
}

const TYPE_LABELS = {
  normal: '노말', fire: '불꽃', water: '물', electric: '전기', grass: '풀', ice: '얼음',
  fighting: '격투', poison: '독', ground: '땅', flying: '비행', psychic: '에스퍼',
  bug: '벌레', rock: '바위', ghost: '고스트', dragon: '드래곤', dark: '악',
  steel: '강철', fairy: '페어리', stellar: '스텔라',
}

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
  ailment: { launch: ['statusAilment', 'spell1', 'magic4'], impact: ['statusAilment', 'slime1'] },
  barrage: { launch: ['punch', 'hit'], impact: ['punch', 'hit'] },
  barrier: { launch: ['barrier', 'gem1', 'metal1'], impact: ['barrier', 'metal2'] },
  beam: { launch: ['magic6', 'electricCrackle', 'spell2'], impact: ['electricHit', 'magic7', 'explosion'] },
  bite: { launch: ['punch', 'slime1'], impact: ['hit', 'punch'] },
  blast: { launch: ['spell1', 'magic6', 'fire1'], impact: ['magic7', 'explosion', 'hit'] },
  boost: { launch: ['statusUp', 'magic2', 'gem1'], impact: ['statusUp', 'gem2'] },
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
  restore: { launch: ['heal', 'magic2', 'gem1'], impact: ['heal', 'gem2'] },
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
  vanish: { launch: ['recall', 'magic5', 'wind'], impact: ['ballOpen', 'hit'] },
  wave: { launch: ['waterBubbles', 'wind', 'magic6'], impact: ['waterImpact', 'hit'] },
  weather: { launch: ['wind', 'waterBubbles', 'magic6'], impact: ['wind', 'magic3'] },
  web: { launch: ['chain1', 'slime1'], impact: ['chain2', 'slime2'] },
  whip: { launch: ['chain1', 'wind'], impact: ['chain2', 'hit'] },
}

const MOVE_SOUND_OVERRIDES = {
  airslash: { launchSample: 'blade1', textureSample: 'retroFlying', impactSample: 'blade2', semitones: [0, 12, 7], cadence: 0.04 },
  aquajet: { launchSample: 'retroWater', textureSample: 'wind', impactSample: 'waterImpact', sampleRate: 1.18, semitones: [0, 7, 12], cadence: 0.034 },
  aurasphere: { launchSample: 'magic6', textureSample: 'retroFighting', impactSample: 'magic7', semitones: [0, 7, 12, 7], cadence: 0.055 },
  blizzard: { launchSample: 'wind', textureSample: 'ice1', impactSample: 'ice3', semitones: [0, 12, 7, 15], cadence: 0.052 },
  boomburst: { launchSample: 'retroNormal', textureSample: 'magic6', impactSample: 'explosionHeavy', sampleRate: 0.68, pulseCount: 3, pulseGap: 0.09, semitones: [0, 0, -12], cadence: 0.08 },
  bravebird: { launchSample: 'retroFlying', textureSample: 'wind', impactSample: 'punch', sampleRate: 0.84, semitones: [-12, 0, 7, 12], cadence: 0.045 },
  bugbuzz: { launchSample: 'retroBug', textureSample: 'chain1', impactSample: 'chain2', semitones: [0, 1, 0, 12], cadence: 0.042 },
  bulletpunch: { launchSample: 'punch', textureSample: 'retroSteel', impactSample: 'metal2', sampleRate: 1.2, semitones: [0, 12, -12], cadence: 0.033 },
  calmmind: { launchSample: 'statusUp', textureSample: 'retroPsychic', impactSample: 'magic3', semitones: [0, 4, 7, 12], cadence: 0.09 },
  closecombat: { launchSample: 'punch', impactSample: 'punch', pulseCount: 4, pulseGap: 0.075, semitones: [0, -2, 3] },
  crunch: { launchSample: 'retroDark', textureSample: 'punch', impactSample: 'hit', sampleRate: 0.78, semitones: [0, -7, -12], cadence: 0.065 },
  darkpulse: { launchSample: 'magic4', textureSample: 'retroDark', impactSample: 'magic5', pulseCount: 3, pulseGap: 0.095, semitones: [0, 6, 0, -12], cadence: 0.07 },
  dazzlinggleam: { launchSample: 'retroFairy', textureSample: 'gem1', impactSample: 'gem2', semitones: [0, 7, 12, 19], cadence: 0.048 },
  dracometeor: { launchSample: 'magic7', textureSample: 'wind', impactSample: 'explosionHeavy', semitones: [12, 7, 3, -5], cadence: 0.07 },
  dragonclaw: { launchSample: 'blade3', textureSample: 'retroDragon', impactSample: 'blade2', semitones: [0, 7, -5], cadence: 0.042 },
  dragondance: { launchSample: 'statusUp', textureSample: 'retroDragon', impactSample: 'magic7', semitones: [-12, 0, 7, 12], cadence: 0.075 },
  dragonpulse: { launchSample: 'retroDragon', textureSample: 'magic6', impactSample: 'magic7', semitones: [0, 7, 10, 12], cadence: 0.06 },
  drainpunch: { launchSample: 'punch', textureSample: 'retroFighting', impactSample: 'punch', semitones: [-12, -5, 0, 7], cadence: 0.055 },
  earthpower: { launchSample: 'retroGround', textureSample: 'stone1', impactSample: 'explosion', semitones: [-12, -5, 0, 7], cadence: 0.07 },
  earthquake: { launchSample: 'electricGround', textureSample: 'stone1', impactSample: 'stone2', sampleRate: 0.72, semitones: [0, -5, -12] },
  ember: { launchSample: 'retroFire', textureSample: 'fire1', impactSample: 'fire2', sampleRate: 1.16, semitones: [0, 7, 3], cadence: 0.045 },
  energyball: { launchSample: 'magic1', textureSample: 'retroGrass', impactSample: 'magic3', semitones: [0, 4, 7, 12], cadence: 0.05 },
  explosion: { launchSample: 'explosion', impactSample: 'explosionHeavy', sampleRate: 0.76, semitones: [12, 0, -12], cadence: 0.045 },
  extremespeed: { launchSample: 'wind', textureSample: 'retroNormal', impactSample: 'punch', sampleRate: 1.24, semitones: [-12, 12, 19], cadence: 0.032 },
  fireblast: { launchSample: 'fire3', impactSample: 'explosionHeavy', semitones: [0, 7, 12, 19], cadence: 0.048 },
  firepunch: { launchSample: 'punch', textureSample: 'retroFire', impactSample: 'fire2', semitones: [0, 7, -5], cadence: 0.04 },
  flamethrower: { launchSample: 'fire1', textureSample: 'fire2', impactSample: 'fire3', semitones: [0, 3, 7, 10], cadence: 0.043 },
  flareblitz: { launchSample: 'retroFire', textureSample: 'wind', impactSample: 'explosion', sampleRate: 0.85, semitones: [-5, 0, 7, 12], cadence: 0.038 },
  flashcannon: { launchSample: 'magic6', textureSample: 'retroSteel', impactSample: 'metal2', semitones: [0, 12, 7, 19], cadence: 0.046 },
  focusblast: { launchSample: 'retroFighting', textureSample: 'magic6', impactSample: 'explosionHeavy', sampleRate: 0.85, semitones: [-12, 0, 7, 19], cadence: 0.053 },
  freezedry: { launchSample: 'retroIce', textureSample: 'wind', impactSample: 'ice2', semitones: [12, 7, 0, -12], cadence: 0.055 },
  gigadrain: { launchSample: 'retroGrass', textureSample: 'magic4', impactSample: 'magic1', semitones: [-12, -5, 0, 7], cadence: 0.08 },
  growl: { launchSample: 'statusDown', textureSample: 'retroNormal', impactSample: 'statusDown', semitones: [0, -3, -7], cadence: 0.085 },
  heatwave: { launchSample: 'fire2', textureSample: 'retroFire', impactSample: 'fire3', semitones: [-5, 0, 7, 10], cadence: 0.064 },
  hurricane: { launchSample: 'wind', textureSample: 'retroFlying', impactSample: 'wind', sampleRate: 0.8, semitones: [-12, 7, 0, 12], cadence: 0.06 },
  fissure: { launchSample: 'stone1', impactSample: 'explosionHeavy', sampleRate: 0.68, semitones: [-12, -7, -19] },
  hydropump: { launchSample: 'waterBubbles', textureSample: 'wind', impactSample: 'waterImpact', semitones: [0, 5, 12, 17], cadence: 0.04 },
  hyperbeam: { launchSample: 'magic6', textureSample: 'electricCrackle', impactSample: 'explosionHeavy', sampleRate: 0.8, semitones: [-12, 0, 7, 19], cadence: 0.06 },
  hypervoice: { launchSample: 'retroNormal', textureSample: 'magic2', impactSample: 'hit', pulseCount: 3, pulseGap: 0.11, semitones: [0, 7, 0, 12], cadence: 0.072 },
  icebeam: { launchSample: 'ice1', textureSample: 'magic2', impactSample: 'ice3', semitones: [0, 12, 16, 19], cadence: 0.05 },
  icepunch: { launchSample: 'punch', textureSample: 'retroIce', impactSample: 'ice2', semitones: [0, 12, -5], cadence: 0.043 },
  ironhead: { launchSample: 'retroSteel', textureSample: 'wind', impactSample: 'metal1', semitones: [0, 7, -12], cadence: 0.047 },
  leafblade: { launchSample: 'blade1', textureSample: 'retroGrass', impactSample: 'blade3', semitones: [0, 7, 12], cadence: 0.038 },
  machpunch: { launchSample: 'punch', textureSample: 'retroFighting', impactSample: 'hit', sampleRate: 1.24, semitones: [0, 12, -12], cadence: 0.032 },
  moonblast: { launchSample: 'retroFairy', textureSample: 'magic6', impactSample: 'gem2', semitones: [-12, 0, 7, 12], cadence: 0.08 },
  nightslash: { launchSample: 'blade2', textureSample: 'retroDark', impactSample: 'blade3', semitones: [7, 0, -12], cadence: 0.04 },
  outrage: { launchSample: 'retroDragon', textureSample: 'punch', impactSample: 'explosion', pulseCount: 3, pulseGap: 0.085, semitones: [0, -5, 7, -12], cadence: 0.048 },
  overheat: { launchSample: 'fire3', textureSample: 'retroFire', impactSample: 'explosionHeavy', sampleRate: 0.7, semitones: [12, 7, 0, -12], cadence: 0.065 },
  playrough: { launchSample: 'punch', textureSample: 'retroFairy', impactSample: 'hit', pulseCount: 3, pulseGap: 0.07, semitones: [0, 7, 4, 12], cadence: 0.04 },
  poisonjab: { launchSample: 'punch', textureSample: 'retroPoison', impactSample: 'slime2', semitones: [0, -3, -7], cadence: 0.045 },
  protect: { launchSample: 'barrier', textureSample: 'metal1', impactSample: 'gem2', semitones: [0, 7, 12], cadence: 0.065 },
  psychic: { launchSample: 'magic3', textureSample: 'magic5', impactSample: 'magic4', semitones: [0, 6, 12, 18], cadence: 0.058 },
  psyshock: { launchSample: 'retroPsychic', textureSample: 'gem1', impactSample: 'magic4', semitones: [0, 6, 12, 6], cadence: 0.052 },
  quickattack: { launchSample: 'wind', textureSample: 'retroNormal', impactSample: 'hit', sampleRate: 1.18, semitones: [0, 7, 12], cadence: 0.035 },
  razorleaf: { launchSample: 'retroGrass', textureSample: 'blade1', impactSample: 'wood2', pulseCount: 3, pulseGap: 0.07, semitones: [0, 7, 4], cadence: 0.042 },
  recover: { launchSample: 'heal', textureSample: 'gem1', impactSample: 'magic3', semitones: [0, 4, 7, 12], cadence: 0.082 },
  rest: { launchSample: 'heal', textureSample: 'magic5', impactSample: 'magic2', sampleRate: 0.78, semitones: [7, 4, 0, -12], cadence: 0.094 },
  rockslide: { launchSample: 'retroRock', textureSample: 'stone1', impactSample: 'stone2', pulseCount: 3, pulseGap: 0.11, semitones: [7, 0, -5, -12], cadence: 0.068 },
  roost: { launchSample: 'heal', textureSample: 'wind', impactSample: 'magic3', semitones: [0, 7, 12, 19], cadence: 0.08 },
  scald: { launchSample: 'retroWater', textureSample: 'fire1', impactSample: 'waterImpact', semitones: [0, 5, 12, 7], cadence: 0.057 },
  shadowball: { launchSample: 'magic4', textureSample: 'slime1', impactSample: 'magic5', semitones: [-5, 0, 6, 12], cadence: 0.057 },
  shadowclaw: { launchSample: 'blade2', textureSample: 'retroGhost', impactSample: 'blade3', semitones: [0, 6, -12], cadence: 0.046 },
  sing: { launchSample: 'magic2', textureSample: 'retroFairy', impactSample: 'magic1', sampleRate: 0.8, semitones: [0, 4, 7, 4], cadence: 0.094 },
  sludgebomb: { launchSample: 'retroPoison', textureSample: 'slime1', impactSample: 'slime2', semitones: [-5, 0, 6, -12], cadence: 0.062 },
  solarbeam: { launchSample: 'magic6', textureSample: 'retroGrass', impactSample: 'magic7', semitones: [-12, 0, 12, 19], cadence: 0.056 },
  stealthrock: { launchSample: 'stone1', textureSample: 'retroRock', impactSample: 'stone2', semitones: [0, 7, 3, 10], cadence: 0.073 },
  stoneedge: { launchSample: 'retroRock', textureSample: 'blade3', impactSample: 'stone2', semitones: [-12, 0, 7], cadence: 0.048 },
  substitute: { launchSample: 'recall', textureSample: 'magic1', impactSample: 'ballOpen', semitones: [12, 0, -12, 7], cadence: 0.06 },
  surf: { launchSample: 'waterBubbles', textureSample: 'wind', impactSample: 'waterImpact', sampleRate: 0.84, semitones: [-5, 0, 5, 12], cadence: 0.068 },
  swordsdance: { launchSample: 'blade1', textureSample: 'magic2', impactSample: 'blade3', semitones: [0, 7, 12, 19], cadence: 0.07 },
  tackle: { launchSample: 'retroNormal', textureSample: 'wind', impactSample: 'hit', sampleRate: 1, semitones: [0, -5, -12], cadence: 0.047 },
  teleport: { launchSample: 'recall', textureSample: 'retroPsychic', impactSample: 'ballOpen', semitones: [0, 12, 24, 12], cadence: 0.05 },
  thunder: { launchSample: 'electricCrackle', impactSample: 'electricGround', sampleRate: 0.78, semitones: [12, 7, 0, -12], cadence: 0.04 },
  thunderbolt: { launchSample: 'electricCrackle', textureSample: 'electricHit', impactSample: 'electricGround', semitones: [0, 12, 7, 19], cadence: 0.036 },
  thunderpunch: { launchSample: 'punch', textureSample: 'retroElectric', impactSample: 'electricHit', semitones: [0, 12, 7], cadence: 0.038 },
  thundershock: { launchSample: 'retroElectric', textureSample: 'electricCrackle', impactSample: 'electricHit', sampleRate: 1.16, semitones: [0, 12, 0], cadence: 0.038 },
  thunderwave: { launchSample: 'retroElectric', textureSample: 'statusAilment', impactSample: 'electricCrackle', semitones: [0, 1, 12, 1], cadence: 0.065 },
  toxic: { launchSample: 'slime1', textureSample: 'magic4', impactSample: 'slime2', semitones: [0, -3, -7, -12], cadence: 0.073 },
  trickroom: { launchSample: 'retroPsychic', textureSample: 'magic5', impactSample: 'magic4', sampleRate: 0.72, semitones: [12, 6, 0, -6], cadence: 0.094 },
  volttackle: { launchSample: 'retroElectric', textureSample: 'wind', impactSample: 'electricGround', semitones: [-12, 0, 12, 7], cadence: 0.037 },
  watergun: { launchSample: 'retroWater', textureSample: 'waterBubbles', impactSample: 'waterImpact', sampleRate: 1.12, semitones: [0, 5, 12], cadence: 0.048 },
  waterfall: { launchSample: 'waterBubbles', textureSample: 'retroWater', impactSample: 'waterImpact', sampleRate: 0.9, semitones: [-12, -5, 0, 12], cadence: 0.065 },
  willowisp: { launchSample: 'retroGhost', textureSample: 'retroFire', impactSample: 'fire1', semitones: [0, 6, 12, 6], cadence: 0.077 },
  xscissor: { launchSample: 'blade1', textureSample: 'retroBug', impactSample: 'blade2', pulseCount: 2, pulseGap: 0.065, semitones: [0, 7, 0, 12], cadence: 0.038 },
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
  const rawType = move.animationType ?? move.moveType ?? move.type ?? move.typeId ?? '노말'
  const rawCategory = move.moveCategory ?? move.categoryId ?? move.category
  // Descriptions and translated display names must never change an audible recipe.
  // Animation references still supply the move ID, type, category and variant style.
  const animation = getMoveAnimationProfile({
    ...move,
    moveId: move.moveId ?? move.id ?? move.englishName ?? 'unknown',
    animationType: TYPE_LABELS[rawType] ?? rawType,
    moveCategory: ['physical', 'special', 'status'].includes(rawCategory) ? rawCategory : undefined,
    name: '', moveName: '', description: '', moveDescription: '',
  })
  const flags = new Set(move.moveFlags ?? move.flags ?? [])
  const isSoundMove = flags.has('sound') || animation.archetype === 'sound'
  const isDrainMove = Boolean(move.moveDrain ?? move.drain)
  const isHealingMove = animation.category === 'status' && flags.has('heal')
  const archetype = isSoundMove ? 'sound' : isDrainMove ? 'drain' : animation.archetype
  const typeTheme = TYPE_SOUND_THEMES[animation.type] ?? TYPE_SOUND_THEMES.노말
  const archetypeBank = ARCHETYPE_SOUND_BANKS[archetype] ?? ARCHETYPE_SOUND_BANKS.blast
  const override = MOVE_SOUND_OVERRIDES[animation.moveId] ?? {}
  const power = Math.max(0, Number(move.movePower ?? move.power) || 0)
  const powerWeight = power >= 120 ? 3 : power >= 75 ? 2 : 1
  const pulseCount = override.pulseCount ?? multihitCount(move.moveMultihit ?? move.multihit, animation.archetype)
  const semitones = override.semitones ?? generatedSemitones(animation.seed, 3 + (animation.seed % 2))
  const launchSample = override.launchSample ?? chooseSample(archetypeBank.launch, animation.seed, 1)
  const typeTextureSample = TYPE_RETRO_SAMPLES[animation.type] ?? 'retroNormal'
  const textureSample = override.textureSample
    ?? (typeTextureSample !== launchSample ? typeTextureSample : chooseSample(archetypeBank.launch, animation.seed, 11))
  const impactSample = override.impactSample
    ?? chooseSample([...archetypeBank.impact, ...typeTheme.impact], animation.seed, 13)
  const isChargeMove = flags.has('charge')
  const isSelfDestruct = Boolean(move.moveSelfdestruct ?? move.selfdestruct)
  const sampleRate = clamp(0.62, override.sampleRate ?? (0.9 + ((animation.seed >>> 3) % 29) / 100 - powerWeight * 0.035), 1.28)
  const cadence = clamp(0.032, override.cadence ?? (0.045 + ((animation.seed >>> 9) % 43) / 1000), 0.094)
  const signatureFrequencies = semitones.map((semitone) => typeTheme.root * (2 ** (semitone / 12)))

  return {
    ...animation,
    archetype,
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
    isDrainMove,
    isHealingMove,
    typeTextureSample,
    soundSource: MOVE_SOUND_OVERRIDES[animation.moveId] ? 'authored-move' : 'type-archetype',
    soundFingerprint: animation.seed.toString(36).padStart(7, '0'),
  }
}
