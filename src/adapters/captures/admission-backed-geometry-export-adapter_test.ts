import { assertEquals, assertRejects } from "@std/assert";
import { fingerprintTechnicalSourceText } from "../../domain/analysis/technical-compilation.ts";
import type {
  McpToolCall,
  McpToolResult,
} from "../../application/ports/out/mcp-tool-client.ts";
import { stubCallToolTextResult } from "../../testing/stub-mcp-tool-client.ts";
import {
  FileCaptureStore,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
  GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
} from "./file-capture-store.ts";
import { PythonCadSourceAnalyzer } from "../analyzers/python-cad-source-analyzer.ts";
import {
  AdmissionBackedGeometryExportAdapter,
  ADMITTED_GEOMETRY_EXPORT_FORMATS,
} from "./admission-backed-geometry-export-adapter.ts";

const HEX64 = "a".repeat(64);
const ADMITTED_SCRIPT = `from build123d import Box\nresult = Box(10, 10, 10)\n`;

function assemblyGltfResponse(digest = HEX64): McpToolResult {
  return {
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: [
        {
          format: "gltf",
          path: "/exports/geometry-preview-assembly.glb",
          bytes: 1024,
          sha256: digest,
          viewer: "model-viewer",
        },
      ],
    },
    text: "",
  };
}

const noopMaterialize = () => Promise.resolve();

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

function request() {
  return {
    script: ADMITTED_SCRIPT,
    architectureBasis: {
      snapshotId: "snapshot.8",
      revision: 8,
      artifactFingerprint: { algorithm: "sha256" as const, digest: HEX64 },
    },
  };
}

Deno.test("admission-backed export sends exact admitted bytes to private build123d_export", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const calls: McpToolCall[] = [];
    const client = {
      callTool: (call: McpToolCall): Promise<McpToolResult> => {
        calls.push(call);
        return Promise.resolve(assemblyGltfResponse());
      },
      callToolTextResult: stubCallToolTextResult,
    };
    const adapter = new AdmissionBackedGeometryExportAdapter({
      client,
      draftCaptures: store,
      sourceAnalysis: sourceAnalysisFor(tmpDir),
      build123dService: "mcp-build123d-sandbox",
      materializeAsset: noopMaterialize,
      previewRunId: "admitted-geometry:test-001",
    });

    const draft = await adapter.export(request());

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.name, "build123d_export");
    assertEquals(calls[0]?.arguments, {
      script: ADMITTED_SCRIPT,
      formats: [...ADMITTED_GEOMETRY_EXPORT_FORMATS],
      name: "geometry-preview-assembly",
      timeout_ms: 120000,
    });
    assertEquals(draft.exportFormats, ["gltf"]);
    assertEquals(draft.assemblyFiles, [{
      format: "gltf",
      name: "geometry-preview-assembly",
      bytes: 1024,
      digest: HEX64,
    }]);
    assertEquals(draft.partMeshes, []);
    assertEquals(
      draft.scriptHash,
      await fingerprintTechnicalSourceText(ADMITTED_SCRIPT),
    );
    const persisted = await store.read({
      algorithm: "sha256",
      digest: draft.draftDigest,
    });
    if (!persisted) throw new Error("expected persisted geometry draft");
    const parsed = JSON.parse(persisted) as { kind: string; script: string };
    assertEquals(parsed.kind, "geometry-draft");
    assertEquals(parsed.script, ADMITTED_SCRIPT);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("admission-backed export refuses caller-selected provider fields and extra request keys", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    let calls = 0;
    const adapter = new AdmissionBackedGeometryExportAdapter({
      client: {
        callTool: () => {
          calls += 1;
          return Promise.resolve(assemblyGltfResponse());
        },
        callToolTextResult: stubCallToolTextResult,
      },
      draftCaptures: store,
      sourceAnalysis: sourceAnalysisFor(tmpDir),
      build123dService: "mcp-build123d-sandbox",
      materializeAsset: noopMaterialize,
    });

    await assertRejects(
      () =>
        adapter.export({
          ...request(),
          provider: "caller-selected",
        } as never),
      TypeError,
    );
    await assertRejects(
      () =>
        adapter.export({
          ...request(),
          tool: "build123d_export",
        } as never),
      TypeError,
    );
    await assertRejects(
      () =>
        adapter.export({
          ...request(),
          path: "/exports/caller.step",
        } as never),
      TypeError,
    );
    await assertRejects(
      () =>
        adapter.export({
          ...request(),
          image: "caller-image",
        } as never),
      TypeError,
    );
    await assertRejects(
      () =>
        adapter.export({
          script: "",
          architectureBasis: request().architectureBasis,
        }),
      TypeError,
    );
    assertEquals(calls, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("admission-backed export uses the server-fixed sandbox service and assembly name", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const names: string[] = [];
    const adapter = new AdmissionBackedGeometryExportAdapter({
      client: {
        callTool: (call) => {
          names.push(String((call.arguments as Record<string, unknown>).name));
          return Promise.resolve(assemblyGltfResponse());
        },
        callToolTextResult: stubCallToolTextResult,
      },
      draftCaptures: store,
      sourceAnalysis: sourceAnalysisFor(tmpDir),
      build123dService: "mcp-build123d-sandbox",
      materializeAsset: noopMaterialize,
    });
    await adapter.export(request());
    assertEquals(names, ["geometry-preview-assembly"]);
    assertEquals(ADMITTED_GEOMETRY_EXPORT_FORMATS, ["gltf"]);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
