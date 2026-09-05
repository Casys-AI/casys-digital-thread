/**
 * Presentation-only boundary for the native Workbench.
 *
 * The product cockpit is a React + Vite SPA (`native-preview.tsx`), not an
 * MCP App. Primitives live in `src/ui/src/ui/*`. This file re-exports the
 * local token copy (`./view/mcp-view-theme.ts`, `--cockpit-*` +
 * `.cockpit-surface` only) and must never import `@casys/mcp-view` — the
 * native presentation layer carries no MCP client or provider authority.
 * `deno task verify:thread:presentation` reads this file as the gate; the
 * generic whole-App frame owns only its bounded read-only Apps lifecycle.
 */
export { installMcpViewTheme } from "./view/mcp-view-theme.ts";
