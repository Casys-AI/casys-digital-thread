import { assertEquals } from "@std/assert";
import { evaluatePresentationBoundary } from "./verify-native-workbench-presentation.ts";

Deno.test("native presentation gate records the unpublished pure export as a release blocker", () => {
  const result = evaluatePresentationBoundary({
    packageJson: { exports: { "./preact": "./preact.js" } },
    primitiveAdapterSource: 'export { Card } from "@casys/mcp-view/preact";',
    nativeBundle: "ui/initialize toolresult postMessage",
  });

  assertEquals(result, {
    status: "blocked",
    releaseStep:
      "Publish an npm version of @casys/mcp-view that exports ./preact/components, then update src/ui/package.json and its lockfile to that version.",
    runtimeMarkers: ["ui/initialize", "toolresult", "postMessage"],
  });
});

Deno.test("native presentation gate accepts the pure subpath only with a bridge-free bundle", () => {
  const result = evaluatePresentationBoundary({
    packageJson: { exports: { "./preact/components": "./components.js" } },
    primitiveAdapterSource: 'export { Card } from "@casys/mcp-view/preact/components";',
    nativeBundle: "<html><body>native application</body></html>",
  });

  assertEquals(result, { status: "ready" });
});

Deno.test("native presentation gate fails if a published pure export still leaks MCP Apps runtime", () => {
  const result = evaluatePresentationBoundary({
    packageJson: { exports: { "./preact/components": "./components.js" } },
    primitiveAdapterSource: 'export { Card } from "@casys/mcp-view/preact/components";',
    nativeBundle: "native ui/initialize and postMessage",
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      "native Workbench bundle contains MCP Apps bridge markers: ui/initialize, postMessage.",
    ],
  });
});

Deno.test("native presentation gate rejects a mixed pure and runtime mcp-view adapter", () => {
  const result = evaluatePresentationBoundary({
    packageJson: { exports: { "./preact/components": "./components.js" } },
    primitiveAdapterSource: [
      'export { Card } from "@casys/mcp-view/preact/components";',
      'export { installMcpViewTheme } from "@casys/mcp-view";',
    ].join("\n"),
    nativeBundle: "<html><body>native application</body></html>",
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      "src/ui/src/mcp-view-primitives.ts must not import MCP Apps entry points: @casys/mcp-view.",
    ],
  });
});
