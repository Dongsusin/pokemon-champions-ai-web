// Every entry is a legal, independently resolved battle recorded through the
// normal BattleScreen. The first move is the move selected by capture.jsx.
export const PROMO_GIMMICK_DEFINITIONS = [
  { id: 'mega', label: '메가진화', variants: [
    ['blastoise', 'waterpulse', 'blastoisinite', '성호', 'aggron'],
    ['venusaur', 'energyball', 'venusaurite', '레드', 'blastoise'],
    ['gardevoir', 'moonblast', 'gardevoirite', '목호', 'gyarados'],
    ['lucario', 'aurasphere', 'lucarionite', '성호', 'aggron'],
    ['ampharos', 'thunderbolt', 'ampharosite', '난천', 'spiritomb'],
    ['alakazam', 'psychic', 'alakazite', '레드', 'venusaur'],
    ['salamence', 'dragonpulse', 'salamencite', '목호', 'gyarados'],
    ['metagross', 'meteormash', 'metagrossite', '레드', 'snorlax'],
  ] },
  { id: 'zmove', label: 'Z기술', variants: [
    ['greninja', 'surf', 'waterium-z--held', '난천', 'spiritomb'],
    ['arcanine', 'flamethrower', 'firium-z--held', '성호', 'skarmory'],
    ['roserade', 'energyball', 'grassium-z--held', '레드', 'blastoise'],
    ['espeon', 'psychic', 'psychium-z--held', '레드', 'venusaur'],
    ['absol', 'nightslash', 'darkinium-z--held', '난천', 'spiritomb'],
    ['froslass', 'icebeam', 'icium-z--held', '목호', 'gyarados'],
    ['lucario', 'aurasphere', 'fightinium-z--held', '레드', 'blastoise'],
    ['lycanroc', 'stoneedge', 'rockium-z--held', '목호', 'gyarados'],
  ] },
  { id: 'dynamax', label: '거다이맥스', variants: [
    ['charizard', 'fireblast', 'life-orb', '성호', 'skarmory'],
    ['blastoise', 'surf', 'life-orb', '성호', 'aggron'],
    ['venusaur', 'energyball', 'life-orb', '레드', 'blastoise'],
    ['pikachu', 'thunderbolt', 'light-ball', '레드', 'blastoise'],
    ['butterfree', 'bugbuzz', 'life-orb', '난천', 'spiritomb'],
    ['corviknight', 'bravebird', 'life-orb', '난천', 'spiritomb'],
    ['lapras', 'icebeam', 'life-orb', '난천', 'spiritomb'],
    ['duraludon', 'dragonpulse', 'life-orb', '난천', 'spiritomb'],
  ] },
  { id: 'tera', label: '테라스탈', variants: [
    ['garchomp', 'dragonclaw', 'expert-belt', '목호', 'gyarados', '드래곤'],
    ['charizard', 'flamethrower', 'wise-glasses', '성호', 'skarmory', '불꽃'],
    ['greninja', 'surf', 'wise-glasses', '성호', 'aggron', '물'],
    ['lucario', 'thunderpunch', 'muscle-band', '레드', 'blastoise', '전기'],
    ['dragonite', 'icebeam', 'wise-glasses', '목호', 'gyarados', '얼음'],
    ['metagross', 'psychic', 'wise-glasses', '레드', 'venusaur', '에스퍼'],
    ['tyranitar', 'darkpulse', 'wise-glasses', '난천', 'spiritomb', '악'],
    ['gengar', 'sludgebomb', 'wise-glasses', '난천', 'milotic', '독'],
  ] },
]
