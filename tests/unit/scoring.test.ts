import { describe, expect, it } from "vitest";

import {
  calculateAccuracy,
  calculateRoundScore,
  getCountdownSeconds,
  getRemainingSeconds,
  isRoundExpired,
} from "../../src/lib/game/scoring";

describe("Roadhunt scoring", () => {
  it("awards the full 1,000 points only for an immediate exact answer", () => {
    expect(calculateRoundScore({ distanceMeters: 0, remainingSeconds: 60 })).toBe(1_000);
    expect(calculateRoundScore({ distanceMeters: 0, remainingSeconds: 0 })).toBe(850);
  });

  it("applies the squared accuracy curve and time factor", () => {
    expect(calculateAccuracy(250)).toBe(0.25);
    expect(calculateRoundScore({ distanceMeters: 250, remainingSeconds: 60 })).toBe(250);
    expect(calculateRoundScore({ distanceMeters: 250, remainingSeconds: 0 })).toBe(213);
  });

  it("returns zero at 500 meters, beyond it, and without a submission", () => {
    expect(calculateRoundScore({ distanceMeters: 500, remainingSeconds: 60 })).toBe(0);
    expect(calculateRoundScore({ distanceMeters: 900, remainingSeconds: 60 })).toBe(0);
    expect(calculateRoundScore({ distanceMeters: null, remainingSeconds: 60 })).toBe(0);
  });

  it("clamps time to the configured round duration", () => {
    expect(calculateRoundScore({ distanceMeters: 0, remainingSeconds: 99 })).toBe(1_000);
    expect(calculateRoundScore({ distanceMeters: 0, remainingSeconds: -10 })).toBe(850);
  });
});

describe("round timer boundaries", () => {
  const endsAt = "2026-08-20T12:01:00.000Z";

  it("uses exact fractional seconds for scoring and ceil for display", () => {
    expect(getRemainingSeconds(endsAt, "2026-08-20T12:00:00.000Z")).toBe(60);
    expect(getRemainingSeconds(endsAt, "2026-08-20T12:00:59.250Z")).toBe(0.75);
    expect(getCountdownSeconds(endsAt, "2026-08-20T12:00:59.250Z")).toBe(1);
  });

  it("expires exactly at the server deadline", () => {
    expect(isRoundExpired(endsAt, "2026-08-20T12:00:59.999Z")).toBe(false);
    expect(isRoundExpired(endsAt, endsAt)).toBe(true);
    expect(getRemainingSeconds(endsAt, "2026-08-20T12:02:00.000Z")).toBe(0);
  });
});
