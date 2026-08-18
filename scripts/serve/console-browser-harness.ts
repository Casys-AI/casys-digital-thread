/**
 * Retired human Console MCP App harness.
 *
 * The Fleet / Runs / Workbench page is no longer a product surface.
 * `deno task preview:browser` refuses so leftover muscle memory fails closed.
 * Fleet health remains available as `console_snapshot` on :3020/mcp.
 */

const PRODUCT_PREVIEW = "deno task preview:thread";

if (import.meta.main) {
  console.error(
    [
      "The Console MCP App browser harness is retired.",
      "It is not a product page. Open the native cockpit instead:",
      `  ${PRODUCT_PREVIEW}`,
      "Fleet health remains available as console_snapshot on :3020/mcp.",
    ].join("\n"),
  );
  Deno.exit(1);
}
