"use client";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics";

const CONSENT_KEY = "cookie_consent_v1";
type Consent = "granted" | "denied";

function readConsent(): Consent | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_KEY}=(granted|denied)`));
  return (m?.[1] as Consent) ?? null;
}
function writeConsent(v: Consent) {
  // 6 mois maximum (recommandation CNIL)
  document.cookie = `${CONSENT_KEY}=${v}; Max-Age=${60 * 60 * 24 * 180}; Path=/; SameSite=Lax; Secure`;
}

/**
 * Google Analytics 4 avec Consent Mode v2 : aucun cookie de mesure avant consentement.
 * Les événements personnalisés sont émis via window "analytics" (formulaires) ou track().
 */
export function Analytics({ gaId, nonce }: { gaId?: string; nonce?: string }) {
  const [consent, setConsent] = useState<Consent | null | "unknown">("unknown");

  useEffect(() => {
    setConsent(readConsent());
    const open = () => setConsent(null);
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent<{ name: string; params?: Record<string, unknown> }>).detail;
      track(d.name, d.params);
    };
    window.addEventListener("open-cookie-settings", open);
    window.addEventListener("analytics", onEvent);
    return () => {
      window.removeEventListener("open-cookie-settings", open);
      window.removeEventListener("analytics", onEvent);
    };
  }, []);

  const decide = (v: Consent) => {
    writeConsent(v);
    setConsent(v);
    window.gtag?.("consent", "update", { analytics_storage: v, ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  };

  return (
    <>
      {gaId && (
        <>
          <Script id="ga-consent" strategy="afterInteractive" nonce={nonce}>{`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
var c = document.cookie.match(/(?:^|; )${CONSENT_KEY}=(granted|denied)/);
gtag('consent','default',{analytics_storage: c ? c[1] : 'denied', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'});
gtag('js', new Date());
gtag('config', '${gaId}', { anonymize_ip: true });`}</Script>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" nonce={nonce} />
        </>
      )}
      {consent === null && (
        <div role="dialog" aria-modal="false" aria-labelledby="cookie-title" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-border bg-card p-5 shadow-xl sm:bottom-6">
          <h2 id="cookie-title" className="font-semibold">Cookies de mesure d&apos;audience</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Nous utilisons des cookies uniquement pour mesurer la fréquentation et améliorer le site (Google Analytics). Vous pouvez accepter ou refuser ; votre choix est conservé 6 mois et modifiable à tout moment en bas de page.{" "}
            <Link href="/cookies" className="underline">En savoir plus</Link>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => decide("denied")} className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">Tout refuser</button>
            <button type="button" onClick={() => decide("granted")} className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">Tout accepter</button>
          </div>
        </div>
      )}
    </>
  );
}

export function CookieSettingsButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("open-cookie-settings"))} className="hover:text-foreground hover:underline">
      Gérer les cookies
    </button>
  );
}

/** Émet un événement GA4 au montage (ex. purchase sur la page de remerciement). */
export function TrackOnMount({ name, params }: { name: string; params?: Record<string, unknown> }) {
  useEffect(() => {
    const t = setTimeout(() => track(name, params), 800);
    return () => clearTimeout(t);
  }, [name, params]);
  return null;
}
