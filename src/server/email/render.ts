import "server-only";
import type { MailContent } from "@/server/email/templates";
import type { Settings } from "@/server/settings";
import { brandName } from "@/server/settings";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Mise en page HTML compatible clients mail (tableaux, styles en ligne, sans image obligatoire) + version texte. */
export function renderEmail(m: MailContent, s: Settings, unsubscribeUrl?: string) {
  const brand = esc(brandName(s));
  const rows = m.table?.map(([k, v]) => `<tr><td style="padding:6px 0;color:#57534e">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(v)}</td></tr>`).join("") ?? "";
  const footer = [s.companyName, s.addressLine, [s.postalCode, s.city].filter(Boolean).join(" ")].filter(Boolean).join(" — ");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">
<tr><td style="padding:28px 28px 0;font-size:18px;font-weight:700;color:#1f5130">${brand}</td></tr>
<tr><td style="padding:20px 28px 8px"><h1 style="font-size:22px;line-height:1.3;margin:0 0 16px">${esc(m.heading)}</h1>
${m.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${esc(p)}</p>`).join("")}
${rows ? `<table role="presentation" width="100%" style="margin:16px 0;font-size:14px;border-top:1px solid #e7e5e4">${rows}</table>` : ""}
${m.cta ? `<p style="margin:24px 0"><a href="${esc(m.cta.url)}" style="background:#1f5130;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(m.cta.label)}</a></p><p style="font-size:12px;color:#78716c;word-break:break-all">${esc(m.cta.url)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px 28px;font-size:12px;color:#78716c;border-top:1px solid #e7e5e4">${esc(footer)}${unsubscribeUrl ? `<br><a href="${esc(unsubscribeUrl)}" style="color:#78716c">Se désinscrire des emails commerciaux</a>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [m.heading, "", ...m.paragraphs, ...(m.table?.map(([k, v]) => `${k} : ${v}`) ?? []), m.cta ? `\n${m.cta.label} : ${m.cta.url}` : "", "", footer, unsubscribeUrl ? `Se désinscrire : ${unsubscribeUrl}` : ""].join("\n");
  return { html, text };
}
