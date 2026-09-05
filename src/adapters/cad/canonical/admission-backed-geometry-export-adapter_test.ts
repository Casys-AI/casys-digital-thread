import { assertEquals, assertRejects } from "@std/assert";
import { fingerprintTechnicalSourceText } from "../../../domain/compile/admission/technical-compilation.ts";
import type {
  McpToolCall,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import type { ExpectedProviderResource } from "../../../domain/compile/source/provider-resource-reader.ts";
import { stubCallToolTextResult } from "../../../testing/stub-mcp-tool-client.ts";
import {
  FileCaptureStore,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
  GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { PythonCadSourceAnalyzer } from "../source/python-cad-source-analyzer.ts";
import {
  AdmissionBackedGeometryExportAdapter,
  ADMITTED_GEOMETRY_EXPORT_FORMATS,
  ADMITTED_TARGETED_PART_EXPORT_FORMATS,
} from "./admission-backed-geometry-export-adapter.ts";
import { BUILD123D_EXPORT_TIMEOUT_MS } from "./build123d-export-contract.ts";

import {
  GEOMETRY_DRAFT_ADMISSION_SCHEMA,
  GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
} from "../../../domain/cad/canonical/geometry-draft-admission.ts";

const HEX64 = "a".repeat(64);
const ADMITTED_SCRIPT =
  "from build123d import Box\nthickness = 10\nresult = Box(10, 10, thickness)\n";

function exportResponse(
  formats: readonly string[],
  digest = HEX64,
): McpToolResult {
  return {
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: formats.map((format) => ({
        format,
        artifact: artifact(format as "step" | "gltf" | "stl", digest, 1024),
      })),
    },
    text: "",
  };
}

function artifact(
  format: "step" | "gltf" | "stl",
  sha256: string,
  bytes: number,
) {
  const extension = format === "gltf" ? "glb" : format;
  const mimeType = format === "step"
    ? "model/step"
    : format === "stl"
    ? "model/stl"
    : "model/gltf-binary";
  return {
    schemaVersion: "build123d-export-artifact/1.0",
    uri: `casys://build123d/artifacts/${sha256}.${extension}`,
    format,
    mimeType,
    bytes,
    sha256,
  } as const;
}

function fixtureResourceDependencies() {
  const issued = new WeakMap<Uint8Array, ExpectedProviderResource>();
  return {
    resourceReader: {
      read(expected: ExpectedProviderResource) {
        const bytes = new Uint8Array(expected.byteCount);
        issued.set(bytes, expected);
        return Promise.resolve({
          bytes: { byteLength: bytes.byteLength, copy: () => bytes },
          attestation: {
            schemaVersion: "provider-resource-read-attestation/1.0" as const,
            verification: "exact-content-match" as const,
            uri: expected.uri,
            mediaType: expected.mediaType,
            byteCount: expected.byteCount,
            sha256: expected.sha256,
          },
        });
      },
    },
    draftAssets: {
      persist(bytes: Uint8Array) {
        const expected = issued.get(bytes);
        if (!expected) {
          return Promise.reject(
            new Error("test asset bytes were not read from a resource"),
          );
        }
        return Promise.resolve({
          fingerprint: { algorithm: "sha256" as const, digest: expected.sha256 },
          byteCount: expected.byteCount,
        });
      },
      read: () => Promise.resolve(undefined),
    },
  } as const;
}

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

async function request() {
  return {
    script: ADMITTED_SCRIPT,
    architectureBasis: {
      snapshotId: "snapshot.8",
      revision: 8,
      artifactFingerprint: { algorithm: "sha256" as const, digest: HEX64 },
    },
    admission: {
      schemaVersion: GEOMETRY_DRAFT_ADMISSION_SCHEMA,
      artifactId: `technical-compilation-admission-${HEX64}`,
      fingerprint: { algorithm: "sha256" as const, digest: HEX64 },
      sourceFingerprint: await fingerprintTechnicalSourceText(ADMITTED_SCRIPT),
    },
    representedPart: {
      elementId: "sysml.part.box",
      label: "Box",
    },
  };
}

async function targetedRequest() {
  const sourceFingerprint = await fingerprintTechnicalSourceText(ADMITTED_SCRIPT);
  return {
    script: ADMITTED_SCRIPT,
    architectureBasis: {
      snapshotId: "snapshot.8",
      revision: 8,
      artifactFingerprint: { algorithm: "sha256" as const, digest: HEX64 },
    },
    admission: {
      schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
      artifactId: `technical-compilation-admission-${HEX64}`,
      fingerprint: { algorithm: "sha256" as const, digest: HEX64 },
      sourceFingerprint,
      target: { partDefinitionElementId: "sysml.part.box", label: "Box" },
    },
    target: { partDefinitionElementId: "sysml.part.box", label: "Box" },
  };
}

Deno.test("admission-backed export sends exact admitted bytes to private build123d_export", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const calls: McpToolCall[] = [];
    const client = {
      callTool: (call: McpToolCall): Promise<McpToolResult> => {
        calls.push(call);
        const args = call.arguments as Record<string, unknown>;
        return Promise.resolve(
          exportResponse(
            args.formats as string[],
          ),
        );
      },
      callToolTextResult: stubCallToolTextResult,
    };
    const adapter = new AdmissionBackedGeometryExportAdapter({
      client,
      draftCaptures: store,
      sourceAnalysis: sourceAnalysisFor(tmpDir),
      ...fixtureResourceDependencies(),
      previewRunId: "admitted-geometry:test-001",
    });

    const draft = await adapter.export(await request());

    assertEquals(calls.length, 2);
    assertEquals(calls[0]?.name, "build123d_export");
    assertEquals(calls[1]?.name, "build123d_export");
    assertEquals(calls[0]?.arguments, {
      script: ADMITTED_SCRIPT,
      formats: [...ADMITTED_GEOMETRY_EXPORT_FORMATS],
      name: String((calls[0]?.arguments as Record<string, unknown>).name),
      timeout_ms: BUILD123D_EXPORT_TIMEOUT_MS,
    });
    assertEquals(
      String((calls[0]?.arguments as Record<string, unknown>).name)
        .endsWith("-assembly"),
      true,
    );
    assertEquals(
      String((calls[1]?.arguments as Record<string, unknown>).name)
        .endsWith("-definition-000"),
      true,
    );
    assertEquals(draft.exportFormats, ["step", "gltf"]);
    assertEquals(draft.partExportFormats, ["step", "gltf"]);
    assertEquals(draft.assemblyFiles.map((file) => file.format), ["step", "gltf"]);
    assertEquals(draft.partDefinitions.length, 1);
    assertEquals(draft.partDefinitions[0]?.elementId, "sysml.part.box");
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
    const parsed = JSON.parse(persisted) as {
      kind: string;
      schemaVersion?: string;
      assembly?: { script: string };
      admission?: { artifactId: string };
    };
    assertEquals(parsed.kind, "geometry-draft");
    assertEquals(parsed.schemaVersion, "geometry-draft-capture/2.1");
    assertEquals(parsed.assembly?.script, ADMITTED_SCRIPT);
    assertEquals(
      parsed.admission?.artifactId,
      `technical-compilation-admission-${HEX64}`,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("targeted admission-backed export makes one fixed call and durably captures one part draft", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const calls: McpToolCall[] = [];
    const adapter = new AdmissionBackedGeometryExportAdapter({
      client: {
        callTool: (call) => {
          calls.push(call);
          const args = call.arguments as Record<string, unknown>;
          return Promise.resolve(
            exportResponse(args.formats as string[]),
          );
        },
        callToolTextResult: stubCallToolTextResult,
      },
      draftCaptures: store,
      sourceAnalysis: sourceAnalysisFor(tmpDir),
      ...fixtureResourceDependencies(),
      previewRunId: "admitted-geometry-part:test-001",
    });

    const draft = await adapter.exportTargetedPart(await targetedRequest());

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.name, "build123d_export");
    assertEquals(calls[0]?.arguments, {
      script: ADMITTED_SCRIPT,
      formats: [...ADMITTED_TARGETED_PART_EXPORT_FORMATS],
      name: String((calls[0]?.arguments as Record<string, unknown>).name),
      timeout_ms: BUILD123D_EXPORT_TIMEOUT_MS,
    });
    assertEquals(draft.target.partDefinitionElementId, "sysml.part.box");
    assertEquals(draft.target.files.map((file) => file.format), ["step", "gltf"]);
    const persisted = await store.read({
      algorithm: "sha256",
      digest: draft.draftDigest,
    });
    if (!persisted) throw new Error("expected persisted target geometry draft");
    const parsed = JSON.parse(persisted) as {
      schemaVersion?: string;
      kind?: string;
      target?: { partDefinitionElementId?: string };
      admission?: { schemaVersion?: string; target?: { label?: string } };
      providerCall?: { timeoutMs?: number };
    };
    assertEquals(parsed.schemaVersion, "geometry-part-draft-capture/1.1");
    assertEquals(parsed.kind, "geometry-part-draft");
    assertEquals(parsed.target?.partDefinitionElementId, "sysml.part.box");
    assertEquals(parsed.admission?.schemaVersion, GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA);
    assertEquals(parsed.admission?.target?.label, "Box");
    assertEquals(parsed.providerCall?.timeoutMs, BUILD123D_EXPORT_TIMEOUT_MS);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("targeted export leaves no reviewable draft or provider retry when resource reading fails", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const calls: McpToolCall[] = [];
    const dependencies = fixtureResourceDependencies();
    const adapter = new AdmissionBackedGeometryExportAdapter({
      client: {
        callTool: (call) => {
          calls.push(call);
          const args = call.arguments as Record<string, unknown>;
          return Promise.resolve(exportResponse(args.formats as string[]));
        },
        callToolTextResult: stubCallToolTextResult,
      },
      draftCaptures: store,
      sourceAnalysis: sourceAnalysisFor(tmpDir),
      ...dependencies,
      resourceReader: {
        read: () => Promise.reject(new Error("resource reader failure")),
      },
      previewRunId: "admitted-geometry-part:resource-read-failure",
    });

    await assertRejects(
      async () => adapter.exportTargetedPart(await targetedRequest()),
      Error,
      "resource reader failure",
    );
    assertEquals(calls.length, 1);
    const draftFiles: string[] = [];
    for await (const entry of Deno.readDir(tmpDir)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        draftFiles.push(entry.name);
      }
    }
    assertEquals(draftFiles, []);
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
        callTool: (call) => {
          calls += 1;
          const args = call.arguments as Record<string, unknown>;
          return Promise.resolve(
            exportResponse(args.formats as string[]),
          );
        },
        callToolTextResult: stubCallToolTextResult,
      },
      draftCaptures: store,
      sourceAnalysis: sourceAnalysisFor(tmpDir),
      ...fixtureResourceDependencies(),
    });

    const valid = await request();
    await assertRejects(
      () => adapter.export({ ...valid, provider: "caller-selected" } as never),
      TypeError,
    );
    await assertRejects(
      () => adapter.export({ ...valid, tool: "build123d_export" } as never),
      TypeError,
    );
    await assertRejects(
      () => adapter.export({ ...valid, path: "/exports/caller.step" } as never),
      TypeError,
    );
    await assertRejects(
      () => adapter.export({ ...valid, image: "caller-image" } as never),
      TypeError,
    );
    await assertRejects(
      () =>
        adapter.export({
          script: "",
          architectureBasis: valid.architectureBasis,
        } as never),
      TypeError,
    );
    assertEquals(calls, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("admission-backed export uses server-fixed export names", async () => {
  const [store, tmpDir] = await makeTempDraftStore();
  try {
    const names: string[] = [];
    const adapter = new AdmissionBackedGeometryExportAdapter({
      client: {
        callTool: (call) => {
          const args = call.arguments as Record<string, unknown>;
          names.push(String(args.name));
          return Promise.resolve(
            exportResponse(args.formats as string[]),
          );
        },
        callToolTextResult: stubCallToolTextResult,
      },
      draftCaptures: store,
      sourceAnalysis: sourceAnalysisFor(tmpDir),
      ...fixtureResourceDependencies(),
    });
    await adapter.export(await request());
    assertEquals(names.length, 2);
    assertEquals(names[0]?.endsWith("-assembly"), true);
    assertEquals(names[1]?.endsWith("-definition-000"), true);
    assertEquals(ADMITTED_GEOMETRY_EXPORT_FORMATS, ["step", "gltf"]);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
