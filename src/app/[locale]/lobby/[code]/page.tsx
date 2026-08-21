import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { AppHeader } from "@/components/app-header";
import { LobbyClient } from "@/components/lobby-client";
import type { Locale } from "@/i18n/routing";

type LobbyPageProps = {
  params: Promise<{ locale: Locale; code: string }>;
  searchParams: Promise<{ game?: string | string[] }>;
};

export default async function LobbyPage({
  params,
  searchParams,
}: LobbyPageProps) {
  const [{ locale, code }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const gameId = typeof query.game === "string" ? query.game : null;
  if (!gameId) {
    redirect(`/${locale}/play?mode=join&code=${encodeURIComponent(code.toUpperCase())}`);
  }

  return (
    <main className="lobby-page">
      <AppHeader locale={locale} />
      <LobbyClient
        gameId={gameId}
        initialCode={code.toUpperCase()}
        locale={locale}
      />
    </main>
  );
}
