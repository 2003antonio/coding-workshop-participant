// A temporary password made in the browser (crypto.getRandomValues), for the
// "Add employee" form. It meets the server's rule (at least 12 characters,
// backend/employees/routes.py) with room to spare: 16 characters with upper
// and lower case letters, digits and symbols, and no look-alike characters
// (no 0/O/o, 1/l/I/i). It is shown once in the dialog that made it and is
// never logged, stored or put in a toast.

export const PASSWORD_LENGTH = 16

export const PASSWORD_CLASSES = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghjkmnpqrstuvwxyz',
  '23456789',
  '!#$%*+-=?@',
]
const ALL = PASSWORD_CLASSES.join('')

/** A uniform whole number from 0 to n - 1 (rejection sampling, so no bias). */
function randomBelow(n, random) {
  const limit = Math.floor(0x100000000 / n) * n
  const box = new Uint32Array(1)
  for (;;) {
    random(box)
    if (box[0] < limit) return box[0] % n
  }
}

const cryptoRandom = (array) => globalThis.crypto.getRandomValues(array)

/** A new temporary password; `random` fills a Uint32Array (crypto.getRandomValues by default). */
export function generatePassword(random = cryptoRandom) {
  const pick = (chars) => chars[randomBelow(chars.length, random)]
  const chars = PASSWORD_CLASSES.map(pick) // one of each class for sure
  while (chars.length < PASSWORD_LENGTH) chars.push(pick(ALL))
  for (let i = chars.length - 1; i > 0; i -= 1) { // Fisher-Yates, so the sure ones are not always first
    const j = randomBelow(i + 1, random)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
