import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

function trimGeneratedHtml(): Plugin {
  return {
    name: "trim-generated-html",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (
          output.type === "asset" &&
          output.fileName.endsWith(".html") &&
          typeof output.source === "string"
        ) {
          output.source = output.source.replace(/[ \t]+$/gm, "");
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [viteSingleFile(), trimGeneratedHtml()],
  base: "./",
  build: {
    outDir: "dist/console",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
