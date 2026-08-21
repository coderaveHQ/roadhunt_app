import { getCity, type CitySlug } from "./catalog";
import { lineLengthMeters } from "./geo";
import type {
  BoundingBox,
  Difficulty,
  LineStringGeometry,
  Position,
} from "./types";

interface CityDemoNames {
  readonly easy: readonly string[];
  readonly medium: readonly string[];
}

const CITY_DEMO_NAMES: Readonly<Record<CitySlug, CityDemoNames>> = {
  berlin: {
    easy: [
      "Unter den Linden",
      "Kurfürstendamm",
      "Frankfurter Allee",
      "Karl-Marx-Allee",
      "Potsdamer Straße",
      "Schönhauser Allee",
      "Sonnenallee",
      "Tempelhofer Damm",
      "Heerstraße",
      "Landsberger Allee",
    ],
    medium: [
      "Oranienstraße",
      "Kantstraße",
      "Warschauer Straße",
      "Turmstraße",
      "Danziger Straße",
      "Mehringdamm",
      "Hermannstraße",
      "Invalidenstraße",
      "Friedrichstraße",
      "Greifswalder Straße",
    ],
  },
  hamburg: {
    easy: [
      "Reeperbahn",
      "Jungfernstieg",
      "Mönckebergstraße",
      "Elbchaussee",
      "Stresemannstraße",
      "Kieler Straße",
      "Wandsbeker Chaussee",
      "Lübecker Straße",
      "Eppendorfer Landstraße",
      "Bergedorfer Straße",
    ],
    medium: [
      "Schulterblatt",
      "Lange Reihe",
      "Osterstraße",
      "Fuhlsbüttler Straße",
      "Grindelallee",
      "Max-Brauer-Allee",
      "Sievekingsallee",
      "Habichtstraße",
      "Saseler Chaussee",
      "Holstenstraße",
    ],
  },
  munich: {
    easy: [
      "Leopoldstraße",
      "Ludwigstraße",
      "Maximilianstraße",
      "Prinzregentenstraße",
      "Landsberger Straße",
      "Dachauer Straße",
      "Lindwurmstraße",
      "Rosenheimer Straße",
      "Wasserburger Landstraße",
      "Fürstenrieder Straße",
    ],
    medium: [
      "Sendlinger Straße",
      "Gabelsbergerstraße",
      "Schleißheimer Straße",
      "Nymphenburger Straße",
      "Türkenstraße",
      "Kazmairstraße",
      "Einsteinstraße",
      "Wolfratshauser Straße",
      "Ismaninger Straße",
      "Hansastraße",
    ],
  },
  cologne: {
    easy: [
      "Aachener Straße",
      "Luxemburger Straße",
      "Bonner Straße",
      "Venloer Straße",
      "Neusser Straße",
      "Bergisch Gladbacher Straße",
      "Hohenzollernring",
      "Severinstraße",
      "Frankfurter Straße",
      "Rheinuferstraße",
    ],
    medium: [
      "Zülpicher Straße",
      "Dürener Straße",
      "Subbelrather Straße",
      "Sülzgürtel",
      "Niehler Straße",
      "Kalker Hauptstraße",
      "Dellbrücker Hauptstraße",
      "Roonstraße",
      "Vorgebirgstraße",
      "Berrenrather Straße",
    ],
  },
  frankfurt: {
    easy: [
      "Zeil",
      "Mainzer Landstraße",
      "Hanauer Landstraße",
      "Bockenheimer Landstraße",
      "Friedberger Landstraße",
      "Eschersheimer Landstraße",
      "Miquelallee",
      "Kennedyallee",
      "Gutleutstraße",
      "Darmstädter Landstraße",
    ],
    medium: [
      "Berger Straße",
      "Schweizer Straße",
      "Leipziger Straße",
      "Kaiserstraße",
      "Oeder Weg",
      "Habsburgerallee",
      "Adickesallee",
      "Saalburgallee",
      "Grüneburgweg",
      "Rödelheimer Landstraße",
    ],
  },
  duesseldorf: {
    easy: [
      "Königsallee",
      "Berliner Allee",
      "Graf-Adolf-Straße",
      "Corneliusstraße",
      "Münsterstraße",
      "Kölner Landstraße",
      "Ludenberger Straße",
      "Völklinger Straße",
      "Heinrichstraße",
      "Rheinufertunnel",
    ],
    medium: [
      "Schadowstraße",
      "Nordstraße",
      "Lorettostraße",
      "Ackerstraße",
      "Rethelstraße",
      "Birkenstraße",
      "Bilkstraße",
      "Ulmenstraße",
      "Ratinger Straße",
      "Brehmstraße",
    ],
  },
  stuttgart: {
    easy: [
      "Königstraße",
      "Theodor-Heuss-Straße",
      "Heilbronner Straße",
      "Cannstatter Straße",
      "Neckartalstraße",
      "Hohenheimer Straße",
      "Pragsattel",
      "Rotebühlstraße",
      "Wildparkstraße",
      "Waiblinger Straße",
    ],
    medium: [
      "Tübinger Straße",
      "Gablenberger Hauptstraße",
      "Schwabstraße",
      "Werastraße",
      "Alexanderstraße",
      "Haußmannstraße",
      "Böblinger Straße",
      "Olgastraße",
      "Maybachstraße",
      "Mercedesstraße",
    ],
  },
  leipzig: {
    easy: [
      "Ringstraße",
      "Karl-Liebknecht-Straße",
      "Eisenbahnstraße",
      "Jahnallee",
      "Torgauer Straße",
      "Delitzscher Straße",
      "Prager Straße",
      "Wurzner Straße",
      "Lützner Straße",
      "Bornaische Straße",
    ],
    medium: [
      "Georg-Schumann-Straße",
      "Gohliser Straße",
      "Käthe-Kollwitz-Straße",
      "Zschochersche Straße",
      "Arthur-Hoffmann-Straße",
      "Riebeckstraße",
      "Permoserstraße",
      "Rosa-Luxemburg-Straße",
      "Holzhäuser Straße",
      "Mockauer Straße",
    ],
  },
  solingen: {
    easy: [
      "Kölner Straße",
      "Wuppertaler Straße",
      "Schlagbaumer Straße",
      "Focher Straße",
      "Bonner Straße",
      "Merscheider Straße",
      "Aufderhöher Straße",
      "Friedrich-Ebert-Straße",
      "Cronenberger Straße",
      "Ohligser Straße",
    ],
    medium: [
      "Grünewalder Straße",
      "Mangenberger Straße",
      "Kasernenstraße",
      "Werwolf",
      "Ufergarten",
      "Dültgenstaler Straße",
      "Beethovenstraße",
      "Burger Landstraße",
      "Löhdorfer Straße",
      "Katternberger Straße",
    ],
  },
  duisburg: {
    easy: [
      "Düsseldorfer Straße",
      "Mülheimer Straße",
      "Ruhrorter Straße",
      "Moerser Straße",
      "Krefelder Straße",
      "Wanheimer Straße",
      "Kaiser-Friedrich-Straße",
      "Friedrich-Ebert-Straße",
      "Koloniestraße",
      "Emmericher Straße",
    ],
    medium: [
      "Königstraße",
      "Sternbuschweg",
      "Grabenstraße",
      "Düsseldorfer Landstraße",
      "Atroper Straße",
      "Wedauer Straße",
      "Rheinhauser Straße",
      "Kalkweg",
      "Holtener Straße",
      "Großenbaumer Allee",
    ],
  },
  moers: {
    easy: [
      "Homberger Straße",
      "Rheinberger Straße",
      "Krefelder Straße",
      "Düsseldorfer Straße",
      "Uerdinger Straße",
      "Kamper Straße",
      "Repelener Straße",
      "Venloer Straße",
      "Römerstraße",
      "Lintforter Straße",
    ],
    medium: [
      "Neustraße",
      "Steinstraße",
      "Unterwallstraße",
      "Essenberger Straße",
      "Baerler Straße",
      "Asberger Straße",
      "Hülsdonker Straße",
      "Filder Straße",
      "Meerstraße",
      "Holderberger Straße",
    ],
  },
  wuppertal: {
    easy: [
      "Friedrich-Engels-Allee",
      "Bundesallee",
      "Hofaue",
      "Briller Straße",
      "Uellendahler Straße",
      "Cronenberger Straße",
      "Ronsdorfer Straße",
      "Heckinghauser Straße",
      "Schwelmer Straße",
      "Langerfelder Straße",
    ],
    medium: [
      "Luisenstraße",
      "Hochstraße",
      "Gathe",
      "Wichlinghauser Straße",
      "Wittensteinstraße",
      "Bendahler Straße",
      "Sonnborner Straße",
      "Nützenberger Straße",
      "Nevigeser Straße",
      "Küllenhahner Straße",
    ],
  },
};

const HARD_NAMES = [
  "Ahornstraße",
  "Buchenweg",
  "Eichenkamp",
  "Finkenstraße",
  "Gartenweg",
  "Heideweg",
  "Kastanienallee",
  "Lerchenstraße",
  "Rosenweg",
  "Ulmenstraße",
] as const;

const INSANE_NAMES = [
  "Am Anger",
  "Am Hang",
  "Im Winkel",
  "Kleine Gasse",
  "Mühlenpfad",
  "Quellenweg",
  "Stegstraße",
  "Tannenstieg",
  "Wiesenrain",
  "Zum Hof",
] as const;

const TARGET_LENGTH_METERS: Readonly<Record<Difficulty, number>> = {
  easy: 3_000,
  medium: 1_450,
  hard: 620,
  insane: 220,
};

export interface DemoRound {
  readonly id: string;
  readonly streetId: string;
  readonly number: number;
  readonly citySlug: CitySlug;
  readonly difficulty: Difficulty;
  readonly targetStreetName: string;
  readonly targetGeometry: LineStringGeometry;
  readonly targetLengthMeters: number;
  readonly bounds: BoundingBox;
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function streetGeometry(
  citySlug: CitySlug,
  difficulty: Difficulty,
  index: number,
): LineStringGeometry {
  const city = getCity(citySlug);
  const random = seededRandom(hashSeed(`${citySlug}:${difficulty}:${index}`));
  const [west, south, east, north] = city.bounds;
  const width = east - west;
  const height = north - south;
  const localCenter: Position = [
    clamp(city.center[0] + (random() - 0.5) * width * 0.32, west + width * 0.2, east - width * 0.2),
    clamp(city.center[1] + (random() - 0.5) * height * 0.32, south + height * 0.2, north - height * 0.2),
  ];

  const desiredLength = TARGET_LENGTH_METERS[difficulty] * (0.9 + random() * 0.2);
  const angle = random() * Math.PI * 2;
  const halfLength = desiredLength / 2;
  const latitudeDegrees = (Math.sin(angle) * halfLength) / 111_320;
  const longitudeScale = 111_320 * Math.max(0.2, Math.cos((localCenter[1] * Math.PI) / 180));
  const longitudeDegrees = (Math.cos(angle) * halfLength) / longitudeScale;
  const bend = (random() - 0.5) * 0.25;

  const start: Position = [localCenter[0] - longitudeDegrees, localCenter[1] - latitudeDegrees];
  const middle: Position = [
    localCenter[0] - latitudeDegrees * bend,
    localCenter[1] + longitudeDegrees * bend,
  ];
  const end: Position = [localCenter[0] + longitudeDegrees, localCenter[1] + latitudeDegrees];
  return { type: "LineString", coordinates: [start, middle, end] };
}

export function getDemoStreetNames(
  citySlug: CitySlug,
  difficulty: Difficulty,
): readonly string[] {
  if (difficulty === "hard") return HARD_NAMES;
  if (difficulty === "insane") return INSANE_NAMES;
  return CITY_DEMO_NAMES[citySlug][difficulty];
}

/**
 * Creates the exact same ten serializable rounds on server and client. It uses
 * no current time, browser API, or global random state.
 */
export function createDemoRounds(
  citySlug: CitySlug,
  difficulty: Difficulty,
): readonly DemoRound[] {
  const city = getCity(citySlug);
  return getDemoStreetNames(citySlug, difficulty).map((targetStreetName, index) => {
    const targetGeometry = streetGeometry(citySlug, difficulty, index);
    const stableId = `demo:${citySlug}:${difficulty}:${index + 1}`;
    return {
      id: stableId,
      streetId: stableId,
      number: index + 1,
      citySlug,
      difficulty,
      targetStreetName,
      targetGeometry,
      targetLengthMeters: lineLengthMeters(targetGeometry.coordinates),
      bounds: city.bounds,
    };
  });
}

export const generateDemoRounds = createDemoRounds;
