import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { SiteFooter } from "@/components/site-footer";

export function LegalSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="legal-section">
      <span className="legal-section-number">{number}</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

export function LegalDocument({
  locale,
  eyebrow,
  title,
  intro,
  updatedLabel,
  updated,
  children,
}: {
  locale: string;
  eyebrow: string;
  title: string;
  intro: string;
  updatedLabel: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="legal-page">
      <AppHeader locale={locale} />

      <main className="legal-main shell">
        <header className="legal-hero">
          <div>
            <div className="eyebrow">
              <span />
              {eyebrow}
            </div>
            <h1>{title}</h1>
            <p>{intro}</p>
          </div>

          <aside aria-label={`${updatedLabel}: ${updated}`}>
            <span>{updatedLabel}</span>
            <strong>{updated}</strong>
          </aside>
        </header>

        <article className="legal-card">{children}</article>
      </main>

      <SiteFooter locale={locale} />
    </div>
  );
}
