import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, PageHeader } from "@/components/ui/card";
import { ContactForm } from "@/components/contact-form";

export const metadata: Metadata = { title: "Demande de devis", description: "Demandez un devis personnalisé : animal, installation complète, équipement de terrarium.", alternates: { canonical: "/devis" } };

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: "Demande de devis" }]} />
      <PageHeader title="Demande de devis" description="Décrivez votre projet (espèce, équipement, budget, délai). Réponse sous 24 h ouvrées." />
      <Card className="p-6"><ContactForm kind="QUOTE" subjectLabel="Projet" /></Card>
    </div>
  );
}
