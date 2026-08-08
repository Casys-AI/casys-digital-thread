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
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  captureGeometryDraft,
  GEOMETRY_DRAFT_CAPTURE_SCHEMA,
} from "./geometry-draft-capture.ts";
import {
  FileCaptureStore,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
} from "./file-capture-store.ts";
import type { McpToolCall, McpToolResult } from "../mcp/http-mcp-tool-client.ts";
import { GeometryScriptValidationError } from "../../domain/platform/geometry-script-validation.ts";
import {
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryManifest,
} from "../../domain/platform/geometry-proposal.ts";

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
      { build123dService: "mcp-build123d", materializeAsset: noopMaterialize },
    );

    assertEquals(callCount, 1, "exactly one build123d_export call for assembly-only");
    assertEquals(capture.schemaVersion, GEOMETRY_DRAFT_CAPTURE_SCHEMA);
    assertEquals(capture.kind, "geometry-draft");
    assertEquals(capture.subject.snapshotId, "snap-001");
    assertEquals(capture.subject.revision, 2);
    assertEquals(capture.producer.serverId, "build123d");
    assertEquals(capture.producer.tool, "build123d_export");
    assertEquals(capture.script, VALID_SCRIPT);
    assertEquals(capture.exportFormats, ["gltf"]);
    assertEquals(capture.assemblyFiles.length, 1);
    assertEquals(capture.assemblyFiles[0]?.format, "gltf");
    assertEquals(capture.assemblyFiles[0]?.name, "geometry-preview-assembly");
    assertEquals(capture.assemblyFiles[0]?.fingerprint.digest, HEX64);
    assertEquals(capture.partMeshes.length, 0);
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
      { build123dService: "mcp-build123d", materializeAsset: noopMaterialize },
    );

    assertEquals(observedNames, ["geometry-preview-assembly"]);
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
        { build123dService: "mcp-build123d", materializeAsset: noopMaterialize },
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
          { build123dService: "mcp-build123d", materializeAsset: noopMaterialize },
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
          { build123dService: "mcp-build123d", materializeAsset: noopMaterialize },
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
          { build123dService: "mcp-build123d", materializeAsset: noopMaterialize },
        ),
      Error,
      "unsupported structuredContent contract",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
