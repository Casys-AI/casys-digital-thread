import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

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

function workbenchRootRewrite(): Plugin {
  return {
    name: "workbench-root-rewrite",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url === "/" || request.url === "") {
          request.url = "/native-workbench.html";
        }
        next();
      });
    },
  };
}

const root = dirname(fileURLToPath(import.meta.url));
const workbenchBffPort = environmentPort("CASYS_COCKPIT_BFF_PORT", 5175);
const nativeUiPort = environmentPort("CASYS_COCKPIT_UI_PORT", 5173);
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
  plugins: [
    tailwindcss(),
    trimGeneratedHtml(),
    workbenchRootRewrite(),
  ],
  base: "./",
  /**
   * Le cockpit rend en Preact. Ark UI ne publie pas de paquet Preact : on
   * garde `@ark-ui/react` et on redirige react/react-dom vers `preact/compat`,
   * de sorte qu'aucun react-dom n'entre dans le bundle.
   */
  resolve: {
    alias: {
      "react/jsx-runtime": "preact/jsx-runtime",
      "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
      "react-dom/client": "preact/compat/client",
      "react-dom/test-utils": "preact/test-utils",
      "react-dom": "preact/compat",
      react: "preact/compat",
    },
  },
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
    rollupOptions: {
      input: resolve(root, "native-workbench.html"),
    },
  },
});
