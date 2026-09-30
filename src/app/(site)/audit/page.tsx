import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, PageHeader } from "@/components/ui/card";
import { ContactForm } from "@/components/contact-form";

export const metadata: Metadata = { title: "Demande d'audit", description: "Faites évaluer votre installation : terrarium, chauffage, éclairage, hygrométrie et conformité réglementaire.", alternates: { canonical: "/audit" } };

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: "Demande d'audit" }]} />
      <PageHeader title="Demande d'audit" description="Décrivez votre installation et vos questions. Nous revenons vers vous sous 24 h ouvrées." />
      <Card className="p-6"><ContactForm kind="AUDIT" subjectLabel="Installation concernée" /></Card>
    </div>
  );
}
