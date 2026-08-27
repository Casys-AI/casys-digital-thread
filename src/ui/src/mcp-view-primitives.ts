/**
 * Presentation-only boundary for the native Workbench.
 *
 * The product cockpit is a React + Vite SPA (`native-preview.tsx`), not an
 * MCP App. Primitives live in `src/ui/src/ui/*`. This file re-exports the
 * local token copy (`./view/mcp-view-theme.ts`, `--cockpit-*` +
 * `.cockpit-surface` only) and must never import `@casys/mcp-view` — the
 * native bundle carries no iframe lifecycle, postMessage transport, or
 * `ui/initialize` handshake. `deno task verify:thread:presentation` reads
 * this file as the gate.
 */
export { installMcpViewTheme } from "./view/mcp-view-theme.ts";
