// Selection and visual metadata only. Boss move sets and encounter rules stay
// out of the catalog consumed by the selection screen.
export const RAID_BOSS_CATALOG = Object.freeze([
  { id: 'mewtwo', name: '뮤츠', speciesId: 150, subtitle: '로켓단의 비밀 병기' },
  { id: 'hooh', name: '칠색조', speciesId: 250, subtitle: '되살아나는 전설' },
  { id: 'lugia', name: '루기아', speciesId: 249, subtitle: '폭풍 속 어둠의 수호자' },
])

export const RAID_FORM_MANIFEST = Object.freeze({
  armored: { name: '아머드 뮤츠', front: '/assets/pokemon/skins/armored-mewtwo-front.gif', back: '/assets/pokemon/skins/armored-mewtwo-back.gif', revision: 1 },
  dark: { name: '다크루기아', sheet: '/assets/pokemon/skins/shadow-lugia-sheet.png', revision: 1, aura: 'shadow' },
})
