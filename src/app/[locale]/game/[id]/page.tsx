import { getTranslations, setRequestLocale } from "next-intl/server";

import { GameClient } from "@/components/game-client";

export async function generateMetadata() {
  const t = await getTranslations("Game");
  return { title: t("metadataTitle") };
}

export default async function GamePage({ params }: PageProps<"/[locale]/game/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <GameClient gameId={id} />;
}
