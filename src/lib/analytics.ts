"use client";
type GtagParams = Record<string, unknown>;
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

/** Événement GA4 (ignoré tant que le visiteur n'a pas consenti : Consent Mode v2). */
export function track(name: string, params: GtagParams = {}) {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params);
}
