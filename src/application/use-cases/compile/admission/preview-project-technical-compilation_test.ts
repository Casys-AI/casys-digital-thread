import { assert, assertEquals, assertRejects } from "@std/assert";
import type { TechnicalCompilationBasisResolver } from "../../../ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import type {
  TechnicalCompilationDraft,
  TechnicalCompilationDraftReference,
  TechnicalCompilationDraftStore,
} from "../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import type { TechnicalCompilationProfileCatalogProvider } from "../../../ports/out/compile/admission/technical-compilation-profile-catalog-provider.ts";
import type {
  ReopenedTechnicalCompilationSource,
  TechnicalCompilationSourceReader,
  TechnicalCompilationSourceReadRequest,
} from "../../../ports/out/compile/admission/technical-compilation-source-reader.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
} from "../../../../domain/compile/source/source-analysis.ts";
import {
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfileCatalog,
  type TechnicalCompilationSource,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_LIMITS,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import { TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY } from "../../../../domain/compile/admission/technical-compilation-preview-review.ts";
import { validateModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  sampleAdmissionSourceWorkspaceFields,
  sampleTechnicalSourceAnalysisCaptureLocator,
} from "../../../../testing/technical-source-capture-test-support.ts";
import {
  PreviewProjectTechnicalCompilation,
  ProjectTechnicalCompilationPreviewError,
} from "./preview-project-technical-compilation.ts";

const CAD_LOCATOR = sampleTechnicalSourceAnalysisCaptureLocator("c".repeat(64));
const SPICE_LOCATOR = sampleTechnicalSourceAnalysisCaptureLocator("d".repeat(64));
const MODELICA_LOCATOR = sampleTechnicalSourceAnalysisCaptureLocator(
  "e".repeat(64),
);
const SOURCE_CLOSURE_DIGEST = "d".repeat(64);
const TECHNICAL_UNIT_ID = `technical-unit:${SOURCE_CLOSURE_DIGEST}`;

interface Harness {
  readonly service: PreviewProjectTechnicalCompilation;
  readonly command: Record<string, unknown>;
  readonly basisResolver: FakeBasisResolver;
  readonly sourceReader: FakeSourceReader;
  readonly draftStore: FakeDraftStore;
}

class FakeBasisResolver implements TechnicalCompilationBasisResolver {
  calls = 0;
  failure?: Error;
  constructor(public result: TechnicalCompilationBasis | undefined) {}

  resolve(): Promise<TechnicalCompilationBasis | undefined> {
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.result);
  }
}

class FakeSourceReader implements TechnicalCompilationSourceReader {
  calls: TechnicalCompilationSourceReadRequest[] = [];
  missing = false;
  mismatchedReference = false;
  failure?: Error;
  provenanceTamper?: "analyzer" | "capture" | "profile";

  constructor(
    readonly source: TechnicalCompilationSource,
    readonly locator = CAD_LOCATOR,
  ) {}

  read(
    request: TechnicalCompilationSourceReadRequest,
  ): Promise<ReopenedTechnicalCompilationSource | undefined> {
    this.calls.push(request);
    if (this.failure) return Promise.reject(this.failure);
    if (this.missing) return Promise.resolve(undefined);
    if (
      request.reference.schemaVersion !== this.locator.schemaVersion ||
      request.reference.kind !== this.locator.kind ||
      request.reference.fingerprint.digest !== this.locator.fingerprint.digest ||
      request.reference.casUri !== this.locator.casUri
    ) {
      return Promise.resolve(undefined);
    }
    const provenance = {
      profile: {
        id: "source-profile.python",
        version: "1.0.0",
        fingerprint: {
          algorithm: "sha256" as const,
          digest: this.provenanceTamper === "profile" ? "NOT-A-DIGEST" : "3".repeat(64),
        },
      },
      analyzer: this.provenanceTamper === "analyzer"
        ? { ...this.source.analysis.analyzer, version: "forged" }
        : this.source.analysis.analyzer,
      sourceFingerprint: this.source.analysis.source.fingerprint,
      captureFingerprint: this.provenanceTamper === "capture"
        ? { algorithm: "sha256" as const, digest: "e".repeat(64) }
        : request.referenceFingerprint,
      analysisFingerprint: this.source.analysisFingerprint,
      effectiveUnit: this.source.effectiveUnit,
      ...sampleAdmissionSourceWorkspaceFields(this.source.analysis.source.id, {
        projectId: request.projectId,
      }),
      locator: request.reference,
      attachmentAlignment: "exact" as const,
    };
    return Promise.resolve({
      referenceFingerprint: this.mismatchedReference
        ? { algorithm: "sha256", digest: "f".repeat(64) }
        : request.referenceFingerprint,
      source: this.source,
      provenance,
    });
  }
}

class FakeCatalogProvider implements TechnicalCompilationProfileCatalogProvider {
  constructor(readonly catalog: TechnicalCompilationProfileCatalog) {}
  get(): Promise<TechnicalCompilationProfileCatalog> {
    return Promise.resolve(this.catalog);
  }
}

class FakeDraftStore implements TechnicalCompilationDraftStore {
  saves = 0;
  reads = 0;
  saved?: TechnicalCompilationDraft;
  reference?: TechnicalCompilationDraftReference;
  driftOnRead = false;
  sourceCaptureDriftOnRead = false;
  sourceCaptureMissingOnRead = false;
  wrongSaveReference = false;

  save(
    reference: TechnicalCompilationDraftReference,
    draft: TechnicalCompilationDraft,
  ): Promise<TechnicalCompilationDraftReference> {
    this.saves += 1;
    this.reference = structuredClone(reference);
    this.saved = structuredClone(draft);
    return Promise.resolve(
      this.wrongSaveReference
        ? { ...reference, draftId: "technical-compilation:foreign" }
        : reference,
    );
  }

  read(): Promise<TechnicalCompilationDraft | undefined> {
    this.reads += 1;
    if (!this.saved) return Promise.resolve(undefined);
    if (this.sourceCaptureMissingOnRead) {
      return Promise.resolve({ ...structuredClone(this.saved), sourceCaptures: [] });
    }
    if (this.sourceCaptureDriftOnRead) {
      const drifted = structuredClone(this.saved);
      const capture = drifted.sourceCaptures[0] as {
        reference: unknown;
      };
      capture.reference = sampleTechnicalSourceAnalysisCaptureLocator(
        "f".repeat(64),
      );
      return Promise.resolve(drifted);
    }
    if (!this.driftOnRead) return Promise.resolve(structuredClone(this.saved));
    return Promise.resolve({
      ...structuredClone(this.saved),
      document: {
        ...structuredClone(this.saved.document),
        status: "unresolved",
      },
    });
  }
}

async function harness(
  options: {
    readonly photo?: boolean;
    readonly unmatchedAttribute?: boolean;
    readonly unloweredClosure?: boolean;
  } = {},
): Promise<Harness> {
  const sourceText = options.photo
    ? "from build123d import Box\nresult = Box(20, 10, 2)\n"
    : [
      "from build123d import Box",
      "thickness = 2.0",
      "result = Box(20, 10, thickness)",
      "",
    ].join("\n");
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const analysis: SourceAnalysisBundle = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: TECHNICAL_UNIT_ID,
      role: "cad-script",
      language: "python",
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "test.ast", version: "1.0.0" },
    policy: {
      profile: "policy.python-safe",
      status: "passed",
      findings: [],
    },
    symbols: options.photo
      ? [{ id: "cad.result", kind: "artifact", name: "result" }]
      : [{
        id: "cad.thickness",
        kind: "parameter",
        name: "thickness",
        span: {
          start: { line: 2, column: 0 },
          end: { line: 2, column: 9 },
        },
      }, {
        id: "cad.result",
        kind: "artifact",
        name: "result",
      }],
    dependencies: options.photo ? [] : [{
      id: "dependency.cad.thickness.result",
      kind: "structural-incidence",
      fromSymbolId: "cad.thickness",
      toSymbolId: "cad.result",
    }],
    unresolvedConstructs: [],
  };
  const source: TechnicalCompilationSource = {
    sourceText,
    analysis,
    analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
    effectiveUnit: authoredRootEffectiveUnit(
      sourceFingerprint,
      options.unloweredClosure ? "unlowered-closure" : "root-only",
    ),
  };
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
    artifactFingerprint: sysmlArtifactFingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.package.main",
    rootElementKind: "Package" as const,
    elements: [
      { id: "sysml.package.main", kind: "Package", provenance: sysmlProvenance },
      {
        id: "sysml.thickness",
        kind: "AttributeUsage",
        name: options.unmatchedAttribute ? "width" : "thickness",
        provenance: sysmlProvenance,
      },
    ],
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId: "project.drip-tray",
      subjectId: "subject.drip-tray",
      snapshotId: "snapshot.7",
      revision: 7,
      snapshotFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  // Exercise the same exact basis fingerprint validation before the fake port
  // exposes it to the use case.
  await fingerprintTechnicalCompilationBasis(basis);

  const catalog: TechnicalCompilationProfileCatalog = {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [{
      id: "profile.build123d",
      version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      target: "build123d-source",
      sourceRole: "cad-script",
      language: "python",
      analyzer: { id: "test.ast", version: "1.0.0" },
      analysisPolicyProfile: "policy.python-safe",
      requiredBindingSymbolKinds: ["parameter"],
    }],
  };
  const command: Record<string, unknown> = {
    projectId: "project.drip-tray",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "snapshot.7",
      revision: 7,
      subjectId: "subject.drip-tray",
    },
    sourceRefs: [CAD_LOCATOR],
  };
  const basisResolver = new FakeBasisResolver(basis);
  const sourceReader = new FakeSourceReader(source);
  const draftStore = new FakeDraftStore();
  return {
    service: new PreviewProjectTechnicalCompilation({
      basisResolver,
      sourceReader,
      profileCatalog: new FakeCatalogProvider(catalog),
      draftStore,
    }),
    command,
    basisResolver,
    sourceReader,
    draftStore,
  };
}

Deno.test("preview reopens server facts, saves and rereads a deterministic provider-free draft", async () => {
  const fixture = await harness();
  const result = await fixture.service.execute(fixture.command);

  assertEquals(result.status, "ready-for-review");
  if (result.status !== "ready-for-review") throw new Error("unreachable");
  assertEquals(result.gaps, []);
  assertEquals(fixture.basisResolver.calls, 1);
  assertEquals(fixture.sourceReader.calls.length, 1);
  assertEquals(fixture.draftStore.saves, 1);
  assertEquals(fixture.draftStore.reads, 1);
  assertEquals(
    result.draft.draftId,
    `technical-compilation:project.drip-tray:${result.fingerprint.digest}`,
  );
  assertEquals(result.draft.projectId, "project.drip-tray");
  assertEquals(result.draft.documentFingerprint, result.fingerprint);
  assertEquals(result.draft.envelopeFingerprint.digest.length, 64);
  const admission = parseTechnicalCompilationAdmissionParameters(
    result.decisionParameters,
  );
  assertEquals(admission.draft, {
    draftId: result.draft.draftId,
    projectId: result.draft.projectId,
    documentFingerprint: result.draft.documentFingerprint,
    envelopeFingerprint: result.draft.envelopeFingerprint,
  });
  assertEquals(admission.basis.fingerprint, result.document.basisFingerprint);
  assertEquals(admission.basis.sysml.rootElementId, "sysml.package.main");
  assertEquals(admission.basis.sysml.rootElementKind, "Package");
  assertEquals(admission.sources[0].id, TECHNICAL_UNIT_ID);
  assertEquals(admission.sources[0].role, "cad-script");
  assertEquals(admission.sources[0].language, "python");
  assertEquals(admission.sources[0].profileId, "source-profile.python");
  assertEquals(
    admission.compilationProfileRequests[0].target,
    "build123d-source",
  );
  assertEquals(
    encodeTechnicalCompilationAdmissionParameters(admission),
    result.decisionParameters,
  );
  assertEquals(fixture.draftStore.saved?.sourceCaptures.length, 1);
  assertEquals(fixture.draftStore.saved?.sourceCaptures[0].sourceId, TECHNICAL_UNIT_ID);
  assertEquals(fixture.draftStore.saved?.sourceCaptures[0].reference, CAD_LOCATOR);
  assertEquals(
    fixture.draftStore.saved?.sourceCaptures[0].referenceFingerprint,
    fixture.sourceReader.calls[0].referenceFingerprint,
  );
  assertEquals(
    result.document.projections[0].sources[0].analysis.source.id,
    TECHNICAL_UNIT_ID,
  );
  assert(!recursiveKeys(result).has("provider"));
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.draft));
});

Deno.test("preview request cannot inject raw analysis, compilation basis, or profile catalog", async () => {
  for (
    const surplus of [
      { analysis: { source: { id: "source.forged" } } },
      { catalog: { profiles: [] } },
      { sources: [{ sourceText: "arbitrary" }] },
    ]
  ) {
    const fixture = await harness();
    const error = await assertRejects(
      () => fixture.service.execute({ ...fixture.command, ...surplus }),
      ProjectTechnicalCompilationPreviewError,
    );
    assertEquals(error.code, "invalid_request");
    assertEquals(fixture.basisResolver.calls, 0);
    assertEquals(fixture.sourceReader.calls.length, 0);
    assertEquals(fixture.draftStore.saves, 0);
  }

  const fixture = await harness();
  const rawBasis = fixture.basisResolver.result;
  const error = await assertRejects(
    () => fixture.service.execute({ ...fixture.command, basis: rawBasis }),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "invalid_request");
  assertEquals(fixture.basisResolver.calls, 0);

  const forgedReference = await harness();
  const forgedCommand = structuredClone(forgedReference.command);
  forgedCommand.sourceRefs = [{
    ...CAD_LOCATOR,
    analysis: { source: { id: "source.forged" } },
    provider: "caller-selected-provider",
  }];
  const forgedError = await assertRejects(
    () => forgedReference.service.execute(forgedCommand),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(forgedError.code, "invalid_request");
  assertEquals(forgedReference.sourceReader.calls.length, 0);
  assertEquals(forgedReference.draftStore.saves, 0);

  for (
    const nonJsonReference of [
      new Date("2026-08-13T00:00:00.000Z"),
      { captureId: "capture.source.cad", hidden: undefined },
      { captureId: "capture.source.cad", count: Number.NaN },
      {
        captureId: "capture.source.cad",
        nested: new Array(1),
      },
      (() => {
        const nested: unknown[] & { authority?: string } = [];
        nested.authority = "caller-selected";
        return { captureId: "capture.source.cad", nested };
      })(),
    ]
  ) {
    const nonJson = await harness();
    const candidate = structuredClone(nonJson.command);
    candidate.sourceRefs = [nonJsonReference];
    const nonJsonError = await assertRejects(
      () => nonJson.service.execute(candidate),
      ProjectTechnicalCompilationPreviewError,
    );
    assertEquals(nonJsonError.code, "invalid_request");
    assertEquals(nonJson.basisResolver.calls, 0);
    assertEquals(nonJson.sourceReader.calls.length, 0);
  }
});

Deno.test("preview rejects admission cardinality overflow before resolver or source I/O", async () => {
  const cases: Array<(command: Record<string, unknown>) => void> = [
    (command) => {
      command.sourceRefs = Array.from(
        { length: TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSources + 1 },
        (_, index) =>
          sampleTechnicalSourceAnalysisCaptureLocator(
            index.toString(16).padStart(64, "0"),
          ),
      );
    },
  ];

  for (const mutate of cases) {
    const fixture = await harness();
    const candidate = structuredClone(fixture.command);
    mutate(candidate);
    const error = await assertRejects(
      () => fixture.service.execute(candidate),
      ProjectTechnicalCompilationPreviewError,
    );
    assertEquals(error.code, "invalid_request");
    assertEquals(fixture.basisResolver.calls, 0);
    assertEquals(fixture.sourceReader.calls.length, 0);
    assertEquals(fixture.draftStore.saves, 0);
  }
});

Deno.test("preview rejects an own __proto__ key on a closed locator without prototype mutation", async () => {
  const fixture = await harness();
  const hostileReference: Record<string, unknown> = Object.create(null);
  hostileReference.schemaVersion = CAD_LOCATOR.schemaVersion;
  hostileReference.kind = CAD_LOCATOR.kind;
  hostileReference.fingerprint = { ...CAD_LOCATOR.fingerprint };
  hostileReference.byteCount = CAD_LOCATOR.byteCount;
  hostileReference.casUri = CAD_LOCATOR.casUri;
  Object.defineProperty(hostileReference, "__proto__", {
    value: { polluted: true },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const candidate = structuredClone(fixture.command);
  candidate.sourceRefs = [hostileReference];

  const error = await assertRejects(
    () => fixture.service.execute(candidate),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "invalid_request");
  assertEquals(fixture.sourceReader.calls.length, 0);
  assertEquals(({} as { polluted?: boolean }).polluted, undefined);
  assertEquals(fixture.draftStore.saves, 0);
});

Deno.test("preview rejects missing, stale, and foreign references before any draft save", async () => {
  const missingBasis = await harness();
  missingBasis.basisResolver.result = undefined;
  let error = await assertRejects(
    () => missingBasis.service.execute(missingBasis.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "basis_not_found");
  assertEquals(missingBasis.draftStore.saves, 0);

  const foreignBasis = await harness();
  foreignBasis.basisResolver.result = {
    ...foreignBasis.basisResolver.result!,
    thread: {
      ...foreignBasis.basisResolver.result!.thread,
      projectId: "project.foreign",
    },
  };
  error = await assertRejects(
    () => foreignBasis.service.execute(foreignBasis.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "basis_mismatch");
  assertEquals(foreignBasis.sourceReader.calls.length, 0);
  assertEquals(foreignBasis.draftStore.saves, 0);

  const missingSource = await harness();
  missingSource.sourceReader.missing = true;
  error = await assertRejects(
    () => missingSource.service.execute(missingSource.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "source_not_found");
  assertEquals(missingSource.draftStore.saves, 0);

  const foreignSource = await harness();
  foreignSource.sourceReader.mismatchedReference = true;
  error = await assertRejects(
    () => foreignSource.service.execute(foreignSource.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "source_reference_mismatch");
  assertEquals(foreignSource.draftStore.saves, 0);
});

Deno.test("preview maps basis and source reader failures without leaking adapter errors", async () => {
  const basisFailure = await harness();
  basisFailure.basisResolver.failure = new Error("secret basis adapter path");
  let error = await assertRejects(
    () => basisFailure.service.execute(basisFailure.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "basis_resolution_failed");
  assertEquals(error.message, "The exact Thread/SysML basis reader failed.");
  assertEquals(basisFailure.sourceReader.calls.length, 0);
  assertEquals(basisFailure.draftStore.saves, 0);

  const sourceFailure = await harness();
  sourceFailure.sourceReader.failure = new Error("secret capture adapter path");
  error = await assertRejects(
    () => sourceFailure.service.execute(sourceFailure.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "source_resolution_failed");
  assert(error.message.startsWith("Source capture reader failed for "));
  assert(!error.message.includes("secret"));
  assertEquals(sourceFailure.draftStore.saves, 0);
});

Deno.test("preview rejects caller-supplied bindings and profileRequests", async () => {
  for (
    const mutate of [
      (command: Record<string, unknown>) => {
        command.bindings = [];
      },
      (command: Record<string, unknown>) => {
        command.profileRequests = [];
      },
    ]
  ) {
    const fixture = await harness();
    const candidate = structuredClone(fixture.command);
    mutate(candidate);
    const error = await assertRejects(
      () => fixture.service.execute(candidate),
      ProjectTechnicalCompilationPreviewError,
    );
    assertEquals(error.code, "invalid_request");
    assertEquals(fixture.draftStore.saves, 0);
  }
});

Deno.test("preview rejects tampered source provenance before draft or MRTR derivation", async () => {
  for (const tamper of ["analyzer", "capture", "profile"] as const) {
    const fixture = await harness();
    fixture.sourceReader.provenanceTamper = tamper;
    const error = await assertRejects(
      () => fixture.service.execute(fixture.command),
      ProjectTechnicalCompilationPreviewError,
    );
    assertEquals(error.code, "source_integrity_failed");
    assertEquals(fixture.draftStore.saves, 0);
  }
});

Deno.test("unresolved and rejected previews expose no draft or sealing parameters", async () => {
  const unresolved = await harness({ unmatchedAttribute: true });
  const unresolvedResult = await unresolved.service.execute(unresolved.command);
  assertEquals(unresolvedResult.status, "unresolved");
  assert(!Object.hasOwn(unresolvedResult, "draft"));
  assert(!Object.hasOwn(unresolvedResult, "decisionParameters"));
  assertEquals(unresolvedResult.gaps, [{
    code: "binding.missing",
    relation: "parameterizes",
    sourceId: TECHNICAL_UNIT_ID,
    symbolName: "thickness",
    symbolKind: "parameter",
    reason: "no-unique-AttributeUsage",
    candidateCount: 0,
    recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noUniqueAttributeUsage,
  }]);
  assertEquals(unresolved.draftStore.saves, 0);

  const rejected = await harness();
  const rejectedCatalog = {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [{
      id: "profile.build123d",
      version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      target: "build123d-source" as const,
      sourceRole: "cad-script" as const,
      language: "python" as const,
      analyzer: { id: "other.ast", version: "9.9.9" },
      analysisPolicyProfile: "policy.python-safe",
      requiredBindingSymbolKinds: ["parameter" as const],
    }],
  };
  const rejectedService = new PreviewProjectTechnicalCompilation({
    basisResolver: rejected.basisResolver,
    sourceReader: rejected.sourceReader,
    profileCatalog: new FakeCatalogProvider(rejectedCatalog),
    draftStore: rejected.draftStore,
  });
  const rejectedResult = await rejectedService.execute(rejected.command);
  assertEquals(rejectedResult.status, "rejected");
  assertEquals(rejectedResult.gaps, []);
  assert(!Object.hasOwn(rejectedResult, "draft"));
  assert(!Object.hasOwn(rejectedResult, "decisionParameters"));
  assertEquals(rejected.draftStore.saves, 0);
});

Deno.test(
  "constructor-only CAD preview emits no draft or admission parameters",
  async () => {
    const photo = await harness({ photo: true });
    const result = await photo.service.execute(photo.command);
    assertEquals(result.status, "unresolved");
    assert(
      result.document.diagnostics.some((diagnostic) =>
        diagnostic.code === "source.no-named-numeric-lever"
      ),
    );
    assertEquals(
      result.gaps.map((gap) => gap.code),
      ["source.no-named-numeric-lever"],
    );
    const leverGap = result.gaps[0];
    assertEquals(
      leverGap?.code === "source.no-named-numeric-lever"
        ? leverGap.sourceId
        : undefined,
      TECHNICAL_UNIT_ID,
    );
    assert(!Object.hasOwn(result, "draft"));
    assert(!Object.hasOwn(result, "decisionParameters"));
    assertEquals(photo.draftStore.saves, 0);
  },
);

Deno.test(
  "multi-file closure preview stays unresolved with a literal dependency-lowering gap",
  async () => {
    const fixture = await harness({ unloweredClosure: true });
    const result = await fixture.service.execute(fixture.command);
    assertEquals(result.status, "unresolved");
    assert(
      result.document.diagnostics.some((diagnostic) =>
        diagnostic.code === "source.dependency-lowering-unavailable"
      ),
    );
    assertEquals(result.gaps, [{
      code: "source.dependency-lowering-unavailable",
      sourceId: TECHNICAL_UNIT_ID,
      closureKind: "unlowered-closure",
      recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.dependencyLowering,
    }]);
    assert(!Object.hasOwn(result, "draft"));
    assert(!Object.hasOwn(result, "decisionParameters"));
    assertEquals(fixture.draftStore.saves, 0);
  },
);

Deno.test("preview fails closed when save receipt or exact CAS reread drifts", async () => {
  const wrongReceipt = await harness();
  wrongReceipt.draftStore.wrongSaveReference = true;
  let error = await assertRejects(
    () => wrongReceipt.service.execute(wrongReceipt.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "draft_integrity_failed");
  assertEquals(wrongReceipt.draftStore.saves, 1);
  assertEquals(wrongReceipt.draftStore.reads, 0);

  const driftedRead = await harness();
  driftedRead.draftStore.driftOnRead = true;
  error = await assertRejects(
    () => driftedRead.service.execute(driftedRead.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "draft_integrity_failed");
  assertEquals(driftedRead.draftStore.saves, 1);
  assertEquals(driftedRead.draftStore.reads, 1);

  const driftedCapture = await harness();
  driftedCapture.draftStore.sourceCaptureDriftOnRead = true;
  error = await assertRejects(
    () => driftedCapture.service.execute(driftedCapture.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "draft_integrity_failed");
  assertEquals(driftedCapture.draftStore.saves, 1);
  assertEquals(driftedCapture.draftStore.reads, 1);

  const missingCapture = await harness();
  missingCapture.draftStore.sourceCaptureMissingOnRead = true;
  error = await assertRejects(
    () => missingCapture.service.execute(missingCapture.command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(error.code, "draft_integrity_failed");
  assertEquals(missingCapture.draftStore.saves, 1);
  assertEquals(missingCapture.draftStore.reads, 1);
});

Deno.test("preview output and content-addressed draft id are deterministic", async () => {
  const first = await harness();
  const second = await harness();
  const permuted = structuredClone(second.command);
  const reference = (permuted.sourceRefs as Record<string, unknown>[])[0];
  permuted.sourceRefs = [{
    casUri: reference.casUri,
    byteCount: reference.byteCount,
    fingerprint: reference.fingerprint,
    kind: reference.kind,
    schemaVersion: reference.schemaVersion,
  }];

  assertEquals(
    await second.service.execute(permuted),
    await first.service.execute(first.command),
  );
});

Deno.test("derived draft id supports the full valid project-id bound", async () => {
  const fixture = await harness();
  const projectId = `p${"x".repeat(255)}`;
  fixture.command.projectId = projectId;
  fixture.basisResolver.result = {
    ...fixture.basisResolver.result!,
    thread: { ...fixture.basisResolver.result!.thread, projectId },
  };

  const result = await fixture.service.execute(fixture.command);
  assertEquals(result.status, "ready-for-review");
  if (result.status !== "ready-for-review") throw new Error("unreachable");
  assertEquals(
    result.draft.draftId,
    `technical-compilation:${projectId}:${result.fingerprint.digest}`,
  );
  assert(result.draft.draftId.length > 256);
});

Deno.test("omitted basis uses the unique current Thread tip", async () => {
  const fixture = await harness();
  const command = {
    projectId: fixture.command.projectId,
    sourceRefs: fixture.command.sourceRefs,
  };
  const withoutProjects = new PreviewProjectTechnicalCompilation({
    basisResolver: fixture.basisResolver,
    sourceReader: fixture.sourceReader,
    profileCatalog: new FakeCatalogProvider({
      schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
      profiles: [{
        id: "profile.build123d",
        version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
        target: "build123d-source",
        sourceRole: "cad-script",
        language: "python",
        analyzer: { id: "test.ast", version: "1.0.0" },
        analysisPolicyProfile: "policy.python-safe",
        requiredBindingSymbolKinds: ["parameter"],
      }],
    }),
    draftStore: fixture.draftStore,
  });
  const missing = await assertRejects(
    () => withoutProjects.execute(command),
    ProjectTechnicalCompilationPreviewError,
  );
  assertEquals(missing.code, "configuration_failure");

  const withTip = await harness();
  const service = new PreviewProjectTechnicalCompilation({
    basisResolver: withTip.basisResolver,
    sourceReader: withTip.sourceReader,
    profileCatalog: new FakeCatalogProvider({
      schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
      profiles: [{
        id: "profile.build123d",
        version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
        target: "build123d-source",
        sourceRole: "cad-script",
        language: "python",
        analyzer: { id: "test.ast", version: "1.0.0" },
        analysisPolicyProfile: "policy.python-safe",
        requiredBindingSymbolKinds: ["parameter"],
      }],
    }),
    draftStore: withTip.draftStore,
    projects: {
      get: () =>
        Promise.resolve({
          project: { id: "project.drip-tray" },
          threadSnapshots: [{
            snapshotId: "snapshot.7",
            revision: 7,
            subjectId: "subject.drip-tray",
          }],
        } as never),
    },
  });
  const result = await service.execute(command);
  assertEquals(result.status, "ready-for-review");
  assertEquals(withTip.basisResolver.calls, 1);
});

Deno.test("preview selects the unique SPICE catalogue profile and rejects caller runtime choice", async () => {
  const sourceText = "Vin in 0 5\nRload in 0 1k\n";
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const analysis: SourceAnalysisBundle = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: TECHNICAL_UNIT_ID,
      role: "spice-circuit",
      language: "spice",
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
    policy: {
      profile: "spice-circuit-closed-subset-v1",
      status: "passed",
      findings: [],
    },
    symbols: [{ id: "artifact.circuit", kind: "artifact", name: "circuit" }],
    dependencies: [],
    unresolvedConstructs: [],
  };
  const source: TechnicalCompilationSource = {
    sourceText,
    analysis,
    analysisFingerprint: await fingerprintSourceAnalysisBundle(analysis),
    effectiveUnit: authoredRootEffectiveUnit(sourceFingerprint),
  };
  const sysmlProvenance = {
    artifactId: "artifact.sysml",
    artifactFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
    captureId: "capture.syson",
  };
  const sysmlAnchor = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlProvenance.artifactFingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.package.main",
    rootElementKind: "Package" as const,
    elements: [
      { id: "sysml.package.main", kind: "Package", provenance: sysmlProvenance },
    ],
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId: "project.clamp",
      subjectId: "subject.clamp",
      snapshotId: "snapshot.3",
      revision: 3,
      snapshotFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  const catalog: TechnicalCompilationProfileCatalog = {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [{
      id: "profile.build123d",
      version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      target: "build123d-source",
      sourceRole: "cad-script",
      language: "python",
      analyzer: { id: "test.ast", version: "1.0.0" },
      analysisPolicyProfile: "policy.python-safe",
      requiredBindingSymbolKinds: ["parameter"],
    }, {
      id: "profile.modelica",
      version: "2.0.0",
      target: "modelica-source-qualification",
      sourceRole: "modelica-model",
      language: "modelica",
      analyzer: { id: "test.ast", version: "1.0.0" },
      analysisPolicyProfile: "policy.modelica-safe",
      requiredBindingSymbolKinds: ["parameter"],
    }, {
      id: "spice-circuit-closed-subset-v1",
      version: "1.0.0",
      target: "spice-circuit-source",
      sourceRole: "spice-circuit",
      language: "spice",
      analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
      analysisPolicyProfile: "spice-circuit-closed-subset-v1",
      requiredBindingSymbolKinds: ["parameter"],
    }],
  };
  const sourceReader = new FakeSourceReader(source, SPICE_LOCATOR);
  const draftStore = new FakeDraftStore();
  const service = new PreviewProjectTechnicalCompilation({
    basisResolver: new FakeBasisResolver(basis),
    sourceReader,
    profileCatalog: new FakeCatalogProvider(catalog),
    draftStore,
  });
  const result = await service.execute({
    projectId: "project.clamp",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "snapshot.3",
      revision: 3,
      subjectId: "subject.clamp",
    },
    sourceRefs: [SPICE_LOCATOR],
  });
  assertEquals(result.status, "ready-for-review");
  if (result.status !== "ready-for-review") throw new Error("unreachable");
  assertEquals(result.document.projections.map((item) => item.target), [
    "spice-circuit-source",
  ]);
  const admission = parseTechnicalCompilationAdmissionParameters(
    result.decisionParameters,
  );
  assertEquals(admission.sources[0].role, "spice-circuit");
  assertEquals(admission.sources[0].language, "spice");
  assertEquals(admission.compilationProfileRequests[0].target, "spice-circuit-source");
  assertEquals(admission.compilationProfileRequests.length, 1);
  assertEquals(recursiveKeys(result).has("provider"), false);
  assertEquals(recursiveKeys(result).has("runtime"), false);
  assertEquals(recursiveKeys(result).has("ngspice"), false);
});

Deno.test(
  "sealed thermal method sheet recross stays on unique Modelica compilation",
  async () => {
    const fixture = await crossDomainMethodSheetPreview();
    const spice = await fixture.service.execute(fixture.spiceCommand);
    assertEquals(spice.status, "ready-for-review");
    assertEquals(spice.gaps, []);
    assertEquals(spice.document.status, "ready-for-review");
    assertEquals(spice.document.projections.map((item) => item.target), [
      "spice-circuit-source",
    ]);
    assertEquals(fixture.methodSheetReads, 0);

    const cad = await fixture.service.execute(fixture.cadCommand);
    assertEquals(cad.status, "ready-for-review");
    assertEquals(cad.gaps, []);
    assertEquals(cad.document.projections.map((item) => item.target), [
      "build123d-source",
    ]);
    assertEquals(fixture.methodSheetReads, 0);

    const modelica = await fixture.service.execute(fixture.modelicaCommand);
    assertEquals(modelica.status, "unresolved");
    assertEquals(modelica.document.status, "ready-for-review");
    assertEquals(modelica.document.projections.map((item) => item.target), [
      "modelica-source-qualification",
    ]);
    assertEquals(modelica.document.diagnostics, []);
    assertEquals(
      modelica.gaps.map((gap) => gap.code),
      [
        "thermal-method-sheet.output.unresolved",
        "thermal-method-sheet.parameter.unresolved",
      ],
    );
    assertEquals(fixture.methodSheetReads, 1);
    assertEquals("draft" in modelica, false);
  },
);

async function crossDomainMethodSheetPreview(): Promise<{
  readonly service: PreviewProjectTechnicalCompilation;
  readonly spiceCommand: Record<string, unknown>;
  readonly cadCommand: Record<string, unknown>;
  readonly modelicaCommand: Record<string, unknown>;
  methodSheetReads: number;
}> {
  const projectId = "project.clamp";
  const subjectId = "subject.clamp";
  const sheetInput = validThermalMethodSheetPlaceholder();
  (sheetInput.project as { id: string; subjectId: string }).id = projectId;
  (sheetInput.project as { id: string; subjectId: string }).subjectId = subjectId;
  (sheetInput.subject as { id: string }).id = subjectId;
  const sheet = validateModelicaThermalMethodSheet(sheetInput);

  const cadText = [
    "from build123d import Box",
    "thickness = 2.0",
    "result = Box(20, 10, thickness)",
    "",
  ].join("\n");
  const spiceText = "Vin in 0 5\nRload in 0 1k\n";
  const modelicaText = "model Placeholder\nend Placeholder;\n";
  const cadFingerprint = await fingerprintTechnicalSourceText(cadText);
  const spiceFingerprint = await fingerprintTechnicalSourceText(spiceText);
  const modelicaFingerprint = await fingerprintTechnicalSourceText(modelicaText);

  const cadAnalysis: SourceAnalysisBundle = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: TECHNICAL_UNIT_ID,
      role: "cad-script",
      language: "python",
      fingerprint: cadFingerprint,
    },
    analyzer: { id: "test.ast", version: "1.0.0" },
    policy: {
      profile: "policy.python-safe",
      status: "passed",
      findings: [],
    },
    symbols: [{
      id: "cad.thickness",
      kind: "parameter",
      name: "thickness",
      span: { start: { line: 2, column: 0 }, end: { line: 2, column: 9 } },
    }, {
      id: "cad.result",
      kind: "artifact",
      name: "result",
    }],
    dependencies: [{
      id: "dependency.cad.thickness.result",
      kind: "structural-incidence",
      fromSymbolId: "cad.thickness",
      toSymbolId: "cad.result",
    }],
    unresolvedConstructs: [],
  };
  const spiceAnalysis: SourceAnalysisBundle = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: TECHNICAL_UNIT_ID,
      role: "spice-circuit",
      language: "spice",
      fingerprint: spiceFingerprint,
    },
    analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
    policy: {
      profile: "spice-circuit-closed-subset-v1",
      status: "passed",
      findings: [],
    },
    symbols: [{ id: "artifact.circuit", kind: "artifact", name: "circuit" }],
    dependencies: [],
    unresolvedConstructs: [],
  };
  const modelicaAnalysis: SourceAnalysisBundle = {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: TECHNICAL_UNIT_ID,
      role: "modelica-model",
      language: "modelica",
      fingerprint: modelicaFingerprint,
    },
    analyzer: { id: "test.ast", version: "1.0.0" },
    policy: {
      profile: "policy.modelica-safe",
      status: "passed",
      findings: [],
    },
    symbols: [
      { id: "parameter.heatingRate", kind: "parameter", name: "heatingRate" },
      { id: "variable.temperature", kind: "variable", name: "temperature" },
    ],
    dependencies: [],
    unresolvedConstructs: [],
  };
  const sources: Record<string, TechnicalCompilationSource> = {
    [CAD_LOCATOR.fingerprint.digest]: {
      sourceText: cadText,
      analysis: cadAnalysis,
      analysisFingerprint: await fingerprintSourceAnalysisBundle(cadAnalysis),
      effectiveUnit: authoredRootEffectiveUnit(cadFingerprint),
    },
    [SPICE_LOCATOR.fingerprint.digest]: {
      sourceText: spiceText,
      analysis: spiceAnalysis,
      analysisFingerprint: await fingerprintSourceAnalysisBundle(spiceAnalysis),
      effectiveUnit: authoredRootEffectiveUnit(spiceFingerprint),
    },
    [MODELICA_LOCATOR.fingerprint.digest]: {
      sourceText: modelicaText,
      analysis: modelicaAnalysis,
      analysisFingerprint: await fingerprintSourceAnalysisBundle(
        modelicaAnalysis,
      ),
      effectiveUnit: authoredRootEffectiveUnit(modelicaFingerprint),
    },
  };

  const sysmlProvenance = {
    artifactId: "artifact.sysml",
    artifactFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
    captureId: "capture.syson",
  };
  const sysmlAnchor = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlProvenance.artifactFingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.package.main",
    rootElementKind: "Package" as const,
    elements: [
      { id: "sysml.package.main", kind: "Package", provenance: sysmlProvenance },
      {
        id: "sysml.thickness",
        kind: "AttributeUsage",
        name: "thickness",
        provenance: sysmlProvenance,
      },
      {
        id: "sysml.heatingRate",
        kind: "AttributeUsage",
        name: "heatingRate",
        provenance: sysmlProvenance,
      },
      {
        id: "placeholder-attribute-usage",
        kind: "AttributeUsage",
        name: "placeholder",
        provenance: sysmlProvenance,
      },
      {
        id: "placeholder-requirement",
        kind: "RequirementUsage",
        provenance: sysmlProvenance,
      },
    ],
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId,
      subjectId,
      snapshotId: "snapshot.3",
      revision: 3,
      snapshotFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  const catalog: TechnicalCompilationProfileCatalog = {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [{
      id: "profile.build123d",
      version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      target: "build123d-source",
      sourceRole: "cad-script",
      language: "python",
      analyzer: { id: "test.ast", version: "1.0.0" },
      analysisPolicyProfile: "policy.python-safe",
      requiredBindingSymbolKinds: ["parameter"],
    }, {
      id: "profile.modelica",
      version: "2.0.0",
      target: "modelica-source-qualification",
      sourceRole: "modelica-model",
      language: "modelica",
      analyzer: { id: "test.ast", version: "1.0.0" },
      analysisPolicyProfile: "policy.modelica-safe",
      requiredBindingSymbolKinds: ["parameter"],
    }, {
      id: "spice-circuit-closed-subset-v1",
      version: "1.0.0",
      target: "spice-circuit-source",
      sourceRole: "spice-circuit",
      language: "spice",
      analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
      analysisPolicyProfile: "spice-circuit-closed-subset-v1",
      requiredBindingSymbolKinds: ["parameter"],
    }],
  };

  const state = { methodSheetReads: 0 };
  const sourceReader = new MappingSourceReader(sources);
  const service = new PreviewProjectTechnicalCompilation({
    basisResolver: new FakeBasisResolver(basis),
    sourceReader,
    profileCatalog: new FakeCatalogProvider(catalog),
    draftStore: new FakeDraftStore(),
    methodSheets: {
      read: () => {
        state.methodSheetReads += 1;
        return Promise.resolve(sheet);
      },
    },
  });
  const command = (
    locator: ReturnType<typeof sampleTechnicalSourceAnalysisCaptureLocator>,
  ) => ({
    projectId,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snapshot.3",
      revision: 3,
      subjectId,
    },
    sourceRefs: [locator],
  });
  return {
    service,
    spiceCommand: command(SPICE_LOCATOR),
    cadCommand: command(CAD_LOCATOR),
    modelicaCommand: command(MODELICA_LOCATOR),
    get methodSheetReads() {
      return state.methodSheetReads;
    },
  };
}

class MappingSourceReader implements TechnicalCompilationSourceReader {
  constructor(
    readonly sources: Readonly<Record<string, TechnicalCompilationSource>>,
  ) {}

  read(
    request: TechnicalCompilationSourceReadRequest,
  ): Promise<ReopenedTechnicalCompilationSource | undefined> {
    const source = this.sources[request.reference.fingerprint.digest];
    if (!source) return Promise.resolve(undefined);
    return Promise.resolve({
      referenceFingerprint: request.referenceFingerprint,
      source,
      provenance: {
        profile: {
          id: "source-profile.test",
          version: "1.0.0",
          fingerprint: {
            algorithm: "sha256" as const,
            digest: "3".repeat(64),
          },
        },
        analyzer: source.analysis.analyzer,
        sourceFingerprint: source.analysis.source.fingerprint,
        captureFingerprint: request.referenceFingerprint,
        analysisFingerprint: source.analysisFingerprint,
        effectiveUnit: source.effectiveUnit,
        ...sampleAdmissionSourceWorkspaceFields(source.analysis.source.id, {
          projectId: request.projectId,
        }),
        locator: request.reference,
        attachmentAlignment: "exact" as const,
      },
    });
  }
}

function authoredRootEffectiveUnit(
  scriptFingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  closureKind: "root-only" | "unlowered-closure" = "root-only",
) {
  return {
    kind: "authored-root" as const,
    closureKind,
    unitId: TECHNICAL_UNIT_ID,
    closureFingerprint: {
      algorithm: "sha256" as const,
      digest: SOURCE_CLOSURE_DIGEST,
    },
    scriptFingerprint,
  };
}

function recursiveKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) recursiveKeys(item, into);
    return into;
  }
  if (value === null || typeof value !== "object") return into;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    into.add(key);
    recursiveKeys(child, into);
  }
  return into;
}
