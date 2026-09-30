import Link from "next/link";
import { cn } from "@/lib/utils";

export function Pagination({ page, pages, basePath, params }: { page: number; pages: number; basePath: string; params: Record<string, string | string[] | undefined> }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2);
  return (
    <nav aria-label="Pagination" className="mt-10 flex justify-center">
      <ul className="flex items-center gap-1">
        {page > 1 && <li><Link href={href(page - 1)} rel="prev" className="rounded-lg px-3 py-2 text-sm hover:bg-muted">Précédent</Link></li>}
        {nums.map((n, i) => (
          <li key={n} className="flex items-center">
            {i > 0 && nums[i - 1] !== n - 1 && <span className="px-1 text-muted-foreground">…</span>}
            <Link href={href(n)} aria-current={n === page ? "page" : undefined} className={cn("rounded-lg px-3 py-2 text-sm", n === page ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{n}</Link>
          </li>
        ))}
        {page < pages && <li><Link href={href(page + 1)} rel="next" className="rounded-lg px-3 py-2 text-sm hover:bg-muted">Suivant</Link></li>}
      </ul>
    </nav>
  );
}
