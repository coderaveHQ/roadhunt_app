import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { LegalDocument, LegalSection } from "@/components/legal-document";

type PrivacyPageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({
  params,
}: PrivacyPageProps): Promise<Metadata> {
  const { locale } = await params;
  const german = locale === "de";

  return {
    title: german ? "Datenschutzerklärung" : "Privacy notice",
    description: german
      ? "Informationen zur Verarbeitung personenbezogener Daten bei Roadhunt."
      : "Information about personal-data processing when using Roadhunt.",
    alternates: {
      canonical: `/${locale}/datenschutz`,
      languages: { de: "/de/datenschutz", en: "/en/datenschutz" },
    },
  };
}

export default async function PrivacyPage({
  params,
}: PrivacyPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const german = locale === "de";

  return (
    <LegalDocument
      locale={locale}
      eyebrow={german ? "Deine Daten" : "Your data"}
      title={german ? "Datenschutz" : "Privacy"}
      intro={
        german
          ? "Welche Daten Roadhunt verarbeitet, warum das geschieht und welche Rechte du hast."
          : "What data Roadhunt processes, why it does so and which rights you have."
      }
      updatedLabel={german ? "Stand" : "Updated"}
      updated={german ? "23. August 2026" : "23 August 2026"}
    >
      <LegalSection number="01" title={german ? "Verantwortlicher" : "Controller"}>
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
          <br />
          E-Mail: <a href="mailto:privacy@coderave.dev">privacy@coderave.dev</a>
        </address>
        <p>
          {german
            ? "Ein Datenschutzbeauftragter ist nicht bestellt, weil keine gesetzliche Bestellpflicht besteht."
            : "No data protection officer has been appointed because there is no statutory appointment requirement."}
        </p>
      </LegalSection>

      <LegalSection
        number="02"
        title={german ? "Geltungsbereich" : "Scope of this notice"}
      >
        <p>
          {german
            ? "Diese Erklärung gilt für die öffentliche Website und das browserbasierte Spiel Roadhunt unter roadhunt.app einschließlich Solo-Partien, privaten Lobbys und der Städtesuche. Roadhunt verwendet keine Werbetracker, bildet keine Werbeprofile und trifft keine ausschließlich automatisierten Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung."
            : "This notice applies to the public website and browser game Roadhunt at roadhunt.app, including solo games, private lobbies and city search. Roadhunt does not use advertising trackers, create advertising profiles or make solely automated decisions with legal or similarly significant effects."}
        </p>
      </LegalSection>

      <LegalSection
        number="03"
        title={german ? "Aufruf der Website" : "Visiting the website"}
      >
        <p>
          {german
            ? "Beim Aufruf verarbeitet der Hostinganbieter technisch notwendige Verbindungsdaten. Dazu können IP-Adresse, Zeitpunkt, aufgerufener Pfad, Referrer, Browser- und Betriebssystemangaben, übertragene Datenmenge sowie Sicherheits- und Fehlerdaten gehören. Die Verarbeitung dient der Auslieferung, Stabilität, Fehleranalyse und Missbrauchsabwehr. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt im sicheren, zuverlässigen und wirtschaftlichen Betrieb."
            : "When you visit, the hosting provider processes technically necessary connection data. This can include IP address, time, requested path, referrer, browser and operating-system details, transferred volume, and security or error data. Processing is used to deliver, stabilise, troubleshoot and protect the service. The legal basis is Article 6(1)(f) GDPR; our legitimate interest is secure, reliable and economical operation."}
        </p>
      </LegalSection>

      <LegalSection
        number="04"
        title={
          german ? "Gastzugang und Sitzung" : "Guest access and session"
        }
      >
        <p>
          {german
            ? "Für Online-Partien erzeugt Roadhunt ein anonymes technisches Gastkonto. Dabei werden eine zufällige Nutzerkennung, Authentifizierungs- und Sitzungsdaten sowie Zeitstempel verarbeitet. Es werden weder E-Mail-Adresse noch Passwort verlangt. Technisch notwendige Sitzungs-Cookies halten die anonyme Anmeldung aufrecht und schützen den Zugriff auf die jeweilige Partie. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO; ergänzend stützen wir Sicherheitsmaßnahmen auf Art. 6 Abs. 1 lit. f DSGVO. Das Speichern oder Auslesen der notwendigen Sitzungsinformationen erfolgt gemäß § 25 Abs. 2 TDDDG."
            : "For online games, Roadhunt creates an anonymous technical guest account. A random user identifier, authentication and session data, and timestamps are processed. No email address or password is requested. Technically necessary session cookies maintain the anonymous sign-in and protect access to the relevant game. The legal basis is Article 6(1)(b) GDPR; security measures additionally rely on Article 6(1)(f) GDPR. Necessary session information is stored or accessed under section 25(2) TDDDG."}
        </p>
      </LegalSection>

      <LegalSection
        number="05"
        title={german ? "Spiel- und Lobbydaten" : "Game and lobby data"}
      >
        <p>
          {german
            ? "Je nach Spielmodus verarbeitet Roadhunt deinen gewählten Nickname, Stadt, Schwierigkeitsgrad, Lobby-Code und Rollenstatus sowie Spiel-, Runden- und Zeitstempel. Zu jedem Tipp werden die gesetzte Kartenposition, Entfernung zur Zielstraße, verbleibende Zeit und Punktzahl gespeichert. Diese Daten sind notwendig, um die Partie zu erstellen, zwischen Geräten zu synchronisieren, Ergebnisse zu berechnen und Mitspielern den gemeinsamen Spielstand anzuzeigen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO."
            : "Depending on the game mode, Roadhunt processes your chosen nickname, city, difficulty, lobby code and role status, as well as game, round and timing data. Each guess stores the selected map position, distance from the target street, remaining time and score. This data is needed to create and synchronise the game, calculate results and show the shared state to other players. The legal basis is Article 6(1)(b) GDPR."}
        </p>
        <p>
          {german
            ? "In privaten Lobbys sehen die anderen Teilnehmer insbesondere Nickname, Anwesenheitsstatus, Tipps nach der Auflösung und Punktestand. Verwende keinen Nickname, der unnötig Rückschlüsse auf deine Identität zulässt."
            : "In private lobbies, other participants can see information including your nickname, presence status, guesses after the reveal and score. Do not choose a nickname that unnecessarily identifies you."}
        </p>
      </LegalSection>

      <LegalSection
        number="06"
        title={german ? "Lokale Browserdaten" : "Local browser data"}
      >
        <p>
          {german
            ? "Roadhunt speichert den zuletzt verwendeten Nickname und lokale Bestwerte einschließlich Stadt, Schwierigkeitsgrad, Punktzahl und Zeitpunkt im Local Storage deines Browsers. Lokale Demo-Partien werden für die Dauer des Browser-Tabs im Session Storage gehalten. Die Daten verbleiben auf deinem Gerät und werden nicht allein durch diese lokale Speicherung an uns übertragen. Du kannst sie jederzeit über die Website-Daten deines Browsers löschen. Die Speicherung ist für die von dir aufgerufenen Komfort- und Spielfunktionen erforderlich und erfolgt gemäß § 25 Abs. 2 TDDDG."
            : "Roadhunt stores your most recently used nickname and local best scores, including city, difficulty, score and time, in your browser's local storage. Local demo games remain in session storage for the lifetime of the browser tab. This data stays on your device and is not sent to us merely because it is stored locally. You can delete it at any time through your browser's website-data settings. Storage is necessary for the convenience and game functions you request and is performed under section 25(2) TDDDG."}
        </p>
      </LegalSection>

      <LegalSection number="07" title="Mapbox">
        <p>
          {german
            ? "Die interaktive Karte wird über Dienste von Mapbox, Inc. geladen. Beim Laden können insbesondere IP-Adresse, Geräte- und Browserinformationen, Zeitpunkt, Kartenansicht und technische Nutzungsdaten an Mapbox übertragen werden. Dies ist erforderlich, um die von dir gestartete Kartenfunktion bereitzustellen. Rechtsgrundlagen sind Art. 6 Abs. 1 lit. b und lit. f DSGVO; unser berechtigtes Interesse liegt in einer funktionsfähigen und missbrauchsgeschützten Kartendarstellung."
            : "The interactive map is loaded using services from Mapbox, Inc. When it loads, information including your IP address, device and browser details, time, map view and technical usage data may be transferred to Mapbox. This is necessary to provide the map function you started. The legal bases are Article 6(1)(b) and (f) GDPR; our legitimate interest is a functional map that is protected against misuse."}
        </p>
        <p>
          <a
            href="https://www.mapbox.com/legal/privacy"
            target="_blank"
            rel="noreferrer"
          >
            {german ? "Datenschutzhinweise von Mapbox" : "Mapbox privacy notice"} ↗
          </a>
        </p>
      </LegalSection>

      <LegalSection
        number="08"
        title={german ? "Supabase" : "Supabase"}
      >
        <p>
          {german
            ? "Für anonyme Authentifizierung, Datenbank, Spielzustand und Echtzeit-Aktualisierungen nutzen wir Supabase, Inc. Supabase verarbeitet die dafür erforderlichen Authentifizierungs-, Spiel- und Verbindungsdaten als Auftragsverarbeiter. Die Datenbank ist durch rollen- und spielbezogene Zugriffsregeln geschützt."
            : "We use Supabase, Inc. for anonymous authentication, the database, game state and realtime updates. Supabase processes the required authentication, game and connection data as a processor. The database is protected by role- and game-based access rules."}
        </p>
        <p>
          <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">
            {german ? "Datenschutzhinweise von Supabase" : "Supabase privacy notice"} ↗
          </a>
        </p>
      </LegalSection>

      <LegalSection
        number="09"
        title={german ? "Hosting durch Vercel" : "Hosting by Vercel"}
      >
        <p>
          {german
            ? "Website und Serverfunktionen werden über Vercel Inc. bereitgestellt. Vercel verarbeitet dabei die in Abschnitt 3 beschriebenen Verbindungs-, Sicherheits- und Fehlerdaten als Auftragsverarbeiter."
            : "The website and server functions are delivered through Vercel Inc. Vercel acts as a processor for the connection, security and error data described in section 3."}
        </p>
        <p>
          <a
            href="https://vercel.com/legal/privacy-notice"
            target="_blank"
            rel="noreferrer"
          >
            {german ? "Datenschutzhinweise von Vercel" : "Vercel privacy notice"} ↗
          </a>
        </p>
      </LegalSection>

      <LegalSection
        number="10"
        title={german ? "Empfänger und Drittländer" : "Recipients and third countries"}
      >
        <p>
          {german
            ? "Empfänger sind neben den genannten Auftragsverarbeitern nur Stellen, an die wir Daten aufgrund einer gesetzlichen Pflicht oder zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen übermitteln müssen. Einige Anbieter und Unterauftragnehmer sind in den USA ansässig oder verarbeiten Daten dort. Soweit erforderlich, stützen sich Übermittlungen auf einen Angemessenheitsbeschluss – insbesondere das EU-US Data Privacy Framework für zertifizierte Empfänger – oder geeignete Garantien wie die Standardvertragsklauseln der Europäischen Kommission."
            : "Apart from the processors named above, recipients are limited to bodies to which disclosure is required by law or needed to establish, exercise or defend legal claims. Some providers and subprocessors are established in, or process data in, the United States. Where required, transfers rely on an adequacy decision—particularly the EU-US Data Privacy Framework for certified recipients—or appropriate safeguards such as the European Commission's Standard Contractual Clauses."}
        </p>
      </LegalSection>

      <LegalSection
        number="11"
        title={german ? "Speicherdauer" : "Retention"}
      >
        <ul>
          <li>
            {german
              ? "Wartende Lobbys laufen regelmäßig nach bis zu sechs Stunden ab; laufende Partien werden mit einem technischen Ablaufzeitpunkt von grundsätzlich drei Stunden gesichert."
              : "Waiting lobbies ordinarily expire after up to six hours; active games use a technical expiry period of generally three hours."}
          </li>
          <li>
            {german
              ? "Abgeschlossene Partien einschließlich Nicknames und Tipps laufen nach 24 Stunden ab und werden durch den regelmäßigen Bereinigungslauf gelöscht."
              : "Completed games, including nicknames and guesses, expire after 24 hours and are deleted by the regular cleanup process."}
          </li>
          <li>
            {german
              ? "Das technische anonyme Authentifizierungsprofil wird getrennt vom einzelnen Spiel gespeichert und gelöscht, sobald es für Betrieb, Sicherheit und die Abwicklung möglicher Betroffenenanfragen nicht mehr erforderlich ist."
              : "The technical anonymous authentication profile is stored separately from an individual game and deleted once it is no longer required for operation, security and handling potential data-subject requests."}
          </li>
          <li>
            {german
              ? "Lokale Browserdaten bleiben bestehen, bis du sie im Browser löschst; Session-Storage-Daten enden grundsätzlich mit der Browser-Sitzung."
              : "Local browser data remains until you delete it in the browser; session-storage data generally ends with the browser session."}
          </li>
          <li>
            {german
              ? "Technische Protokolle werden nach den betrieblichen Löschfristen der Anbieter gelöscht, sofern sie nicht ausnahmsweise länger zur Aufklärung eines Sicherheitsvorfalls oder aufgrund gesetzlicher Pflichten benötigt werden."
              : "Technical logs are deleted according to the providers' operational schedules unless exceptionally needed for longer to investigate a security incident or comply with law."}
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        number="12"
        title={german ? "Kontaktaufnahme" : "Contacting us"}
      >
        <p>
          {german
            ? "Wenn du uns per E-Mail kontaktierst, verarbeiten wir Absenderadresse, Nachricht, Anhänge, Zeitstempel und die zur Bearbeitung notwendigen technischen oder spielbezogenen Angaben. Rechtsgrundlagen sind je nach Anliegen Art. 6 Abs. 1 lit. b, c oder f DSGVO. Korrespondenz wird in der Regel drei Jahre nach Abschluss des Vorgangs gelöscht; gesetzliche Aufbewahrungspflichten oder Rechtsansprüche können eine längere Speicherung erfordern."
            : "If you contact us by email, we process the sender address, message, attachments, timestamps and any technical or game details required to respond. Depending on the request, the legal bases are Article 6(1)(b), (c) or (f) GDPR. Correspondence is ordinarily deleted three years after the matter closes; statutory retention obligations or legal claims may require longer storage."}
        </p>
      </LegalSection>

      <LegalSection
        number="13"
        title={german ? "Deine Rechte" : "Your rights"}
      >
        <p>
          {german
            ? "Unter den gesetzlichen Voraussetzungen hast du Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Beruht eine Verarbeitung auf Art. 6 Abs. 1 lit. f DSGVO, kannst du aus Gründen, die sich aus deiner besonderen Situation ergeben, widersprechen. Richte Anfragen an privacy@coderave.dev. Zum Schutz vor unbefugter Offenlegung können wir einen angemessenen Identitätsnachweis verlangen."
            : "Subject to statutory requirements, you have rights of access, rectification, erasure, restriction of processing, data portability and objection. Where processing relies on Article 6(1)(f) GDPR, you may object for reasons arising from your particular situation. Send requests to privacy@coderave.dev. We may request reasonable proof of identity to prevent unauthorised disclosure."}
        </p>
        <p>
          {german
            ? "Du hast außerdem das Recht, dich bei einer Datenschutzaufsichtsbehörde zu beschweren. Zuständig ist insbesondere die Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen, Kavalleriestraße 2–4, 40213 Düsseldorf."
            : "You also have the right to complain to a data-protection authority. Our competent authority is the State Commissioner for Data Protection and Freedom of Information North Rhine-Westphalia, Kavalleriestraße 2–4, 40213 Düsseldorf, Germany."}
        </p>
        <p>
          <a href="https://www.ldi.nrw.de" target="_blank" rel="noreferrer">
            www.ldi.nrw.de ↗
          </a>
        </p>
      </LegalSection>

      <LegalSection number="14" title={german ? "Änderungen" : "Changes"}>
        <p>
          {german
            ? "Wir aktualisieren diese Datenschutzerklärung, wenn sich Roadhunt, eingesetzte Anbieter oder die Rechtslage wesentlich ändern. Es gilt die jeweils auf dieser Seite veröffentlichte Fassung."
            : "We update this Privacy Notice when Roadhunt, its providers or applicable law materially changes. The version published on this page applies."}
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
