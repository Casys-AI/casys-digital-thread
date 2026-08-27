import { assertEquals, assertFalse, assertRejects } from "@std/assert";
import type { TechnicalCompilationAdmissionReadRequest } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  TechnicalCompilationDraft,
  TechnicalCompilationDraftReference,
} from "../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationSource,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
  type TechnicalCompilationAdmission,
} from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import { fingerprintSourceAnalysisBundle } from "../../../domain/compile/source/source-analysis.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtension } from "../../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { TechnicalCompilationSourceReader } from "../../../application/ports/out/compile/admission/technical-compilation-source-reader.ts";
import {
  technicalSourceAnalysisCaptureStores,
  technicalSourceCaptureInput,
} from "../../../testing/technical-source-capture-test-support.ts";
import {
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX,
  type TechnicalCompilationAdmissionCapture,
  validateTechnicalCompilationAdmissionCapture,
} from "../executors/compile-seal-admission-run-executor.ts";
import {
  createInitialTechnicalSourceAnalysisCaptureService,
} from "../captures/initial-technical-source-analysis-composition.ts";
import {
  INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
} from "./fixed-technical-compilation-profile-catalog-provider.ts";
import {
  CaptureBackedTechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadError,
} from "./capture-backed-technical-compilation-admission-reader.ts";

const AT = "2026-08-13T12:00:00.000Z";
const PROJECT_ID = "project.reader";
const SUBJECT_ID = "subject.reader";
const SOURCE_TEXT = [
  "from build123d import Box",
  "length = 20",
  "width = 10",
  "height = 2",
  "result = Box(length, width, height)",
  "",
].join("\n");

Deno.test("capture-backed admission reader reopens only the exact frozen Thread and CAS evidence", async () => {
  await withFixture(async (fixture) => {
    const reopened = await fixture.reader.read(fixture.request);
    if (!reopened) throw new Error("missing exact admission");

    assertEquals(reopened.schemaVersion, fixture.capture.schemaVersion);
    assertEquals(reopened.operation, fixture.capture.operation);
    assertEquals(reopened.admission, fixture.capture.admission);
    assertEquals(reopened.document, fixture.capture.document);
    assertEquals(
      admissionArtifact(
        fixture.snapshots.get(fixture.request.basis.snapshotId)! as MutableSnapshot,
      ).inputArtifactIds,
      [
        fixture.requirementsArtifact.id,
        fixture.capture.admission.basis.sysml.artifactId,
      ],
    );
    assertEquals(Object.isFrozen(reopened), true);
    assertEquals(Object.isFrozen(reopened.admission), true);
    assertEquals(Object.isFrozen(reopened.document.projections), true);
    assertFalse("sourceCaptures" in reopened);
    assertNoStorageLocator(reopened);
  });
});

Deno.test("capture-backed admission reader rejects producer, URI, input, freshness, and project drift", async () => {
  await withFixture(async (fixture) => {
    const cases: Array<{
      readonly name: string;
      readonly mutate: (snapshot: MutableSnapshot) => void;
    }> = [{
      name: "producer",
      mutate: (snapshot) => {
        const artifact = admissionArtifact(snapshot);
        artifact.producer = { ...artifact.producer, serverId: "untrusted" };
      },
    }, {
      name: "URI",
      mutate: (snapshot) => {
        admissionArtifact(snapshot).uri =
          `casys://foreign/sha256/${fixture.request.artifactFingerprint.digest}`;
      },
    }, {
      name: "input",
      mutate: (snapshot) => {
        admissionArtifact(snapshot).inputArtifactIds = [];
      },
    }, {
      name: "freshness",
      mutate: (snapshot) => {
        admissionArtifact(snapshot).freshness = {
          status: "stale",
          changedAt: AT,
          reason: "changed",
          invalidatedByChangeIds: ["change.sysml"],
        };
      },
    }];

    for (const testCase of cases) {
      const snapshots = cloneSnapshots(fixture.snapshots);
      testCase.mutate(
        snapshots.get(fixture.request.basis.snapshotId)! as MutableSnapshot,
      );
      const reader = fixture.readerWith(snapshots);
      await assertRejects(
        () => reader.read(fixture.request),
        TechnicalCompilationAdmissionReadError,
        testCase.name === "URI" ? "identity" : undefined,
      );
    }

    await assertRejects(
      () =>
        fixture.reader.read({
          ...fixture.request,
          projectId: "project.foreign",
        }),
      TechnicalCompilationAdmissionReadError,
      "scope",
    );
  });
});

Deno.test("capture-backed admission reader requires the full architecture/requirements V3 closure and rejects retired provenance", async () => {
  await withFixture(async (fixture) => {
    const duplicateDerived = cloneSnapshots(fixture.snapshots);
    const current = duplicateDerived.get(fixture.request.basis.snapshotId)!;
    const requirementsDerivation = current.provenance.find((link) =>
      link.relation === "derived_from" && link.to.kind === "artifact" &&
      link.to.id === fixture.requirementsArtifact.id
    );
    if (!requirementsDerivation) {
      throw new Error("fixture requirements derivation is absent");
    }
    duplicateDerived.set(
      current.id,
      validateThreadSnapshot({
        ...current,
        provenance: [...current.provenance, {
          ...requirementsDerivation,
          id: "derived-from.requirements-v3.duplicate",
        }],
      }),
    );
    await assertRejects(
      () => fixture.readerWith(duplicateDerived).read(fixture.request),
      TechnicalCompilationAdmissionReadError,
      "derived-from",
    );

    const archived = cloneSnapshots(fixture.snapshots);
    const archiveBasis = archived.get(fixture.request.basis.snapshotId)!;
    const archiveChangeId = "change.archive.requirements-v3";
    archived.set(
      archiveBasis.id,
      validateThreadSnapshot({
        ...archiveBasis,
        changeSet: {
          ...archiveBasis.changeSet,
          changes: [...archiveBasis.changeSet.changes, {
            id: archiveChangeId,
            kind: "archived",
            target: {
              kind: "artifact",
              id: fixture.requirementsArtifact.id,
            },
            summary: "Retire the exact native SysML requirements V3 capture.",
          }],
        },
        provenance: [...archiveBasis.provenance, {
          id: "provenance.archive.requirements-v3",
          relation: "changes",
          from: { kind: "change", id: archiveChangeId },
          to: { kind: "artifact", id: fixture.requirementsArtifact.id },
          rationale: "The applied change retires this exact requirements capture.",
        }],
      }),
    );
    await assertRejects(
      () => fixture.readerWith(archived).read(fixture.request),
      TechnicalCompilationAdmissionReadError,
      "archived",
    );
  });
});

Deno.test("capture-backed admission reader fails closed on non-canonical CAS bytes and broken lineage", async () => {
  await withFixture(async (fixture) => {
    const nonCanonical = fixture.readerWith(
      fixture.snapshots,
      JSON.stringify(fixture.capture, null, 2),
    );
    await assertRejects(
      () => nonCanonical.read(fixture.request),
      TechnicalCompilationAdmissionReadError,
      "CAS bytes",
    );

    const noPredecessor = cloneSnapshots(fixture.snapshots);
    noPredecessor.delete(fixture.admissionBasis.id);
    await assertRejects(
      () => fixture.readerWith(noPredecessor).read(fixture.request),
      TechnicalCompilationAdmissionReadError,
      "lineage",
    );

    assertEquals(
      await fixture.reader.read({
        ...fixture.request,
        artifactId: "technical-compilation-admission-missing",
      }),
      undefined,
    );
    await assertRejects(
      () =>
        fixture.reader.read({
          ...fixture.request,
          basis: { ...fixture.request.basis, snapshotId: "latest" },
        }),
      TypeError,
      "exact snapshot",
    );
  });
});

Deno.test("capture-backed admission reader refuses different-basis alignment and multi-file closures", async () => {
  await withFixture(async (fixture) => {
    for (const tamper of ["alignment", "deps"] as const) {
      const reader = new CaptureBackedTechnicalCompilationAdmissionReader({
        snapshots: {
          get: (id) => Promise.resolve(fixture.snapshots.get(id)),
        },
        captures: {
          read: (fingerprint) =>
            Promise.resolve(
              fingerprint.digest === fixture.request.artifactFingerprint.digest
                ? deterministicJson(fixture.capture)
                : undefined,
            ),
        },
        sources: {
          read: async (request) => {
            const exact = await fixture.sources.read(request);
            if (!exact) return undefined;
            if (tamper === "alignment") {
              return {
                ...exact,
                provenance: {
                  ...exact.provenance,
                  attachmentAlignment: "different-basis",
                },
              };
            }
            return {
              ...exact,
              source: {
                ...exact.source,
                effectiveUnit: unloweredAuthoredRoot(exact.source.effectiveUnit),
              },
              provenance: {
                ...exact.provenance,
                effectiveUnit: unloweredAuthoredRoot(
                  exact.provenance.effectiveUnit,
                ),
              },
            };
          },
        },
      });
      await assertRejects(
        () => reader.read(fixture.request),
        TechnicalCompilationAdmissionReadError,
      );
    }
  });
});

Deno.test("capture-backed admission reader reconstructs hostile store failures without inspecting or leaking them", async () => {
  await withFixture(async (fixture) => {
    for (const failurePoint of ["snapshot", "lineage", "capture"] as const) {
      const observedPrivateProperties: string[] = [];
      const hostile = new Error();
      for (const property of ["message", "stack", "cause"]) {
        Object.defineProperty(hostile, property, {
          configurable: true,
          get() {
            observedPrivateProperties.push(property);
            throw new Error("HOST_SECRET_/private/backend/socket");
          },
        });
      }
      const snapshots = {
        get: (id: string): Promise<ThreadSnapshot | undefined> => {
          if (failurePoint === "snapshot") throw hostile;
          if (
            failurePoint === "lineage" &&
            id !== fixture.request.basis.snapshotId
          ) throw hostile;
          return Promise.resolve(fixture.snapshots.get(id));
        },
      };
      const captures = {
        read: (): Promise<string | undefined> => {
          if (failurePoint === "capture") throw hostile;
          return Promise.resolve(deterministicJson(fixture.capture));
        },
      };
      const reader = new CaptureBackedTechnicalCompilationAdmissionReader({
        snapshots,
        captures,
        sources: {
          read: () => Promise.resolve(undefined),
        },
      });
      const error = await assertRejects(
        () => reader.read(fixture.request),
        TechnicalCompilationAdmissionReadError,
      );
      assertFalse(error.message.includes("HOST_SECRET"));
      assertFalse(error.message.includes("/private/"));
      assertFalse(error.message.includes("backend"));
      assertEquals(observedPrivateProperties, []);
      assertEquals("cause" in error, false);
    }
  });
});

interface Fixture {
  readonly reader: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly readerWith: (
    snapshots: Map<string, ThreadSnapshot>,
    captureText?: string,
  ) => CaptureBackedTechnicalCompilationAdmissionReader;
  readonly snapshots: Map<string, ThreadSnapshot>;
  readonly sources: TechnicalCompilationSourceReader;
  readonly admissionBasis: ThreadSnapshot;
  readonly requirementsArtifact: ThreadArtifact;
  readonly capture: TechnicalCompilationAdmissionCapture;
  readonly request: TechnicalCompilationAdmissionReadRequest;
}

function locatorBackedSourceReader(
  captures: {
    reopenLocator(
      value: unknown,
    ): ReturnType<
      import("../captures/technical-source-analysis-capture.ts").TechnicalSourceAnalysisCaptureService[
        "reopenLocator"
      ]
    >;
  },
): TechnicalCompilationSourceReader {
  return {
    async read(request) {
      const reopened = await captures.reopenLocator(request.reference);
      const analysisFingerprint = await fingerprintSourceAnalysisBundle(
        reopened.analysis,
      );
      return {
        referenceFingerprint: request.referenceFingerprint,
        source: {
          sourceText: reopened.sourceText,
          analysis: reopened.analysis,
          analysisFingerprint,
          effectiveUnit: reopened.document.effectiveUnit,
        },
        provenance: {
          profile: reopened.document.profile,
          analyzer: reopened.document.analysis.analyzer,
          sourceFingerprint: {
            algorithm: "sha256",
            digest: reopened.document.source.sha256,
          },
          captureFingerprint: request.referenceFingerprint,
          analysisFingerprint,
          effectiveUnit: reopened.document.effectiveUnit,
          attachment: reopened.document.attachment,
          sourceClosure: reopened.document.sourceClosure,
          locator: reopened.locator,
          attachmentAlignment: "exact",
        },
      };
    },
  };
}

function unloweredAuthoredRoot(
  effectiveUnit: TechnicalCompilationSource["effectiveUnit"],
) {
  if (effectiveUnit.kind !== "authored-root") {
    throw new Error("Fixture expected an authored-root effective unit.");
  }
  return { ...effectiveUnit, closureKind: "unlowered-closure" as const };
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "admission-reader-" });
  try {
    await run(await buildFixture(directory));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function buildFixture(directory: string): Promise<Fixture> {
  const sourceCaptureService = createInitialTechnicalSourceAnalysisCaptureService(
    technicalSourceAnalysisCaptureStores(directory),
  );
  const persistedSource = await sourceCaptureService.persist(
    technicalSourceCaptureInput({
      profileId: INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles[0].id,
      sourceId: "source.cad",
      projectId: PROJECT_ID,
      sourceText: SOURCE_TEXT,
    }),
  );
  const sourceReference = persistedSource.locator;
  const reopenedSource = persistedSource;
  const source: TechnicalCompilationSource = {
    sourceText: reopenedSource.sourceText,
    analysis: reopenedSource.analysis,
    analysisFingerprint: await fingerprintSourceAnalysisBundle(
      reopenedSource.analysis,
    ),
    effectiveUnit: persistedSource.document.effectiveUnit,
  };

  const sysmlFingerprint = await sha256Fingerprint({ sysml: "reader.fixture" });
  const sysmlArtifact: ThreadArtifact = {
    id: "artifact.sysml.reader",
    name: "SysML architecture",
    kind: "sysml-model",
    version: sysmlFingerprint.digest,
    fingerprint: sysmlFingerprint,
    uri: `casys://architecture-capture/sha256/${sysmlFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run.sysml.reader",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const requirementsFingerprint = await sha256Fingerprint({
    sysml: "reader.requirements-v3.fixture",
  });
  const requirementsArtifact: ThreadArtifact = {
    id: "artifact.requirements-v3.reader",
    name: "SysML requirements V3",
    kind: "sysml-model",
    version: requirementsFingerprint.digest,
    fingerprint: requirementsFingerprint,
    uri: `casys://requirements-capture/sha256/${requirementsFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "model.write-requirements@3",
      runId: "run.requirements-v3.reader",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const admissionBasis = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.reader.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Admission reader fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: sysmlArtifact.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.sysml",
      name: "Captured SysML",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.sysml",
        kind: "created",
        target: { kind: "artifact", id: sysmlArtifact.id },
        summary: "Captured the exact SysML model.",
        afterFingerprint: sysmlArtifact.fingerprint,
      }, {
        id: "change.requirements-v3",
        kind: "created",
        target: { kind: "artifact", id: requirementsArtifact.id },
        summary: "Captured the exact native SysML requirements V3 scope.",
        afterFingerprint: requirementsArtifact.fingerprint,
      }],
    },
    artifacts: [sysmlArtifact, requirementsArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.sysml",
      relation: "changes",
      from: { kind: "change", id: "change.sysml" },
      to: { kind: "artifact", id: sysmlArtifact.id },
      rationale: "The applied change introduced the SysML artefact.",
    }, {
      id: "provenance.change.requirements-v3",
      relation: "changes",
      from: { kind: "change", id: "change.requirements-v3" },
      to: { kind: "artifact", id: requirementsArtifact.id },
      rationale:
        "The applied change introduced the native SysML requirements V3 artefact.",
    }],
    proposedActions: [],
  });

  const sysmlProvenance = {
    artifactId: sysmlArtifact.id,
    artifactFingerprint: sysmlArtifact.fingerprint,
    captureId: sysmlArtifact.fingerprint.digest,
  };
  const requirementsProvenance = {
    artifactId: requirementsArtifact.id,
    artifactFingerprint: requirementsArtifact.fingerprint,
    captureId: requirementsArtifact.fingerprint.digest,
  };
  const elements = [
    {
      id: "sysml.root",
      kind: "Package",
      provenance: sysmlProvenance,
    },
    ...source.analysis.symbols.map((symbol, index) => ({
      id: `sysml.symbol.${index}`,
      kind: symbol.kind === "artifact" ? "PartUsage" : "AttributeUsage",
      provenance: requirementsProvenance,
    })),
  ];
  const anchor = {
    artifactId: sysmlArtifact.id,
    artifactFingerprint: sysmlArtifact.fingerprint,
    captureId: sysmlArtifact.fingerprint.digest,
    editingContextId: "editing-context.reader",
    rootElementId: "sysml.root",
    rootElementKind: "Package" as const,
    elements,
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId: PROJECT_ID,
      subjectId: SUBJECT_ID,
      snapshotId: admissionBasis.id,
      revision: admissionBasis.revision,
      snapshotFingerprint: await sha256Fingerprint(admissionBasis),
    },
    sysmlAnchor: anchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(anchor),
  };
  const bindings = source.analysis.symbols.map((symbol, index) => ({
    id: `binding.${index}`,
    sourceId: source.analysis.source.id,
    sourceSymbolId: symbol.id,
    sysmlElementId: elements[index + 1]!.id,
    sysmlElementKind: elements[index + 1]!.kind,
    relation: symbol.kind === "artifact"
      ? "represents" as const
      : "parameterizes" as const,
  }));
  const profile = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles[0];
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [source],
    bindings,
    profileRequests: [{
      profileId: profile.id,
      profileVersion: profile.version,
      sourceIds: [source.analysis.source.id],
    }],
  }, INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG);
  if (compiled.document.status !== "ready-for-review") {
    throw new Error(`fixture compiled as ${compiled.document.status}`);
  }

  const sourceReferenceFingerprint = await sha256Fingerprint(sourceReference);
  const draft: TechnicalCompilationDraft = {
    projectId: PROJECT_ID,
    document: compiled.document,
    fingerprint: compiled.fingerprint,
    sourceCaptures: [{
      sourceId: source.analysis.source.id,
      reference: sourceReference,
      referenceFingerprint: sourceReferenceFingerprint,
    }],
  };
  const draftReference: TechnicalCompilationDraftReference = {
    schemaVersion: "technical-compilation-draft-reference/1.0",
    draftId: `technical-compilation:${PROJECT_ID}:${compiled.fingerprint.digest}`,
    projectId: PROJECT_ID,
    documentFingerprint: compiled.fingerprint,
    envelopeFingerprint: await sha256Fingerprint(draft),
  };
  const projection = compiled.document.projections[0]!;
  const admission: TechnicalCompilationAdmission = {
    schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
    draft: {
      draftId: draftReference.draftId,
      projectId: PROJECT_ID,
      documentFingerprint: compiled.fingerprint,
      envelopeFingerprint: draftReference.envelopeFingerprint,
    },
    basis: {
      fingerprint: compiled.document.basisFingerprint,
      thread: {
        projectId: PROJECT_ID,
        subjectId: SUBJECT_ID,
        snapshotId: admissionBasis.id,
        revision: admissionBasis.revision,
        fingerprint: basis.thread.snapshotFingerprint,
      },
      sysml: {
        artifactId: anchor.artifactId,
        artifactFingerprint: anchor.artifactFingerprint,
        captureId: anchor.captureId,
        editingContextId: anchor.editingContextId,
        rootElementId: anchor.rootElementId,
        rootElementKind: anchor.rootElementKind,
        anchorFingerprint: basis.sysmlAnchorFingerprint,
      },
    },
    sources: [{
      id: source.analysis.source.id,
      role: "cad-script",
      language: "python",
      profileId: persistedSource.document.profile.id,
      profileVersion: persistedSource.document.profile.version,
      profileFingerprint: persistedSource.document.profile.fingerprint,
      analyzer: persistedSource.document.analysis.analyzer,
      sourceFingerprint: source.analysis.source.fingerprint,
      captureFingerprint: sourceReferenceFingerprint,
      analysisFingerprint: source.analysisFingerprint,
      effectiveUnit: persistedSource.document.effectiveUnit,
      attachment: persistedSource.document.attachment,
      sourceClosure: persistedSource.document.sourceClosure,
      locator: persistedSource.locator,
    }],
    bindings,
    compilationProfileRequests: [{
      profileId: profile.id,
      profileVersion: profile.version,
      target: projection.target,
      sourceIds: [source.analysis.source.id],
      profileFingerprint: projection.profileFingerprint,
    }],
    compilation: {
      fingerprint: compiled.fingerprint,
      status: "ready-for-review",
    },
  };
  const capture = await validateTechnicalCompilationAdmissionCapture({
    schemaVersion: TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
    operation: COMPILE_SEAL_ADMISSION_OPERATION,
    trustedRunId: "run.compile.reader",
    decisionId: "decision.compile.reader",
    sealedAt: AT,
    draftReference,
    sourceCaptures: draft.sourceCaptures,
    admission,
    document: compiled.document,
  });
  const captureFingerprint = await sha256Fingerprint(capture);
  const artifact: ThreadArtifact = {
    id: `technical-compilation-admission-${captureFingerprint.digest}`,
    name: "Technical compilation admission",
    kind: "document",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri:
      `${TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX}${captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile.seal-admission@3",
      runId: capture.trustedRunId,
    },
    inputArtifactIds: [requirementsArtifact.id, sysmlArtifact.id],
    freshness: fresh(),
  };
  const sysmlInputs = [requirementsArtifact, sysmlArtifact];
  const successor = applyThreadSnapshotExtension(admissionBasis, {
    id: "compile-seal-admission-run.compile.reader",
    name: "Seal technical compilation admission",
    subjectId: SUBJECT_ID,
    capturedAt: AT,
    artifacts: [artifact],
    consumptions: sysmlInputs.map((inputArtifact) => ({
      id: `consume-${inputArtifact.id}-by-${artifact.id}`,
      artifactId: inputArtifact.id,
      consumer: artifact.producer,
      observedFingerprint: inputArtifact.fingerprint,
      verifiedAt: AT,
      status: "verified" as const,
    })),
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: sysmlInputs.flatMap((inputArtifact) => {
      const consumptionId = `consume-${inputArtifact.id}-by-${artifact.id}`;
      return [{
        id: `derived-from-sysml-${captureFingerprint.digest}-${inputArtifact.id}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifact.id },
        to: { kind: "artifact" as const, id: inputArtifact.id },
        rationale:
          "The sealed admission is anchored to this exact reviewed SysML provenance artefact.",
      }, {
        id: `uses-${consumptionId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumptionId },
        to: { kind: "artifact" as const, id: inputArtifact.id },
        rationale:
          "The executor reopened this exact SysML provenance input before sealing.",
      }];
    }),
    proposedActions: [],
  }, { appliedAt: AT });
  const snapshots = new Map([
    [admissionBasis.id, admissionBasis],
    [successor.id, successor],
  ]);
  const captureText = deterministicJson(capture);
  const sources = locatorBackedSourceReader(sourceCaptureService);
  const readerWith = (
    selectedSnapshots: Map<string, ThreadSnapshot>,
    selectedCaptureText = captureText,
  ) =>
    new CaptureBackedTechnicalCompilationAdmissionReader({
      snapshots: {
        get: (id) => Promise.resolve(selectedSnapshots.get(id)),
      },
      captures: {
        read: (fingerprint) =>
          Promise.resolve(
            fingerprint.digest === captureFingerprint.digest
              ? selectedCaptureText
              : undefined,
          ),
      },
      sources,
    });
  const request: TechnicalCompilationAdmissionReadRequest = {
    projectId: PROJECT_ID,
    basis: {
      kind: "thread-snapshot",
      snapshotId: successor.id,
      revision: successor.revision,
      subjectId: SUBJECT_ID,
    },
    artifactId: artifact.id,
    artifactFingerprint: captureFingerprint,
  };
  return {
    reader: readerWith(snapshots),
    readerWith,
    snapshots,
    sources,
    admissionBasis,
    requirementsArtifact,
    capture,
    request,
  };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [] as string[],
  };
}

function cloneSnapshots(
  snapshots: Map<string, ThreadSnapshot>,
): Map<string, ThreadSnapshot> {
  return new Map(
    [...snapshots].map(([id, snapshot]) => [
      id,
      structuredClone(snapshot) as ThreadSnapshot,
    ]),
  );
}

type MutableArtifact = {
  -readonly [Key in keyof ThreadArtifact]: ThreadArtifact[Key];
};

type MutableSnapshot = Omit<ThreadSnapshot, "artifacts"> & {
  artifacts: MutableArtifact[];
};

function admissionArtifact(snapshot: MutableSnapshot): MutableArtifact {
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id.startsWith("technical-compilation-admission-")
  );
  if (!artifact) throw new Error("fixture admission artifact missing");
  return artifact;
}

function assertNoStorageLocator(value: unknown, path = "$result"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoStorageLocator(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "path" || key === "directory") {
      throw new Error(`${path}.${key} exposes a storage locator`);
    }
    if (
      (key === "uri" || key === "casUri") &&
      typeof child === "string" &&
      !child.startsWith("casys://")
    ) {
      throw new Error(`${path}.${key} exposes a storage locator`);
    }
    assertNoStorageLocator(child, `${path}.${key}`);
  }
}
