import { assertEquals } from "@std/assert";
import { evaluatePresentationBoundary } from "./verify-native-workbench-presentation.ts";

Deno.test("native presentation gate accepts a self-contained boundary with a bridge-free bundle", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "./view/mcp-view-theme.ts";',
    nativeBundle: "<html><body>native application postMessage</body></html>",
  });

  assertEquals(result, { status: "ready" });
});

Deno.test("native presentation gate rejects any mcp-view import in the boundary file", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "@casys/mcp-view/preact/components";',
    nativeBundle: "<html><body>native application</body></html>",
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      "src/ui/src/mcp-view-primitives.ts must not import @casys/mcp-view entry points: @casys/mcp-view/preact/components.",
    ],
  });
});

Deno.test("native presentation gate fails when the bundle leaks the MCP Apps handshake", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "./view/mcp-view-theme.ts";',
    nativeBundle: "native ui/initialize then toolresult",
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      "native Workbench bundle contains MCP Apps bridge markers: ui/initialize, toolresult.",
    ],
  });
});
