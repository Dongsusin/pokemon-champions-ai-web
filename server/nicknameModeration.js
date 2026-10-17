// This deliberately small, deterministic list is kept on the server. Normal
// nickname entries target common profanity and its usual spelling disguises.

const koreanWords = [
  '시발', '씨발', '시팔', '씨팔', '시벌', '씨벌', '쉬발', '쉬벌', '쉬팔', '슈발',
  '개새끼', '개세끼', '개새기', '개세기', '개색끼', '개색기', '개쉐끼', '개쉐기',
  '씹새끼', '씹새', '씹할', '십새끼', '십새',
  '병신', '븅신', '빙신', '지랄', '존나', '졸라', '염병',
  '좆', '졷', '죶', '좃', '좇같', '좇까',
  '개년', '미친놈', '미친년', '느금마', '니애미', '니애비', '애미뒤진', '애비뒤진',
  '닥쳐', '꺼져', '이새끼', '저새끼', '호로새끼', '새끼야', '찐따', '애자', '쌍놈', '쌍년',
]

const initialConsonants = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ']
const vowels = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ']
const finalConsonants = [...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']
function compatibilityJamo(character) {
  const code = character.codePointAt(0)
  if (code >= 0x1100 && code <= 0x1112) return initialConsonants[code - 0x1100]
  if (code >= 0x1161 && code <= 0x1175) return vowels[code - 0x1161]
  if (code >= 0x11a8 && code <= 0x11c2) return finalConsonants[code - 0x11a8]
  return character
}

function koreanSkeleton(text) {
  return [...text.normalize('NFKD')].map(compatibilityJamo).join('')
    .replace(/[\s\p{P}\p{S}\p{N}\p{Cf}\p{M}]/gu, '')
}
// A following vowel means a matched final consonant actually belongs to the
// next syllable. For example, 조준/조직 must not match the syllable 좆.
const koreanPatterns = [...new Set(koreanWords.map(koreanSkeleton))]
  .map(word => new RegExp(`${word}(?![ㅏ-ㅣ])`, 'u'))

const separator = '[\\s\\p{P}\\p{S}\\p{N}\\p{Cf}\\p{M}]*'
const initialsPattern = new RegExp(`(?<![ㄱ-ㅎ])(?:ㅅ${separator}ㅂ|ㅆ${separator}ㅂ|ㅂ${separator}ㅅ|ㅈ${separator}ㄴ|ㅈ${separator}ㄹ)(?:[ㅋㅎ]+)?(?![ㄱ-ㅎ])`, 'u')

const englishWords = [
  'fuck', 'fucks', 'fucked', 'fucker', 'fuckers', 'fucking', 'fuckyou',
  'motherfucker', 'motherfuckers', 'motherfucking',
  'shit', 'shits', 'shitty', 'shitting', 'bullshit',
  'bitch', 'bitches', 'bitching', 'bitchy', 'bastard', 'bastards',
  'asshole', 'assholes', 'dickhead', 'dickheads', 'cunt', 'cunts',
  'cocksucker', 'cocksuckers', 'wtf', 'stfu',
]
const leetLetters = {
  a: 'a@4', b: 'b8', c: 'c(', e: 'e3', g: 'g9',
  i: 'i1!|', o: 'o0', s: 's$5', t: 't7+', u: 'uv',
}
const englishSpellings = englishWords.map(word => [...word].map(letter => leetLetters[letter] ?? letter))
const separatorCharacter = /[\s\p{P}\p{S}\p{N}\p{Cf}\p{M}]/u
const latinLetter = /[a-z]/u

function containsEnglishProfanity(text) {
  const characters = [...text]
  // A digit can be a disguised letter OR an inserted separator. Track the
  // bounded word positions instead of a backtracking regex; a punctuation-only
  // 200-character request must remain cheap. Latin boundaries keep innocent
  // substrings such as Scunthorpe/class out of the filter.
  return englishSpellings.some(spelling => {
    let positions = Array(spelling.length + 1).fill(false)
    for (let index = 0; index < characters.length; index++) {
      const character = characters[index]
      const next = separatorCharacter.test(character) ? positions.slice() : Array(positions.length).fill(false)
      if (spelling[0].includes(character) && !latinLetter.test(characters[index - 1] ?? '')) next[1] = true
      for (let position = 1; position < spelling.length; position++) {
        if (positions[position] && spelling[position].includes(character)) next[position + 1] = true
      }
      if (next[spelling.length] && !latinLetter.test(characters[index + 1] ?? '')) return true
      next[spelling.length] = false
      positions = next
    }
    return false
  })
}

export function containsNicknameProfanity(value) {
  if (typeof value !== 'string') return false
  const normalized = value.normalize('NFKC').toLowerCase()
  // Protect only these literal, ordinary spans, never the whole nickname. A
  // separate insult next to "시발점" must still be rejected. The marker remains
  // a letter in the skeleton so surrounding fragments cannot join across it.
  const koreanComparison = normalized.replace(/시발(?:점|역)|시\s+발동|졸라매|졸라맨/gu, 'x')
  const korean = koreanSkeleton(koreanComparison)
  if (koreanPatterns.some(pattern => pattern.test(korean))) return true
  const initials = [...normalized].map(compatibilityJamo).join('')
  if (initialsPattern.test(initials)) return true
  const english = normalized.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '')
  return containsEnglishProfanity(english)
}
