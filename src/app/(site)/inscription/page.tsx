import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/forms";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Créer un compte", robots: { index: false } };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/compte");
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="mb-6 text-center font-display text-3xl font-semibold">Créer un compte</h1>
      <Card className="p-6"><RegisterForm /></Card>
      <p className="mt-6 text-center text-sm text-muted-foreground">Déjà inscrit ? <Link href="/connexion" className="font-semibold text-primary hover:underline">Se connecter</Link></p>
    </div>
  );
}
