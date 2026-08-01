/**
 * Presentation-only boundary for the native Workbench.
 *
 * Domain components import this adapter instead of the MCP Apps lifecycle.
 *
 * This import must remain on the presentation-only package entry point. The
 * native shell is not an MCP App and must not bundle the iframe lifecycle,
 * postMessage transport, or `ui/initialize` handshake.
 */
export {
  Badge,
  Button,
  Card,
  EmptyState,
  installMcpViewTheme,
  KeyValueList,
  MetricGrid,
  StateMessage,
  Toolbar,
} from "@casys/mcp-view/preact/components";
export type {
  KeyValueItem,
  MetricItem,
  PresentationTone,
} from "@casys/mcp-view/preact/components";
