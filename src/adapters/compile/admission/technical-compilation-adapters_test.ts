import {
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
  type TechnicalCompilationDraft,
  type TechnicalCompilationDraftReference,
} from "../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSysmlAnchor,
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  type TechnicalCompilationResult,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  deriveTechnicalCompilationProfileRequests,
} from "../../../domain/compile/admission/technical-compilation-join.ts";
import type { SourceAnalysisBundle } from "../../../domain/compile/source/source-analysis.ts";
import {
  fingerprintSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
  QualifiedBuild123dSourceAnalyzer,
} from "../../cad/source/qualified-build123d-source-analyzer.ts";
import {
  FixedTechnicalSourceAnalysisProfileRegistry,
  TechnicalSourceAnalysisCaptureService,
} from "../captures/technical-source-analysis-capture.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import {
  CaptureBackedTechnicalCompilationSourceReader,
} from "./capture-backed-technical-compilation-source-reader.ts";
import {
  FileTechnicalCompilationDraftStore,
} from "./file-technical-compilation-draft-store.ts";
import {
  FixedTechnicalCompilationProfileCatalogProvider,
  INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
} from "./fixed-technical-compilation-profile-catalog-provider.ts";

const SOURCE_TEXT = [
  "from build123d import Box",
  "length = 20",
  "width = 10",
  "height = 2",
  "result = Box(length, width, height)",
  "",
].join("\n");

const THREAD_BASIS = {
  kind: "thread-snapshot" as const,
  snapshotId: "snapshot.1",
  revision: 1,
  subjectId: "subject.support",
};

Deno.test("capture-backed source reader reopens exact bytes and externally fingerprints analysis", async () => {
  await withCaptureHarness(async ({ service }) => {
    const reference = await service.capture({
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      sourceId: "source.support",
      sourceText: SOURCE_TEXT,
    });
    const referenceFingerprint = await sha256Fingerprint(reference);
    const opaqueReference = structuredClone(reference) as unknown as Readonly<
      Record<string, unknown>
    >;
    const reader = new CaptureBackedTechnicalCompilationSourceReader(service);
    const reopened = await reader.read({
      projectId: "project.support",
      basis: THREAD_BASIS,
      reference: opaqueReference,
      referenceFingerprint,
    });

    assertEquals(reopened.referenceFingerprint, referenceFingerprint);
    assertEquals(reopened.source.sourceText, SOURCE_TEXT);
    assertEquals(
      reopened.source.analysisFingerprint,
      await fingerprintSourceAnalysisBundle(reopened.source.analysis),
    );
    assertEquals(
      reopened.source.analysis.analyzer,
      {
        id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
        version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
      },
    );
    assertEquals(reopened.provenance, {
      profile: reference.profile,
      analyzer: reference.analysis.analyzer,
      sourceFingerprint: reopened.source.analysis.source.fingerprint,
      captureFingerprint: referenceFingerprint,
      analysisFingerprint: reopened.source.analysisFingerprint,
    });
  });
});

Deno.test("capture-backed source reader rejects reference drift and non-exact context", async () => {
  await withCaptureHarness(async ({ service }) => {
    const reference = await service.capture({
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      sourceId: "source.support",
      sourceText: SOURCE_TEXT,
    });
    const reader = new CaptureBackedTechnicalCompilationSourceReader(service);
    const opaqueReference = structuredClone(reference) as unknown as Readonly<
      Record<string, unknown>
    >;

    await assertRejects(
      () =>
        reader.read({
          projectId: "project.support",
          basis: THREAD_BASIS,
          reference: opaqueReference,
          referenceFingerprint: {
            algorithm: "sha256",
            digest: "f".repeat(64),
          },
        }),
      TypeError,
      "fingerprint",
    );

    const tampered = {
      ...structuredClone(reference),
      source: {
        ...structuredClone(reference.source),
        byteCount: reference.source.byteCount + 1,
      },
    };
    const tamperedFingerprint = await sha256Fingerprint(tampered);
    await assertRejects(
      () =>
        reader.read({
          projectId: "project.support",
          basis: THREAD_BASIS,
          reference: tampered as unknown as Readonly<Record<string, unknown>>,
          referenceFingerprint: tamperedFingerprint,
        }),
      Error,
    );

    const tamperedProfile = {
      ...structuredClone(reference),
      profile: {
        ...structuredClone(reference.profile),
        fingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
      },
    };
    const tamperedProfileFingerprint = await sha256Fingerprint(tamperedProfile);
    await assertRejects(
      () =>
        reader.read({
          projectId: "project.support",
          basis: THREAD_BASIS,
          reference: tamperedProfile as unknown as Readonly<Record<string, unknown>>,
          referenceFingerprint: tamperedProfileFingerprint,
        }),
      Error,
      "profile",
    );

    const exactFingerprint = await sha256Fingerprint(opaqueReference);
    await assertRejects(
      () =>
        reader.read({
          projectId: "project.support",
          basis: { ...THREAD_BASIS, snapshotId: "latest" },
          reference: opaqueReference,
          referenceFingerprint: exactFingerprint,
        }),
      TypeError,
      "exact snapshot",
    );
  });
});

Deno.test("fixed catalogue exposes only the registered build123d, Modelica v2 and SPICE v1 frontends", async () => {
  const provider = new FixedTechnicalCompilationProfileCatalogProvider();
  const first = await provider.get();
  const second = await provider.get();
  assertNotStrictEquals(first, second);
  assertEquals(first, INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG);
  assertEquals(first.profiles.length, 3);
  assertEquals(first.profiles[0].target, "build123d-source");
  assertEquals(first.profiles[0].analyzer, {
    id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
    version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
  });
  assertEquals(first.profiles[1].target, "modelica-source-qualification");
  assertEquals(first.profiles[1].id, "modelica-closed-subset-v2");
  assertEquals(first.profiles[1].version, "2.0.0");
  assertEquals(first.profiles[1].analyzer, {
    id: "modelica-qualified-mo-subset",
    version: "2.0.0",
  });
  assertEquals(first.profiles[1].requiredBindingSymbolKinds, [
    "parameter",
  ]);
  assertEquals(first.profiles[2].target, "spice-circuit-source");
  assertEquals(first.profiles[2].id, "spice-circuit-closed-subset-v1");
  assertEquals(first.profiles[2].version, "1.0.0");
  assertEquals(first.profiles[2].analyzer, {
    id: "spice-circuit-closed-subset",
    version: "1.0.0",
  });
  assertEquals(first.profiles[2].requiredBindingSymbolKinds, ["parameter"]);
  assertEquals(Object.isFrozen(first), true);
  assertEquals(Object.isFrozen(first.profiles[0]), true);
  assertThrows(
    () => new FixedTechnicalCompilationProfileCatalogProvider({ profiles: [] }),
    TypeError,
  );
  assertEquals(
    deriveTechnicalCompilationProfileRequests(
      [{
        sourceText: "Vin in 0 5\nRload in 0 1k\n",
        analysis: {
          schemaVersion: "source-analysis/1.0",
          source: {
            id: "source.spice",
            role: "spice-circuit",
            language: "spice",
            fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
          },
          analyzer: {
            id: "spice-circuit-closed-subset",
            version: "1.0.0",
          },
          policy: {
            profile: "spice-circuit-closed-subset-v1",
            status: "passed",
            findings: [],
          },
          symbols: [],
          dependencies: [],
          unresolvedConstructs: [],
        } satisfies SourceAnalysisBundle,
      }],
      first,
    ),
    [{
      profileId: "spice-circuit-closed-subset-v1",
      profileVersion: "1.0.0",
      sourceIds: ["source.spice"],
    }],
  );
});

Deno.test("profile-2 admission accepts every qualified finite decimal spelling", async () => {
  for (const literal of ["1_000", ".5", "+1", "1e-3"]) {
    const compiled = await compileFixture(
      `from build123d import Box\nthickness = ${literal}\nresult = Box(20, 10, thickness)\n`,
    );
    assertEquals(compiled.document.status, "ready-for-review", literal);
  }
});

Deno.test("file draft store is deterministic, project-scoped, and hides its CAS URI", async () => {
  await withDraftHarness(async ({ store, compiled }) => {
    const draft = await draftFrom(compiled);
    const reference = await referenceFor(draft);
    assertEquals(await store.save(reference, draft), reference);
    assertEquals(await store.save(reference, draft), reference);
    assertEquals(await store.read(reference), draft);
    assertEquals(recursiveKeys(reference).has("uri"), false);
    assertEquals(recursiveKeys(reference).has("path"), false);
  });
});

Deno.test("file draft store rejects tampered references and cross-project replay", async () => {
  await withDraftHarness(async ({ store, compiled }) => {
    const draft = await draftFrom(compiled);
    const reference = await referenceFor(draft);

    const foreignProject = {
      ...reference,
      projectId: "project.foreign",
      draftId:
        `technical-compilation:project.foreign:${reference.documentFingerprint.digest}`,
    };
    await assertRejects(
      () => store.save(foreignProject, draft),
      TypeError,
      "reference",
    );

    const foreignDocument = {
      ...reference,
      documentFingerprint: {
        algorithm: "sha256" as const,
        digest: "e".repeat(64),
      },
      draftId: `technical-compilation:${reference.projectId}:${"e".repeat(64)}`,
    };
    await assertRejects(
      () => store.save(foreignDocument, draft),
      TypeError,
      "reference",
    );

    await assertRejects(
      () =>
        store.read({
          ...reference,
          envelopeFingerprint: {
            algorithm: "sha256",
            digest: "d".repeat(64),
          },
        }).then((value) => {
          if (value === undefined) throw new TypeError("tampered reference absent");
          return value;
        }),
      TypeError,
      "tampered reference absent",
    );
  });
});

Deno.test("file draft store rejects drift, omission, and duplication in source capture lineage", async () => {
  await withDraftHarness(async ({ store, compiled }) => {
    const draft = await draftFrom(compiled);
    const driftedDraft = {
      ...draft,
      sourceCaptures: [{
        ...draft.sourceCaptures[0],
        reference: {
          ...draft.sourceCaptures[0].reference,
          captureId: "capture.forged",
        },
      }],
    };
    const driftedReference = await referenceFor(driftedDraft);
    await assertRejects(
      () => store.save(driftedReference, driftedDraft),
      TypeError,
      "fingerprint",
    );

    const omittedDraft = { ...draft, sourceCaptures: [] };
    const omittedReference = await referenceFor(omittedDraft);
    await assertRejects(
      () => store.save(omittedReference, omittedDraft),
      TypeError,
      "cover",
    );

    const duplicateDraft = {
      ...draft,
      sourceCaptures: [
        draft.sourceCaptures[0],
        structuredClone(draft.sourceCaptures[0]),
      ],
    };
    const duplicateReference = await referenceFor(duplicateDraft);
    await assertRejects(
      () => store.save(duplicateReference, duplicateDraft),
      TypeError,
      "duplicates",
    );
  });
});

Deno.test("file draft reference supports the full safe project-id bound", async () => {
  await withDraftHarness(async ({ store }) => {
    const projectId = `p${"a".repeat(255)}`;
    const documentFingerprint = {
      algorithm: "sha256" as const,
      digest: "a".repeat(64),
    };
    const reference: TechnicalCompilationDraftReference = {
      schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
      projectId,
      documentFingerprint,
      envelopeFingerprint: {
        algorithm: "sha256",
        digest: "b".repeat(64),
      },
      draftId: `technical-compilation:${projectId}:${documentFingerprint.digest}`,
    };
    assertEquals(await store.read(reference), undefined);
  });
});

Deno.test("file draft store detects altered CAS bytes and refuses non-ready documents", async () => {
  await withDraftHarness(async ({ store, directory, compiled }) => {
    const draft = await draftFrom(compiled);
    const reference = await referenceFor(draft);
    await store.save(reference, draft);
    await Deno.writeTextFile(
      `${directory}/${reference.envelopeFingerprint.digest}`,
      "{}",
    );
    await assertRejects(() => store.read(reference), Error, "sha256");
  });

  await withDraftHarness(async ({ store, compiled }) => {
    const readyDraft = await draftFrom(compiled);
    const unresolvedDocument = {
      ...compiled.document,
      status: "unresolved" as const,
    };
    const unresolvedFingerprint = await sha256Fingerprint(unresolvedDocument);
    const draft: TechnicalCompilationDraft = {
      projectId: compiled.document.basis.thread.projectId,
      document: unresolvedDocument,
      fingerprint: unresolvedFingerprint,
      sourceCaptures: readyDraft.sourceCaptures,
    };
    const reference = await referenceFor(draft);
    await assertRejects(
      () => store.save(reference, draft),
      TypeError,
    );
  });
});

async function withCaptureHarness(
  run: (harness: {
    readonly service: TechnicalSourceAnalysisCaptureService;
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({
    prefix: "technical-compilation-source-reader-",
  });
  try {
    const service = new TechnicalSourceAnalysisCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "technical-source",
        directory: `${directory}/source`,
        uriNamespace: "technical-compilation-source-test",
        label: "technical source test",
      }),
      analysisCaptures: new FileByteStore({
        kind: "technical-source-analysis",
        directory: `${directory}/analysis`,
        uriNamespace: "technical-compilation-analysis-test",
        label: "technical source analysis test",
      }),
      profiles: new FixedTechnicalSourceAnalysisProfileRegistry([{
        profile: {
          id: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
          version: "1.0.0",
          role: "cad-script",
          language: "python",
          analyzer: {
            id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
            version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
          },
          maxSourceBytes: 262_144,
        },
        frontend: new QualifiedBuild123dSourceAnalyzer(),
      }]),
    });
    await run({ service });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function withDraftHarness(
  run: (harness: {
    readonly store: FileTechnicalCompilationDraftStore;
    readonly directory: string;
    readonly compiled: TechnicalCompilationResult;
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({
    prefix: "technical-compilation-draft-store-",
  });
  try {
    const store = new FileTechnicalCompilationDraftStore(
      new FileByteStore({
        kind: "technical-compilation-draft",
        directory,
        uriNamespace: "technical-compilation-draft-test",
        label: "technical compilation draft test",
      }),
    );
    await run({ store, directory, compiled: await compileFixture() });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function compileFixture(
  sourceText = SOURCE_TEXT,
): Promise<TechnicalCompilationResult> {
  const analysis = await new QualifiedBuild123dSourceAnalyzer().analyze({
    sourceId: "source.support",
    role: "cad-script",
    language: "python",
    sourceText,
  });
  const sysmlArtifactFingerprint = {
    algorithm: "sha256" as const,
    digest: "2".repeat(64),
  };
  const sysmlProvenance = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlArtifactFingerprint,
    captureId: "capture.syson",
  };
  const sysmlAnchor = {
    artifactId: "artifact.sysml",
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    artifactFingerprint: sysmlArtifactFingerprint,
    rootElementId: "sysml.root.package",
    rootElementKind: "Package" as const,
    elements: [
      { id: "sysml.root.package", kind: "Package", provenance: sysmlProvenance },
      ...analysis.symbols.map((symbol, index) => ({
        id: `sysml.element.${index}`,
        kind: symbol.kind === "artifact" ? "PartUsage" : "AttributeUsage",
        provenance: sysmlProvenance,
      })),
    ],
  };
  const basis = {
    thread: {
      projectId: "project.support",
      subjectId: THREAD_BASIS.subjectId,
      snapshotId: THREAD_BASIS.snapshotId,
      revision: THREAD_BASIS.revision,
      snapshotFingerprint: {
        algorithm: "sha256" as const,
        digest: "1".repeat(64),
      },
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  return await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{
      sourceText,
      analysis,
      analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
    }],
    bindings: analysis.symbols.map((symbol, index) => ({
      id: `binding.${index}`,
      sourceId: analysis.source.id,
      sourceSymbolId: symbol.id,
      sysmlElementId: sysmlAnchor.elements[index + 1].id,
      sysmlElementKind: sysmlAnchor.elements[index + 1].kind,
      relation: symbol.kind === "artifact" ? "represents" : "parameterizes",
    })),
    profileRequests: [{
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      profileVersion: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      sourceIds: [analysis.source.id],
    }],
  }, INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG);
}

async function draftFrom(
  compiled: TechnicalCompilationResult,
): Promise<TechnicalCompilationDraft> {
  if (compiled.document.status !== "ready-for-review") {
    throw new Error(`Fixture unexpectedly compiled as ${compiled.document.status}.`);
  }
  const sourceId = compiled.document.inputManifest.sources[0].analysis.source.id;
  const reference = {
    schemaVersion: "test-source-reference/1.0",
    sourceId,
  };
  return {
    projectId: compiled.document.basis.thread.projectId,
    document: compiled.document,
    fingerprint: compiled.fingerprint,
    sourceCaptures: [{
      sourceId,
      reference,
      referenceFingerprint: await sha256Fingerprint(reference),
    }],
  };
}

async function referenceFor(
  draft: TechnicalCompilationDraft,
): Promise<TechnicalCompilationDraftReference> {
  return {
    schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    draftId: `technical-compilation:${draft.projectId}:${draft.fingerprint.digest}`,
    projectId: draft.projectId,
    documentFingerprint: draft.fingerprint,
    envelopeFingerprint: await sha256Fingerprint(draft),
  };
}

function recursiveKeys(value: unknown, seen = new Set<unknown>()): Set<string> {
  const keys = new Set<string>();
  if (value === null || typeof value !== "object" || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key.toLowerCase());
    for (const child of recursiveKeys(nested, seen)) keys.add(child);
  }
  return keys;
}
