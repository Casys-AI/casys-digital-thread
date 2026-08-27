import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "../../../domain/compile/source/source-analysis-frontend.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  GeometrySourceAnalysisCaptureError,
  GeometrySourceAnalysisCaptureService,
  requireGeometrySourceAnalysis,
} from "./geometry-source-analysis-capture.ts";

const SOURCE_TEXT = "from build123d import Box\nresult = Box(1, 2, 3)\n";

Deno.test("geometry source capture persists exact source before the frontend runs", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    const events: string[] = [];
    const frontend: SourceAnalysisFrontend = {
      analyze: async (input) => {
        let sourceRecords = 0;
        for await (
          const _entry of Deno.readDir(sourceCapturesDirectory(sourceCaptures))
        ) {
          sourceRecords++;
        }
        assertEquals(sourceRecords, 1);
        events.push("frontend");
        return await validBundle(input);
      },
    };
    const service = new GeometrySourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      frontend,
    });

    const reference = await service.capture({
      selector: { kind: "assembly" },
      sourceText: SOURCE_TEXT,
    });

    assertEquals(events, ["frontend"]);
    assertEquals(reference.sourceId, "cad-assembly");
    const sourceText = await sourceCaptures.read(reference.sourceCaptureFingerprint);
    assertEquals(sourceText !== undefined, true);
    assertEquals(JSON.parse(sourceText!).sourceText, SOURCE_TEXT);
    const analysisText = await analysisCaptures.read(reference.analysisFingerprint);
    assertEquals(analysisText !== undefined, true);
    const reopened = await requireGeometrySourceAnalysis(reference, {
      sourceCaptures,
      analysisCaptures,
    });
    assertEquals(reopened.source.sourceText, SOURCE_TEXT);
    assertEquals(reopened.analysis.source.id, reference.sourceId);
  });
});

Deno.test("geometry source capture keeps v2 PartDefinition identities distinct when source bytes match", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    const observedIds: string[] = [];
    const frontend: SourceAnalysisFrontend = {
      analyze: async (input) => {
        observedIds.push(input.sourceId);
        return await validBundle(input);
      },
    };
    const service = new GeometrySourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      frontend,
    });

    const first = await service.capture({
      selector: { kind: "part-definition", elementId: "definition-a" },
      sourceText: SOURCE_TEXT,
    });
    const second = await service.capture({
      selector: { kind: "part-definition", elementId: "definition-b" },
      sourceText: SOURCE_TEXT,
    });

    assertEquals(observedIds.length, 2);
    assertEquals(observedIds[0]?.startsWith("cad-part-definition:"), true);
    assertEquals(observedIds[1]?.startsWith("cad-part-definition:"), true);
    assertEquals(observedIds[0] === observedIds[1], false);
    assertEquals(first.sourceFingerprint, second.sourceFingerprint);
    assertEquals(first.sourceId === second.sourceId, false);
    assertEquals(
      first.sourceCaptureFingerprint === second.sourceCaptureFingerprint,
      false,
    );
    assertEquals(first.analysisFingerprint === second.analysisFingerprint, false);
  });
});

Deno.test("geometry source capture rejects a frontend bundle that does not identify the captured source", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    const frontend: SourceAnalysisFrontend = {
      analyze: async (input) => {
        const bundle = await validBundle(input);
        return {
          ...bundle,
          source: { ...bundle.source, id: "cad-assembly-other" },
        };
      },
    };
    const service = new GeometrySourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      frontend,
    });

    const error = await assertRejects(
      () =>
        service.capture({ selector: { kind: "assembly" }, sourceText: SOURCE_TEXT }),
      GeometrySourceAnalysisCaptureError,
    );
    assertInstanceOf(error, GeometrySourceAnalysisCaptureError);
    assertEquals(error.code, "analysis_identity_mismatch");
    assertEquals(await countDirectory(analysisCapturesDirectory(analysisCaptures)), 0);
  });
});

Deno.test("geometry source capture rejects corrupted source CAS readback before analysis", async () => {
  const directory = await Deno.makeTempDir({ prefix: "geometry-source-analysis-" });
  try {
    const sourceCaptures = new CorruptReadCaptureStore({
      kind: "geometry-source" as const,
      directory: `${directory}/sources`,
      uriNamespace: "geometry-source-test",
      label: "Geometry source test",
    });
    const analysisCaptures = new FileCaptureStore({
      kind: "source-analysis" as const,
      directory: `${directory}/analyses`,
      uriNamespace: "source-analysis-test",
      label: "Source analysis test",
    });
    let frontendCalls = 0;
    const service = new GeometrySourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      frontend: {
        analyze: async (input) => {
          frontendCalls++;
          return await validBundle(input);
        },
      },
    });

    const error = await assertRejects(
      () =>
        service.capture({ selector: { kind: "assembly" }, sourceText: SOURCE_TEXT }),
      GeometrySourceAnalysisCaptureError,
    );
    assertInstanceOf(error, GeometrySourceAnalysisCaptureError);
    assertEquals(error.code, "source_capture_readback_failed");
    assertEquals(frontendCalls, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("geometry source capture persists a rejected analysis before returning its typed error", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    let rejectedBundle: SourceAnalysisBundle | undefined;
    const frontend: SourceAnalysisFrontend = {
      analyze: async (input) => {
        rejectedBundle = await validBundle(input, "rejected");
        return rejectedBundle;
      },
    };
    const service = new GeometrySourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      frontend,
    });

    const error = await assertRejects(
      () =>
        service.capture({ selector: { kind: "assembly" }, sourceText: SOURCE_TEXT }),
      GeometrySourceAnalysisCaptureError,
    );
    assertInstanceOf(error, GeometrySourceAnalysisCaptureError);
    assertEquals(error.code, "analysis_rejected");
    const fingerprint = await fingerprintSourceAnalysisBundle(rejectedBundle!);
    assertEquals(await analysisCaptures.read(fingerprint) !== undefined, true);
  });
});

Deno.test("geometry source-analysis reader rejects a selector that does not match its source id", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    const service = new GeometrySourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      frontend: { analyze: (input) => validBundle(input) },
    });
    const reference = await service.capture({
      selector: { kind: "assembly" },
      sourceText: SOURCE_TEXT,
    });

    const error = await assertRejects(
      () =>
        requireGeometrySourceAnalysis({
          ...reference,
          selector: { kind: "part-definition", elementId: "same-bytes" },
        }, { sourceCaptures, analysisCaptures }),
      GeometrySourceAnalysisCaptureError,
    );
    assertEquals(error.code, "source_reference_invalid");
  });
});

class CorruptReadCaptureStore<Kind extends string> extends FileCaptureStore<Kind> {
  override async read(fingerprint: { algorithm: "sha256"; digest: string }) {
    const text = await super.read(fingerprint);
    return text === undefined ? undefined : `${text} `;
  }
}

async function validBundle(
  input: SourceAnalysisFrontendInput,
  status: "passed" | "rejected" = "passed",
): Promise<SourceAnalysisBundle> {
  const fingerprint = await utf8Fingerprint(input.sourceText);
  return {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: input.sourceId,
      role: input.role,
      language: input.language,
      fingerprint,
    },
    analyzer: { id: "test-python-frontend", version: "1" },
    policy: {
      profile: "test",
      status,
      findings: status === "rejected"
        ? [{ id: "syntax", code: "syntax", severity: "error", message: "Rejected." }]
        : [],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  };
}

async function utf8Fingerprint(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256" as const,
    digest: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}

async function withStores(
  action: (stores: {
    sourceCaptures: FileCaptureStore<"geometry-source">;
    analysisCaptures: FileCaptureStore<"source-analysis">;
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "geometry-source-analysis-" });
  try {
    await action({
      sourceCaptures: new FileCaptureStore({
        kind: "geometry-source",
        directory: `${directory}/sources`,
        uriNamespace: "geometry-source-test",
        label: "Geometry source test",
      }),
      analysisCaptures: new FileCaptureStore({
        kind: "source-analysis",
        directory: `${directory}/analyses`,
        uriNamespace: "source-analysis-test",
        label: "Source analysis test",
      }),
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

function sourceCapturesDirectory(
  store: FileCaptureStore<"geometry-source">,
): string {
  return store.pathFor({
    algorithm: "sha256",
    digest: "0".repeat(64),
  }).replace(/\/[^/]+$/, "");
}

function analysisCapturesDirectory(
  store: FileCaptureStore<"source-analysis">,
): string {
  return store.pathFor({
    algorithm: "sha256",
    digest: "0".repeat(64),
  }).replace(/\/[^/]+$/, "");
}

async function countDirectory(directory: string): Promise<number> {
  try {
    let count = 0;
    for await (const _entry of Deno.readDir(directory)) count++;
    return count;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
}
