import { getTranslations } from "next-intl/server";

import { Logo } from "@/components/logo";

export async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations("Footer");

  return (
    <footer className="site-footer shell">
      <div className="site-footer-brand">
        <Logo />
        <span>
          by{" "}
          <a href="https://coderave.dev" target="_blank" rel="noreferrer">
            coderave
          </a>
        </span>
      </div>

      <nav aria-label={t("legalNavigation")}>
        <a href={`/${locale}/impressum`}>{t("imprint")}</a>
        <a href={`/${locale}/datenschutz`}>{t("privacy")}</a>
        <a href={`/${locale}/nutzungsbedingungen`}>{t("terms")}</a>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          {t("attribution")}
        </a>
      </nav>

      <span className="site-footer-copyright">© 2026 ROADHUNT</span>
    </footer>
  );
}
