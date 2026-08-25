import { assertEquals, assertRejects } from "@std/assert";
import {
  CaptureBackedPartDefinitionsStructureReader,
  createGeometryModuleExportComposition,
} from "./geometry-module-export-composition.ts";
import { ExportProjectGeometryModule } from "../../../application/use-cases/cad/canonical/export-project-geometry-module.ts";
import { PART_DEFINITIONS_CAPTURE_STATEMENT } from "../../../domain/architecture/part-definitions/part-definitions-capture.ts";
import { GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE } from "../../../domain/cad/module-assembly/geometry-module-assembly-execution.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { ARCHITECTURE_CAPTURE_SCHEMA } from "../../architecture/renderer/architecture-capture.ts";

const COMPOSITION_SOURCE = await Deno.readTextFile(
  new URL("./geometry-module-export-composition.ts", import.meta.url),
);
const USE_CASE_SOURCE = await Deno.readTextFile(
  new URL(
    "../../../application/use-cases/cad/canonical/export-project-geometry-module.ts",
    import.meta.url,
  ),
);
const ARCH_DIGEST = "a".repeat(64);
const ARCH_ID = `architecture-${ARCH_DIGEST}`;
const fp = (digest: string) => ({ algorithm: "sha256" as const, digest });

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
    publications: fakePublications(),
  });
  assertEquals(
    composition.geometryModuleExport instanceof ExportProjectGeometryModule,
    true,
  );
});

Deno.test("module-export composition stays unregistered without the publication reader", () => {
  const composition = createGeometryModuleExportComposition({
    ...baseOptions(),
    runner: {
      run: () => Promise.reject(new Error("not dispatched")),
    },
  });
  assertEquals(composition.geometryModuleExport, undefined);
});

Deno.test("module-export composition does not import the geometry sealer or product catalog", () => {
  assertEquals(
    COMPOSITION_SOURCE.includes("design-write-geometry-run-executor"),
    false,
  );
  assertEquals(COMPOSITION_SOURCE.includes("geometry-bundle-product-catalog"), false);
});

Deno.test("module-export composition recrosses structure CAS; the use case does not import the adapter", () => {
  assertEquals(
    COMPOSITION_SOURCE.includes("parseExactPartDefinitionsCapture"),
    true,
  );
  assertEquals(
    COMPOSITION_SOURCE.includes("CaptureBackedPartDefinitionsStructureReader"),
    true,
  );
  assertEquals(USE_CASE_SOURCE.includes("parseExactPartDefinitionsCapture"), false);
  assertEquals(USE_CASE_SOURCE.includes("adapters/architecture"), false);
});

Deno.test("structure reader requires the exact part-definitions sha256 URI and architecture reference", async () => {
  const stored = await storedStructure();
  const reader = new CaptureBackedPartDefinitionsStructureReader({
    read: (fingerprint) =>
      Promise.resolve(
        fingerprint.digest === stored.fingerprint.digest ? stored.text : undefined,
      ),
  });
  const architecture = { artifactId: ARCH_ID, fingerprint: fp(ARCH_DIGEST) };
  const opened = await reader.reopen(
    {
      artifactId: `part-definitions-${stored.fingerprint.digest}`,
      fingerprint: stored.fingerprint,
      uri: `casys://part-definitions-capture/sha256/${stored.fingerprint.digest}`,
    },
    architecture,
  );
  assertEquals(opened?.schemaVersion, "part-definitions-capture/1.0");
  assertEquals(opened?.artifactId, `part-definitions-${stored.fingerprint.digest}`);
  assertEquals(
    opened?.uri,
    `casys://part-definitions-capture/sha256/${stored.fingerprint.digest}`,
  );
  assertEquals(opened?.byteCount, new TextEncoder().encode(stored.text).byteLength);
  assertEquals(opened?.architecture, {
    artifactId: ARCH_ID,
    fingerprint: fp(ARCH_DIGEST),
    uri: `casys://architecture-capture/sha256/${ARCH_DIGEST}`,
  });
  await assertRejects(
    () =>
      reader.reopen(
        {
          artifactId: `part-definitions-${stored.fingerprint.digest}`,
          fingerprint: stored.fingerprint,
          uri: `casys://part-definitions-capture/${stored.fingerprint.digest}`,
        },
        architecture,
      ),
    TypeError,
    "casys://part-definitions-capture/sha256/",
  );
});

function baseOptions() {
  return {
    projects: { get: () => Promise.resolve(undefined) },
    snapshots: { get: () => Promise.resolve(undefined) },
    traversal: { open: () => Promise.resolve(undefined) },
    architectureCaptures: { read: () => Promise.resolve(undefined) },
    sysmlSourceAnalysis: {
      reopen: () => Promise.reject(new Error("not exercised")),
    },
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

async function storedStructure() {
  const capture = {
    schemaVersion: "part-definitions-capture/1.0",
    kind: "part-definitions",
    scope: "sealed-architecture-subgraph",
    statement: PART_DEFINITIONS_CAPTURE_STATEMENT,
    capturedAt: "2026-08-25T10:00:00.000Z",
    trustedRunId: "run.part-definitions",
    operation: { id: "model.capture-part-definitions", version: "1" },
    architecture: {
      artifactId: ARCH_ID,
      fingerprint: fp(ARCH_DIGEST),
      producerRunId: "run.architecture",
      uri: `casys://architecture-capture/sha256/${ARCH_DIGEST}`,
      schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
      packageName: "LampPackage",
      systemName: "LampSystem",
      scopeRoot: { id: "package-lamp", kind: "Package", label: "LampPackage" },
      semanticRoot: {
        id: "sysml.part.assembly",
        kind: "PartDefinition",
        label: "Assembly",
      },
    },
    seed: {
      artifactId: "syson-model-seed-" + "d".repeat(64),
      fingerprint: fp("d".repeat(64)),
      producerRunId: "run.seed",
      editingContextId: "ctx-1",
      rootPackageId: "root-1",
    },
    partDefinitions: [{
      id: "sysml.part.assembly",
      kind: "PartDefinition",
      label: "Assembly",
      usages: [{
        id: "sysml.usage.arm",
        kind: "PartUsage",
        label: "arm",
        targetId: "sysml.part.arm",
        targetKind: "PartDefinition",
        targetLabel: "Arm",
      }],
    }, {
      id: "sysml.part.arm",
      kind: "PartDefinition",
      label: "Arm",
      usages: [],
    }],
  };
  const text = deterministicJson(capture);
  return { text, fingerprint: await sha256Fingerprint(JSON.parse(text)) };
}

function fakePublications() {
  return {
    resolvePublicationByRunId: () =>
      Promise.resolve({
        status: "not-published" as const,
        runId: "not-dispatched",
        producerGeneration: 0 as const,
      }),
    readReceipt: () => Promise.resolve(undefined),
    readPublishedObject: () => Promise.resolve(undefined),
  };
}
