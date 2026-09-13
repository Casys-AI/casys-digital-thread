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
import {
  deterministicJson,
  sha256Hex,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import { assembleTechnicalCompilationAdmissionOperation } from "../../../../domain/compile/admission/technical-compilation-admission-operation.ts";
import { sampleAdmissionSourceWorkspaceFields } from "../../../../testing/technical-source-capture-test-support.ts";
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
    const arbitraryParameter = result.decisionParameters.map((parameter) =>
      parameter.key === "compile.admission.basis.thread.revision"
        ? { ...parameter, value: 2 }
        : parameter
    );
    await assertRejects(
      () =>
        store.save({
          ...evidence,
          result: { ...result, decisionParameters: arbitraryParameter },
        }),
      TypeError,
      "document",
    );
    await assertRejects(
      () =>
        store.save({
          ...evidence,
          result: {
            ...result,
            gaps: [{ code: "source.no-named-numeric-lever" }],
          } as never,
        }),
      TypeError,
      "technicalCompilationJoinGaps",
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
      original.replace("project.preview", "project.forged"),
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
    const denseSummary = await summary(dense, {
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

Deno.test("summary excerpts preserve Unicode boundaries, exact digests, and reduce samples", async () => {
  const result = await previewFixture("ready-for-review");
  const enormous = "🦾é".repeat(10_000);
  const dense = {
    ...result,
    document: {
      ...result.document,
      diagnostics: Array.from({ length: 9 }, () => ({
        code: "source.profile-incompatible",
        profileRef: enormous,
        subjectRef: enormous,
      })),
    },
    gaps: Array.from({ length: 9 }, () => ({
      code: "source.no-named-numeric-lever",
      sourceId: enormous,
      recovery: enormous,
    })),
  } as unknown as ProjectTechnicalCompilationPreviewResult;
  const out = await summary(dense, {
    schemaVersion: "technical-compilation-preview-evidence-reference/1.0",
    projectId: "project.preview",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    byteCount: 1,
  });
  assertEquals(
    summaryByteCount(out) <= TECHNICAL_COMPILATION_PREVIEW_SUMMARY_MAX_BYTES,
    true,
  );
  assertEquals(out.samples.omittedDiagnostics > 1 || out.samples.omittedGaps > 1, true);
  const excerpt = (out.samples.diagnostics[0] as Record<string, unknown>)
    .profileRef as {
      excerpt: string;
      originalByteCount: number;
      sha256: string;
      truncatedBytes: number;
    };
  assertEquals(new TextEncoder().encode(excerpt.excerpt).byteLength <= 256, true);
  assertEquals(excerpt.excerpt.endsWith("\ud83d"), false);
  assertEquals(
    excerpt.originalByteCount,
    new TextEncoder().encode(enormous).byteLength,
  );
  assertEquals(excerpt.sha256, await sha256Hex(new TextEncoder().encode(enormous)));
  assertEquals(
    excerpt.truncatedBytes,
    excerpt.originalByteCount - new TextEncoder().encode(excerpt.excerpt).byteLength,
  );
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
    const reconstructedReader = new ReadTechnicalCompilationPreviewEvidence(store);
    assertEquals(
      (await reconstructedReader.execute({
        projectId: "project.preview",
        evidenceRef: ref,
        section: "source-text",
        cursor: validCursor,
      })).items.length > 0,
      true,
    );
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
    const parameterItems: unknown[] = [];
    let parameterCursor: string | undefined;
    do {
      const parameters = await reader.execute({
        projectId: "project.preview",
        evidenceRef: ref,
        section: "decision-parameters",
        ...(parameterCursor ? { cursor: parameterCursor } : {}),
      });
      parameterItems.push(...parameters.items);
      parameterCursor = parameters.nextCursor ?? undefined;
    } while (parameterCursor);
    assertEquals(parameterItems, [...result.decisionParameters]);
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
    assertEquals("bindingIds" in (manifest.items[0] as Record<string, unknown>), false);
    assertEquals(
      (manifest.items[0] as { counts: { bindings: number } }).counts.bindings,
      result.document.inputManifest.bindings.length,
    );
    const dense = structuredClone(result);
    asRecord(asRecord(dense.document, "document").inputManifest, "inputManifest")
      .bindings = Array.from({ length: 256 }, (_, index) => ({
        ...result.document.inputManifest.bindings[0],
        id: `binding.${index}.${"x".repeat(240)}`,
      }));
    const denseReader = new ReadTechnicalCompilationPreviewEvidence({
      read: () =>
        Promise.resolve({
          schemaVersion: "technical-compilation-preview-evidence/1.0",
          projectId: "project.preview",
          result: dense,
        }),
      save: () => Promise.reject(new Error("not used")),
      saveCursor: () => Promise.resolve("a".repeat(64)),
      readCursor: () => Promise.resolve(undefined),
    });
    const densePage = await denseReader.execute({
      projectId: "project.preview",
      evidenceRef: ref,
      section: "source-manifest",
    });
    assertEquals(
      new TextEncoder().encode(deterministicJson(densePage)).byteLength <=
        TECHNICAL_COMPILATION_PREVIEW_DETAIL_MAX_BYTES,
      true,
    );
    assertEquals(
      (densePage.items[0] as { counts: { bindings: number } }).counts.bindings,
      256,
    );
    assertEquals(
      "bindingIds" in (densePage.items[0] as Record<string, unknown>),
      false,
    );
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
  if (status !== "ready-for-review") return { ...base, status };
  const source = compiled.document.inputManifest.sources[0];
  const projection = compiled.document.projections[0];
  const workspace = sampleAdmissionSourceWorkspaceFields(sourceId, {
    projectId: basis.thread.projectId,
  });
  const sourceClosure = {
    ...workspace.sourceClosure,
    fingerprint,
  };
  const admission = parseTechnicalCompilationAdmissionParameters(
    encodeTechnicalCompilationAdmissionParameters({
      schemaVersion: "technical-compilation-admission/4.0",
      draft: {
        draftId:
          `technical-compilation:${basis.thread.projectId}:${compiled.fingerprint.digest}`,
        projectId: basis.thread.projectId,
        documentFingerprint: compiled.fingerprint,
        envelopeFingerprint: compiled.fingerprint,
      },
      basis: {
        fingerprint: compiled.document.basisFingerprint,
        thread: {
          projectId: basis.thread.projectId,
          subjectId: basis.thread.subjectId,
          snapshotId: basis.thread.snapshotId,
          revision: basis.thread.revision,
          fingerprint: basis.thread.snapshotFingerprint,
        },
        sysml: {
          artifactId: anchor.artifactId,
          artifactFingerprint: anchor.artifactFingerprint,
          captureId: anchor.captureId,
          editingContextId: anchor.editingContextId,
          rootElementId: anchor.rootElementId,
          rootElementKind: anchor.rootElementKind,
          anchorFingerprint: compiled.document.basis.sysmlAnchorFingerprint,
        },
      },
      sources: [{
        id: source.analysis.source.id,
        role: source.analysis.source.role,
        language: source.analysis.source.language,
        profileId: projection.profile.id,
        profileVersion: projection.profile.version,
        profileFingerprint: projection.profileFingerprint,
        analyzer: source.analysis.analyzer,
        sourceFingerprint: fingerprint,
        captureFingerprint: fingerprint,
        analysisFingerprint: source.analysisFingerprint,
        effectiveUnit: source.effectiveUnit,
        attachment: workspace.attachment,
        sourceClosure,
        locator: workspace.locator,
      }],
      bindings: compiled.document.inputManifest.bindings,
      compilationProfileRequests: [{
        profileId: projection.profile.id,
        profileVersion: projection.profile.version,
        target: projection.target,
        sourceIds: [sourceId],
        profileFingerprint: projection.profileFingerprint,
      }],
      compilation: { fingerprint: compiled.fingerprint, status: "ready-for-review" },
    }),
  );
  return {
    ...base,
    status,
    draft: {
      schemaVersion: "technical-compilation-draft-reference/1.0",
      ...admission.draft,
    },
    decisionParameters: encodeTechnicalCompilationAdmissionParameters(admission),
    operation: assembleTechnicalCompilationAdmissionOperation({
      basis: {
        kind: "thread-snapshot",
        snapshotId: admission.basis.thread.snapshotId,
        revision: admission.basis.thread.revision,
        subjectId: admission.basis.thread.subjectId,
      },
      sysmlArtifactId: admission.basis.sysml.artifactId,
    }),
  };
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
function summaryByteCount(value: unknown): number {
  return new TextEncoder().encode(deterministicJson(value)).byteLength;
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
function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
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
