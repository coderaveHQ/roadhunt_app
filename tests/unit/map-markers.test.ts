import { describe, expect, it } from "vitest";

import {
  cityFitOptions,
  createPlayerMarkerColorMap,
  firstVisibleNicknameLetter,
  PLAYER_MARKER_COLORS,
} from "../../src/components/road-map";

describe("player map markers", () => {
  it("assigns every lobby player a stable distinct color independent of score order", () => {
    const playerIds = ["player-charlie", "player-alpha", "player-bravo"];
    const initial = createPlayerMarkerColorMap(playerIds);
    const reordered = createPlayerMarkerColorMap([...playerIds].reverse());

    expect(new Set(initial.values()).size).toBe(playerIds.length);
    for (const playerId of playerIds) {
      expect(reordered.get(playerId)).toEqual(initial.get(playerId));
    }
  });

  it("provides a unique palette entry for the maximum eight lobby players", () => {
    const colors = createPlayerMarkerColorMap(
      Array.from({ length: 8 }, (_, index) => `player-${index}`),
    );

    expect(PLAYER_MARKER_COLORS).toHaveLength(8);
    expect(new Set([...colors.values()].map((color) => color.background)).size).toBe(8);
  });

  it("uses the first visible nickname letter instead of UI copy", () => {
    expect(firstVisibleNicknameLetter("  Dora Explorer")).toBe("D");
    expect(firstVisibleNicknameLetter("🛣️ road runner")).toBe("🛣");
    expect(firstVisibleNicknameLetter("🔥")).toBe("🔥");
    expect(firstVisibleNicknameLetter("   ")).toBe("?");
  });
});

describe("city camera fit", () => {
  it("animates the full-bounds reveal unless reduced motion is requested", () => {
    expect(cityFitOptions(false, false)).toEqual({ padding: 34, duration: 450 });
    expect(cityFitOptions(true, false)).toEqual({ padding: 34, duration: 750 });
    expect(cityFitOptions(true, true)).toEqual({ padding: 34, duration: 0 });
  });
});
