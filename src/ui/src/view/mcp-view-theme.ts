/**
 * Local design-system stylesheet (historical copy of mcp-view theme.js).
 *
 * The product cockpit does not import `@casys/mcp-view`. Tokens here use the
 * `--cockpit-*` names; leftover `.mcp-view-*` class rules were retired in UI.4.
 * `src/ui/src/ui/*` is the primitive layer. This file remains the
 * presentation-gate theme copy (tokens + `.cockpit-surface` only).
 */
export const MCP_VIEW_THEME_STYLE_ID = "cockpit-theme";

/**
 * Light atelier tokens shared with `01-tokens-and-console.css`. The npm
 * package must not re-enter the native bundle.
 */
export const MCP_VIEW_THEME_CSS = String.raw`
:root {
  color-scheme: light;
  --cockpit-text: var(--text, #1c2126);
  --cockpit-muted: var(--muted, #5f6773);
  --cockpit-border: var(--line, #e2e5e9);
  --cockpit-panel: var(--surface-1, #ffffff);
  --cockpit-subtle: var(--surface-2, #f2f4f6);
  --cockpit-accent: var(--accent, #5e6ad2);
  --cockpit-success: var(--green, #1a7f4e);
  --cockpit-warning: var(--amber, #9a5b12);
  --cockpit-danger: var(--red, #c03e38);
  --cockpit-radius: 0.75rem;
  --cockpit-gap: 0.65rem;
}

.cockpit-surface,
.cockpit-component {
  width: 100%;
  min-width: 0;
}

.cockpit-surface {
  container-type: inline-size;
}
`;

/** Install the shared theme once in the current document. */
export function installMcpViewTheme(
  target: Document = document,
): HTMLStyleElement {
  const existing = target.getElementById(MCP_VIEW_THEME_STYLE_ID);
  if (existing) return existing as HTMLStyleElement;
  const style = target.createElement("style");
  style.id = MCP_VIEW_THEME_STYLE_ID;
  style.textContent = MCP_VIEW_THEME_CSS;
  target.head.append(style);
  return style;
}
