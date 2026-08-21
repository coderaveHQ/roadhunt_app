"use client";

import { useEffect, useState } from "react";

import { CITIES, readLocalBestScores, type LocalBestScore } from "@/lib/game";
import type { Locale } from "@/i18n/routing";

export function LocalBestScores({ locale, emptyLabel }: { locale: Locale; emptyLabel: string }) {
  const [scores, setScores] = useState<readonly LocalBestScore[] | null>(null);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      setScores(readLocalBestScores().slice(0, 3));
    }, 0);
    return () => window.clearTimeout(initial);
  }, []);

  if (!scores?.length) return <p>{emptyLabel}</p>;

  return (
    <ol className="best-score-list">
      {scores.map((entry, index) => {
        const city = CITIES.find((candidate) => candidate.slug === entry.citySlug);
        return (
          <li key={`${entry.citySlug}:${entry.difficulty}`}>
            <b>{index + 1}</b>
            <span><strong>{city?.name[locale] ?? entry.citySlug}</strong><small>{entry.difficulty}</small></span>
            <em>{new Intl.NumberFormat(locale).format(entry.score)}</em>
          </li>
        );
      })}
    </ol>
  );
}
