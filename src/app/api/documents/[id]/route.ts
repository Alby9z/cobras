import { NextResponse } from "next/server";
import { assertUser } from "@/server/session";
import { documentDownloadUrl } from "@/server/documents";
import { apiRoute } from "@/server/api";

export const dynamic = "force-dynamic";

/** Téléchargement : propriétaire ou permission documents.read_sensitive ; URL signée 2 min ; accès journalisé. */
export const GET = apiRoute(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await assertUser();
  const url = await documentDownloadUrl(user, (await params).id);
  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
});
