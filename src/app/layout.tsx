import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/theme";
import { getSettings, brandName } from "@/server/settings";
import "./globals.css";

const inter = localFont({ src: "../fonts/inter-latin-wght-normal.woff2", variable: "--font-inter", display: "swap" });
const fraunces = localFont({ src: "../fonts/fraunces-latin-wght-normal.woff2", variable: "--font-fraunces", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const name = brandName(s);
  const description = s.tagline ?? s.valueProposition;
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: { default: name, template: `%s | ${name}` },
    description,
    applicationName: name,
    alternates: { canonical: "/" },
    openGraph: { type: "website", locale: "fr_FR", siteName: name, description },
    twitter: { card: "summary_large_image" },
    verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#11140f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="fr" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-dvh font-sans">
        <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
          Aller au contenu
        </a>
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
