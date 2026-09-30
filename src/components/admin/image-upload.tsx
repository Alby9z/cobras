"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Input, Label } from "@/components/ui/form";
import { uploadProductImage } from "@/server/actions/admin/catalog";

export function ImageUpload({ productId }: { productId: string }) {
  return (
    <ActionForm action={uploadProductImage} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="productId" value={productId} />
      <div><Label htmlFor="img-file">Image (JPG, PNG, WEBP, AVIF)</Label><Input id="img-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required className="h-auto py-2" /></div>
      <div><Label htmlFor="img-alt">Texte alternatif *</Label><Input id="img-alt" name="alt" required placeholder="Ex. Python royal femelle phase pastel" /></div>
      <SubmitButton pendingText="Traitement…">Ajouter</SubmitButton>
    </ActionForm>
  );
}
