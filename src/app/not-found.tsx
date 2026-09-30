import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="contenu" className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="font-display text-7xl font-semibold text-primary">404</p>
      <h1 className="mt-4 text-2xl font-semibold">Cette page est introuvable</h1>
      <p className="mt-2 text-muted-foreground">Elle a peut-être été déplacée, ou l&apos;animal a trouvé preneur.</p>
      <form action="/catalogue" role="search" className="mt-8 flex w-full max-w-sm gap-2">
        <label htmlFor="q404" className="sr-only">Rechercher</label>
        <input id="q404" name="q" type="search" placeholder="Rechercher dans le catalogue" className="h-11 flex-1 rounded-lg border border-border bg-card px-3 text-sm" />
        <Button type="submit">Chercher</Button>
      </form>
      <div className="mt-6 flex gap-3"><Button asChild variant="outline"><Link href="/">Accueil</Link></Button><Button asChild variant="outline"><Link href="/catalogue">Catalogue</Link></Button></div>
    </main>
  );
}
