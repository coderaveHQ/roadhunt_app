const FORBIDDEN_NICKNAME_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function normalizeWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Stable database key for official street names. It deliberately preserves
 * umlauts and punctuation that can distinguish different official names.
 */
export function normalizeStreetName(value: string): string {
  return normalizeWhitespace(value)
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s*-\s*/gu, "-")
    .toLowerCase()
    .replaceAll("ß", "ss");
}

export function normalizeNickname(value: string): string {
  return normalizeWhitespace(value);
}

export function nicknameComparisonKey(value: string): string {
  return normalizeNickname(value).toLowerCase();
}

export function countVisibleCharacters(value: string): number {
  const visible = value.replace(/\s/gu, "");
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter("und", { granularity: "grapheme" }).segment(visible),
    ).length;
  }
  return Array.from(visible).length;
}

export type NicknameValidationError =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_characters";

export type NicknameValidationResult =
  | { readonly success: true; readonly value: string }
  | { readonly success: false; readonly error: NicknameValidationError };

export function validateNickname(value: string): NicknameValidationResult {
  const normalized = normalizeNickname(value);
  if (!normalized) return { success: false, error: "required" };
  if (FORBIDDEN_NICKNAME_CHARACTERS.test(normalized)) {
    return { success: false, error: "invalid_characters" };
  }

  const length = countVisibleCharacters(normalized);
  if (length < 2) return { success: false, error: "too_short" };
  if (length > 20) return { success: false, error: "too_long" };
  return { success: true, value: normalized };
}
