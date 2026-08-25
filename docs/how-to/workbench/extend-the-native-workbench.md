# How-to: extend the native Workbench without an MCP App

Audience: both · Diátaxis: how-to · Kind: how-to

> **Diátaxis category: how-to guide.** Use this when you are about to scaffold a
> result-viewer into `src/ui/`. That is the retired path.

The product cockpit is **not** an MCP App. `native-preview.tsx` mounts
`ThreadWorkbench` as a React + Vite SPA. `deno task preview:browser` refuses:
the former Console MCP App on `:3021` is gone.

## Do this instead

1. Add or change React surfaces under `src/ui/src/{project,thread,ui}/`.
2. Rebuild with `npm --prefix src/ui run build:thread`.
3. Preview with `deno task preview:thread` (HMR) or `preview:cockpit` (hashed-asset BFF).
4. Keep `deno task verify:thread:presentation`: the native bundle must not import
   `@casys/mcp-view` and must not contain Apps handshake markers (`ui/initialize`,
   `toolresult`).

Provider MCP servers in **other** repositories may still scaffold a result
viewer with `@casys/mcp-view`. That package is not the atelier UI path and must
not be reintroduced into this repo's native bundle.

See [preview the native Workbench](preview-native-workbench.md) and
[the native Workbench explanation](../../explanations/workbench/workbench-overview.md).
