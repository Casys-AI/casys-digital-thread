import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

function trimGeneratedHtml(): Plugin {
  return {
    name: "trim-generated-html",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (
          output.type === "asset" && output.fileName.endsWith(".html") &&
          typeof output.source === "string"
        ) {
          output.source = output.source
            .replace(/^[ ]+\t/gm, "\t")
            .replace(/[ \t]+$/gm, "");
        }
      }
    },
  };
}

const root = dirname(fileURLToPath(import.meta.url));
const workbenchBffPort = environmentPort("CASYS_COCKPIT_BFF_PORT", 5175);
const nativeUiPort = environmentPort("CASYS_COCKPIT_UI_PORT", 5174);
const workbenchBffOrigin = `http://127.0.0.1:${workbenchBffPort}`;

function environmentPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

export default defineConfig({
  plugins: [viteSingleFile(), trimGeneratedHtml()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: nativeUiPort,
    strictPort: true,
    open: "/native-workbench.html",
    proxy: {
      "/api": {
        target: workbenchBffOrigin,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist/thread",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: resolve(root, "native-workbench.html"),
    },
  },
});
