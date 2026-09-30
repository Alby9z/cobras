"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button type="button" className="block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium text-danger hover:bg-muted" onClick={async () => { await authClient.signOut(); router.push("/"); router.refresh(); }}>
      Se déconnecter
    </button>
  );
}
