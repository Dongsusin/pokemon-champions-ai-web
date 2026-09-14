import { RAID_BOSS_CATALOG } from './raidCatalog.js'
export { RAID_FORM_MANIFEST } from './raidCatalog.js'

export const RAID_RULE_VERSION = 1
export const RAID_ENGINE_VERSION = 1
export const RAID_SCHEMA_VERSION = 1
export const RAID_DEFAULTS = Object.freeze({ level: 50, bossHpMultiplier: 8, commandSeconds: 45, stageTurnLimit: 80, totalTurnLimit: 120, winVp: 300, firstClearVp: 500 })

export const RAID_BOSSES = Object.freeze([
  { ...RAID_BOSS_CATALOG[0],
    stageOne: [{ speciesId: 24, trainer: '로사', moves: ['gunkshot', 'crunch', 'glare', 'protect'] }, { speciesId: 110, trainer: '로이', moves: ['sludgebomb', 'flamethrower', 'willowisp', 'protect'] }, { speciesId: 34, trainer: '비주기', moves: ['earthpower', 'sludgebomb', 'icebeam', 'thunderbolt'] }],
    moves: ['psystrike', 'aurasphere', 'icebeam', 'shadowball'] },
  { ...RAID_BOSS_CATALOG[1],
    stageOne: [{ speciesId: 244, trainer: '엔테이', moves: ['sacredfire', 'stoneedge', 'crunch', 'protect'] }, { speciesId: 243, trainer: '라이코', moves: ['thunderbolt', 'shadowball', 'extrasensory', 'reflect'] }, { speciesId: 245, trainer: '스이쿤', moves: ['scald', 'icebeam', 'tailwind', 'reflect'] }],
    moves: ['sacredfire', 'bravebird', 'earthquake', 'extrasensory'] },
  { ...RAID_BOSS_CATALOG[2],
    stageOne: [{ speciesId: 145, trainer: '썬더', moves: ['thunderbolt', 'hurricane', 'heatwave', 'tailwind'] }, { speciesId: 146, trainer: '파이어', moves: ['flamethrower', 'airslash', 'scorchingsands', 'willowisp'] }, { speciesId: 144, trainer: '프리져', moves: ['icebeam', 'hurricane', 'reflect', 'tailwind'] }],
    moves: ['aeroblast', 'hydropump', 'psychic', 'icebeam'] },
])
export const getRaidBoss = (id) => RAID_BOSSES.find((boss) => boss.id === id)
export const RAID_NPCS = Object.freeze([
  { role: 'attack', speciesId: 181, moves: ['thunderbolt', 'dragonpulse', 'powergem', 'lightscreen'] },
  { role: 'support', speciesId: 131, moves: ['icebeam', 'hydropump', 'lifedew', 'reflect'] },
  { role: 'physical', speciesId: 214, moves: ['megahorn', 'closecombat', 'rockslide', 'knockoff'] },
])
