import { assertEquals } from "@std/assert";
import { evaluatePresentationBoundary } from "./verify-native-workbench-presentation.ts";

Deno.test("native presentation gate accepts the bounded read-only Apps lifecycle", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "./view/mcp-view-theme.ts";',
    nativeBundle:
      "<html><body>native ui/initialize ui/compose/event postMessage</body></html>",
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

Deno.test("native presentation gate rejects provider authority and domain viewers", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "./view/mcp-view-theme.ts";',
    nativeBundle:
      "native serverTools then GLTFLoader architectureSysmlSealInspectorView",
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      "native Workbench source or bundle contains provider authority or native viewer markers: serverTools, GLTFLoader, architectureSysmlSealInspectorView.",
    ],
  });
});

Deno.test("native presentation gate rejects retired viewer source clusters even when unbundled", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "./view/mcp-view-theme.ts";',
    nativeBundle: "<html><body>generic application</body></html>",
    presentForbiddenPaths: [
      "src/ui/src/thread/gltf-asset-canvas.tsx",
      "src/ui/src/project/product-requirements-matrix.tsx",
      "src/ui/src/thread/essential-graph-filter.ts",
      "src/ui/src/thread/recompute.tsx",
    ],
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      "retired native Workbench presentation paths still exist: src/ui/src/thread/gltf-asset-canvas.tsx, src/ui/src/project/product-requirements-matrix.tsx, src/ui/src/thread/essential-graph-filter.ts, src/ui/src/thread/recompute.tsx.",
    ],
  });
});

Deno.test("native presentation gate rejects reintroduced domain reconstruction clusters", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "./view/mcp-view-theme.ts";',
    nativeBundle:
      "function OverviewVerdictTiles() {} function geometryReviewPartAssets() {} function resolveToolFacet() {} function isAnalyzeInstrumentNode() {} function verificationChainDetail() {} function RecomputeHistoryPanel() {}",
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      "native Workbench source or bundle contains provider authority or native viewer markers: OverviewVerdictTiles, geometryReviewPartAssets, resolveToolFacet, isAnalyzeInstrumentNode, verificationChainDetail, RecomputeHistoryPanel.",
    ],
  });
});

Deno.test("native presentation gate rejects a reintroduced component snapshot overlay", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "./view/mcp-view-theme.ts";',
    nativeBundle:
      "projectComponents(snapshot); snapshot.components; componentCatalogForSnapshot(snapshot)",
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      "native Workbench source or bundle contains provider authority or native viewer markers: projectComponents(, snapshot.components, componentCatalogForSnapshot.",
    ],
  });
});

Deno.test("native presentation gate rejects a reintroduced admission snapshot overlay", () => {
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource:
      'export { installMcpViewTheme } from "./view/mcp-view-theme.ts";',
    nativeBundle:
      'enrichThreadWorkbenchWithTechnicalAdmissions(snapshot); snapshot["sourceFiles"]; const kind = "cad-lever";',
  });

  assertEquals(result, {
    status: "failed",
    errors: [
      'native Workbench source or bundle contains provider authority or native viewer markers: enrichThreadWorkbenchWithTechnicalAdmissions, "cad-lever", "sourceFiles".',
    ],
  });
});
