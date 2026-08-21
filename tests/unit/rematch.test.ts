import { describe, expect, it } from "vitest";

import { canCreateRematch } from "../../src/lib/game/rematch";

describe("live rematch eligibility", () => {
  it("allows a finished solo game with its single active player", () => {
    expect(
      canCreateRematch({ mode: "solo", status: "finished", activePlayerCount: 1 }),
    ).toBe(true);
  });

  it("allows finished lobbies with two to eight active players", () => {
    for (const activePlayerCount of [2, 4, 8]) {
      expect(
        canCreateRematch({ mode: "lobby", status: "finished", activePlayerCount }),
      ).toBe(true);
    }
  });

  it("rejects unfinished games and invalid group sizes", () => {
    expect(
      canCreateRematch({ mode: "lobby", status: "revealing", activePlayerCount: 2 }),
    ).toBe(false);
    expect(
      canCreateRematch({ mode: "solo", status: "finished", activePlayerCount: 2 }),
    ).toBe(false);
    expect(
      canCreateRematch({ mode: "lobby", status: "finished", activePlayerCount: 1 }),
    ).toBe(false);
    expect(
      canCreateRematch({ mode: "lobby", status: "finished", activePlayerCount: 9 }),
    ).toBe(false);
  });
});
