import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/language-switch";
import { Logo } from "@/components/logo";

export async function AppHeader({ locale }: { locale: string }) {
  const nav = await getTranslations("Nav");

  return (
    <header className="site-header shell app-header">
      <a href={`/${locale}`} aria-label="Roadhunt home"><Logo /></a>
      <LanguageSwitch label={nav("language")} />
    </header>
  );
}
