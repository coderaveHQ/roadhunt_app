import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { LegalDocument, LegalSection } from "@/components/legal-document";

type ImprintPageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({
  params,
}: ImprintPageProps): Promise<Metadata> {
  const { locale } = await params;
  const german = locale === "de";

  return {
    title: german ? "Impressum" : "Imprint",
    description: german
      ? "Anbieterkennzeichnung und Kontaktinformationen für Roadhunt."
      : "Provider identification and contact information for Roadhunt.",
    alternates: {
      canonical: `/${locale}/impressum`,
      languages: { de: "/de/impressum", en: "/en/impressum" },
    },
  };
}

export default async function ImprintPage({
  params,
}: ImprintPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const german = locale === "de";

  return (
    <LegalDocument
      locale={locale}
      eyebrow={german ? "Rechtliches" : "Legal"}
      title={german ? "Impressum" : "Imprint"}
      intro={
        german
          ? "Wer hinter Roadhunt steht und wie du uns erreichst."
          : "Who operates Roadhunt and how you can reach us."
      }
      updatedLabel={german ? "Stand" : "Updated"}
      updated={german ? "23. August 2026" : "23 August 2026"}
    >
      <LegalSection
        number="01"
        title={
          german
            ? "Anbieterangaben gemäß § 5 DDG"
            : "Provider information under section 5 DDG"
        }
      >
        <address>
          <strong>Florian Leeser Softwareentwicklung</strong>
          <br />
          {german ? "Inhaber" : "Proprietor"}: Florian Leeser
          <br />
          Eintrachtstraße 50
          <br />
          42655 Solingen
          <br />
          {german ? "Deutschland" : "Germany"}
        </address>
      </LegalSection>

      <LegalSection number="02" title={german ? "Kontakt" : "Contact"}>
        <p>
          {german ? "Allgemeine Anfragen" : "General enquiries"}:{" "}
          <a href="mailto:support@coderave.dev">support@coderave.dev</a>
          <br />
          {german ? "Datenschutzanfragen" : "Privacy requests"}:{" "}
          <a href="mailto:privacy@coderave.dev">privacy@coderave.dev</a>
          <br />
          {german ? "Rechtliche Anfragen" : "Legal requests"}:{" "}
          <a href="mailto:legal@coderave.dev">legal@coderave.dev</a>
          <br />
          Website:{" "}
          <a href="https://coderave.dev" target="_blank" rel="noreferrer">
            coderave.dev
          </a>
        </p>
      </LegalSection>

      <LegalSection
        number="03"
        title={
          german
            ? "Verbraucherstreitbeilegung"
            : "Consumer dispute resolution"
        }
      >
        <p>
          {german
            ? "Wir sind weder bereit noch verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen."
            : "We are neither willing nor required to participate in dispute-resolution proceedings before a consumer arbitration board."}
        </p>
      </LegalSection>

      <LegalSection
        number="04"
        title={german ? "Haftung für Links" : "Liability for links"}
      >
        <p>
          {german
            ? "Roadhunt enthält Links zu externen Websites. Auf deren Inhalte und Datenschutzpraktiken haben wir keinen Einfluss. Für die Inhalte verlinkter Seiten ist stets der jeweilige Anbieter verantwortlich."
            : "Roadhunt contains links to external websites. We have no control over their content or privacy practices. The respective provider is responsible for each linked website."}
        </p>
      </LegalSection>

      <LegalSection
        number="05"
        title={german ? "Karten- und Geodaten" : "Map and geodata"}
      >
        <p>
          {german
            ? "Kartendarstellung und Geodaten stammen unter anderem von Mapbox und den Mitwirkenden von OpenStreetMap. Es gelten die jeweiligen Quellen- und Lizenzhinweise. Roadhunt macht sich fremde Karteninhalte nicht zu eigen."
            : "Map rendering and geodata are supplied in part by Mapbox and OpenStreetMap contributors. The respective attribution and licence notices apply. Roadhunt does not adopt third-party map content as its own."}
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
