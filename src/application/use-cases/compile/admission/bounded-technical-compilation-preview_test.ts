import { assertEquals, assertRejects } from "@std/assert";
import {
  FileTechnicalCompilationPreviewEvidenceStore,
} from "../../../../adapters/compile/admission/file-technical-compilation-preview-evidence-store.ts";
import {
  INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
} from "../../../../adapters/compile/admission/fixed-technical-compilation-profile-catalog-provider.ts";
import { QualifiedBuild123dSourceAnalyzer } from "../../../../adapters/cad/source/qualified-build123d-source-analyzer.ts";
import { FileByteStore } from "../../../../adapters/shared/cas/file-byte-store.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSysmlAnchor,
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  type TechnicalCompilationResult,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import { fingerprintSourceAnalysisBundle } from "../../../../domain/compile/source/source-analysis.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type {
  ProjectTechnicalCompilationPreviewResult,
} from "../../../ports/in/compile/admission/project-technical-compilation-preview.ts";
import {
  BoundedTechnicalCompilationPreview,
  ReadTechnicalCompilationPreviewEvidence,
  summary,
  TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES,
  TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_BYTES,
} from "./bounded-technical-compilation-preview.ts";

Deno.test("preview evidence store has an exact deterministic round trip and fails closed", async () => {
  await withStore(async ({ store, directory }) => {
    const result = await previewFixture("ready-for-review");
    if (result.status !== "ready-for-review") {
      throw new Error("Expected ready fixture.");
    }
    const evidence = {
      schemaVersion: "technical-compilation-preview-evidence/1.0" as const,
      projectId: "project.preview",
      result,
    };
    const first = await store.save(evidence);
    const second = await store.save(structuredClone(evidence));
    assertEquals(second, first);
    assertEquals(await store.read(first), evidence);
    await assertRejects(
      () =>
        store.save({
          ...evidence,
          result: {
            ...result,
            fingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
          },
        }),
      TypeError,
      "fingerprint",
    );
    await assertRejects(
      () =>
        store.save({
          ...evidence,
          result: {
            ...result,
            operation: { ...result.operation, version: "forged" } as never,
          },
        }),
      TypeError,
      "operation",
    );
    const unresolved = await previewFixture("unresolved");
    const unresolvedEvidence = {
      schemaVersion: "technical-compilation-preview-evidence/1.0" as const,
      projectId: "project.preview",
      result: unresolved,
    };
    assertEquals(
      await store.read(await store.save(unresolvedEvidence)),
      unresolvedEvidence,
    );
    await assertRejects(
      () =>
        store.save(
          {
            ...unresolvedEvidence,
            result: { ...unresolved, draft: result.draft },
          } as never,
        ),
      TypeError,
      "Non-ready",
    );
    assertEquals(
      await store.read({
        ...first,
        fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      }),
      undefined,
    );
    await assertRejects(
      () => store.read({ ...first, projectId: "project.foreign" }),
      TypeError,
      "foreign or corrupt",
    );
    const original = await Deno.readTextFile(
      `${directory}/${first.fingerprint.digest}`,
    );
    await Deno.writeTextFile(`${directory}/${first.fingerprint.digest}`, "{bad");
    await assertRejects(() => store.read(first), Error);
    await Deno.writeTextFile(
      `${directory}/${first.fingerprint.digest}`,
      original.replace("fixture", "forged"),
    );
    await assertRejects(() => store.read(first), Error);
  });
});

Deno.test("bounded summaries cover every preview state, omit evidence recursively, and stay below 8KiB", async () => {
  await withStore(async ({ store }) => {
    for (const status of ["unresolved", "rejected", "ready-for-review"] as const) {
      const result = await previewFixture(status, { sourceText: largeUnicodeSource() });
      const bounded = new BoundedTechnicalCompilationPreview({
        execute: () => Promise.resolve(result),
      }, store);
      const value = await bounded.execute({ projectId: "ignored" });
      assertEquals(value.status, status);
      assertEquals(
        new TextEncoder().encode(deterministicJson(value)).byteLength <=
          TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_BYTES,
        true,
      );
      assertEquals(hasForbiddenKey(value), false);
      assertEquals(
        value.samples.omittedDiagnostics,
        Math.max(0, value.counts.diagnostics - value.samples.diagnostics.length),
      );
      assertEquals(
        value.samples.omittedGaps,
        Math.max(0, value.counts.gaps - value.samples.gaps.length),
      );
      assertEquals(
        value.counts.diagnosticsByCode,
        countByCode(result.document.diagnostics),
      );
      assertEquals(value.counts.gapsByCode, countByCode(result.gaps));
      assertEquals(value.requiresFullEvidenceForMrtr, status === "ready-for-review");
    }
    const ready = await previewFixture("ready-for-review");
    const dense = {
      ...ready,
      document: {
        ...ready.document,
        diagnostics: Array.from({ length: 17 }, (_, index) => ({
          code: `diagnostic.${index % 2}`,
          sourceText: largeUnicodeSource(),
        })),
      },
      gaps: Array.from({ length: 15 }, (_, index) => ({
        code: `gap.${index % 3}`,
        nested: { operation: "must-not-leak", decisionParameters: [index] },
      })),
    } as unknown as ProjectTechnicalCompilationPreviewResult;
    const denseSummary = summary(dense, {
      schemaVersion: "technical-compilation-preview-evidence-reference/1.0",
      projectId: "project.preview",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      byteCount: 1,
    });
    assertEquals(denseSummary.samples.omittedDiagnostics, 9);
    assertEquals(denseSummary.samples.omittedGaps, 7);
    assertEquals(denseSummary.counts.diagnosticsByCode, {
      "diagnostic.0": 9,
      "diagnostic.1": 8,
    });
    assertEquals(denseSummary.counts.gapsByCode, {
      "gap.0": 5,
      "gap.1": 5,
      "gap.2": 5,
    });
    assertEquals(hasForbiddenKey(denseSummary), false);
  });
});

Deno.test("evidence details paginate exact Unicode source text and refuse altered cursors", async () => {
  await withStore(async ({ store }) => {
    const result = await previewFixture("ready-for-review", {
      sourceText: largeUnicodeSource(),
    });
    const ref = await store.save({
      schemaVersion: "technical-compilation-preview-evidence/1.0",
      projectId: "project.preview",
      result,
    });
    const reader = new ReadTechnicalCompilationPreviewEvidence(store);
    const chunks: unknown[] = [];
    let cursor: string | undefined;
    do {
      const page = await reader.execute({
        projectId: "project.preview",
        evidenceRef: ref,
        section: "source-text",
        ...(cursor ? { cursor } : {}),
      });
      assertEquals(
        new TextEncoder().encode(deterministicJson(page)).byteLength <=
          TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES,
        true,
      );
      chunks.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const source = result.document.inputManifest.sources[0];
    assertEquals(
      chunks.map((item) => (item as { text: string }).text).join(""),
      source.sourceText,
    );
    assertEquals(
      chunks.every((item) =>
        new TextEncoder().encode((item as { text: string }).text).byteLength <= 1000
      ),
      true,
    );

    const first = await reader.execute({
      projectId: "project.preview",
      evidenceRef: ref,
      section: "source-text",
    });
    const validCursor = first.nextCursor!;
    const altered = `${validCursor.slice(0, -1)}${
      validCursor.endsWith("A") ? "B" : "A"
    }`;
    await assertRejects(
      () =>
        reader.execute({
          projectId: "project.preview",
          evidenceRef: ref,
          section: "source-text",
          cursor: altered,
        }),
      TypeError,
      "invalid or foreign",
    );
    await assertRejects(
      () =>
        reader.execute({
          projectId: "project.foreign",
          evidenceRef: ref,
          section: "source-text",
          cursor: validCursor,
        }),
      TypeError,
      "unavailable or foreign",
    );
    await assertRejects(
      () =>
        reader.execute({
          projectId: "project.preview",
          evidenceRef: ref,
          section: "diagnostics",
          cursor: validCursor,
        }),
      TypeError,
      "invalid or foreign",
    );
  });
});

Deno.test("MRTR-only detail sections are verbatim and full evidence remains explicit", async () => {
  await withStore(async ({ store }) => {
    const result = await previewFixture("ready-for-review");
    if (result.status !== "ready-for-review") {
      throw new Error("Expected ready fixture.");
    }
    const ref = await store.save({
      schemaVersion: "technical-compilation-preview-evidence/1.0",
      projectId: "project.preview",
      result,
    });
    const reader = new ReadTechnicalCompilationPreviewEvidence(store);
    assertEquals(
      (await reader.execute({
        projectId: "project.preview",
        evidenceRef: ref,
        section: "decision-parameters",
      })).items,
      result.decisionParameters,
    );
    assertEquals(
      (await reader.execute({
        projectId: "project.preview",
        evidenceRef: ref,
        section: "operation",
      })).items,
      [result.operation],
    );
    const manifest = await reader.execute({
      projectId: "project.preview",
      evidenceRef: ref,
      section: "source-manifest",
    });
    assertEquals(hasForbiddenKey(manifest), false);
    assertEquals(
      (await reader.execute({
        projectId: "project.preview",
        evidenceRef: ref,
        section: "full-evidence",
      })).items,
      [result],
    );
    const large = await previewFixture("ready-for-review", {
      sourceText: largeUnicodeSource(),
    });
    const largeRef = await store.save({
      schemaVersion: "technical-compilation-preview-evidence/1.0",
      projectId: "project.preview",
      result: large,
    });
    const full = await reader.execute({
      projectId: "project.preview",
      evidenceRef: largeRef,
      section: "full-evidence",
    });
    assertEquals(
      new TextEncoder().encode(deterministicJson(full)).byteLength >
        TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES,
      true,
    );
    assertEquals(full.items, [large]);
  });
});

async function withStore(
  run: (
    value: { store: FileTechnicalCompilationPreviewEvidenceStore; directory: string },
  ) => Promise<void>,
) {
  const directory = await Deno.makeTempDir({
    prefix: "bounded-technical-compilation-preview-",
  });
  try {
    await run({
      directory,
      store: new FileTechnicalCompilationPreviewEvidenceStore(
        new FileByteStore({
          kind: "technical-compilation-preview-evidence",
          directory,
          uriNamespace: "technical-compilation-preview-evidence-test",
          label: "technical compilation preview evidence test",
        }),
      ),
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function previewFixture(
  status: "unresolved" | "rejected" | "ready-for-review",
  options: { sourceText?: string } = {},
): Promise<ProjectTechnicalCompilationPreviewResult> {
  const sourceText = options.sourceText ??
    "from build123d import Box\nthickness = 2\nresult = Box(20, 10, thickness)\n";
  const fingerprint = await sourceFingerprint(sourceText);
  const sourceId = `technical-unit:${fingerprint.digest}`;
  const analyzed = await new QualifiedBuild123dSourceAnalyzer().analyze({
    sourceId,
    role: "cad-script",
    language: "python",
    sourceText,
  });
  const analysis = status === "rejected"
    ? {
      ...analyzed,
      policy: {
        ...analyzed.policy,
        status: "rejected" as const,
        findings: [{
          id: "fixture.rejected",
          code: "fixture.rejected",
          severity: "error" as const,
          message: "fixture",
        }],
      },
    }
    : analyzed;
  const provenance = {
    artifactId: "artifact.preview",
    artifactFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
    captureId: "capture.preview",
  };
  const anchor = {
    artifactId: provenance.artifactId,
    captureId: provenance.captureId,
    editingContextId: "context.preview",
    artifactFingerprint: provenance.artifactFingerprint,
    rootElementId: "sysml.root",
    rootElementKind: "Package" as const,
    elements: [
      { id: "sysml.root", kind: "Package" as const, provenance },
      ...analysis.symbols.map((symbol, index) => ({
        id: `sysml.${index}`,
        kind: symbol.kind === "artifact"
          ? "PartUsage" as const
          : "AttributeUsage" as const,
        provenance,
      })),
    ],
  };
  const basis = {
    thread: {
      projectId: "project.preview",
      subjectId: "subject.preview",
      snapshotId: "snapshot.preview",
      revision: 1,
      snapshotFingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
    },
    sysmlAnchor: anchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(anchor),
  };
  const compiled: TechnicalCompilationResult = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{
      sourceText,
      analysis,
      analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
      effectiveUnit: {
        kind: "authored-root",
        closureKind: "root-only",
        unitId: sourceId,
        closureFingerprint: fingerprint,
        scriptFingerprint: fingerprint,
      },
    }],
    bindings: status === "unresolved" ? [] : analysis.symbols.map((symbol, index) => ({
      id: `binding.${index}`,
      sourceId,
      sourceSymbolId: symbol.id,
      sysmlElementId: `sysml.${index}`,
      sysmlElementKind: symbol.kind === "artifact" ? "PartUsage" : "AttributeUsage",
      relation: symbol.kind === "artifact"
        ? "represents" as const
        : "parameterizes" as const,
    })),
    profileRequests: [{
      profileId: "build123d-closed-subset-v1",
      profileVersion: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      sourceIds: [sourceId],
    }],
  }, INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG);
  if (compiled.document.status !== status) {
    throw new Error(`Fixture expected ${status}, got ${compiled.document.status}.`);
  }
  const base = {
    document: compiled.document,
    fingerprint: compiled.fingerprint,
    gaps: [],
  };
  return status === "ready-for-review"
    ? {
      ...base,
      status,
      draft: {
        schemaVersion: "technical-compilation-draft-reference/1.0",
        draftId: "technical-compilation:project.preview:fixture",
        projectId: "project.preview",
        documentFingerprint: compiled.fingerprint,
        envelopeFingerprint: compiled.fingerprint,
      },
      decisionParameters: [{
        key: "compile.fixture",
        label: "Fixture",
        value: "verbatim",
      }] as never,
      operation: {
        id: "compile.seal-admission",
        version: "3",
        bindings: [{
          name: "sysmlModel",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: basis.thread.snapshotId,
              snapshotRevision: basis.thread.revision,
              kind: "artifact",
              id: anchor.artifactId,
            },
          },
        }],
      } as never,
    }
    : { ...base, status };
}

function largeUnicodeSource() {
  return `from build123d import Box\nthickness = 2\n# ${
    "🦾é".repeat(7_000)
  }\nresult = Box(20, 10, thickness)\n`;
}
async function sourceFingerprint(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256" as const,
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}
function countByCode(items: readonly unknown[]) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const code = typeof (item as { code?: unknown }).code === "string"
      ? (item as { code: string }).code
      : "unknown";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}
function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    ["document", "sourcetext", "decisionparameters", "operation"].includes(
      key.toLowerCase(),
    ) || hasForbiddenKey(child)
  );
}
