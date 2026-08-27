/**
 * Tests for geometry-draft-capture.ts.
 *
 * Provider mock is pinned on the REAL build123d_export structuredContent
 * contract: {schemaVersion:"1.0", kind:"export", metrics:{},
 * files:[{format, path, bytes, sha256}]} — the same shape verified by
 * `normalizeAssemblyExport`.  If the contract changes, both the production
 * normalizer and these tests will need updating simultaneously.
 *
 * Docker materialisation is replaced by a no-op in all tests (inject via
 * `options.materializeAsset`).  This avoids requiring a live Docker daemon.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  captureGeometryBundleDraft,
  captureGeometryDraft,
  currentGenericGeometryDraftCaptureSchema,
  GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_DRAFT_CAPTURE_SCHEMA,
  geometryBundleManifestFromDraft,
  requireGeometryBundleCanonicalSources,
} from "./geometry-draft-capture.ts";
import {
  FileCaptureStore,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
  GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { PythonCadSourceAnalyzer } from "../source/python-cad-source-analyzer.ts";
import type {
  McpToolCall,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import { GeometryScriptValidationError } from "../../../domain/cad/source/geometry-script-validation.ts";
import {
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryManifest,
} from "../../../domain/cad/canonical/geometry-proposal.ts";
import {
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
  type GeometryBundleManifest,
} from "../../../domain/cad/canonical/geometry-bundle.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const HEX64 = "a".repeat(64);
const VALID_SCRIPT = `from build123d import Box\nresult = Box(10, 10, 10)\n`;

const VALID_MANIFEST: GeometryManifest = {
  schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
  architectureBasis: {
    snapshotId: "snap-001",
    revision: 2,
    artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
  },
  components: [],
  unitSystem: "mm",
  exportFormats: ["gltf"],
};

/** One valid structuredContent response for an assembly gltf export. */
function assemblyGltfResponse(digest = HEX64): McpToolResult {
  return {
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: [
        {
          format: "gltf",
          path: `/exports/geometry-preview-assembly.glb`,
          bytes: 1024,
          sha256: digest,
          viewer: "model-viewer",
        },
      ],
    },
    text: "",
  };
}

/** No-op materializer: does not touch Docker or the filesystem. */
const noopMaterialize = (_sha256: string, _containerPath: string) => Promise.resolve();

// ── Helper: build a store backed by a temp directory ─────────────────────────

async function makeTempDraftStore(): Promise<
  [FileCaptureStore<"geometry-draft">, string]
> {
  const tmpDir = await Deno.makeTempDir();
  const store = new FileCaptureStore({
    ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
    directory: tmpDir,
  });
  return [store, tmpDir];
}

function sourceAnalysisFor(directory: string) {
  return {
    sourceCaptures: new FileCaptureStore({
      ...GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
      directory: `${directory}/geometry-sources`,
    }),
    analysisCaptures: new FileCaptureStore({
      ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
      directory: `${directory}/source-analyses`,
    }),
    frontend: new PythonCadSourceAnalyzer(),
  } as const;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("captureGeometryDraft saves a verifiable JSON capture for a valid script and assembly-only manifest", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    let callCount = 0;
    const client = {
      callTool: (call: McpToolCall): Promise<McpToolResult> => {
        callCount++;
        assertEquals(call.name, "build123d_export");
        assertEquals(
          (call.arguments as Record<string, unknown>).name,
          "geometry-preview-assembly",
        );
        assertEquals((call.arguments as Record<string, unknown>).timeout_ms, 120000);
        return Promise.resolve(assemblyGltfResponse());
      },
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };

    const capture = await captureGeometryDraft(
      client,
      { script: VALID_SCRIPT, manifest: VALID_MANIFEST },
      store,
      {
        build123dService: "mcp-build123d-sandbox",
        sourceAnalysis: sourceAnalysisFor(tmpDir),
        materializeAsset: noopMaterialize,
        previewRunId: "preview:test-001",
      },
    );

    assertEquals(callCount, 1, "exactly one build123d_export call for assembly-only");
    assertEquals(capture.schemaVersion, GEOMETRY_DRAFT_CAPTURE_SCHEMA);
    assertEquals(capture.kind, "geometry-draft");
    assertEquals(capture.subject.snapshotId, "snap-001");
    assertEquals(capture.subject.revision, 2);
    assertEquals(capture.producer.serverId, "build123d-sandbox");
    assertEquals(capture.producer.tool, "build123d_export");
    assertEquals(capture.producer.runId, "preview:test-001");
    assertEquals(capture.script, VALID_SCRIPT);
    assertEquals(capture.exportFormats, ["gltf"]);
    assertEquals(capture.assemblyFiles.length, 1);
    assertEquals(capture.assemblyFiles[0]?.format, "gltf");
    assertEquals(capture.assemblyFiles[0]?.name, "geometry-preview-assembly");
    assertEquals(capture.assemblyFiles[0]?.fingerprint.digest, HEX64);
    assertEquals(capture.partMeshes.length, 0);
    assertEquals(capture.sourceAnalysis.selector, { kind: "assembly" });
    assertEquals(capture.fingerprint.algorithm, "sha256");

    // CAS readback: the store must have the JSON under the capture fingerprint.
    // The stored JSON does NOT contain a self-referential fingerprint field —
    // the digest is implicit in the filename.  We verify integrity by
    // recomputing sha256Fingerprint from the parsed record.
    const readback = await store.read(capture.fingerprint);
    if (!readback) throw new Error("draft capture not found in store after save");
    const parsed = JSON.parse(readback);
    assertEquals(parsed.schemaVersion, GEOMETRY_DRAFT_CAPTURE_SCHEMA);
    const reparsedFp = await sha256Fingerprint(parsed);
    assertEquals(reparsedFp.digest, capture.fingerprint.digest);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryDraft uses server-fixed name 'geometry-preview-assembly' not agent-supplied text", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const observedNames: string[] = [];
    const client = {
      callTool: (call: McpToolCall): Promise<McpToolResult> => {
        observedNames.push((call.arguments as Record<string, unknown>).name as string);
        return Promise.resolve(assemblyGltfResponse());
      },
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };

    await captureGeometryDraft(
      client,
      { script: VALID_SCRIPT, manifest: VALID_MANIFEST },
      store,
      {
        build123dService: "mcp-build123d-sandbox",
        sourceAnalysis: sourceAnalysisFor(tmpDir),
        materializeAsset: noopMaterialize,
      },
    );

    assertEquals(observedNames, ["geometry-preview-assembly"]);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryDraft refuses a provider path whose extension contradicts the requested export", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const client = {
      callTool: (): Promise<McpToolResult> => {
        const response = assemblyGltfResponse();
        const file = response.structuredContent.files as Array<Record<string, unknown>>;
        file[0]!.path = "/exports/geometry-preview-assembly.gltf";
        return Promise.resolve(response);
      },
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };

    await assertRejects(
      () =>
        captureGeometryDraft(
          client,
          { script: VALID_SCRIPT, manifest: VALID_MANIFEST },
          store,
          {
            build123dService: "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: noopMaterialize,
          },
        ),
      Error,
      'fixed basename "geometry-preview-assembly.glb"',
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryDraft rejects duplicate formats before the provider call", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    let providerCalled = false;
    const client = {
      callTool: (): Promise<McpToolResult> => {
        providerCalled = true;
        return Promise.resolve(assemblyGltfResponse());
      },
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };
    await assertRejects(
      () =>
        captureGeometryDraft(
          client,
          {
            script: VALID_SCRIPT,
            manifest: { ...VALID_MANIFEST, exportFormats: ["gltf", "gltf"] },
          },
          store,
          {
            build123dService: "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: noopMaterialize,
          },
        ),
      Error,
      "must not contain duplicates",
    );
    assertEquals(providerCalled, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryDraft rejects colliding provider digests before materialization", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    let materialized = false;
    const client = {
      callTool: (): Promise<McpToolResult> =>
        Promise.resolve({
          structuredContent: {
            schemaVersion: "1.0",
            kind: "export",
            metrics: {},
            files: [
              {
                format: "step",
                path: "/exports/geometry-preview-assembly.step",
                bytes: 10,
                sha256: HEX64,
              },
              {
                format: "stl",
                path: "/exports/geometry-preview-assembly.stl",
                bytes: 10,
                sha256: HEX64,
              },
            ],
          },
          text: "",
        }),
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };
    await assertRejects(
      () =>
        captureGeometryDraft(
          client,
          {
            script: VALID_SCRIPT,
            manifest: { ...VALID_MANIFEST, exportFormats: ["step", "stl"] },
          },
          store,
          {
            build123dService: "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: () => {
              materialized = true;
              return Promise.resolve();
            },
          },
        ),
      Error,
      "fingerprints must be unique",
    );
    assertEquals(materialized, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryDraft refuses the trusted build123d volume before provider dispatch", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    let providerCalled = false;
    const client = {
      callTool: (): Promise<McpToolResult> => {
        providerCalled = true;
        return Promise.resolve(assemblyGltfResponse());
      },
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };
    await assertRejects(
      () =>
        captureGeometryDraft(
          client,
          { script: VALID_SCRIPT, manifest: VALID_MANIFEST },
          store,
          {
            build123dService: "mcp-build123d" as unknown as "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: noopMaterialize,
          },
        ),
      TypeError,
      "must be materialized from mcp-build123d-sandbox",
    );
    assertEquals(providerCalled, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test(
  "captureGeometryDraft makes exactly one build123d_export call even when manifest has components (per-part exports deferred to v2)",
  async () => {
    // WHY ONE CALL — per-component STL exports were removed in v1 because repeating
    // the assembly script with a different `name` exports the full model each time,
    // not the named sub-solid.  The resulting artefacts would be labelled by
    // usageName but carry full-assembly bytes — a "no hidden heuristics" violation.
    // v1 produces only the assembly export; components are stored as metadata only.
    const [store, tmpDir] = await makeTempDraftStore();
    try {
      const manifest: GeometryManifest = {
        ...VALID_MANIFEST,
        exportFormats: ["gltf"],
        components: [
          { usageName: "dripTray", elementId: "elem-01", label: "Drip Tray" },
          { usageName: "tank", elementId: "elem-02", label: "Tank" },
        ],
      };

      const callNames: string[] = [];
      const client = {
        callTool: (call: McpToolCall): Promise<McpToolResult> => {
          const args = call.arguments as Record<string, unknown>;
          callNames.push(args.name as string);
          if (args.name === "geometry-preview-assembly") {
            return Promise.resolve(assemblyGltfResponse());
          }
          return Promise.reject(
            new Error(`unexpected provider call for name '${args.name}'`),
          );
        },
        callToolTextResult: () => Promise.reject(new Error("unexpected")),
      };

      const capture = await captureGeometryDraft(
        client,
        { script: VALID_SCRIPT, manifest },
        store,
        {
          build123dService: "mcp-build123d-sandbox",
          sourceAnalysis: sourceAnalysisFor(tmpDir),
          materializeAsset: noopMaterialize,
        },
      );

      // Only the assembly call — no per-part calls.
      assertEquals(callNames, ["geometry-preview-assembly"]);
      assertEquals(capture.partMeshes.length, 0);
      // Components are preserved as metadata in the capture.
      assertEquals(capture.components.length, 2);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test("captureGeometryDraft rejects a script with a forbidden identifier before any provider call", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    let callCount = 0;
    const client = {
      callTool: (): Promise<McpToolResult> => {
        callCount++;
        return Promise.resolve(assemblyGltfResponse());
      },
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };

    await assertRejects(
      () =>
        captureGeometryDraft(
          client,
          {
            script:
              `from build123d import *\nos.system("rm -rf /")\nresult = Box(1,1,1)\n`,
            manifest: VALID_MANIFEST,
          },
          store,
          {
            build123dService: "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: noopMaterialize,
          },
        ),
      GeometryScriptValidationError,
    );
    assertEquals(callCount, 0, "provider must not be called when validation fails");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryDraft rejects a provider response with a missing required field", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const client = {
      callTool: (): Promise<McpToolResult> =>
        Promise.resolve({
          structuredContent: {
            schemaVersion: "1.0",
            kind: "export",
            metrics: {},
            files: [{ format: "gltf", path: "/exports/x.glb", bytes: 100 }], // missing sha256
          },
          text: "",
        }),
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };

    await assertRejects(
      () =>
        captureGeometryDraft(
          client,
          { script: VALID_SCRIPT, manifest: VALID_MANIFEST },
          store,
          {
            build123dService: "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: noopMaterialize,
          },
        ),
      Error,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryDraft rejects a provider response with an unexpected schemaVersion", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const client = {
      callTool: (): Promise<McpToolResult> =>
        Promise.resolve({
          structuredContent: {
            schemaVersion: "2.0",
            kind: "export",
            metrics: {},
            files: [{
              format: "gltf",
              path: "/exports/x.glb",
              bytes: 100,
              sha256: HEX64,
            }],
          },
          text: "",
        }),
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };

    await assertRejects(
      () =>
        captureGeometryDraft(
          client,
          { script: VALID_SCRIPT, manifest: VALID_MANIFEST },
          store,
          {
            build123dService: "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: noopMaterialize,
          },
        ),
      Error,
      "unsupported structuredContent contract",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

function v2Manifest(): GeometryBundleManifest {
  return {
    schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
    architectureBasis: {
      snapshotId: "snap-architecture-v2",
      revision: 5,
      artifactFingerprint: { algorithm: "sha256", digest: HEX64 },
    },
    components: [{ elementId: "usage:left", usageName: "left", label: "Left" }, {
      elementId: "usage:right",
      usageName: "right",
      label: "Right",
    }],
    unitSystem: "mm",
    placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
    exportFormats: ["step", "gltf"],
    partExportFormats: ["step", "gltf", "stl"],
    partDefinitions: [{
      elementId: "definition:shared",
      label: "Shared",
    }],
    occurrences: [{
      usageElementId: "usage:left",
      partDefinitionElementId: "definition:shared",
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    }, {
      usageElementId: "usage:right",
      partDefinitionElementId: "definition:shared",
      placement: { translationMm: [20, 0, 0], rotationDeg: [0, 0, 90] },
    }],
  };
}

function exportResponse(
  name: string,
  formats: readonly ("step" | "gltf" | "stl")[],
  digest = HEX64,
): McpToolResult {
  return {
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: formats.map((format) => ({
        format,
        path: `/exports/${name}.${format === "gltf" ? "glb" : format}`,
        bytes: 123,
        sha256: digest,
        ...(format === "gltf" ? { viewer: "model-viewer" } : {}),
      })),
    },
    text: "",
  };
}

Deno.test("captureGeometryBundleDraft exports one exact assembly and one exact source per reused PartDefinition", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const calls: McpToolCall[] = [];
    const client = {
      callTool: (call: McpToolCall): Promise<McpToolResult> => {
        calls.push(call);
        const args = call.arguments as Record<string, unknown>;
        return Promise.resolve(
          exportResponse(
            String(args.name),
            args.formats as ("step" | "gltf" | "stl")[],
          ),
        );
      },
      callToolTextResult: () => Promise.reject(new Error("unexpected")),
    };
    const definitionScript =
      "from build123d import Cylinder\nresult = Cylinder(5, 10)\n";
    const capture = await captureGeometryBundleDraft(
      client,
      {
        assemblyScript: VALID_SCRIPT,
        manifest: v2Manifest(),
        partDefinitionScripts: [{
          elementId: "definition:shared",
          script: definitionScript,
        }],
      },
      store,
      {
        build123dService: "mcp-build123d-sandbox",
        sourceAnalysis: sourceAnalysisFor(tmpDir),
        materializeAsset: noopMaterialize,
        previewRunId: "preview:bundle-v2",
      },
      () => "2026-08-09T01:00:00.000Z",
    );

    assertEquals(calls.length, 2);
    const exportNames = calls.map((call) =>
      String((call.arguments as Record<string, unknown>).name)
    );
    assertEquals(exportNames[0], `${capture.exportNamePrefix}-assembly`);
    assertEquals(exportNames[1], `${capture.exportNamePrefix}-definition-000`);
    assertEquals(
      (calls[1]!.arguments as Record<string, unknown>).script,
      definitionScript,
    );
    assertEquals(capture.schemaVersion, GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA);
    assertEquals(capture.sourceAnalyses.assembly.selector, { kind: "assembly" });
    assertEquals(capture.sourceAnalyses.partDefinitions.length, 1);
    assertEquals(capture.producer.runId, "preview:bundle-v2");
    assertEquals(capture.partDefinitions.length, 1);
    assertEquals(capture.occurrences.length, 2);
    assertEquals(
      geometryBundleManifestFromDraft(capture),
      {
        ...v2Manifest(),
        scriptHash: capture.assembly.scriptHash,
        artifactHashes: {
          assemblyFiles: capture.assembly.files.map(
            ({ format, name, fingerprint }) => ({ format, name, fingerprint }),
          ),
          partMeshes: [],
        },
        partDefinitions: capture.partDefinitions.map((definition) => ({
          elementId: definition.elementId,
          label: definition.label,
          scriptHash: definition.scriptHash,
          files: definition.files.map(({ format, name, fingerprint }) => ({
            format,
            name,
            fingerprint,
          })),
        })),
      },
    );
    const stored = await store.read(capture.fingerprint);
    if (!stored) throw new Error("v2 draft missing");
    assertEquals(
      (await sha256Fingerprint(JSON.parse(stored))).digest,
      capture.fingerprint.digest,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryBundleDraft rejects missing independent source before provider dispatch", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    let called = false;
    await assertRejects(
      () =>
        captureGeometryBundleDraft(
          {
            callTool: () => {
              called = true;
              return Promise.resolve(exportResponse("unused", ["step"]));
            },
            callToolTextResult: () => Promise.reject(new Error("unexpected")),
          },
          {
            assemblyScript: VALID_SCRIPT,
            manifest: v2Manifest(),
            partDefinitionScripts: [],
          },
          store,
          {
            build123dService: "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: noopMaterialize,
          },
        ),
      TypeError,
      "cover every manifest PartDefinition identity exactly once",
    );
    assertEquals(called, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryBundleDraft accepts identical content for distinct semantic definitions", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const base = v2Manifest();
    const manifest: GeometryBundleManifest = {
      ...base,
      partDefinitions: [{ elementId: "definition:left", label: "Left" }, {
        elementId: "definition:right",
        label: "Right",
      }],
      occurrences: [{
        ...base.occurrences[0]!,
        partDefinitionElementId: "definition:left",
      }, {
        ...base.occurrences[1]!,
        partDefinitionElementId: "definition:right",
      }],
    };
    const capture = await captureGeometryBundleDraft(
      {
        callTool: (call) => {
          const args = call.arguments as Record<string, unknown>;
          return Promise.resolve(
            exportResponse(
              String(args.name),
              args.formats as ("step" | "gltf" | "stl")[],
              HEX64,
            ),
          );
        },
        callToolTextResult: () => Promise.reject(new Error("unexpected")),
      },
      {
        assemblyScript: VALID_SCRIPT,
        manifest,
        partDefinitionScripts: [{
          elementId: "definition:left",
          script: VALID_SCRIPT,
        }, {
          elementId: "definition:right",
          script: VALID_SCRIPT,
        }],
      },
      store,
      {
        build123dService: "mcp-build123d-sandbox",
        sourceAnalysis: sourceAnalysisFor(tmpDir),
        materializeAsset: noopMaterialize,
      },
    );
    assertEquals(capture.partDefinitions.length, 2);
    assertEquals(
      capture.partDefinitions[0]!.files[0]!.fingerprint,
      capture.partDefinitions[1]!.files[0]!.fingerprint,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("captureGeometryBundleDraft rejects a provider definition path that breaks its ordinal identity", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    await assertRejects(
      () =>
        captureGeometryBundleDraft(
          {
            callTool: (call) => {
              const args = call.arguments as Record<string, unknown>;
              const response = exportResponse(
                String(args.name),
                args.formats as ("step" | "gltf" | "stl")[],
              );
              if (String(args.name).endsWith("-definition-000")) {
                (response.structuredContent.files as Array<Record<string, unknown>>)[0]!
                  .path = "/exports/geometry-preview-assembly.step";
              }
              return Promise.resolve(response);
            },
            callToolTextResult: () => Promise.reject(new Error("unexpected")),
          },
          {
            assemblyScript: VALID_SCRIPT,
            manifest: v2Manifest(),
            partDefinitionScripts: [{
              elementId: "definition:shared",
              script: VALID_SCRIPT,
            }],
          },
          store,
          {
            build123dService: "mcp-build123d-sandbox",
            sourceAnalysis: sourceAnalysisFor(tmpDir),
            materializeAsset: noopMaterialize,
          },
        ),
      Error,
      "fixed basename",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

for (
  const [name, bytes, digest, expected] of [
    ["zero-byte claim", 0, HEX64, "expected a positive integer"],
    [
      "empty-file digest with a lying positive count",
      1,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "empty-file SHA-256",
    ],
  ] as const
) {
  Deno.test(
    `captureGeometryBundleDraft rejects ${name} before materialization or definition calls`,
    async () => {
      const [store, tmpDir] = await makeTempDraftStore();
      try {
        let providerCalls = 0;
        let materializations = 0;
        await assertRejects(
          () =>
            captureGeometryBundleDraft(
              {
                callTool: (call) => {
                  providerCalls += 1;
                  const args = call.arguments as Record<string, unknown>;
                  const response = exportResponse(
                    String(args.name),
                    args.formats as ("step" | "gltf" | "stl")[],
                  );
                  const first = (response.structuredContent.files as Array<
                    Record<string, unknown>
                  >)[0]!;
                  first.bytes = bytes;
                  first.sha256 = digest;
                  return Promise.resolve(response);
                },
                callToolTextResult: () => Promise.reject(new Error("unexpected")),
              },
              {
                assemblyScript: VALID_SCRIPT,
                manifest: v2Manifest(),
                partDefinitionScripts: [{
                  elementId: "definition:shared",
                  script: VALID_SCRIPT,
                }],
              },
              store,
              {
                build123dService: "mcp-build123d-sandbox",
                sourceAnalysis: sourceAnalysisFor(tmpDir),
                materializeAsset: () => {
                  materializations += 1;
                  return Promise.resolve();
                },
              },
            ),
          Error,
          expected,
        );
        assertEquals(providerCalls, 1);
        assertEquals(materializations, 0);
        // Passive source and analysis CAS records intentionally precede the
        // provider. A bad provider response still creates no reviewable draft.
        const entries = (await Array.fromAsync(Deno.readDir(tmpDir)))
          .map((entry) => entry.name)
          .sort();
        assertEquals(entries, ["geometry-sources", "source-analyses"]);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    },
  );
}

Deno.test("geometry bundle canonical sources reject source or N+1 provenance mutation", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const capture = await captureGeometryBundleDraft(
      {
        callTool: (call) => {
          const args = call.arguments as Record<string, unknown>;
          return Promise.resolve(
            exportResponse(
              String(args.name),
              args.formats as ("step" | "gltf" | "stl")[],
            ),
          );
        },
        callToolTextResult: () => Promise.reject(new Error("unexpected")),
      },
      {
        assemblyScript: VALID_SCRIPT,
        manifest: v2Manifest(),
        partDefinitionScripts: [{
          elementId: "definition:shared",
          script: "from build123d import Cylinder\nresult = Cylinder(5, 10)\n",
        }],
      },
      store,
      {
        build123dService: "mcp-build123d-sandbox",
        sourceAnalysis: sourceAnalysisFor(tmpDir),
        materializeAsset: noopMaterialize,
        previewRunId: "preview:source-integrity",
      },
    );
    await assertRejects(
      () =>
        requireGeometryBundleCanonicalSources({
          ...capture,
          assembly: {
            ...capture.assembly,
            script: `${capture.assembly.script}# changed`,
          },
        }),
      Error,
      "assembly source does not match",
    );
    await assertRejects(
      () =>
        requireGeometryBundleCanonicalSources({
          ...capture,
          providerCalls: capture.providerCalls.slice(0, 1),
        }),
      Error,
      "exact ordered N+1 source plan",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("current generic draft schemas are 1.2 and 2.1; older identities are rejected", () => {
  assertEquals(
    currentGenericGeometryDraftCaptureSchema("geometry-draft-capture/1.2"),
    GEOMETRY_DRAFT_CAPTURE_SCHEMA,
  );
  assertEquals(
    currentGenericGeometryDraftCaptureSchema("geometry-draft-capture/2.1"),
    GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA,
  );
  for (
    const schema of [
      "geometry-draft-capture/1.0",
      "geometry-draft-capture/1.1",
      "geometry-draft-capture/2.0",
    ]
  ) {
    try {
      currentGenericGeometryDraftCaptureSchema(schema);
      throw new Error(`expected ${schema} to be rejected`);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      if (!error.message.includes("Unsupported geometry draft capture schema")) {
        throw error;
      }
    }
  }
});
