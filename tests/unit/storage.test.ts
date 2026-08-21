import { describe, expect, it } from "vitest";

import {
  readLocalBestScore,
  readLocalBestScores,
  saveLocalBestScore,
  type StorageLike,
} from "../../src/lib/game/storage";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe("local best persistence", () => {
  it("is safe when no browser storage exists", () => {
    expect(readLocalBestScores(null)).toEqual([]);
    expect(saveLocalBestScore("berlin", "easy", 500, "2026-08-20T10:00:00Z", null)).toMatchObject({
      improved: true,
      persisted: false,
    });
  });

  it("only replaces a best score with a higher result", () => {
    const storage = memoryStorage();
    saveLocalBestScore("berlin", "easy", 500, "2026-08-20T10:00:00Z", storage);
    const lower = saveLocalBestScore(
      "berlin",
      "easy",
      400,
      "2026-08-20T11:00:00Z",
      storage,
    );
    expect(lower.improved).toBe(false);
    expect(readLocalBestScore("berlin", "easy", storage)?.score).toBe(500);

    saveLocalBestScore("berlin", "easy", 700, "2026-08-20T12:00:00Z", storage);
    expect(readLocalBestScore("berlin", "easy", storage)?.score).toBe(700);
  });

  it("persists server-validated city slugs outside the launch catalog", () => {
    const storage = memoryStorage();
    saveLocalBestScore("bad-homburg", "hard", 812, "2026-08-20T12:00:00Z", storage);

    expect(readLocalBestScore("bad-homburg", "hard", storage)).toMatchObject({
      citySlug: "bad-homburg",
      score: 812,
    });
  });

  it("rejects arbitrary slugs when writing and ignores them when reading", () => {
    const storage = memoryStorage();
    expect(() => saveLocalBestScore("../../admin", "easy", 500, undefined, storage)).toThrow(
      "citySlug must be a normalized lowercase slug",
    );

    storage.setItem("roadhunt:local-bests:v1", JSON.stringify({
      version: 1,
      scores: {
        unsafe: {
          citySlug: "Berlin<script>",
          difficulty: "easy",
          score: 999,
          achievedAt: "2026-08-20T12:00:00Z",
        },
      },
    }));
    expect(readLocalBestScores(storage)).toEqual([]);
  });

  it("ignores malformed stored data", () => {
    const storage = memoryStorage();
    storage.setItem("roadhunt:local-bests:v1", "not-json");
    expect(readLocalBestScores(storage)).toEqual([]);
  });
});
