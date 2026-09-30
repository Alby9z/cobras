import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/card";

export const metadata: Metadata = { title: "Désinscription", robots: { index: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="mb-6 font-display text-3xl font-semibold">Désinscription</h1>
      {ok === "1" ? <Alert tone="success">Vous ne recevrez plus d&apos;e-mails commerciaux. Les e-mails liés à vos commandes restent envoyés.</Alert> : <Alert tone="danger">Lien invalide. Vous pouvez gérer vos préférences depuis <Link href="/compte/profil" className="underline">votre profil</Link>.</Alert>}
    </div>
  );
}
