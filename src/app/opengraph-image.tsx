import { ImageResponse } from "next/og";
import { getSettings, brandName } from "@/server/settings";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export const alt = "Image de partage";

/** Image de partage réseaux sociaux par défaut (générée à partir des paramètres de l'entreprise). */
export default async function OgImage() {
  const s = await getSettings();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "linear-gradient(135deg,#1f5130,#0f2a18)", color: "#fafaf7" }}>
        <div style={{ fontSize: 72, fontWeight: 700 }}>{brandName(s)}</div>
        {s.tagline && <div style={{ fontSize: 36, marginTop: 24, opacity: 0.9 }}>{s.tagline}</div>}
      </div>
    ),
    size,
  );
}
