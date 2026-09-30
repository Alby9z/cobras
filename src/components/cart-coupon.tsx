"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Input } from "@/components/ui/form";
import { applyCoupon } from "@/server/actions/cart";

export function CouponForm({ current }: { current: string | null }) {
  return (
    <ActionForm action={applyCoupon} className="space-y-2">
      <label htmlFor="coupon" className="text-sm font-medium">Code promotionnel</label>
      <div className="flex gap-2">
        <Input id="coupon" name="code" defaultValue={current ?? ""} autoComplete="off" className="uppercase" />
        <SubmitButton variant="outline" pendingText="…">{current ? "Modifier" : "Appliquer"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
