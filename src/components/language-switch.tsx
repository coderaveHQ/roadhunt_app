"use client";

import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

export function LanguageSwitch({ label }: { label: string }) {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchLocale() {
    const nextLocale: Locale = locale === "de" ? "en" : "de";
    const query = searchParams.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    startTransition(() => router.replace(href, { locale: nextLocale }));
  }

  return (
    <button
      className="language-switch"
      type="button"
      onClick={switchLocale}
      disabled={isPending}
      aria-label={label}
    >
      <span aria-hidden="true">{locale === "de" ? "DE" : "EN"}</span>
      {label}
    </button>
  );
}
