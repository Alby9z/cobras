import { headers } from "next/headers";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { Analytics } from "@/components/analytics";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <Header />
      <main id="contenu" className="min-h-[60vh]">{children}</main>
      <Footer />
      <Analytics gaId={process.env.NEXT_PUBLIC_GA_ID} nonce={nonce} />
    </>
  );
}
