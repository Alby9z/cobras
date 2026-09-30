import { JsonLd } from "@/components/json-ld";
import { renderRichText, plainText } from "@/lib/sanitize";

export function FaqList({ items }: { items: { id: string; question: string; answer: string }[] }) {
  return (
    <>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {items.map((f) => (
          <details key={f.id} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center justify-between gap-4 font-semibold">
              {f.question}
              <span aria-hidden className="text-xl text-primary transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="prose-content mt-3 text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(f.answer) }} />
          </details>
        ))}
      </div>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: plainText(f.answer, 1000) } })) }} />
    </>
  );
}
