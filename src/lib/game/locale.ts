import type { Locale } from "./types";

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const language = value.trim().replaceAll("_", "-").split("-", 1)[0]?.toLowerCase();
  return language === "de" || language === "en" ? language : null;
}

function localeCandidates(input: string | readonly string[]): readonly string[] {
  if (typeof input !== "string") return input;
  return input.split(",").map((part) => part.split(";", 1)[0]?.trim() ?? "");
}

/** Resolves browser language lists and Accept-Language values without system locale state. */
export function resolveLocale(
  input: string | readonly string[] | null | undefined,
  fallback: Locale = "de",
): Locale {
  if (!input) return fallback;
  for (const candidate of localeCandidates(input)) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return fallback;
}
