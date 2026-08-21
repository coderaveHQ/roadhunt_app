export const LOBBY_CODE_LENGTH = 6;
export const LOBBY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export type RandomByteSource = (length: number) => Uint8Array;

export function normalizeLobbyCode(value: string): string {
  return value.normalize("NFKC").replace(/[\s-]+/gu, "").toUpperCase();
}

export function isValidLobbyCode(value: string): boolean {
  return /^[2-9A-HJKMNP-Z]{6}$/u.test(normalizeLobbyCode(value));
}

function secureRandomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random number generation is unavailable");
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** Generates a code without modulo bias; ambiguous 0/O/1/I/L are absent. */
export function generateLobbyCode(randomBytes: RandomByteSource = secureRandomBytes): string {
  const acceptedByteLimit =
    Math.floor(256 / LOBBY_CODE_ALPHABET.length) * LOBBY_CODE_ALPHABET.length;
  let result = "";

  while (result.length < LOBBY_CODE_LENGTH) {
    const bytes = randomBytes(LOBBY_CODE_LENGTH - result.length);
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      throw new TypeError("The random byte source must return a non-empty Uint8Array");
    }
    for (const byte of bytes) {
      if (byte >= acceptedByteLimit) continue;
      result += LOBBY_CODE_ALPHABET[byte % LOBBY_CODE_ALPHABET.length];
      if (result.length === LOBBY_CODE_LENGTH) break;
    }
  }

  return result;
}
