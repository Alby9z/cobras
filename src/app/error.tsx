"use client";
import { Button } from "@/components/ui/button";

/** Aucune trace technique n'est affichée au visiteur (seul l'identifiant d'erreur est montré). */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="contenu" className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">Une erreur est survenue</h1>
      <p className="mt-2 text-muted-foreground">Merci de réessayer. Si le problème persiste, contactez-nous{error.digest ? ` en indiquant la référence ${error.digest}` : ""}.</p>
      <Button className="mt-6" onClick={reset}>Réessayer</Button>
    </main>
  );
}
