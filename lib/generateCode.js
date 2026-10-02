// Generates a human-typeable access code, e.g. "ARMONIA-7X2P-9KQF"
// Avoids ambiguous characters (0/O, 1/I/L) so students can type it accurately
// from an email on their phone.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no O, 0, I, 1, L

function randomBlock(length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function generateAccessCode() {
  return `ARMONIA-${randomBlock(4)}-${randomBlock(4)}`;
}
