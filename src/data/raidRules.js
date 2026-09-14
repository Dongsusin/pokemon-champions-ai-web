export const RAID_RULE_VERSION = 1
export const RAID_ENGINE_VERSION = 1
export const RAID_SCHEMA_VERSION = 1
export const RAID_DEFAULTS = Object.freeze({ level: 50, bossHpMultiplier: 8, commandSeconds: 45, stageTurnLimit: 80, totalTurnLimit: 120, winVp: 300, firstClearVp: 500 })

export const RAID_BOSSES = Object.freeze([
  { id: 'mewtwo', name: '뮤츠', speciesId: 150, subtitle: '로켓단의 비밀 병기',
    stageOne: [{ speciesId: 24, trainer: '로사', moves: ['gunkshot', 'crunch', 'glare', 'protect'] }, { speciesId: 110, trainer: '로이', moves: ['sludgebomb', 'flamethrower', 'willowisp', 'protect'] }, { speciesId: 34, trainer: '비주기', moves: ['earthpower', 'sludgebomb', 'icebeam', 'thunderbolt'] }],
    moves: ['psystrike', 'aurasphere', 'icebeam', 'shadowball'], gates: { 50: '아머드 뮤츠 · 여섯 능력 +1', 25: '격노 · 매 턴 두 번 공격' } },
  { id: 'hooh', name: '칠색조', speciesId: 250, subtitle: '되살아나는 전설',
    stageOne: [{ speciesId: 244, trainer: '엔테이', moves: ['sacredfire', 'stoneedge', 'crunch', 'protect'] }, { speciesId: 243, trainer: '라이코', moves: ['thunderbolt', 'shadowball', 'extrasensory', 'reflect'] }, { speciesId: 245, trainer: '스이쿤', moves: ['scald', 'icebeam', 'tailwind', 'reflect'] }],
    moves: ['sacredfire', 'bravebird', 'earthquake', 'extrasensory'], gates: { 50: '전설의 짐승 부활 · 본체와 첫 소환수 강화', 25: '다른 전설의 짐승 한 마리 부활' } },
  { id: 'lugia', name: '루기아', speciesId: 249, subtitle: '폭풍 속 어둠의 수호자',
    stageOne: [{ speciesId: 145, trainer: '썬더', moves: ['thunderbolt', 'hurricane', 'heatwave', 'tailwind'] }, { speciesId: 146, trainer: '파이어', moves: ['flamethrower', 'airslash', 'scorchingsands', 'willowisp'] }, { speciesId: 144, trainer: '프리져', moves: ['icebeam', 'hurricane', 'reflect', 'tailwind'] }],
    moves: ['aeroblast', 'hydropump', 'psychic', 'icebeam'], gates: { 50: '다크루기아 · 필드 정화와 고정 비', 25: '여섯 능력 +1' } },
])
export const getRaidBoss = (id) => RAID_BOSSES.find((boss) => boss.id === id)
export const RAID_NPCS = Object.freeze([
  { role: 'attack', speciesId: 181, moves: ['thunderbolt', 'dragonpulse', 'powergem', 'lightscreen'] },
  { role: 'support', speciesId: 131, moves: ['icebeam', 'hydropump', 'lifedew', 'reflect'] },
  { role: 'physical', speciesId: 214, moves: ['megahorn', 'closecombat', 'rockslide', 'knockoff'] },
])
export const RAID_FORM_MANIFEST = Object.freeze({
  armored: { name: '아머드 뮤츠', front: '/assets/pokemon/skins/armored-mewtwo-front.gif', back: '/assets/pokemon/skins/armored-mewtwo-back.gif', revision: 1 },
  dark: { name: '다크루기아', sheet: '/assets/pokemon/skins/shadow-lugia-sheet.png', revision: 1, aura: 'shadow' },
})
