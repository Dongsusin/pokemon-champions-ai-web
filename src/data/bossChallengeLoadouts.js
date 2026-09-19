// Curated against this game's learnsets and item catalog. The game uses a
// 66-point training budget (32 per stat), rather than external EV/IV fields.
const points = spread => ({ hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, ...spread })
const physical = points({ hp: 2, attack: 32, speed: 32 })
const special = points({ hp: 2, specialAttack: 32, speed: 32 })
const bulkyPhysical = points({ hp: 32, attack: 32, specialDefense: 2 })
const bulkySpecial = points({ hp: 32, specialAttack: 32, specialDefense: 2 })
const physicalWall = points({ hp: 32, defense: 32, specialDefense: 2 })
const specialWall = points({ hp: 32, defense: 2, specialDefense: 32 })
const flexibleMechanics = ['terastallization', 'dynamax']
const set = (speciesId, moves, heldItemId, ability, nature, trainingPoints, teraType, battleMechanics = flexibleMechanics) => ({
  speciesId, moves, heldItemId, ability, nature, teraType, battleMechanics: [...battleMechanics],
  ...(trainingPoints ? { trainingPoints: { ...trainingPoints } } : {}),
})

export const BOSS_CHALLENGE_LOADOUTS = {
  mewtwo: [
    {
      pokemon: [
        set(24, ['gunkshot', 'knockoff', 'suckerpunch', 'glare'], 'life-orb', '위협', '고집', physical, '악'),
        set(110, ['sludgebomb', 'heatwave', 'willowisp', 'protect'], 'black-sludge', '화학변화가스', '대담', physicalWall, '독', ['terastallization']),
        set(52, ['fakeout', 'icywind', 'taunt', 'helpinghand'], 'focus-sash', '테크니션', '겁쟁이', special, '고스트', ['terastallization']),
        set(202, ['counter', 'mirrorcoat', 'encore', 'destinybond'], 'mental-herb', '그림자밟기', '차분', points({ hp: 2, defense: 32, specialDefense: 32 }), '악', ['terastallization']),
        set(455, ['powerwhip', 'knockoff', 'sleeppowder', 'leechseed'], 'leftovers', '부유', '고집', bulkyPhysical, '물'),
        set(469, ['bugbuzz', 'airslash', 'tailwind', 'protect'], 'buginium-z--held', '가속', '조심', special, '비행', ['z-move', 'terastallization', 'dynamax']),
      ],
    },
    {
      pokemon: [
        set(53, ['fakeout', 'knockoff', 'taunt', 'uturn'], 'silk-scarf', '테크니션', '명랑', physical, '악'),
        set(31, ['earthpower', 'icebeam', 'toxic', 'stealthrock'], 'black-sludge', '우격다짐', '조심', bulkySpecial, '독', ['terastallization']),
        set(34, ['earthpower', 'sludgewave', 'icebeam', 'flamethrower'], 'life-orb', '우격다짐', '겁쟁이', special, '물'),
        set(112, ['earthquake', 'rockslide', 'swordsdance', 'stealthrock'], 'eviolite', '피뢰침', '고집', bulkyPhysical, '풀'),
        set(51, ['earthquake', 'stoneedge', 'suckerpunch', 'sandstorm'], 'focus-sash', '개미지옥', '명랑', physical, '땅'),
        set(115, ['fakeout', 'doubleedge', 'suckerpunch', 'drainpunch'], 'kangaskhanite', '배짱', '명랑', physical, '노말', ['mega-evolution']),
      ],
      battleGimmicks: [{ type: 'mega-evolution', pokemonSpeciesId: 115, targetFormId: 10039 }],
    },
    {
      // Finals retain their original neutral nature/default training and 1x
      // stats. HP-gated forms remain solely under the campaign mechanic.
      pokemon: [set(150, ['psystrike', 'aurasphere', 'recover', 'toxic'], 'life-orb', '긴장감', '노력', null, '에스퍼', [])],
    },
  ],
  hooh: [
    {
      pokemon: [
        set(42, ['bravebird', 'tailwind', 'taunt', 'roost'], 'eviolite', '정신력', '명랑', points({ hp: 32, defense: 2, speed: 32 }), '강철', ['terastallization']),
        set(110, ['sludgebomb', 'heatwave', 'willowisp', 'protect'], 'black-sludge', '화학변화가스', '대담', physicalWall, '독', ['terastallization']),
        set(89, ['gunkshot', 'knockoff', 'drainpunch', 'toxic'], 'leftovers', '독수', '고집', bulkyPhysical, '물'),
        set(24, ['gunkshot', 'knockoff', 'suckerpunch', 'glare'], 'life-orb', '위협', '고집', physical, '악'),
        set(44, ['gigadrain', 'sludgebomb', 'sleeppowder', 'helpinghand'], 'sitrus-berry', '엽록소', '조심', bulkySpecial, '물'),
        set(198, ['tailwind', 'haze', 'taunt', 'foulplay'], 'focus-sash', '짓궂은마음', '차분', specialWall, '고스트', ['terastallization']),
      ],
    },
    {
      // This exact order is also the source of the two distinct revival waves.
      pokemon: [
        set(244, ['sacredfire', 'extremespeed', 'stoneedge', 'sandstorm'], 'sitrus-berry', '정신력', '고집', physical, '노말'),
        set(245, ['scald', 'calmmind', 'rest', 'toxic'], 'leftovers', '프레셔', '대담', physicalWall, '독', ['terastallization']),
        set(243, ['thunderbolt', 'aurasphere', 'shadowball', 'toxic'], 'life-orb', '정신력', '겁쟁이', special, '얼음'),
      ],
    },
    {
      pokemon: [set(250, ['sacredfire', 'bravebird', 'recover', 'toxic'], 'leftovers', '프레셔', '노력', null, '불꽃', [])],
    },
  ],
  lugia: [
    {
      pokemon: [
        set(24, ['gunkshot', 'knockoff', 'suckerpunch', 'glare'], 'life-orb', '위협', '고집', physical, '악'),
        set(45, ['gigadrain', 'sludgebomb', 'sleeppowder', 'helpinghand'], 'black-sludge', '포자', '대담', physicalWall, '독', ['terastallization']),
        set(198, ['tailwind', 'haze', 'taunt', 'foulplay'], 'eviolite', '짓궂은마음', '차분', specialWall, '고스트', ['terastallization']),
        set(229, ['heatwave', 'darkpulse', 'nastyplot', 'protect'], 'houndoominite', '타오르는불꽃', '겁쟁이', special, '악', ['mega-evolution']),
        set(110, ['sludgebomb', 'heatwave', 'willowisp', 'protect'], 'sitrus-berry', '화학변화가스', '대담', physicalWall, '물', ['terastallization']),
        set(169, ['bravebird', 'tailwind', 'taunt', 'roost'], 'flyinium-z--held', '정신력', '명랑', physical, '비행', ['z-move', 'terastallization', 'dynamax']),
      ],
      battleGimmicks: [{ type: 'mega-evolution', pokemonSpeciesId: 229, targetFormId: 10048 }],
    },
    {
      pokemon: [
        set(146, ['flamethrower', 'hurricane', 'roost', 'willowisp'], 'heavy-duty-boots', '불꽃몸', '겁쟁이', special, '풀'),
        set(144, ['freezedry', 'roost', 'haze', 'toxic'], 'leftovers', '프레셔', '차분', specialWall, '강철', ['terastallization']),
        set(145, ['thunderbolt', 'hurricane', 'heatwave', 'roost'], 'life-orb', '정전기', '겁쟁이', special, '전기'),
      ],
    },
    {
      pokemon: [set(249, ['aeroblast', 'earthpower', 'recover', 'toxic'], 'leftovers', '멀티스케일', '노력', null, '에스퍼', [])],
    },
  ],
}
