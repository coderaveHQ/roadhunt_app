import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { LegalDocument, LegalSection } from "@/components/legal-document";

type TermsPageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({
  params,
}: TermsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const german = locale === "de";

  return {
    title: german ? "Nutzungsbedingungen" : "Terms of use",
    description: german
      ? "Bedingungen für die Nutzung von Roadhunt."
      : "Terms governing the use of Roadhunt.",
    alternates: {
      canonical: `/${locale}/nutzungsbedingungen`,
      languages: {
        de: "/de/nutzungsbedingungen",
        en: "/en/nutzungsbedingungen",
      },
    },
  };
}

export default async function TermsPage({
  params,
}: TermsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const german = locale === "de";

  return (
    <LegalDocument
      locale={locale}
      eyebrow={german ? "Spielregeln" : "Ground rules"}
      title={german ? "Nutzungsbedingungen" : "Terms of use"}
      intro={
        german
          ? "Die fairen Spielregeln für die Nutzung von Roadhunt."
          : "The fair ground rules for using Roadhunt."
      }
      updatedLabel={german ? "Stand" : "Updated"}
      updated={german ? "23. August 2026" : "23 August 2026"}
    >
      <LegalSection
        number="01"
        title={german ? "Anbieter und Geltung" : "Provider and scope"}
      >
        <p>
          {german
            ? "Diese Bedingungen gelten für die Nutzung von Roadhunt, einem Angebot von:"
            : "These Terms govern the use of Roadhunt, a service provided by:"}
        </p>
        <address>
          <strong>Florian Leeser Softwareentwicklung</strong>
          <br />
          {german ? "Inhaber" : "Proprietor"}: Florian Leeser
          <br />
          Eintrachtstraße 50, 42655 Solingen, {german ? "Deutschland" : "Germany"}
          <br />
          E-Mail: <a href="mailto:support@coderave.dev">support@coderave.dev</a>
        </address>
        <p>
          {german
            ? "Zwingende Verbraucherrechte bleiben unberührt."
            : "Mandatory consumer-protection rights remain unaffected."}
        </p>
      </LegalSection>

      <LegalSection number="02" title={german ? "Mindestalter" : "Minimum age"}>
        <p>
          {german
            ? "Du musst mindestens 16 Jahre alt sein, um Roadhunt eigenständig zu nutzen. Bist du noch nicht volljährig, darfst du Roadhunt nur mit Zustimmung deiner gesetzlichen Vertretung verwenden."
            : "You must be at least 16 years old to use Roadhunt independently. If you are not yet of legal age, you may use Roadhunt only with the consent of your legal guardian."}
        </p>
      </LegalSection>

      <LegalSection
        number="03"
        title={german ? "Das Angebot" : "The service"}
      >
        <p>
          {german
            ? "Roadhunt ist ein browserbasiertes Straßensuchspiel. Du kannst eine Stadt und einen Schwierigkeitsgrad wählen, Straßen auf einer Karte suchen und allein oder in privaten Lobbys Punkte sammeln. Der Dienst wird derzeit unentgeltlich bereitgestellt. Ein Anspruch auf bestimmte Städte, Straßen, Spielmodi, Funktionen oder eine dauerhafte kostenlose Verfügbarkeit besteht nicht."
            : "Roadhunt is a browser-based street-finding game. You can choose a city and difficulty, find streets on a map, and score points alone or in private lobbies. The service is currently provided free of charge. There is no entitlement to particular cities, streets, game modes, features or permanent free availability."}
        </p>
      </LegalSection>

      <LegalSection
        number="04"
        title={german ? "Gastzugang und Nickname" : "Guest access and nickname"}
      >
        <p>
          {german
            ? "Für Online-Partien wird ein anonymer technischer Gastzugang verwendet. Du bist für den Zugriff auf dein Gerät und deine laufende Browser-Sitzung verantwortlich. Wähle einen Nickname, der keine Rechte Dritter verletzt, niemanden täuscht und keine beleidigenden, diskriminierenden, rechtswidrigen oder werblichen Inhalte enthält. Ein Nickname begründet keinen Anspruch auf dauerhafte Reservierung."
            : "Online games use anonymous technical guest access. You are responsible for access to your device and active browser session. Choose a nickname that does not infringe third-party rights, mislead anyone or contain offensive, discriminatory, illegal or promotional content. A nickname is not permanently reserved."}
        </p>
      </LegalSection>

      <LegalSection
        number="05"
        title={german ? "Private Lobbys und Fairplay" : "Private lobbies and fair play"}
      >
        <p>
          {german
            ? "Lobby-Codes sind für die von dir ausgewählten Mitspieler bestimmt. Teile sie nur mit Personen, die teilnehmen sollen. Spiele fair und nutze keine Automatisierung, manipulierten Anfragen, fremden Sitzungen oder sonstigen technischen Hilfsmittel, um Spielstände, Zeitmessung, Kartenpositionen oder Punkte unzulässig zu beeinflussen."
            : "Lobby codes are intended for the players you select. Share them only with people who should participate. Play fairly and do not use automation, manipulated requests, other users' sessions or technical aids to improperly affect game state, timing, map positions or scores."}
        </p>
      </LegalSection>

      <LegalSection
        number="06"
        title={german ? "Unzulässige Nutzung" : "Prohibited use"}
      >
        <p>{german ? "Du darfst Roadhunt insbesondere nicht nutzen, um:" : "You must not use Roadhunt to:"}</p>
        <ul>
          <li>
            {german
              ? "rechtswidrige, schädliche, täuschende, beleidigende oder diskriminierende Inhalte zu verbreiten;"
              : "distribute illegal, harmful, deceptive, abusive or discriminatory content;"}
          </li>
          <li>
            {german
              ? "Sicherheitsmaßnahmen, Zugriffsbeschränkungen oder technische Limits zu umgehen;"
              : "circumvent security measures, access restrictions or technical limits;"}
          </li>
          <li>
            {german
              ? "ohne Berechtigung auf fremde Partien, Sitzungen, Lobby-Codes oder Daten zuzugreifen;"
              : "access another person's games, sessions, lobby codes or data without authorisation;"}
          </li>
          <li>
            {german
              ? "den Dienst zu stören, automatisiert zu überlasten, zu untersuchen oder Schwachstellen auszunutzen; oder"
              : "disrupt, overload, probe or exploit vulnerabilities in the service through automated or other means; or"}
          </li>
          <li>
            {german
              ? "Malware, Spam oder unerwünschte Werbung zu verbreiten."
              : "distribute malware, spam or unsolicited advertising."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        number="07"
        title={german ? "Maßnahmen bei Verstößen" : "Measures for violations"}
      >
        <p>
          {german
            ? "Bei konkreten Anhaltspunkten für einen Verstoß dürfen wir nach angemessener Prüfung Inhalte, Nicknames, Partien oder Zugriffe einschränken oder löschen. Sicherheitsrelevante Hinweise und konkrete rechtswidrige Inhalte kannst du an legal@coderave.dev melden. Nenne dabei möglichst genau den betroffenen Lobby-Code, Zeitpunkt oder sonstige Identifikationsmerkmale, ohne rechtswidrige Inhalte unnötig zu vervielfältigen."
            : "Where there are specific indications of a violation, we may restrict or remove content, nicknames, games or access after an appropriate review. Security issues and specific illegal content can be reported to legal@coderave.dev. Identify the relevant lobby code, time or other details as precisely as possible without unnecessarily reproducing illegal content."}
        </p>
      </LegalSection>

      <LegalSection
        number="08"
        title={german ? "Karten- und Straßendaten" : "Map and street data"}
      >
        <p>
          {german
            ? "Die Karten- und Straßendaten werden von Drittanbietern und offenen Datenquellen bereitgestellt. Trotz sorgfältiger Verarbeitung können sie unvollständig, veraltet oder ungenau sein. Roadhunt ist ein Spiel und nicht zur Navigation, für Notfälle oder für Entscheidungen bestimmt, bei denen es auf exakte Geodaten ankommt. Es gelten die jeweiligen Lizenz- und Quellenhinweise von Mapbox und OpenStreetMap."
            : "Map and street data is supplied by third parties and open-data sources. Despite careful processing, it may be incomplete, outdated or inaccurate. Roadhunt is a game and is not intended for navigation, emergencies or decisions that depend on exact geodata. The respective Mapbox and OpenStreetMap licence and attribution notices apply."}
        </p>
      </LegalSection>

      <LegalSection
        number="09"
        title={german ? "Verfügbarkeit und Änderungen" : "Availability and changes"}
      >
        <p>
          {german
            ? "Wir bemühen uns um einen sicheren und zuverlässigen Betrieb, versprechen aber keine bestimmte Verfügbarkeit, Reaktionszeit oder fehlerfreie Funktion. Wartung, Sicherheitsmaßnahmen, Ausfälle von Infrastruktur- oder Kartenanbietern und Ereignisse außerhalb unseres Einflusses können den Dienst vorübergehend einschränken. Wir dürfen Roadhunt aus technischen, rechtlichen, sicherheitsbezogenen oder produktbezogenen Gründen ändern oder einstellen und berücksichtigen dabei angemessen die Interessen der Nutzer."
            : "We work to operate Roadhunt securely and reliably but do not promise a particular level of availability, response time or error-free function. Maintenance, security measures, outages of infrastructure or map providers, and events beyond our control may temporarily restrict the service. We may change or discontinue Roadhunt for technical, legal, security or product reasons while reasonably considering users' interests."}
        </p>
      </LegalSection>

      <LegalSection
        number="10"
        title={german ? "Gewährleistung und Haftung" : "Warranty and liability"}
      >
        <p>
          {german
            ? "Es gelten die gesetzlichen Gewährleistungsrechte, soweit sie auf das unentgeltliche Angebot anwendbar sind. Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei schuldhafter Verletzung von Leben, Körper oder Gesundheit, nach dem Produkthaftungsgesetz und im Umfang einer ausdrücklich übernommenen Garantie. Bei leicht fahrlässiger Verletzung einer wesentlichen Vertragspflicht ist die Haftung auf den typischen, vorhersehbaren Schaden begrenzt. Für sonstige leichte Fahrlässigkeit ist die Haftung ausgeschlossen. Zwingende gesetzliche Haftung bleibt unberührt."
            : "Statutory warranty rights apply to the extent applicable to the free service. We are liable without limitation for intent and gross negligence, culpable injury to life, body or health, under product-liability law and within the scope of an express guarantee. For a slightly negligent breach of an essential contractual obligation, liability is limited to the typical, foreseeable loss. Liability for other slight negligence is excluded. Mandatory statutory liability remains unaffected."}
        </p>
      </LegalSection>

      <LegalSection number="11" title={german ? "Datenschutz" : "Privacy"}>
        <p>
          {german ? "Informationen zur Verarbeitung personenbezogener Daten findest du in der" : "Information about personal-data processing is provided in the"}{" "}
          <a href={`/${locale}/datenschutz`}>
            {german ? "Datenschutzerklärung" : "Privacy Notice"}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection
        number="12"
        title={german ? "Änderungen dieser Bedingungen" : "Changes to these Terms"}
      >
        <p>
          {german
            ? "Wir können diese Bedingungen aus rechtlichen, sicherheitsbezogenen oder technischen Gründen sowie zur Weiterentwicklung des Angebots ändern. Wesentliche Änderungen werden in geeigneter Weise auf der Website kenntlich gemacht. Wenn du nicht einverstanden bist, kannst du die Nutzung jederzeit beenden."
            : "We may change these Terms for legal, security or technical reasons or to develop the service. Material changes will be identified appropriately on the website. If you do not agree, you may stop using the service at any time."}
        </p>
      </LegalSection>

      <LegalSection
        number="13"
        title={german ? "Recht und Gerichtsstand" : "Law and jurisdiction"}
      >
        <p>
          {german
            ? "Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Für Verbraucher entfallen dadurch keine zwingenden Schutzvorschriften des Staates ihres gewöhnlichen Aufenthalts. Ist der Nutzer Kaufmann, juristische Person des öffentlichen Rechts oder öffentlich-rechtliches Sondervermögen, ist Solingen ausschließlicher Gerichtsstand; für Verbraucher gelten die gesetzlichen Gerichtsstände."
            : "German law applies, excluding the UN Convention on Contracts for the International Sale of Goods. For consumers, this does not remove mandatory protections under the law of their country of habitual residence. If the user is a merchant, public-law entity or special fund under public law, Solingen is the exclusive place of jurisdiction; statutory places of jurisdiction apply to consumers."}
        </p>
        <p>
          {german
            ? "Die deutsche Fassung ist maßgeblich. Die englische Fassung dient als Übersetzung."
            : "The German version controls. The English version is provided as a translation."}
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
