// Construit le worker en un seul fichier ESM (dépendances npm externes).
import { build } from "esbuild";
await build({
  entryPoints: ["src/worker/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/worker.mjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  conditions: ["react-server"],
  logLevel: "warning",
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
