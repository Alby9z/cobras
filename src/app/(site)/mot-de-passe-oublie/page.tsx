import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Mot de passe oublié", robots: { index: false } };

export default function ForgotPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-center font-display text-3xl font-semibold">Mot de passe oublié</h1>
      <Card className="p-6"><ForgotPasswordForm /></Card>
    </div>
  );
}
