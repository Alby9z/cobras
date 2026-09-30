import sanitizeHtml from "sanitize-html";
import { marked } from "marked";

/** Contenu riche saisi en Markdown dans l'administration → HTML assaini (protection XSS). */
export function renderRichText(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: true }) as string;
  return sanitizeHtml(html, {
    allowedTags: ["h2", "h3", "h4", "p", "br", "strong", "em", "ul", "ol", "li", "a", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "hr", "code"],
    allowedAttributes: { a: ["href", "title", "rel", "target"] },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
  });
}

export function plainText(input: string, max = 160) {
  const t = sanitizeHtml(marked.parse(input, { async: false }) as string, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
