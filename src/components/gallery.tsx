"use client";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function Gallery({ images }: { images: { src: string; alt: string }[] }) {
  const [active, setActive] = useState(0);
  if (!images.length) return <div className="flex aspect-square items-center justify-center rounded-xl bg-muted text-muted-foreground">Photo à venir</div>;
  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
        <Image src={images[active].src} alt={images[active].alt} fill priority sizes="(min-width:1024px) 50vw, 100vw" className="object-cover" />
      </div>
      {images.length > 1 && (
        <ul className="mt-3 grid grid-cols-5 gap-2" aria-label="Galerie photos">
          {images.map((img, i) => (
            <li key={img.src}>
              <button type="button" onClick={() => setActive(i)} aria-label={`Afficher la photo ${i + 1}`} aria-current={i === active} className={cn("relative block aspect-square w-full overflow-hidden rounded-lg border-2", i === active ? "border-primary" : "border-transparent")}>
                <Image src={img.src} alt="" fill sizes="120px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
