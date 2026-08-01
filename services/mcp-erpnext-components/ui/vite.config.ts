import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  // Local file dependencies keep their build-time node_modules next to the
  // package. Force one Preact runtime so hooks and render share internals.
  resolve: { dedupe: ["preact"] },
  build: {
    outDir: "dist/bom-surface",
    emptyOutDir: true,
  },
});
