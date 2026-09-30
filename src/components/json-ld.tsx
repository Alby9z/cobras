/** Données structurées Schema.org (échappement de « < » pour éviter toute injection). */
export function JsonLd({ data, nonce }: { data: unknown; nonce?: string }) {
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
