import { getTranslations, setRequestLocale } from "next-intl/server";

import { LanguageSwitch } from "@/components/language-switch";
import { LocalBestScores } from "@/components/local-best-scores";
import { Logo } from "@/components/logo";
import type { Locale } from "@/i18n/routing";
import { CITIES } from "@/lib/game";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, nav] = await Promise.all([
    getTranslations("Home"),
    getTranslations("Nav"),
  ]);
  const activeLocale = locale as Locale;
  const cities = CITIES.map((city) => city.name[activeLocale]);
  const posterCity = CITIES.find((city) => city.slug === "duesseldorf")?.name[activeLocale] ?? "Düsseldorf";

  return (
    <main>
      <header className="site-header shell">
        <Logo />
        <nav aria-label="Main navigation">
          <a href="#how">{nav("how")}</a>
          <a href="#cities">{nav("cities")}</a>
          <LanguageSwitch label={nav("language")} />
        </nav>
      </header>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span />{t("eyebrow")}</div>
          <h1>
            {t("titleStart")}
            <br />
            <em>{t("titleAccent")}</em>
          </h1>
          <p>{t("subtitle")}</p>
          <div className="game-actions" aria-label="Game modes">
            <a className="action-card action-primary" href={`/${locale}/play?mode=solo`}>
              <span className="action-icon" aria-hidden="true">↗</span>
              <span><strong>{t("solo")}</strong><small>{t("soloHint")}</small></span>
              <b aria-hidden="true">→</b>
            </a>
            <a className="action-card" href={`/${locale}/play?mode=lobby`}>
              <span className="action-icon" aria-hidden="true">◆</span>
              <span><strong>{t("lobby")}</strong><small>{t("lobbyHint")}</small></span>
              <b aria-hidden="true">→</b>
            </a>
            <a className="action-card action-compact" href={`/${locale}/play?mode=join`}>
              <span className="action-icon" aria-hidden="true">#</span>
              <span><strong>{t("join")}</strong><small>{t("joinHint")}</small></span>
            </a>
          </div>
          <div className="hero-stats" aria-label="Game facts">
            <span><b>●</b>{t("live")}</span>
            <span><b>10</b>{t("rounds")}</span>
            <span><b>60</b>{t("timer")}</span>
          </div>
        </div>

        <div className="map-poster" aria-label="Stylized Roadhunt map preview">
          <div className="road road-a" />
          <div className="road road-b" />
          <div className="road road-c" />
          <div className="road road-d" />
          <div className="map-block block-a" />
          <div className="map-block block-b" />
          <div className="map-block block-c" />
          <div className="target-pin"><span>?</span></div>
          <div className="street-sign"><small>{t("posterFind")}</small><strong>KÖNIGSALLEE</strong></div>
          <div className="timer-ring"><span>42</span><small>{t("posterSeconds")}</small></div>
          <div className="poster-tag">{posterCity.toUpperCase()} · {t("posterRound")} 4/10</div>
        </div>
      </section>

      <section className="city-strip" id="cities">
        <div className="shell section-heading">
          <div><span>01</span><h2>{t("citiesTitle")}</h2></div>
          <p>{t("citiesText")}</p>
        </div>
        <div className="city-marquee" aria-label="Available cities">
          {[...cities, ...cities].map((city, index) => (
            <span key={`${city}-${index}`}>{city}<b>✦</b></span>
          ))}
        </div>
      </section>

      <section className="how shell" id="how">
        <div className="section-heading"><div><span>02</span><h2>{t("howTitle")}</h2></div></div>
        <div className="steps">
          {([1, 2, 3] as const).map((step) => (
            <article key={step}>
              <div className="step-number">0{step}</div>
              <div className={`step-visual step-${step}`} aria-hidden="true"><span /></div>
              <h3>{t(`step${step}Title`)}</h3>
              <p>{t(`step${step}Text`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="scores shell">
        <div><span className="section-kicker">03</span><h2>{t("bestTitle")}</h2></div>
        <LocalBestScores locale={activeLocale} emptyLabel={t("bestEmpty")} />
      </section>

      <section className="final-cta shell" id="play">
        <div><span className="eyebrow"><span />ROADHUNT</span><h2>{t("ctaTitle")}</h2><p>{t("ctaText")}</p></div>
        <a className="cta-button" href={`/${locale}/play?mode=solo`}>{t("playNow")}<span aria-hidden="true">→</span></a>
      </section>

      <footer className="shell">
        <Logo />
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{t("attribution")}</a>
        <span>© 2026 ROADHUNT</span>
      </footer>
    </main>
  );
}
