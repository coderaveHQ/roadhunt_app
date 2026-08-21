# Roadhunt

Roadhunt ist ein responsives Straßensuchspiel für `roadhunt.app`. In zehn
Runden suchen Spieler eine vorgegebene Straße auf einer Mapbox-Karte ohne
Straßenbeschriftungen – solo oder in privaten Lobbys mit bis zu acht Personen.

## Lokal starten

Voraussetzungen: Node.js 24+, Docker und ein öffentlicher Mapbox-Token.

```sh
npm install
npm run db:start
npm run db:reset
cp .env.local.example .env.local
npm run dev
```

`supabase status -o env` liefert URL, Publishable Key und Secret Key für die
lokale `.env.local`. Der Mapbox-Token gehört in
`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`. Lokale Supabase-Ports sind `55321` (API),
`55322` (Postgres) und `55323` (Studio).

`npm run dev` lauscht bewusst auf allen lokalen Interfaces. Ein iPhone im
selben WLAN öffnet `http://<MAC-IP>:3000/de`; die Mac-IP zeigt beispielsweise
`ipconfig getifaddr en0`. Für Auth und Realtime ersetzt der Browser die lokale
Supabase-Loopbackadresse automatisch durch denselben LAN-Host. Die
Produktionskonfiguration wird dadurch nicht verändert.

## Qualitätssicherung

```sh
npm run typecheck
npm run lint
npm test
npm run db:test
npm run test:e2e
npm run build
```

Die Playwright-Suite spielt zwei vollständige Solo-Partien (Deutsch/Desktop
und Englisch/Smartphone) sowie eine Zwei-Browser-Lobby über alle zehn Runden
einschließlich Reconnect und Ergebnisansicht. Der Datenbanktest prüft unter
anderem Ziel-Leakage, PostGIS-Wertung, parallele Abgaben, Timeouts, Idempotenz,
ACLs, Realtime-Mitgliedschaft, Revanche und Hostwechsel.

## Daten und OpenStreetMap

`supabase/schemas/00_roadhunt.sql` ist die deklarative Quelle der Wahrheit. Der
lokale Seed enthält 480 deterministische Testziele für schnelle Datenbanktests.
Der Produktionskatalog wird dagegen reproduzierbar aus einem gepinnten
Geofabrik-Deutschland-PBF aufgebaut:

```sh
npm run osm:import -- all --runtime native
```

Die Pipeline importiert jede deutsche Gemeinde mit administrativer Grenze und
alle benannten `highway`-Ways mit positivem Linienanteil innerhalb dieser
Gemeindegrenzen in ein isoliertes `osm_import`-Staging-Schema.
Straßen werden räumlich je Gemeinde zugeschnitten und nach normalisiertem Namen
als `MultiLineString` zusammengefasst. Ungeeignete oder beschränkt zugängliche
Ways bleiben im Staging für Datenvollständigkeit erhalten, fließen aber weder
in die Zielgeometrie noch über `is_playable` in Spielpools ein. `trunk`,
`primary` und `secondary` werden einschließlich ihrer Link-Typen als Easy
klassifiziert. Details zu Snapshot, Prüfsumme,
Platzbedarf, nativer Installation und Docker-Fallback stehen in
`data/osm-germany/README.md`.

Das bisherige zwölf-Städte-Overpass-Werkzeug bleibt für kleine Diagnosen unter
`npm run osm:import:legacy` verfügbar. Nach einem bewussten `npm run db:reset`
ist wieder nur der kleine Test-Seed aktiv und der Deutschlandimport muss erneut
ausgeführt werden.

## Architektur und Sicherheit

- Next.js App Router, TypeScript, Tailwind CSS, `next-intl` und Mapbox GL JS
- Supabase Auth (anonyme Gäste), PostGIS, private Realtime-Kanäle und RLS
- Browser erhalten vor der Auflösung weder Zielgeometrie noch fremde Tipps
- Alle Spiel-RPCs sind nur für den serverseitigen Supabase Secret Key ausführbar
- Der tägliche Vercel-Cron unter `/api/cron/cleanup` ist mit `CRON_SECRET`
  geschützt und entfernt abgelaufene Partien

Vor dem Hosting müssen anonyme Anmeldung und private Realtime-Kanäle im
Supabase-Dashboard aktiviert sowie Mapbox-URLs auf localhost, Preview-Hosts und
`roadhunt.app` beschränkt werden. Ein CAPTCHA kann als zusätzliche
Missbrauchsbremse ergänzt werden, benötigt dann aber auch eine passende
Token-Übergabe im Anmeldefluss. Geheimnisse gehören nie ins Repository.
