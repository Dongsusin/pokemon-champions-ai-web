const form = (slug, name) => ({ slug, name })

const stone = (id, name, englishName, basePokemonName, forms, spriteSourceSlug = id) => ({
  id,
  name,
  englishName,
  basePokemonName,
  forms,
  sprite: `/assets/items/za-mega-stones/${id}.png`,
  spriteSource: `https://www.serebii.net/itemdex/sprites/za/${spriteSourceSlug}.png`,
})

export const ZA_MEGA_STONES = [
  stone('clefablite', '픽시나이트', 'Clefablite', '픽시', [form('clefable-mega', '메가픽시')]),
  stone('victreebelite', '우츠보트나이트', 'Victreebelite', '우츠보트', [form('victreebel-mega', '메가우츠보트')]),
  stone('starminite', '아쿠스타나이트', 'Starminite', '아쿠스타', [form('starmie-mega', '메가아쿠스타')]),
  stone('dragoninite', '망나뇽나이트', 'Dragoninite', '망나뇽', [form('dragonite-mega', '메가망나뇽')]),
  stone('meganiumite', '메가니움나이트', 'Meganiumite', '메가니움', [form('meganium-mega', '메가메가니움')]),
  stone('feraligite', '장크로다일나이트', 'Feraligite', '장크로다일', [form('feraligatr-mega', '메가장크로다일')]),
  stone('skarmorite', '무장조나이트', 'Skarmorite', '무장조', [form('skarmory-mega', '메가무장조')]),
  stone('froslassite', '눈여아나이트', 'Froslassite', '눈여아', [form('froslass-mega', '메가눈여아')]),
  stone('emboarite', '염무왕나이트', 'Emboarite', '염무왕', [form('emboar-mega', '메가염무왕')]),
  stone('excadrite', '몰드류나이트', 'Excadrite', '몰드류', [form('excadrill-mega', '메가몰드류')]),
  stone('scolipite', '펜드라나이트', 'Scolipite', '펜드라', [form('scolipede-mega', '메가펜드라')]),
  stone('scraftinite', '곤율거니나이트', 'Scraftinite', '곤율거니', [form('scrafty-mega', '메가곤율거니')]),
  stone('eelektrossite', '저리더프나이트', 'Eelektrossite', '저리더프', [form('eelektross-mega', '메가저리더프')]),
  stone('chandelurite', '샹델라나이트', 'Chandelurite', '샹델라', [form('chandelure-mega', '메가샹델라')]),
  stone('chesnaughtite', '브리가론나이트', 'Chesnaughtite', '브리가론', [form('chesnaught-mega', '메가브리가론')]),
  stone('delphoxite', '마폭시나이트', 'Delphoxite', '마폭시', [form('delphox-mega', '메가마폭시')]),
  stone('greninjite', '개굴닌자나이트', 'Greninjite', '개굴닌자', [form('greninja-mega', '메가개굴닌자')]),
  stone('pyroarite', '화염레오나이트', 'Pyroarite', '화염레오', [form('pyroar-mega', '메가화염레오')]),
  stone('floettite', '플라엣테나이트', 'Floettite', '플라엣테', [form('floette-mega', '메가플라엣테')]),
  stone('malamarite', '칼라마네로나이트', 'Malamarite', '칼라마네로', [form('malamar-mega', '메가칼라마네로')]),
  stone('barbaracite', '거북손데스나이트', 'Barbaracite', '거북손데스', [form('barbaracle-mega', '메가거북손데스')]),
  stone('dragalgite', '드래캄나이트', 'Dragalgite', '드래캄', [form('dragalge-mega', '메가드래캄')]),
  stone('hawluchanite', '루차불나이트', 'Hawluchanite', '루차불', [form('hawlucha-mega', '메가루차불')]),
  stone('drampanite', '할비롱나이트', 'Drampanite', '할비롱', [form('drampa-mega', '메가할비롱')]),
  stone('falinksite', '대여르나이트', 'Falinksite', '대여르', [form('falinks-mega', '메가대여르')]),
  stone('raichunite-x', '라이츄나이트X', 'Raichunite X', '라이츄', [form('raichu-mega-x', '메가라이츄X')], 'raichunitex'),
  stone('raichunite-y', '라이츄나이트Y', 'Raichunite Y', '라이츄', [form('raichu-mega-y', '메가라이츄Y')], 'raichunitey'),
  stone('chimechite', '치렁나이트', 'Chimechite', '치렁', [form('chimecho-mega', '메가치렁')]),
  stone('staraptite', '찌르호크나이트', 'Staraptite', '찌르호크', [form('staraptor-mega', '메가찌르호크')]),
  stone('golurkite', '골루그나이트', 'Golurkite', '골루그', [form('golurk-mega', '메가골루그')]),
  stone('meowsticite', '냐오닉스나이트', 'Meowsticite', '냐오닉스', [
    form('meowstic-male-mega', '메가냐오닉스 (수컷의 모습)'),
    form('meowstic-female-mega', '메가냐오닉스 (암컷의 모습)'),
  ]),
  stone('crabominite', '모단단게나이트', 'Crabominite', '모단단게', [form('crabominable-mega', '메가모단단게')]),
  stone('scovillainite', '스코빌런나이트', 'Scovillainite', '스코빌런', [form('scovillain-mega', '메가스코빌런')]),
  stone('glimmoranite', '킬라플로르나이트', 'Glimmoranite', '킬라플로르', [form('glimmora-mega', '메가킬라플로르')]),
  stone('absolite-z', '앱솔나이트Z', 'Absolite Z', '앱솔', [form('absol-mega-z', '메가앱솔Z')], 'absolitez'),
  stone('garchompite-z', '한카리아스나이트Z', 'Garchompite Z', '한카리아스', [form('garchomp-mega-z', '메가한카리아스Z')], 'garchompitez'),
  stone('lucarionite-z', '루카리오나이트Z', 'Lucarionite Z', '루카리오', [form('lucario-mega-z', '메가루카리오Z')], 'lucarionitez'),
  stone('golisopite', '갑주무사나이트', 'Golisopite', '갑주무사', [form('golisopod-mega', '메가갑주무사')]),
  stone('baxcalibrite', '드닐레이브나이트', 'Baxcalibrite', '드닐레이브', [form('baxcalibur-mega', '메가드닐레이브')]),
]

const formEntries = ZA_MEGA_STONES.flatMap((entry) => (
  entry.forms.map((megaForm) => [megaForm.slug, { ...megaForm, stone: entry }])
))

export const ZA_MEGA_FORMS = Object.fromEntries(formEntries)
export const ZA_MEGA_FORM_SLUGS = new Set(Object.keys(ZA_MEGA_FORMS))

export const ZA_MEGA_UNAVAILABLE_FORM_SLUGS = new Set([
  'heatran-mega',
  'darkrai-mega',
  'zygarde-mega',
  'magearna-mega',
  'magearna-original-mega',
  'zeraora-mega',
  'tatsugiri-curly-mega',
  'tatsugiri-droopy-mega',
  'tatsugiri-stretchy-mega',
])

export const ZA_MEGA_ABILITY_OVERRIDES = {
  // Champions Regulation M-C (2026-09-09). Keep confirmed Mega abilities
  // explicit: upstream records can still be empty or retain base-form abilities.
  'absol-mega-z': {
    name: '예리함',
    trigger: '베는 기술 사용',
    description: '베는 기술의 위력이 50% 올라간다.',
  },
  'garchomp-mega-z': {
    name: '부유',
    trigger: '상시',
    description: '공중에 떠 있어 땅타입 기술과 압정 계열 효과를 받지 않는다.',
  },
  'lucario-mega-z': {
    name: '파동의방호',
    trigger: '접촉 기술로 공격받을 때',
    description: '상대의 접촉 기술로 받는 데미지가 절반이 된다.',
  },
  'golisopod-mega': {
    name: '단단한발톱',
    trigger: '접촉 기술 사용',
    description: '접촉 기술의 위력이 30% 올라간다.',
  },
  'baxcalibur-mega': {
    name: '열교환',
    trigger: '불꽃타입 기술로 공격받을 때',
    description: '불꽃타입 기술로 공격받으면 공격이 1랭크 오른다. 화상 상태가 되지 않는다.',
  },
  'meganium-mega': {
    name: '메가솔라',
    trigger: '상시',
    description: '햇살이 강하지 않아도 쾌청 상태인 것처럼 기술을 사용할 수 있다.',
  },
  'feraligatr-mega': {
    name: '드래곤스킨',
    trigger: '노말타입 기술 사용',
    description: '노말타입 기술이 드래곤타입이 되고 위력이 20% 올라간다.',
  },
  'excadrill-mega': {
    name: '관통드릴',
    trigger: '접촉 기술 사용',
    description: '접촉 기술로 방어 중인 상대를 공격하면 원래 데미지의 1/4을 준다.',
  },
  'eelektross-mega': {
    name: 'Eelevate',
    trigger: '상시·상대를 쓰러뜨릴 때',
    description: '땅타입 기술과 압정 계열 효과를 받지 않으며, 상대를 쓰러뜨리면 가장 높은 능력치가 1랭크 오른다.',
  },
  'pyroar-mega': {
    name: 'Fire Mane',
    trigger: '불꽃타입 기술 사용',
    description: '자신이 사용하는 불꽃타입 기술의 위력이 50% 올라간다.',
  },
  'scovillain-mega': {
    name: '하바네로분출',
    trigger: '기술로 데미지를 받을 때',
    description: '기술로 데미지를 받으면 공격한 상대를 화상 상태로 만든다.',
  },
}

export function getZaMegaForm(formSlug) {
  return ZA_MEGA_FORMS[formSlug] ?? null
}

export function getZaMegaStoneByFormSlug(formSlug) {
  return getZaMegaForm(formSlug)?.stone ?? null
}

export function isZaMegaForm(formSlug) {
  return ZA_MEGA_FORM_SLUGS.has(formSlug)
}
