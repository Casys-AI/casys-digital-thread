import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { TechnicalCompilationBasisResolver } from "../../../application/ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
  type TechnicalCompilationDraft,
  type TechnicalCompilationDraftReference,
  type TechnicalCompilationDraftStore,
} from "../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
import type { TechnicalCompilationProfileCatalogProvider } from "../../../application/ports/out/compile/admission/technical-compilation-profile-catalog-provider.ts";
import type { TechnicalCompilationSourceReader } from "../../../application/ports/out/compile/admission/technical-compilation-source-reader.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationSource,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  encodeTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
  type TechnicalCompilationAdmission,
} from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import { fingerprintSourceAnalysisBundle } from "../../../domain/compile/source/source-analysis.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { computeArchiveCascade } from "../../../domain/thread/thread-retirement.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  sampleTechnicalSourceClosureProvenance,
  technicalSourceAnalysisCaptureStores,
  technicalSourceCaptureInput,
} from "../../../testing/technical-source-capture-test-support.ts";
import {
  INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
} from "../admission/fixed-technical-compilation-profile-catalog-provider.ts";
import {
  createInitialTechnicalSourceAnalysisCaptureService,
} from "../captures/initial-technical-source-analysis-composition.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  CompileSealAdmissionRunExecutor,
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
  type TechnicalCompilationAdmissionCaptureStore,
  technicalCompilationAnchorArtifactReferences,
  technicalCompilationEvidenceRefsEqualForTest,
  type TechnicalCompilationThreadSnapshotStore,
  validateTechnicalCompilationAdmissionCapture,
} from "./compile-seal-admission-run-executor.ts";

const SOURCE_TEXT = [
  "from build123d import Box",
  "length = 20",
  "width = 10",
  "height = 2",
  "result = Box(length, width, height)",
  "",
].join("\n");

Deno.test("SysML anchor artifact closure is codepoint-ordered, unique, and fingerprint-injective", () => {
  const rootFingerprint = {
    algorithm: "sha256" as const,
    digest: "1".repeat(64),
  };
  const requirementsFingerprint = {
    algorithm: "sha256" as const,
    digest: "2".repeat(64),
  };
  const anchor = {
    artifactId: "artifact.z-architecture",
    artifactFingerprint: rootFingerprint,
    captureId: "capture.architecture",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.root",
    rootElementKind: "Package" as const,
    elements: [{
      id: "sysml.requirement",
      kind: "RequirementUsage",
      provenance: {
        artifactId: "artifact.a-requirements-v3",
        artifactFingerprint: requirementsFingerprint,
        captureId: "capture.requirements-v3",
      },
    }, {
      id: "sysml.root",
      kind: "Package",
      provenance: {
        artifactId: "artifact.z-architecture",
        artifactFingerprint: rootFingerprint,
        captureId: "capture.architecture",
      },
    }],
  };

  assertEquals(
    technicalCompilationAnchorArtifactReferences(anchor).map((item) => item.artifactId),
    ["artifact.a-requirements-v3", "artifact.z-architecture"],
  );
  assertThrows(
    () =>
      technicalCompilationAnchorArtifactReferences({
        ...anchor,
        elements: [{
          ...anchor.elements[0],
          provenance: {
            ...anchor.elements[0].provenance,
            artifactId: anchor.artifactId,
          },
        }, anchor.elements[1]],
      }),
    EngineeringProjectCommandError,
    "divergent provenance fingerprints",
  );
});

Deno.test("sealed admission capture uses codepoint order and exact source coverage", async () => {
  const directory = await Deno.makeTempDir({ prefix: "compile-seal-capture-" });
  try {
    const captures = createInitialTechnicalSourceAnalysisCaptureService(
      technicalSourceAnalysisCaptureStores(directory),
    );
    const persisted = await Promise.all(
      ["source.Z", "source.a"].map((sourceId, index) =>
        captures.persist(technicalSourceCaptureInput({
          profileId: INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles[0].id,
          sourceId,
          sourceText: SOURCE_TEXT,
          sourceClosure: sampleTechnicalSourceClosureProvenance(sourceId, {
            fingerprint: {
              algorithm: "sha256",
              digest: (index === 0 ? "b" : "a").repeat(64),
            },
          }),
        }))
      ),
    );
    const references = persisted.map((item) => item.locator);
    const reopened = persisted;
    const sysmlArtifactFingerprint = {
      algorithm: "sha256" as const,
      digest: "2".repeat(64),
    };
    const sysmlProvenance = {
      artifactId: "artifact.sysml",
      artifactFingerprint: sysmlArtifactFingerprint,
      captureId: "capture.sysml",
    };
    const sysmlElements = [
      { id: "sysml.root", kind: "Package", provenance: sysmlProvenance },
      ...reopened.flatMap((item, sourceIndex) =>
        item.analysis.symbols.map((symbol, symbolIndex) => ({
          id: `sysml.element.${sourceIndex}.${symbolIndex}`,
          kind: symbol.kind === "artifact" ? "PartUsage" : "AttributeUsage",
          provenance: sysmlProvenance,
        }))
      ),
    ];
    const sysmlAnchor = {
      artifactId: "artifact.sysml",
      artifactFingerprint: sysmlArtifactFingerprint,
      captureId: "capture.sysml",
      editingContextId: "editing-context.main",
      rootElementId: "sysml.root",
      rootElementKind: "Package" as const,
      elements: sysmlElements,
    };
    const basis = {
      thread: {
        projectId: "project.support",
        subjectId: "subject.support",
        snapshotId: "snapshot.1",
        revision: 1,
        snapshotFingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
      },
      sysmlAnchor,
      sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
    };
    let elementIndex = 1;
    const bindings = reopened.flatMap((item, sourceIndex) =>
      item.analysis.symbols.map((symbol, symbolIndex) => {
        const element = sysmlElements[elementIndex++];
        return {
          id: `binding.${sourceIndex}.${symbolIndex}`,
          sourceId: item.analysis.source.id,
          sourceSymbolId: symbol.id,
          sysmlElementId: element.id,
          sysmlElementKind: element.kind,
          relation: symbol.kind === "artifact"
            ? "represents" as const
            : "parameterizes" as const,
        };
      })
    );
    const profile = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles[0];
    const compiled = await compileTechnicalSources({
      schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
      basis,
      basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
      sources: await Promise.all(reopened.map(async (item) => ({
        sourceText: item.sourceText,
        analysis: item.analysis,
        analysisFingerprint: await fingerprintSourceAnalysisBundle(item.analysis),
        effectiveUnit: item.document.effectiveUnit,
      }))),
      bindings,
      profileRequests: [{
        profileId: profile.id,
        profileVersion: profile.version,
        sourceIds: reopened.map((item) => item.analysis.source.id),
      }],
    }, INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG);
    if (compiled.document.status !== "ready-for-review") {
      throw new Error(`Fixture unexpectedly compiled as ${compiled.document.status}.`);
    }

    const sourceCaptures = await Promise.all(reopened.map(async (item, index) => ({
      sourceId: item.analysis.source.id,
      reference: references[index]!,
      referenceFingerprint: await sha256Fingerprint(references[index]),
    })));
    sourceCaptures.sort((left, right) => left.sourceId < right.sourceId ? -1 : 1);
    const draft: TechnicalCompilationDraft = {
      projectId: basis.thread.projectId,
      document: compiled.document,
      fingerprint: compiled.fingerprint,
      sourceCaptures,
    };
    const draftReference = {
      schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
      draftId: `technical-compilation:${draft.projectId}:${draft.fingerprint.digest}`,
      projectId: draft.projectId,
      documentFingerprint: draft.fingerprint,
      envelopeFingerprint: await sha256Fingerprint(draft),
    };
    const projection = compiled.document.projections[0];
    const admission = {
      schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
      draft: {
        draftId: draftReference.draftId,
        projectId: draftReference.projectId,
        documentFingerprint: draftReference.documentFingerprint,
        envelopeFingerprint: draftReference.envelopeFingerprint,
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
          artifactId: sysmlAnchor.artifactId,
          artifactFingerprint: sysmlAnchor.artifactFingerprint,
          captureId: sysmlAnchor.captureId,
          editingContextId: sysmlAnchor.editingContextId,
          rootElementId: sysmlAnchor.rootElementId,
          rootElementKind: sysmlAnchor.rootElementKind,
          anchorFingerprint: basis.sysmlAnchorFingerprint,
        },
      },
      sources: await Promise.all(reopened.map(async (item) => ({
        id: item.analysis.source.id,
        role: item.analysis.source.role,
        language: item.analysis.source.language,
        profileId: item.document.profile.id,
        profileVersion: item.document.profile.version,
        profileFingerprint: item.document.profile.fingerprint,
        analyzer: item.document.analysis.analyzer,
        sourceFingerprint: item.analysis.source.fingerprint,
        captureFingerprint: sourceCaptures.find((capture) =>
          capture.sourceId === item.analysis.source.id
        )!.referenceFingerprint,
        analysisFingerprint: await fingerprintSourceAnalysisBundle(item.analysis),
        effectiveUnit: item.document.effectiveUnit,
        attachment: item.document.attachment,
        sourceClosure: item.document.sourceClosure,
        locator: item.locator,
      }))),
      bindings: compiled.document.inputManifest.bindings,
      compilationProfileRequests: [{
        profileId: profile.id,
        profileVersion: profile.version,
        target: projection.target,
        sourceIds: compiled.document.inputManifest.profileRequests[0].sourceIds,
        profileFingerprint: projection.profileFingerprint,
      }],
      compilation: {
        fingerprint: compiled.fingerprint,
        status: "ready-for-review" as const,
      },
    };
    const capture = {
      schemaVersion: TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
      operation: COMPILE_SEAL_ADMISSION_OPERATION,
      trustedRunId: "run.seal",
      decisionId: "decision.seal",
      sealedAt: "2026-08-13T00:00:00.000Z",
      draftReference,
      // Deliberately use the opposite of codepoint order.
      sourceCaptures: [...sourceCaptures].reverse(),
      admission,
      document: compiled.document,
    };
    const validated = await validateTechnicalCompilationAdmissionCapture(capture);
    assertEquals(
      validated.sourceCaptures.map((item) => item.sourceId),
      [
        `technical-unit:${"a".repeat(64)}`,
        `technical-unit:${"b".repeat(64)}`,
      ],
    );
    assertEquals(
      validated.admission.sources.every((source) =>
        source.id !== source.sourceClosure.root.fileId &&
        source.attachment.fileId === source.sourceClosure.root.fileId
      ),
      true,
    );

    const loweredSources = await Promise.all(reopened.map(async (item) => ({
      sourceText: item.sourceText,
      analysis: item.analysis,
      analysisFingerprint: await fingerprintSourceAnalysisBundle(item.analysis),
      effectiveUnit: {
        kind: "build123d-workspace-closure-lowered" as const,
        closureKind: "build123d-workspace-closure-lowered" as const,
        unitId: item.analysis.source.id,
        closureFingerprint: item.document.effectiveUnit.closureFingerprint,
        scriptFingerprint: item.analysis.source.fingerprint,
        lowerer: {
          schemaVersion: "build123d-workspace-closure-lowering/1.0" as const,
          kind: "build123d-workspace-closure-lowering" as const,
          manifestFingerprint: {
            algorithm: "sha256" as const,
            digest: "c".repeat(64),
          },
        },
      },
    })));
    const lowered = await compileTechnicalSources({
      schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
      basis,
      basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
      sources: loweredSources,
      bindings,
      profileRequests: [{
        profileId: profile.id,
        profileVersion: profile.version,
        sourceIds: reopened.map((item) => item.analysis.source.id),
      }],
    }, INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG);
    if (lowered.document.status !== "ready-for-review") {
      throw new Error(
        `Lowered fixture unexpectedly compiled as ${lowered.document.status}.`,
      );
    }
    const loweredDraft: TechnicalCompilationDraft = {
      projectId: basis.thread.projectId,
      document: lowered.document,
      fingerprint: lowered.fingerprint,
      sourceCaptures,
    };
    const loweredDraftReference = {
      schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
      draftId:
        `technical-compilation:${loweredDraft.projectId}:${loweredDraft.fingerprint.digest}`,
      projectId: loweredDraft.projectId,
      documentFingerprint: loweredDraft.fingerprint,
      envelopeFingerprint: await sha256Fingerprint(loweredDraft),
    };
    const loweredAdmission = {
      ...admission,
      draft: {
        draftId: loweredDraftReference.draftId,
        projectId: loweredDraftReference.projectId,
        documentFingerprint: loweredDraftReference.documentFingerprint,
        envelopeFingerprint: loweredDraftReference.envelopeFingerprint,
      },
      sources: admission.sources.map((source, index) => ({
        ...source,
        effectiveUnit: loweredSources[index]!.effectiveUnit,
      })),
      compilation: {
        fingerprint: lowered.fingerprint,
        status: "ready-for-review" as const,
      },
    };
    const loweredValidated = await validateTechnicalCompilationAdmissionCapture({
      ...capture,
      draftReference: loweredDraftReference,
      admission: loweredAdmission,
      document: lowered.document,
    });
    assertEquals(
      loweredValidated.document.inputManifest.sources.every((source) =>
        source.effectiveUnit.kind === "build123d-workspace-closure-lowered"
      ),
      true,
    );

    await assertRejects(
      () =>
        validateTechnicalCompilationAdmissionCapture({
          ...capture,
          sourceCaptures: capture.sourceCaptures.slice(1),
        }),
      TypeError,
      "exactly cover",
    );
    await assertRejects(
      () =>
        validateTechnicalCompilationAdmissionCapture({
          ...capture,
          admission: {
            ...admission,
            sources: admission.sources.map((source, index) =>
              index === 0
                ? {
                  ...source,
                  effectiveUnit: {
                    ...source.effectiveUnit,
                    closureKind: "unlowered-closure" as const,
                  },
                }
                : source
            ),
          },
        }),
      TypeError,
      "disagrees",
    );
    await assertRejects(
      () =>
        validateTechnicalCompilationAdmissionCapture({
          ...capture,
          sourceCaptures: [capture.sourceCaptures[0], capture.sourceCaptures[0]],
        }),
      TypeError,
      "exactly cover",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

const EXEC_AT = "2026-08-13T01:00:00.000Z";
const EXEC_PROJECT_ID = "project.compile-seal";
const EXEC_SUBJECT_ID = "subject.compile-seal";
const EXEC_RUN_ID = "run.compile-seal";
const EXEC_WORK_ID = "work.compile-seal";
const EXEC_DECISION_ID = "decision.compile-seal";
const EXEC_APPROVAL_ID = "approval.compile-seal";
const EXEC_COMMAND_ID = "execute.compile-seal";
const EXEC_AGENT = { kind: "agent" as const, actorId: "agent.compiler" };
const EXEC_HUMAN = { kind: "human" as const, actorId: "human.reviewer" };

interface ExecuteFixtureOptions {
  readonly approvalOrigin?: "human" | "agent";
  readonly staleHead?: boolean;
  readonly foreignEvidence?: boolean;
  readonly sourceProvenanceDrift?: boolean;
  readonly unresolvedDraft?: boolean;
  readonly forgedPhotoDraft?: boolean;
  readonly attachmentMisaligned?: boolean;
  readonly multiFileClosure?: boolean;
  readonly resolverDrift?: "missing" | "root" | "editing-context" | "elements";
  readonly ackLostOnce?: boolean;
  readonly freshMissOnce?: boolean;
  readonly publishFailsOnce?: boolean;
  readonly completeFailsOnce?: boolean;
}

interface ExecuteFixture {
  readonly executor: CompileSealAdmissionRunExecutor;
  readonly command: {
    commandId: string;
    projectId: string;
    expectedRevision: number;
    issuedAt: string;
    runId: string;
  };
  readonly project: MutableProject;
  readonly snapshots: ExecuteMemorySnapshots;
  readonly captures: ExecuteMemoryCaptures;
  readonly commands: ExecuteCommands;
  readonly admission: TechnicalCompilationAdmission;
  readonly sysmlInputArtifactIds: readonly string[];
  readonly dispose: () => Promise<void>;
}

Deno.test("compile seal executes, records exact SysML causality, and replays without a second successor", async () => {
  await withExecuteFixture({}, async (fixture) => {
    const completed = await fixture.executor.execute(EXEC_AGENT, fixture.command);
    assertEquals(completed.agentRuns[0].status, "completed");
    assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
    assertByteIdenticalSaveAttempts(fixture.snapshots);
    assertEquals(fixture.captures.saves, 1);
    const result = completed.agentRuns[0].resultSnapshot!;
    const successor = await fixture.snapshots.getFresh(result.snapshotId);
    if (!successor) throw new Error("missing successor");
    const sealedArtifact = successor.artifacts.find((artifact) =>
      artifact.kind === "document" &&
      artifact.producer.runId === EXEC_RUN_ID
    );
    if (!sealedArtifact) throw new Error("missing sealed artifact");
    assertEquals(
      sealedArtifact.inputArtifactIds,
      fixture.sysmlInputArtifactIds,
    );
    assertEquals(
      successor.consumptions.filter((item) =>
        item.consumer.runId === EXEC_RUN_ID &&
        item.status === "verified"
      ).map((item) => item.artifactId).sort(),
      fixture.sysmlInputArtifactIds,
    );
    assertEquals(
      successor.provenance.filter((item) =>
        item.relation === "derived_from" && item.from.kind === "artifact" &&
        item.from.id === sealedArtifact.id && item.to.kind === "artifact"
      ).map((item) => item.to.id).sort(),
      fixture.sysmlInputArtifactIds,
    );
    assertEquals(
      successor.provenance.filter((item) =>
        item.relation === "uses" && item.from.kind === "consumption" &&
        item.to.kind === "artifact" &&
        successor.consumptions.some((consumption) =>
          consumption.id === item.from.id &&
          consumption.consumer.runId === EXEC_RUN_ID
        )
      ).map((item) => item.to.id).sort(),
      fixture.sysmlInputArtifactIds,
    );
    const requirementsArtifactId = fixture.sysmlInputArtifactIds.find((id) =>
      id !== fixture.admission.basis.sysml.artifactId
    );
    if (!requirementsArtifactId) {
      throw new Error("missing requirements V3 provenance artifact");
    }
    assertEquals(
      computeArchiveCascade(successor, [{
        kind: "artifact",
        id: requirementsArtifactId,
      }]).some((entry) =>
        entry.ref.kind === "artifact" && entry.ref.id === sealedArtifact.id
      ),
      true,
    );
    const captureText = await fixture.captures.read(sealedArtifact.fingerprint);
    if (!captureText) throw new Error("missing admission capture");
    const capture = await validateTechnicalCompilationAdmissionCapture(
      JSON.parse(captureText),
    );
    assertEquals(capture.draftReference.draftId, fixture.admission.draft.draftId);
    assertEquals(capture.sourceCaptures.length, 1);

    const revision = completed.revision;
    const replayed = await fixture.executor.execute(EXEC_AGENT, fixture.command);
    assertEquals(replayed.revision, revision);
    assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
    assertByteIdenticalSaveAttempts(fixture.snapshots);
    assertEquals(fixture.captures.saves, 1);
  });
});

Deno.test("compile seal refuses non-agent execution and stale capture-backed SysML before writes", async () => {
  await withExecuteFixture({}, async (nonAgent) => {
    await assertRejects(
      () => nonAgent.executor.execute(EXEC_HUMAN, nonAgent.command),
      EngineeringProjectCommandError,
      "Only an authenticated agent",
    );
    assertEquals(nonAgent.snapshots.successorIds, []);
    assertEquals(nonAgent.captures.saves, 0);
  });

  for (const drift of ["missing", "root", "editing-context", "elements"] as const) {
    await withExecuteFixture({ resolverDrift: drift }, async (fixture) => {
      await assertRejects(() => fixture.executor.execute(EXEC_AGENT, fixture.command));
      assertEquals(fixture.snapshots.successorIds, []);
      assertEquals(fixture.captures.saves, 0);
    });
  }
});

Deno.test("compile seal refuses non-human MRTR approval and stale Thread head before writes", async () => {
  for (
    const options of [
      { approvalOrigin: "agent" as const },
      { staleHead: true },
    ]
  ) {
    await withExecuteFixture(options, async (fixture) => {
      await assertRejects(() => fixture.executor.execute(EXEC_AGENT, fixture.command));
      assertEquals(fixture.snapshots.successorIds, []);
      assertEquals(fixture.captures.saves, 0);
    });
  }
});

Deno.test("compile seal refuses foreign MRTR, source provenance drift, and unresolved draft without Thread evidence", async () => {
  for (
    const options of [
      { foreignEvidence: true },
      { sourceProvenanceDrift: true },
      { unresolvedDraft: true },
    ]
  ) {
    await withExecuteFixture(options, async (fixture) => {
      await assertRejects(() => fixture.executor.execute(EXEC_AGENT, fixture.command));
      assertEquals(fixture.snapshots.successorIds, []);
      assertEquals(fixture.captures.saves, 0);
    });
  }
});

Deno.test(
  "compile seal refuses different-basis alignment and multi-file closures independently of a ready draft",
  async () => {
    for (
      const options of [
        { attachmentMisaligned: true },
        { multiFileClosure: true },
      ]
    ) {
      await withExecuteFixture(options, async (fixture) => {
        await assertRejects(() =>
          fixture.executor.execute(EXEC_AGENT, fixture.command)
        );
        assertEquals(fixture.snapshots.successorIds, []);
        assertEquals(fixture.captures.saves, 0);
      });
    }
  },
);

Deno.test(
  "compile seal re-derives the lever diagnostic and rejects a forged ready photo draft",
  async () => {
    await withExecuteFixture({ forgedPhotoDraft: true }, async (fixture) => {
      await assertRejects(() => fixture.executor.execute(EXEC_AGENT, fixture.command));
      assertEquals(fixture.snapshots.successorIds, []);
      assertEquals(fixture.captures.saves, 0);
    });
  },
);

Deno.test("compile seal recovers ACK loss, fresh-read miss, and publish ACK loss on one immutable successor", async () => {
  for (
    const options of [
      { ackLostOnce: true },
      { freshMissOnce: true },
      { publishFailsOnce: true },
    ]
  ) {
    await withExecuteFixture(options, async (fixture) => {
      await assertRejects(() => fixture.executor.execute(EXEC_AGENT, fixture.command));
      const afterFailure = fixture.project.agentRuns[0];
      assertEquals(
        afterFailure.status === "running" || afterFailure.status === "publishing",
        true,
      );
      const completed = await fixture.executor.execute(EXEC_AGENT, fixture.command);
      assertEquals(completed.agentRuns[0].status, "completed");
      assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
      assertByteIdenticalSaveAttempts(fixture.snapshots);
      assertEquals(
        completed.threadSnapshots.filter((item) => item.revision === 2).length,
        1,
      );
    });
  }
});

Deno.test("compile seal recognizes a durably committed completion after its ACK is lost", async () => {
  await withExecuteFixture({ completeFailsOnce: true }, async (fixture) => {
    const completed = await fixture.executor.execute(EXEC_AGENT, fixture.command);
    assertEquals(completed.agentRuns[0].status, "completed");
    assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
    assertByteIdenticalSaveAttempts(fixture.snapshots);
    const revision = completed.revision;
    const replayed = await fixture.executor.execute(EXEC_AGENT, fixture.command);
    assertEquals(replayed.revision, revision);
    assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
  });
});

Deno.test("running and publishing retries reject an altered command without a second successor", async () => {
  for (
    const options of [
      { ackLostOnce: true },
      { publishFailsOnce: true },
    ]
  ) {
    await withExecuteFixture(options, async (fixture) => {
      await assertRejects(() => fixture.executor.execute(EXEC_AGENT, fixture.command));
      const attemptsBeforeConflict = fixture.snapshots.saveAttempts.length;
      await assertRejects(
        () =>
          fixture.executor.execute(EXEC_AGENT, {
            ...fixture.command,
            issuedAt: "2026-08-13T00:00:01.000Z",
          }),
        EngineeringProjectCommandError,
        "claim command differs from its immutable receipt",
      );
      assertEquals(fixture.snapshots.saveAttempts.length, attemptsBeforeConflict);
      assertEquals(new Set(fixture.snapshots.successorIds).size, 1);

      const completed = await fixture.executor.execute(EXEC_AGENT, fixture.command);
      assertEquals(completed.agentRuns[0].status, "completed");
      assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
      assertByteIdenticalSaveAttempts(fixture.snapshots);
    });
  }
});

Deno.test("completed replay rejects any drift in the deterministic successor bytes", async () => {
  const mutations: Array<(snapshot: ThreadSnapshot) => ThreadSnapshot> = [
    (snapshot) => ({
      ...snapshot,
      consumptions: snapshot.consumptions.map((item, index) =>
        index === snapshot.consumptions.length - 1
          ? { ...item, verifiedAt: "2026-08-13T00:00:01.000Z" }
          : item
      ),
    }),
    (snapshot) => ({
      ...snapshot,
      artifacts: snapshot.artifacts.map((item, index) =>
        index === snapshot.artifacts.length - 1
          ? { ...item, name: "Tampered admission name" }
          : item
      ),
    }),
    (snapshot) => ({
      ...snapshot,
      provenance: snapshot.provenance.map((item, index) =>
        index === snapshot.provenance.length - 1
          ? { ...item, rationale: "Tampered provenance rationale." }
          : item
      ),
    }),
  ];

  for (const mutate of mutations) {
    await withExecuteFixture({}, async (fixture) => {
      const completed = await fixture.executor.execute(EXEC_AGENT, fixture.command);
      const result = completed.agentRuns[0].resultSnapshot!;
      fixture.snapshots.tamper(result.snapshotId, mutate);
      await assertRejects(
        () => fixture.executor.execute(EXEC_AGENT, fixture.command),
        EngineeringProjectCommandError,
        "no longer equals the exact deterministic snapshot",
      );
      assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
      assertEquals(fixture.snapshots.saveAttempts.length, 1);
    });
  }
});

Deno.test("completed replay rejects homonymous or divergent completion receipts without a write", async () => {
  const mutations = [
    "homonym",
    "type",
    "actor",
    "fingerprint",
    "resulting-snapshot",
  ] as const;

  for (const mutation of mutations) {
    await withExecuteFixture({}, async (fixture) => {
      const completed = await fixture.executor.execute(EXEC_AGENT, fixture.command);
      const receipt = fixture.project.commandReceipts.find((item) =>
        item.commandId ===
          `${fixture.command.commandId}:compile-seal-admission:complete`
      );
      if (!receipt) throw new Error("missing completion receipt");
      const mutable = receipt as MutableReceipt;
      if (mutation === "homonym") {
        fixture.project.commandReceipts.push(structuredClone(receipt));
      } else if (mutation === "type") {
        mutable.type = "agent-run.publish";
      } else if (mutation === "actor") {
        mutable.actor = { id: "agent.foreign", origin: "agent" };
      } else if (mutation === "fingerprint") {
        mutable.requestFingerprint = {
          algorithm: "sha256",
          digest: "a".repeat(64),
        };
      } else {
        mutable.resultingSnapshot = {
          snapshotId: "project.foreign:project:r4",
          revision: receipt.resultingSnapshot.revision,
        };
      }

      const revisionBeforeReplay = completed.revision;
      const snapshotAttemptsBeforeReplay = fixture.snapshots.saveAttempts.length;
      const captureSavesBeforeReplay = fixture.captures.saves;
      await assertRejects(
        () => fixture.executor.execute(EXEC_AGENT, fixture.command),
        EngineeringProjectCommandError,
      );
      assertEquals(fixture.project.revision, revisionBeforeReplay);
      assertEquals(
        fixture.snapshots.saveAttempts.length,
        snapshotAttemptsBeforeReplay,
      );
      assertEquals(fixture.captures.saves, captureSavesBeforeReplay);
      assertEquals(new Set(fixture.snapshots.successorIds).size, 1);
    });
  }
});

Deno.test("exact evidence comparison stays injective for colon-bearing ids", () => {
  const left: EngineeringThreadEntityRef = {
    snapshotId: "snapshot:a:b",
    snapshotRevision: 1,
    kind: "artifact",
    id: "artifact:c:d",
  };
  const right: EngineeringThreadEntityRef = {
    snapshotId: "snapshot:a",
    snapshotRevision: 1,
    kind: "artifact",
    id: "b:artifact:c:d",
  };
  assertEquals(technicalCompilationEvidenceRefsEqualForTest([left], [right]), false);
  assertEquals(technicalCompilationEvidenceRefsEqualForTest([left], [left]), true);
});

async function withExecuteFixture<T>(
  options: ExecuteFixtureOptions,
  use: (fixture: ExecuteFixture) => Promise<T>,
): Promise<T> {
  const fixture = await executeFixture(options);
  try {
    return await use(fixture);
  } finally {
    await fixture.dispose();
  }
}

function assertByteIdenticalSaveAttempts(
  snapshots: ExecuteMemorySnapshots,
): void {
  assertEquals(snapshots.saveAttempts.length > 0, true);
  assertEquals(
    new Set(snapshots.saveAttempts.map((item) => deterministicJson(item))).size,
    1,
  );
}

async function executeFixture(
  options: ExecuteFixtureOptions = {},
): Promise<ExecuteFixture> {
  const directory = await Deno.makeTempDir({ prefix: "compile-seal-execute-" });
  try {
    return await buildExecuteFixture(options, directory);
  } catch (error) {
    await removeExecuteFixtureDirectory(directory);
    throw error;
  }
}

async function buildExecuteFixture(
  options: ExecuteFixtureOptions,
  directory: string,
): Promise<ExecuteFixture> {
  const captureService = createInitialTechnicalSourceAnalysisCaptureService(
    technicalSourceAnalysisCaptureStores(directory),
  );
  const persisted = await captureService.persist(technicalSourceCaptureInput({
    profileId: INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles[0].id,
    sourceId: "source.cad",
    projectId: EXEC_PROJECT_ID,
    sourceText: options.forgedPhotoDraft
      ? "from build123d import Box\nresult = Box(20, 10, 2)\n"
      : SOURCE_TEXT,
  }));
  const reference = persisted.locator;
  const reopened = persisted;
  const source: TechnicalCompilationSource = {
    sourceText: reopened.sourceText,
    analysis: reopened.analysis,
    analysisFingerprint: await fingerprintSourceAnalysisBundle(reopened.analysis),
    effectiveUnit: reopened.document.effectiveUnit,
  };
  const sysmlFingerprint = await sha256Fingerprint({ capture: "sysml.fixture" });
  const sysmlArtifact = {
    id: "artifact.sysml",
    name: "SysML architecture",
    kind: "sysml-model" as const,
    version: sysmlFingerprint.digest,
    fingerprint: sysmlFingerprint,
    uri: `casys://architecture-capture/sha256/${sysmlFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run.sysml",
    },
    inputArtifactIds: [],
    freshness: fresh(EXEC_AT),
  };
  const requirementsFingerprint = await sha256Fingerprint({
    capture: "sysml.requirements-v3.fixture",
  });
  const requirementsArtifact = {
    id: "artifact.requirements-v3",
    name: "SysML requirements V3",
    kind: "sysml-model" as const,
    version: requirementsFingerprint.digest,
    fingerprint: requirementsFingerprint,
    uri: `casys://requirements-capture/sha256/${requirementsFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "model.write-requirements@3",
      runId: "run.requirements-v3",
    },
    inputArtifactIds: [],
    freshness: fresh(EXEC_AT),
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.compile.r1",
    revision: 1,
    generatedAt: EXEC_AT,
    subject: {
      id: EXEC_SUBJECT_ID,
      name: "Compile seal fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: sysmlArtifact.id,
    },
    freshness: fresh(EXEC_AT),
    changeSet: {
      id: "change-set.sysml",
      name: "Captured SysML",
      status: "applied",
      createdAt: EXEC_AT,
      appliedAt: EXEC_AT,
      changes: [{
        id: "change.sysml",
        kind: "created",
        target: { kind: "artifact", id: sysmlArtifact.id },
        summary: "Captured the exact SysML model.",
        afterFingerprint: sysmlFingerprint,
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
      rationale: "The applied change introduced the SysML artifact.",
    }, {
      id: "provenance.change.requirements-v3",
      relation: "changes",
      from: { kind: "change", id: "change.requirements-v3" },
      to: { kind: "artifact", id: requirementsArtifact.id },
      rationale:
        "The applied change introduced the native SysML requirements V3 artifact.",
    }],
    proposedActions: [],
  });
  const symbols = reopened.analysis.symbols;
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
  const anchorElements = [
    { id: "sysml.root", kind: "Package", provenance: sysmlProvenance },
    ...symbols.map((symbol, index) => ({
      id: `sysml.symbol.${index}`,
      kind: symbol.kind === "artifact" ? "PartUsage" : "AttributeUsage",
      provenance: requirementsProvenance,
    })),
  ];
  const anchor = {
    artifactId: sysmlArtifact.id,
    artifactFingerprint: sysmlArtifact.fingerprint,
    captureId: sysmlArtifact.fingerprint.digest,
    editingContextId: "editing-context.fixture",
    rootElementId: "sysml.root",
    rootElementKind: "Package" as const,
    elements: anchorElements,
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId: EXEC_PROJECT_ID,
      subjectId: EXEC_SUBJECT_ID,
      snapshotId: basisSnapshot.id,
      revision: 1,
      snapshotFingerprint: await sha256Fingerprint(basisSnapshot),
    },
    sysmlAnchor: anchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(anchor),
  };
  const bindings = symbols.map((symbol, index) => ({
    id: `binding.${index}`,
    sourceId: source.analysis.source.id,
    sourceSymbolId: symbol.id,
    sysmlElementId: anchorElements[index + 1].id,
    sysmlElementKind: anchorElements[index + 1].kind,
    relation: symbol.kind === "artifact"
      ? "represents" as const
      : "parameterizes" as const,
  }));
  const profile = INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG.profiles[0];
  let compiled = await compileTechnicalSources({
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
  if (options.forgedPhotoDraft) {
    const forged = {
      ...structuredClone(compiled.document),
      status: "ready-for-review" as const,
      diagnostics: [],
      projections: compiled.document.projections.map((projection) => ({
        ...structuredClone(projection),
        status: "ready-for-review" as const,
        diagnostics: [],
      })),
    };
    compiled = {
      document: forged,
      // Deliberately hash the forged bytes without invoking the validator.
      fingerprint: await sha256Fingerprint(forged),
    };
  } else if (compiled.document.status !== "ready-for-review") {
    throw new Error(`fixture compiled as ${compiled.document.status}`);
  }
  const referenceFingerprint = await sha256Fingerprint(reference);
  const draft: TechnicalCompilationDraft = {
    projectId: EXEC_PROJECT_ID,
    document: compiled.document,
    fingerprint: compiled.fingerprint,
    sourceCaptures: [{
      sourceId: source.analysis.source.id,
      reference,
      referenceFingerprint,
    }],
  };
  const draftReference: TechnicalCompilationDraftReference = {
    schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    draftId: `technical-compilation:${EXEC_PROJECT_ID}:${compiled.fingerprint.digest}`,
    projectId: EXEC_PROJECT_ID,
    documentFingerprint: compiled.fingerprint,
    envelopeFingerprint: await sha256Fingerprint(draft),
  };
  const projection = compiled.document.projections[0];
  const admission: TechnicalCompilationAdmission = {
    schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
    draft: {
      draftId: draftReference.draftId,
      projectId: draftReference.projectId,
      documentFingerprint: draftReference.documentFingerprint,
      envelopeFingerprint: draftReference.envelopeFingerprint,
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
        anchorFingerprint: basis.sysmlAnchorFingerprint,
      },
    },
    sources: [{
      id: source.analysis.source.id,
      role: source.analysis.source.role as "cad-script",
      language: source.analysis.source.language as "python",
      profileId: persisted.document.profile.id,
      profileVersion: persisted.document.profile.version,
      profileFingerprint: persisted.document.profile.fingerprint,
      analyzer: persisted.document.analysis.analyzer,
      sourceFingerprint: source.analysis.source.fingerprint,
      captureFingerprint: referenceFingerprint,
      analysisFingerprint: source.analysisFingerprint,
      effectiveUnit: persisted.document.effectiveUnit,
      attachment: persisted.document.attachment,
      sourceClosure: persisted.document.sourceClosure,
      locator: persisted.locator,
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
  const evidence: EngineeringThreadEntityRef = {
    snapshotId: basisSnapshot.id,
    snapshotRevision: basisSnapshot.revision,
    kind: "artifact",
    id: sysmlArtifact.id,
  };
  const reviewedEvidence: EngineeringThreadEntityRef = options.foreignEvidence
    ? { ...evidence, id: "artifact.foreign" }
    : evidence;
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: EXEC_SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    ...COMPILE_SEAL_ADMISSION_OPERATION,
    bindings: [{
      name: "sysmlModel",
      source: { kind: "thread-entity" as const, reference: evidence },
    }],
  };
  const parameters = encodeTechnicalCompilationAdmissionParameters(admission);
  const summary = "Seal the exact reviewed technical compilation.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [reviewedEvidence],
    proposal: { summary, parameters },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: EXEC_WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: EXEC_DECISION_ID,
      inputFingerprint: decisionFingerprint,
    }],
  });
  const project = {
    schemaVersion: "4.0",
    id: "project.compile-seal:r1",
    revision: 1,
    generatedAt: EXEC_AT,
    project: {
      id: EXEC_PROJECT_ID,
      name: "Compile seal fixture",
      subjectId: EXEC_SUBJECT_ID,
      objective: { title: "Compile", statement: "Seal exact source." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.compile",
      name: "Compile",
      order: 1,
      description: "Seal compilation.",
      workItemIds: [EXEC_WORK_ID],
      requiredDecisionIds: [EXEC_DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: EXEC_WORK_ID,
      activityId: `activity:${EXEC_WORK_ID}`,
      phaseId: "phase.compile",
      title: "Seal compilation",
      description: "Seal exact reviewed compilation.",
      kind: "review",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [EXEC_DECISION_ID],
      blockerIds: [],
    }],
    agentRuns: [{
      id: EXEC_RUN_ID,
      workItemId: EXEC_WORK_ID,
      status: "queued",
      summary: "Seal compilation.",
      queuedAt: EXEC_AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: EXEC_DECISION_ID,
      phaseId: "phase.compile",
      title: "Approve compilation",
      question: "Seal the exact compilation?",
      status: "approved",
      requestedAt: EXEC_AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [reviewedEvidence],
      approvalIds: [EXEC_APPROVAL_ID],
      proposal: {
        summary,
        parameters,
        proposedAt: EXEC_AT,
        proposedBy: { id: EXEC_AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: EXEC_APPROVAL_ID,
      decisionId: EXEC_DECISION_ID,
      status: "approved",
      requestedAt: EXEC_AT,
      decidedAt: EXEC_AT,
      decidedBy: EXEC_HUMAN.actorId,
      decidedByOrigin: options.approvalOrigin ?? "human",
      rationale: "Reviewed exact bytes.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [reviewedEvidence],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  if (options.staleHead) {
    project.threadSnapshots.push({
      snapshotId: "snapshot.compile.r2.foreign",
      revision: 2,
      subjectId: EXEC_SUBJECT_ID,
    });
  }
  const snapshots = new ExecuteMemorySnapshots(basisSnapshot, options);
  const captures = new ExecuteMemoryCaptures();
  const commands = new ExecuteCommands(project, options);
  const resolver: TechnicalCompilationBasisResolver = {
    resolve: () => {
      if (options.resolverDrift === "missing") return Promise.resolve(undefined);
      const resolved = structuredClone(basis) as MutableBasis;
      if (options.resolverDrift === "root") {
        resolved.sysmlAnchor.rootElementId = "sysml.foreign";
      } else if (options.resolverDrift === "editing-context") {
        resolved.sysmlAnchor.editingContextId = "editing-context.foreign";
      } else if (options.resolverDrift === "elements") {
        resolved.sysmlAnchor.elements = [
          ...resolved.sysmlAnchor.elements,
          {
            id: "sysml.foreign",
            kind: "PartUsage",
            provenance: resolved.sysmlAnchor.elements[0]!.provenance,
          },
        ];
      }
      return Promise.resolve(resolved);
    },
  };
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: () => Promise.resolve(project),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  const drafts: TechnicalCompilationDraftStore = {
    save: () => Promise.reject(new Error("unused")),
    read: () => {
      if (!options.unresolvedDraft) {
        return Promise.resolve(structuredClone(draft));
      }
      return Promise.resolve({
        ...structuredClone(draft),
        document: {
          ...structuredClone(draft.document),
          status: "unresolved" as const,
        },
      });
    },
  };
  const exactSourceReader = locatorBackedSourceReader(captureService);
  const sourceReader: TechnicalCompilationSourceReader = options
      .sourceProvenanceDrift ||
      options.attachmentMisaligned ||
      options.multiFileClosure
    ? {
      read: async (request) => {
        const exact = await exactSourceReader.read(request);
        if (!exact) return undefined;
        return {
          ...exact,
          source: options.multiFileClosure
            ? {
              ...exact.source,
              effectiveUnit: unloweredAuthoredRoot(exact.source.effectiveUnit),
            }
            : exact.source,
          provenance: {
            ...exact.provenance,
            ...(options.multiFileClosure
              ? {
                effectiveUnit: unloweredAuthoredRoot(
                  exact.provenance.effectiveUnit,
                ),
              }
              : {}),
            ...(options.sourceProvenanceDrift
              ? {
                analyzer: {
                  ...exact.provenance.analyzer,
                  version: "foreign-version",
                },
              }
              : {}),
            ...(options.attachmentMisaligned
              ? { attachmentAlignment: "different-basis" as const }
              : {}),
          },
        };
      },
    }
    : exactSourceReader;
  const profileProvider: TechnicalCompilationProfileCatalogProvider = {
    get: () =>
      Promise.resolve(structuredClone(
        INITIAL_TECHNICAL_COMPILATION_PROFILE_CATALOG,
      )),
  };
  const executor = new CompileSealAdmissionRunExecutor({
    projects,
    commands,
    snapshots,
    basisResolver: resolver,
    drafts,
    sources: sourceReader,
    profiles: profileProvider,
    captures,
    lease: {
      withLease: (_projectId, _scope, operation) => operation(),
    },
  });
  return {
    executor,
    command: {
      commandId: EXEC_COMMAND_ID,
      projectId: EXEC_PROJECT_ID,
      expectedRevision: 1,
      issuedAt: EXEC_AT,
      runId: EXEC_RUN_ID,
    },
    project,
    snapshots,
    captures,
    commands,
    admission,
    sysmlInputArtifactIds: [requirementsArtifact.id, sysmlArtifact.id],
    dispose: () => removeExecuteFixtureDirectory(directory),
  };
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

async function removeExecuteFixtureDirectory(directory: string): Promise<void> {
  try {
    await Deno.remove(directory, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};

type MutableReceipt = {
  -readonly [Key in keyof EngineeringProjectCommandReceipt]:
    EngineeringProjectCommandReceipt[Key];
};

type MutableBasis = {
  -readonly [Key in keyof TechnicalCompilationBasis]: Key extends "sysmlAnchor" ? {
      -readonly [AnchorKey in keyof TechnicalCompilationBasis["sysmlAnchor"]]:
        TechnicalCompilationBasis["sysmlAnchor"][AnchorKey];
    }
    : TechnicalCompilationBasis[Key];
};

class ExecuteMemorySnapshots implements TechnicalCompilationThreadSnapshotStore {
  readonly #items = new Map<string, ThreadSnapshot>();
  readonly saveAttempts: ThreadSnapshot[] = [];
  #ackLostOnce: boolean;
  #freshMissOnce: boolean;

  constructor(basis: ThreadSnapshot, options: ExecuteFixtureOptions) {
    this.#items.set(basis.id, structuredClone(basis));
    this.#ackLostOnce = options.ackLostOnce ?? false;
    this.#freshMissOnce = options.freshMissOnce ?? false;
  }

  get successorIds(): string[] {
    return this.saveAttempts.map((snapshot) => snapshot.id);
  }

  get(id: string): Promise<ThreadSnapshot | undefined> {
    const value = this.#items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }

  getFresh(id: string): Promise<ThreadSnapshot | undefined> {
    if (this.#freshMissOnce && this.successorIds.includes(id)) {
      this.#freshMissOnce = false;
      return Promise.resolve(undefined);
    }
    return this.get(id);
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const result =
      [...this.#items.values()].filter((item) => item.subject.id === subjectId).sort((
        left,
        right,
      ) => right.revision - left.revision)[0];
    return Promise.resolve(result && structuredClone(result));
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    const attempted = structuredClone(snapshot);
    this.saveAttempts.push(attempted);
    const existing = this.#items.get(snapshot.id);
    if (
      existing && deterministicJson(existing) !== deterministicJson(attempted)
    ) {
      return Promise.reject(
        new Error(`immutable snapshot ${snapshot.id} was rewritten`),
      );
    }
    if (!existing) this.#items.set(snapshot.id, attempted);
    if (this.#ackLostOnce) {
      this.#ackLostOnce = false;
      return Promise.reject(new Error("snapshot ACK lost after durable commit"));
    }
    return Promise.resolve();
  }

  tamper(
    snapshotId: string,
    mutate: (snapshot: ThreadSnapshot) => ThreadSnapshot,
  ): void {
    const snapshot = this.#items.get(snapshotId);
    if (!snapshot) throw new Error(`missing snapshot ${snapshotId}`);
    this.#items.set(snapshotId, structuredClone(mutate(structuredClone(snapshot))));
  }
}

class ExecuteMemoryCaptures implements TechnicalCompilationAdmissionCaptureStore {
  readonly #items = new Map<string, string>();
  saves = 0;

  save(fingerprint: ContentFingerprint, text: string): Promise<void> {
    this.saves += 1;
    this.#items.set(fingerprint.digest, text);
    return Promise.resolve();
  }

  read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class ExecuteCommands {
  #claimIdentity?: string;
  #completeIdentity?: string;
  #completeResult?: EngineeringProjectCommandReceipt["resultingSnapshot"];
  #publishFailsOnce: boolean;
  #completeFailsOnce: boolean;

  constructor(
    readonly project: MutableProject,
    options: ExecuteFixtureOptions,
  ) {
    this.#publishFailsOnce = options.publishFailsOnce ?? false;
    this.#completeFailsOnce = options.completeFailsOnce ?? false;
  }

  claimRun(
    origin: typeof EXEC_AGENT,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const identity = deterministicJson({ origin, command });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      this.#claimIdentity = identity;
      run.status = "running";
      run.startedAt = EXEC_AT;
      run.claimedAt = EXEC_AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      this.project.revision += 1;
      return Promise.resolve(this.project);
    }
    if (identity !== this.#claimIdentity) {
      return Promise.reject(
        new EngineeringProjectCommandError(
          "command_id_conflict",
          "claim command differs from its immutable receipt",
        ),
      );
    }
    return Promise.resolve(this.project);
  }

  publishRun(
    _origin: typeof EXEC_AGENT,
    _command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    (this.project.agentRuns[0] as MutableRun).status = "publishing";
    this.project.revision += 1;
    if (this.#publishFailsOnce) {
      this.#publishFailsOnce = false;
      return Promise.reject(new Error("publish ACK lost after durable commit"));
    }
    return Promise.resolve(this.project);
  }

  async completeRun(
    origin: typeof EXEC_AGENT,
    command: CompleteRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const identity = deterministicJson({ origin, command });
    const requestFingerprint = await sha256Fingerprint({
      type: "agent-run.complete",
      origin,
      command,
    });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "completed") {
      const receipts = this.project.commandReceipts.filter((receipt) =>
        receipt.commandId === command.commandId
      );
      const receipt = receipts[0];
      if (
        receipts.length !== 1 || !receipt ||
        identity !== this.#completeIdentity ||
        receipt.type !== "agent-run.complete" ||
        receipt.actor.id !== origin.actorId ||
        receipt.actor.origin !== origin.kind ||
        receipt.issuedAt !== command.issuedAt ||
        deterministicJson(receipt.requestFingerprint) !==
          deterministicJson(requestFingerprint) ||
        deterministicJson(receipt.resultingSnapshot) !==
          deterministicJson(this.#completeResult)
      ) {
        throw new EngineeringProjectCommandError(
          "command_id_conflict",
          "complete command differs from its immutable receipt",
        );
      }
      return this.project;
    }
    if (run.status !== "publishing") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `cannot complete from ${run.status}`,
      );
    }
    this.#completeIdentity = identity;
    run.status = "completed";
    run.completedAt = EXEC_AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    const work = this.project.workItems[0] as MutableWork;
    work.status = "completed";
    work.evidenceRefs = [...command.evidenceRefs];
    (this.project.phases[0] as MutablePhase).evidenceRefs = [
      ...command.evidenceRefs,
    ];
    if (
      !this.project.threadSnapshots.some((item) =>
        item.snapshotId === command.resultSnapshot.snapshotId
      )
    ) this.project.threadSnapshots.push(command.resultSnapshot);
    this.project.revision += 1;
    this.#completeResult = {
      snapshotId: `project.receipt.r${this.project.revision}`,
      revision: this.project.revision,
    };
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "agent-run.complete",
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: EXEC_AT,
      requestFingerprint,
      resultingSnapshot: this.#completeResult,
    });
    if (this.#completeFailsOnce) {
      this.#completeFailsOnce = false;
      return Promise.reject(new Error("complete ACK lost after durable commit"));
    }
    return Promise.resolve(this.project);
  }

  failRun(
    _origin: typeof EXEC_AGENT,
    command: FailRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const run = this.project.agentRuns[0] as MutableRun;
    run.status = "failed";
    run.failure = { code: command.code, message: command.message };
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}

type MutableRun = {
  -readonly [Key in keyof EngineeringProjectSnapshot["agentRuns"][number]]:
    EngineeringProjectSnapshot["agentRuns"][number][Key];
};
type MutableWork = {
  -readonly [Key in keyof EngineeringProjectSnapshot["workItems"][number]]:
    EngineeringProjectSnapshot["workItems"][number][Key];
};
type MutablePhase = {
  -readonly [Key in keyof EngineeringProjectSnapshot["phases"][number]]:
    EngineeringProjectSnapshot["phases"][number][Key];
};

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}
