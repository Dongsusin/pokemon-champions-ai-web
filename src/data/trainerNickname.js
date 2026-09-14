export const NICKNAME_MIN_LENGTH = 2
export const NICKNAME_MAX_LENGTH = 12
const nicknamePattern = /^[\p{Script=Hangul}a-zA-Z0-9 _-]+$/u
const invisibleHangulPattern = /[\u115f\u1160\u3164\uffa0]/u
const reservedGuestPattern = /^guest-\d{6}$/i

export function normalizeTrainerNickname(value) {
  if (typeof value !== 'string') throw new Error('닉네임을 입력해주세요.')
  const nickname = value.normalize('NFKC').trim()
  if (invisibleHangulPattern.test(value) || invisibleHangulPattern.test(nickname)) {
    throw new Error('닉네임에 보이지 않는 문자를 사용할 수 없습니다.')
  }
  // An empty value explicitly restores the original, masked trainer name.
  if (!nickname) return ''
  const length = [...nickname].length
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH || !nicknamePattern.test(nickname)) {
    throw new Error('닉네임은 한글, 영문, 숫자, 공백, _ 또는 -를 사용해 2~12자로 입력해주세요.')
  }
  if (reservedGuestPattern.test(nickname)) throw new Error('guest-숫자 6자리 형식은 게스트 전용 이름입니다.')
  return nickname
}

export function readTrainerNickname(value) {
  try { return normalizeTrainerNickname(value) } catch { return '' }
}
