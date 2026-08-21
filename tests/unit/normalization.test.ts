import { describe, expect, it } from "vitest";

import { resolveLocale } from "../../src/lib/game/locale";
import {
  nicknameComparisonKey,
  normalizeStreetName,
  validateNickname,
} from "../../src/lib/game/normalization";

describe("street normalization", () => {
  it("is deterministic and preserves meaningful umlauts", () => {
    expect(normalizeStreetName("  Große   Münchner Straße  ")).toBe(
      "grosse münchner strasse",
    );
    expect(normalizeStreetName("Karl – Marx – Allee")).toBe("karl-marx-allee");
  });
});

describe("nickname validation", () => {
  it("normalizes spacing and compares names case-insensitively", () => {
    expect(validateNickname("  Road   Runner  ")).toEqual({
      success: true,
      value: "Road Runner",
    });
    expect(nicknameComparisonKey("JÄGER")).toBe(nicknameComparisonKey("jäger"));
  });

  it("counts visible grapheme clusters instead of UTF-16 code units", () => {
    expect(validateNickname("🧑‍🚀X")).toEqual({ success: true, value: "🧑‍🚀X" });
    expect(validateNickname("X")).toEqual({ success: false, error: "too_short" });
    expect(validateNickname("x".repeat(21))).toEqual({ success: false, error: "too_long" });
  });

  it("rejects control and bidi override characters", () => {
    expect(validateNickname("ab\u202Ecd")).toEqual({
      success: false,
      error: "invalid_characters",
    });
  });
});

describe("locale resolution", () => {
  it("handles browser and Accept-Language values without relying on system locale", () => {
    expect(resolveLocale(["fr-FR", "en-GB"])).toBe("en");
    expect(resolveLocale("fr-FR;q=0.9, de-DE;q=0.8")).toBe("de");
    expect(resolveLocale("pt-BR")).toBe("de");
  });
});
