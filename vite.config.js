import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const localBuild = mode === "internal";
  return {
    plugins: localBuild
      ? [{
          name: "local-crm-data",
          generateBundle() {
            this.emitFile({ type: "asset", fileName: "crm100.json", source: readFileSync(resolve(import.meta.dirname, "leads-data.local.json"), "utf8") });
          },
        }]
      : [],
    build: {
      outDir: localBuild ? "dist-local" : "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: localBuild
          ? {
              client: resolve(import.meta.dirname, "index.html"),
              privacy: resolve(import.meta.dirname, "privacy.html"),
              leads: resolve(import.meta.dirname, "leads.html"),
            }
          : {
              client: resolve(import.meta.dirname, "index.html"),
              privacy: resolve(import.meta.dirname, "privacy.html"),
              leads: resolve(import.meta.dirname, "leads.html"),
            },
      },
    },
  };
});
