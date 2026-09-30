import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false } };

export default function ResetPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-center font-display text-3xl font-semibold">Nouveau mot de passe</h1>
      <Card className="p-6"><Suspense><ResetPasswordForm /></Suspense></Card>
    </div>
  );
}
