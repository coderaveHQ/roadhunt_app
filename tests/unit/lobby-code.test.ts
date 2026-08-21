import { describe, expect, it } from "vitest";

import {
  generateLobbyCode,
  isValidLobbyCode,
  LOBBY_CODE_ALPHABET,
  normalizeLobbyCode,
} from "../../src/lib/game/lobby-code";

describe("lobby codes", () => {
  it("generates deterministic six-character codes with an injected source", () => {
    const code = generateLobbyCode((length) => Uint8Array.from({ length }, (_, index) => index));
    expect(code).toBe(LOBBY_CODE_ALPHABET.slice(0, 6));
    expect(isValidLobbyCode(code)).toBe(true);
  });

  it("accepts pasted separators but rejects ambiguous glyphs", () => {
    expect(normalizeLobbyCode("ab-cd 23")).toBe("ABCD23");
    expect(isValidLobbyCode("ab-cd 23")).toBe(true);
    for (const ambiguous of ["0", "O", "1", "I", "L"]) {
      expect(isValidLobbyCode(`ABC23${ambiguous}`)).toBe(false);
    }
  });
});
