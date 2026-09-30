"use client";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>{children}</NextThemes>;
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted" aria-label={dark ? "Activer le thème clair" : "Activer le thème sombre"}>
      {dark ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
    </button>
  );
}
