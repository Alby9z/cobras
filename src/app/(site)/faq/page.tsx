import Link from "next/link";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/ui/card";
import { FaqList } from "@/components/site/faq-list";
import { db } from "@/server/db";

export const revalidate = 600;
export const metadata: Metadata = { title: "Questions fréquentes", description: "Réponses aux questions sur la commande, la réglementation, les documents, le transport des animaux et le paiement.", alternates: { canonical: "/faq" } };

export default async function FaqPage() {
  const faqs = await db.faq.findMany({ where: { published: true }, orderBy: { position: "asc" } });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: "FAQ" }]} />
      <PageHeader title="Questions fréquentes" />
      {faqs.length ? <FaqList items={faqs} /> : <p className="text-muted-foreground">Les questions fréquentes seront publiées prochainement. <Link href="/contact" className="text-primary underline">Contactez-nous</Link> en attendant.</p>}
    </div>
  );
}
