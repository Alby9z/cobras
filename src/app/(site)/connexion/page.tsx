import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card, Alert } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/forms";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Connexion", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (await getCurrentUser()) redirect("/compte");
  const { reset } = await searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-center font-display text-3xl font-semibold">Connexion</h1>
      {reset && <Alert tone="success" className="mb-4">Mot de passe modifié. Vous pouvez vous connecter.</Alert>}
      <Card className="p-6"><Suspense><LoginForm /></Suspense></Card>
      <p className="mt-6 text-center text-sm text-muted-foreground">Pas encore de compte ? <Link href="/inscription" className="font-semibold text-primary hover:underline">Créer un compte</Link></p>
    </div>
  );
}
