import { getTranslations, setRequestLocale } from "next-intl/server";

import { AppHeader } from "@/components/app-header";
import { GameSetup } from "@/components/game-setup";
import { loadGameSetupCities } from "@/lib/game/setup-catalog.server";
import type { Locale } from "@/lib/game/types";

type Mode = "solo" | "lobby" | "join";

export async function generateMetadata() {
  const t = await getTranslations("Play");
  return { title: t("title") };
}

export default async function PlayPage({ params, searchParams }: PageProps<"/[locale]/play">) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const cities = await loadGameSetupCities(locale as Locale);
  const requestedMode = query.mode;
  const initialMode: Mode = requestedMode === "lobby" || requestedMode === "join" ? requestedMode : "solo";
  const initialCode = typeof query.code === "string"
    ? query.code.toUpperCase().replace(/[^2-9A-HJKMNP-Z]/g, "").slice(0, 6)
    : "";

  return (
    <main className="play-page">
      <AppHeader locale={locale} />
      <GameSetup initialCities={cities} initialMode={initialMode} initialCode={initialCode} />
    </main>
  );
}
