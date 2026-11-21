// scripts/bill.ts を Node で動く1ファイル（dist/cli/bill.mjs）にまとめる。
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    ssr: "scripts/bill.ts",
    outDir: "dist/cli",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "bill.mjs" } },
  },
});
