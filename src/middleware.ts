import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy avec nonce par requête.
 * Les contrôles d'accès réels sont faits côté serveur (layouts / actions) ; ce middleware
 * n'ajoute que les en-têtes de sécurité.
 */
export function middleware(req: NextRequest) {
  // Identifiant de corrélation (repris s'il est fourni par le reverse proxy).
  const requestId = /^[\w.:-]{8,100}$/.test(req.headers.get("x-request-id") ?? "") ? req.headers.get("x-request-id")! : crypto.randomUUID();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const h = new Headers(req.headers);
    h.set("x-request-id", requestId);
    const r = NextResponse.next({ request: { headers: h } });
    r.headers.set("x-request-id", requestId);
    return r;
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const media = process.env.NEXT_PUBLIC_MEDIA_URL ? new URL(process.env.NEXT_PUBLIC_MEDIA_URL).origin : "";

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${media} https://*.google-analytics.com https://*.googletagmanager.com`,
    `font-src 'self'`,
    `connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com`,
    `frame-src https://www.google.com https://www.youtube-nocookie.com`,
    `form-action 'self' https://checkout.stripe.com`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    ...(process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
