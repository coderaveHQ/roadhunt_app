import { describe, expect, it } from "vitest";

import { classifyDifficulty } from "../../src/lib/game/difficulty";

describe("deterministic street difficulty", () => {
  it("uses road class before length", () => {
    expect(classifyDifficulty({ lengthMeters: 120, highwayTypes: ["primary"] })).toBe("easy");
    expect(classifyDifficulty({ lengthMeters: 120, highwayTypes: ["trunk_link"] })).toBe("easy");
    expect(classifyDifficulty({ lengthMeters: 120, highwayTypes: ["secondary_link"] })).toBe(
      "easy",
    );
    expect(classifyDifficulty({ lengthMeters: 120, highwayTypes: ["tertiary"] })).toBe(
      "medium",
    );
  });

  it("uses exact length thresholds for remaining roads", () => {
    expect(classifyDifficulty({ lengthMeters: 2_000 })).toBe("easy");
    expect(classifyDifficulty({ lengthMeters: 1_999.99 })).toBe("medium");
    expect(classifyDifficulty({ lengthMeters: 1_000 })).toBe("medium");
    expect(classifyDifficulty({ lengthMeters: 999.99 })).toBe("hard");
    expect(classifyDifficulty({ lengthMeters: 400 })).toBe("hard");
    expect(classifyDifficulty({ lengthMeters: 399.99 })).toBe("insane");
  });

  it("honors reviewed overrides", () => {
    expect(classifyDifficulty({ lengthMeters: 2_500, override: "insane" })).toBe("insane");
  });

  it("rejects malformed lengths even when an override exists", () => {
    expect(() => classifyDifficulty({ lengthMeters: 0, override: "easy" })).toThrow(
      "positive finite",
    );
  });
});
