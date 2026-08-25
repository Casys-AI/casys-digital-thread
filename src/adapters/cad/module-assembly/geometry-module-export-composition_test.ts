import { assertEquals } from "@std/assert";
import { createGeometryModuleExportComposition } from "./geometry-module-export-composition.ts";
import { ExportProjectGeometryModule } from "../../../application/use-cases/cad/canonical/export-project-geometry-module.ts";
import { GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE } from "../../../domain/cad/module-assembly/geometry-module-assembly-execution.ts";

const COMPOSITION_SOURCE = await Deno.readTextFile(
  new URL("./geometry-module-export-composition.ts", import.meta.url),
);

Deno.test("module-export composition stays unregistered without an isolated runner", () => {
  const composition = createGeometryModuleExportComposition(baseOptions());
  assertEquals(composition.geometryModuleExport, undefined);
});

Deno.test("module-export composition wires the use case only when a runner is supplied", () => {
  const composition = createGeometryModuleExportComposition({
    ...baseOptions(),
    runner: {
      run: () => Promise.reject(new Error("not dispatched")),
    },
  });
  assertEquals(
    composition.geometryModuleExport instanceof ExportProjectGeometryModule,
    true,
  );
});

Deno.test("module-export composition does not import the geometry sealer or product catalog", () => {
  assertEquals(
    COMPOSITION_SOURCE.includes("design-write-geometry-run-executor"),
    false,
  );
  assertEquals(COMPOSITION_SOURCE.includes("geometry-bundle-product-catalog"), false);
});

function baseOptions() {
  return {
    projects: { get: () => Promise.resolve(undefined) },
    snapshots: { get: () => Promise.resolve(undefined) },
    traversal: { open: () => Promise.resolve(undefined) },
    architectureCaptures: { read: () => Promise.resolve(undefined) },
    partDefinitionsCaptures: { read: () => Promise.resolve(undefined) },
    geometryCaptures: { read: () => Promise.resolve(undefined) },
    recordedAnalysisDirectory: "/tmp/casys-module-export-composition/analysis",
    canonicalAssetDirectory: "/tmp/casys-module-export-composition/assets",
    geometryDraftCaptureDirectory: "/tmp/casys-module-export-composition/drafts",
    geometryDraftAssetDirectory: "/tmp/casys-module-export-composition/draft-assets",
    profiles: {
      initial: () =>
        Promise.resolve({
          executionProfile: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
        } as never),
      resolve: () => Promise.reject(new Error("not used")),
    },
  };
}
