import type { Position, StreetGeometry } from "./types";

const EARTH_RADIUS_METERS = 6_371_008.8;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

export function haversineDistanceMeters(from: Position, to: Position): number {
  const latitudeDelta = radians(to[1] - from[1]);
  const longitudeDelta = radians(to[0] - from[0]);
  const fromLatitude = radians(from[1]);
  const toLatitude = radians(to[1]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function lineLengthMeters(coordinates: readonly Position[]): number {
  let length = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    length += haversineDistanceMeters(coordinates[index - 1]!, coordinates[index]!);
  }
  return length;
}

function pointToSegmentDistanceMeters(
  point: Position,
  start: Position,
  end: Position,
): number {
  // Local equirectangular projection is highly accurate at Roadhunt's <city scale.
  const referenceLatitude = radians((point[1] + start[1] + end[1]) / 3);
  const longitudeScale = EARTH_RADIUS_METERS * Math.cos(referenceLatitude);
  const latitudeScale = EARTH_RADIUS_METERS;
  const startX = radians(start[0] - point[0]) * longitudeScale;
  const startY = radians(start[1] - point[1]) * latitudeScale;
  const endX = radians(end[0] - point[0]) * longitudeScale;
  const endY = radians(end[1] - point[1]) * latitudeScale;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const squaredLength = deltaX * deltaX + deltaY * deltaY;

  if (squaredLength === 0) return Math.hypot(startX, startY);
  const projection = Math.min(
    1,
    Math.max(0, -(startX * deltaX + startY * deltaY) / squaredLength),
  );
  return Math.hypot(startX + projection * deltaX, startY + projection * deltaY);
}

/** Turf-free minimum point-to-street distance for deterministic demo scoring. */
export function pointToStreetDistanceMeters(
  point: Position,
  geometry: StreetGeometry,
): number {
  if (!isPosition(point)) throw new RangeError("Point is outside valid longitude/latitude bounds");
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  let minimum = Number.POSITIVE_INFINITY;

  for (const line of lines) {
    if (line.length === 1 && isPosition(line[0])) {
      minimum = Math.min(minimum, haversineDistanceMeters(point, line[0]));
    }
    for (let index = 1; index < line.length; index += 1) {
      const start = line[index - 1];
      const end = line[index];
      if (!isPosition(start) || !isPosition(end)) continue;
      minimum = Math.min(minimum, pointToSegmentDistanceMeters(point, start, end));
    }
  }

  return Number.isFinite(minimum) ? minimum : Number.POSITIVE_INFINITY;
}
