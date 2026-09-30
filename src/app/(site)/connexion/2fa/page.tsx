import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { TwoFactorForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Vérification en deux étapes", robots: { index: false } };

export default function TwoFactorPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-center font-display text-3xl font-semibold">Vérification en deux étapes</h1>
      <Card className="p-6"><Suspense><TwoFactorForm /></Suspense></Card>
    </div>
  );
}
