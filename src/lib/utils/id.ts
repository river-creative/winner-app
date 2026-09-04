const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BACKUP_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Ids in the same alphabet and length the app has always used (`UI.generateId`), so existing
 * records and new ones stay indistinguishable.
 *
 * `crypto.getRandomValues` replaces `Math.random()`: ids end up in ticket QR codes, and a
 * 62^10 space drawn from a predictable PRNG is not one anybody should be able to enumerate.
 * Rejection sampling keeps the distribution flat rather than biasing the first few characters.
 */
export function generateId(length = 10): string {
  return randomString(ID_ALPHABET, length);
}

/** Backups have always used an uppercase-and-digits alphabet, 8 characters. Kept as it was. */
export function generateBackupId(): string {
  return randomString(BACKUP_ID_ALPHABET, 8);
}

function randomString(alphabet: string, length: number): string {
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  const out: string[] = [];
  const buffer = new Uint8Array(length * 2);

  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (out.length === length) break;
      // Values in the final, short bucket would over-represent early characters; draw again.
      if (byte >= max) continue;
      out.push(alphabet[byte % alphabet.length] as string);
    }
  }

  return out.join('');
}
