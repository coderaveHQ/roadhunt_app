"use client";

import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapboxMap,
  Marker,
} from "mapbox-gl";
import { useEffect, useRef, useState } from "react";

import type {
  BoundingBox,
  Position,
  StreetGeometry,
} from "@/lib/game/types";

export type RevealMarker = {
  id: string;
  position: Position | null;
  nickname: string;
  color: PlayerMarkerColor;
  isCurrentPlayer?: boolean;
};

export type PlayerMarkerColor = {
  background: string;
  foreground: string;
};

export const PLAYER_MARKER_COLORS: readonly PlayerMarkerColor[] = [
  { background: "#ff5a36", foreground: "#101b2b" },
  { background: "#73d7ec", foreground: "#101b2b" },
  { background: "#c9ff3d", foreground: "#101b2b" },
  { background: "#6c4ccf", foreground: "#ffffff" },
  { background: "#e8b01f", foreground: "#101b2b" },
  { background: "#147453", foreground: "#ffffff" },
  { background: "#b83270", foreground: "#ffffff" },
  { background: "#315fc9", foreground: "#ffffff" },
];

export function createPlayerMarkerColorMap(playerIds: readonly string[]) {
  const stableIds = [...new Set(playerIds)].sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1,
  );
  return new Map(
    stableIds.map((playerId, index) => [
      playerId,
      PLAYER_MARKER_COLORS[index % PLAYER_MARKER_COLORS.length],
    ]),
  );
}

export function firstVisibleNicknameLetter(nickname: string) {
  const visibleCharacter = Array.from(nickname.normalize("NFC").trim())[0];
  return Array.from(visibleCharacter?.toLocaleUpperCase() ?? "?")[0] ?? "?";
}

export function cityFitOptions(revealing: boolean, reduceMotion: boolean) {
  return {
    padding: 34,
    duration: reduceMotion ? 0 : revealing ? 750 : 450,
  } as const;
}

type RoadMapProps = {
  bounds: BoundingBox;
  selectedPosition: Position | null;
  onSelect: (position: Position) => void;
  disabled?: boolean;
  targetGeometry?: StreetGeometry | null;
  revealMarkers?: readonly RevealMarker[];
  revealing?: boolean;
  roundKey: string;
  mapLabel: string;
  keyboardHint: string;
  selectionLabel: string;
  selectionNickname: string;
  selectionColor: PlayerMarkerColor;
  unavailableLabel: string;
};

function markerElement(
  className: string,
  accessibleLabel: string,
  nickname: string,
  color: PlayerMarkerColor,
) {
  const element = document.createElement("div");
  const initials = document.createElement("span");
  element.className = className;
  element.setAttribute("aria-label", accessibleLabel);
  element.setAttribute("role", "img");
  element.setAttribute("title", accessibleLabel);
  element.style.setProperty("--player-marker-color", color.background);
  element.style.setProperty("--player-marker-foreground", color.foreground);
  initials.textContent = firstVisibleNicknameLetter(nickname);
  element.append(initials);
  return element;
}

function geometryFeature(geometry: StreetGeometry) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: geometry.type,
      coordinates: geometry.coordinates,
    },
  };
}

export function RoadMap({
  bounds,
  selectedPosition,
  onSelect,
  disabled = false,
  targetGeometry = null,
  revealMarkers = [],
  revealing = false,
  roundKey,
  mapLabel,
  keyboardHint,
  selectionLabel,
  selectionNickname,
  selectionColor,
  unavailableLabel,
}: RoadMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const selectionMarkerRef = useRef<Marker | null>(null);
  const revealMarkerRefs = useRef<Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  const disabledRef = useRef(disabled);
  const [loadError, setLoadError] = useState(false);
  const [mapGeneration, setMapGeneration] = useState(0);
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const [west, south, east, north] = bounds;
  const serializedRevealMarkers = JSON.stringify(revealMarkers);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    if (!containerRef.current || !token || mapRef.current) return;
    let cancelled = false;

    void import("mapbox-gl").then((module) => {
      if (cancelled || !containerRef.current) return;
      const mapboxgl = module.default;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/standard",
        bounds: [
          [west, south],
          [east, north],
        ],
        fitBoundsOptions: { padding: 34, duration: 0 },
        maxBounds: [
          [west - 0.25, south - 0.16],
          [east + 0.25, north + 0.16],
        ],
        pitch: 0,
        bearing: 0,
        minPitch: 0,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: true,
        logoPosition: "bottom-left",
        config: {
          basemap: {
            lightPreset: "day",
            showRoadLabels: false,
            showTransitLabels: false,
            showPointOfInterestLabels: true,
            showPlaceLabels: true,
          },
        },
      });

      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => setMapGeneration((generation) => generation + 1));
      map.on("error", (event) => {
        if (String(event.error?.message ?? "").includes("access token")) setLoadError(true);
      });
      map.on("click", (event) => {
        if (disabledRef.current) return;
        onSelectRef.current([event.lngLat.lng, event.lngLat.lat]);
      });
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      selectionMarkerRef.current?.remove();
      revealMarkerRefs.current.forEach((marker) => marker.remove());
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [east, north, south, token, west]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ] as LngLatBoundsLike,
      cityFitOptions(
        revealing,
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    );
  }, [east, mapGeneration, north, revealing, roundKey, south, west]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    selectionMarkerRef.current?.remove();
    selectionMarkerRef.current = null;
    if (!selectedPosition) return;

    void import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (mapRef.current !== map) return;
      selectionMarkerRef.current = new mapboxgl.Marker({
        element: markerElement(
          "guess-pin current",
          `${selectionLabel}: ${selectionNickname}`,
          selectionNickname,
          selectionColor,
        ),
        anchor: "bottom",
      })
        .setLngLat([selectedPosition[0], selectedPosition[1]])
        .addTo(map);
    });
  }, [mapGeneration, selectedPosition, selectionColor, selectionLabel, selectionNickname]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateTarget = () => {
      const existing = map.getSource("target-street") as GeoJSONSource | undefined;
      if (!targetGeometry) {
        if (map.getLayer("target-street-glow")) map.removeLayer("target-street-glow");
        if (map.getLayer("target-street-line")) map.removeLayer("target-street-line");
        if (existing) map.removeSource("target-street");
        return;
      }

      const data = geometryFeature(targetGeometry);
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource("target-street", { type: "geojson", data });
        map.addLayer({
          id: "target-street-glow",
          type: "line",
          source: "target-street",
          paint: { "line-color": "#101b2b", "line-width": 12, "line-opacity": 0.92 },
        });
        map.addLayer({
          id: "target-street-line",
          type: "line",
          source: "target-street",
          paint: { "line-color": "#c9ff3d", "line-width": 7 },
        });
      }
    };

    if (map.isStyleLoaded()) updateTarget();
    else map.once("style.load", updateTarget);
  }, [mapGeneration, targetGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    revealMarkerRefs.current.forEach((marker) => marker.remove());
    revealMarkerRefs.current = [];

    void import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (mapRef.current !== map) return;
      const markerSpecs = JSON.parse(serializedRevealMarkers) as RevealMarker[];
      revealMarkerRefs.current = markerSpecs.flatMap((item) => {
        if (!item.position) return [];
        const marker = new mapboxgl.Marker({
          element: markerElement(
            item.isCurrentPlayer ? "result-pin current" : "result-pin",
            item.isCurrentPlayer
              ? `${selectionLabel}: ${item.nickname}`
              : item.nickname,
            item.nickname,
            item.color,
          ),
          anchor: "bottom",
        })
          .setLngLat([item.position[0], item.position[1]])
          .addTo(map);
        return [marker];
      });
    });
  }, [mapGeneration, selectionLabel, serializedRevealMarkers]);

  if (!token || loadError) {
    return (
      <div className="map-unavailable" role="status">
        <div className="map-unavailable-grid" />
        <strong>MAPBOX</strong>
        <p>{unavailableLabel}</p>
      </div>
    );
  }

  return (
    <div
      className="road-map"
      ref={containerRef}
      aria-label={`${mapLabel}. ${keyboardHint}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
        const map = mapRef.current;
        if (!map) return;
        event.preventDefault();
        const center = map.getCenter();
        onSelect([center.lng, center.lat]);
      }}
    />
  );
}
