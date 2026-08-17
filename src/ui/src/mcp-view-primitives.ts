/**
 * Presentation-only boundary for the MCP Console surface.
 *
 * Since the shadcn migration the native Workbench renders its own
 * components (`src/ui/src/ui/*`) and no longer uses the mcp-view
 * presentation primitives or theme. Only the Console MCP App still installs
 * the shared mcp-view stylesheet, through the verbatim local copy
 * (`./view/mcp-view-theme.ts`): the published theme is only reachable
 * through Preact-importing entry points. This file must never import an
 * MCP Apps entry point of `@casys/mcp-view` — the native bundle carries no
 * iframe lifecycle, postMessage transport, or `ui/initialize` handshake.
 */
export { installMcpViewTheme } from "./view/mcp-view-theme.ts";
