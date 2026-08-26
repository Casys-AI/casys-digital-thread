import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { EngineeringProjectCommandError } from "../../project/engineering-project-command-service.ts";
import type {
  AdmittedModelicaExecutionProfile,
  AdmittedModelicaExecutionProfileCatalog,
  AdmittedModelicaExecutionProfileFingerprintBody,
} from "../../../ports/out/modelica/admitted-execution-profile-catalog.ts";
import { ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA } from "../../../ports/out/modelica/admitted-execution-profile-catalog.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  encodeModelicaAdmittedRunAdmissionParameters,
  MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  MODELICA_ADMITTED_EXECUTION_PROFILE,
  MODELICA_ADMITTED_OUTPUT_MANIFEST,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
} from "../../../../domain/modelica/admitted/run-proposal.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintSourceAnalysisBundle } from "../../../../domain/compile/source/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfile,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import {
  sampleAdmissionSourceWorkspaceFields,
  technicalSourceCaptureInput,
} from "../../../../testing/technical-source-capture-test-support.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import { QualifiedModelicaSourceAnalyzer } from "../../../../adapters/modelica/source/qualified-source-analyzer.ts";
import { PrepareProjectAdmittedModelicaRunReview } from "./prepare-run-review.ts";
import {
  assertAdmittedModelicaAdmissionScope,
  reopenAdmittedExecutionRequest,
  requireAdmittedModelicaExecutionShape,
  requireReviewedAdmittedModelicaAuthority,
} from "./reopen-reviewed-execution.ts";

const MODELICA_ADMITTED_GENERIC_SOURCE = `model GenericOscillator
  parameter Real initialPosition(unit = "m") = 0;
  parameter Real drive(unit = "m/s2") = 2;
  output Real position(unit = "m", start = initialPosition, fixed = true);
  output Real velocity(unit = "m/s", start = 0, fixed = true);
equation
  der(position) = velocity;
  der(velocity) = drive-position;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end GenericOscillator;
`;

class FakeAdmissionReader implements TechnicalCompilationAdmissionReader {
  constructor(public result: ReopenedTechnicalCompilationAdmission) {}
  read(): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    return Promise.resolve(structuredClone(this.result));
  }
}

class FakeProfiles implements AdmittedModelicaExecutionProfileCatalog {
  initialCalls = 0;
  resolveCalls = 0;
  constructor(public profile: AdmittedModelicaExecutionProfile) {}
  initial(): Promise<AdmittedModelicaExecutionProfile> {
    this.initialCalls += 1;
    return Promise.resolve(structuredClone(this.profile));
  }
  resolve(): Promise<AdmittedModelicaExecutionProfile> {
    this.resolveCalls += 1;
    return Promise.reject(new Error("reviewed reopen must use profiles.initial"));
  }
}

Deno.test("reviewed reopen takes sealed Modelica bytes and never caller text or a snapshot", async () => {
  const fixture = await harness();
  const admission = (await fixture.review.execute(fixture.command)).admission;
  fixture.profiles.initialCalls = 0;
  const context = await reopenAdmittedExecutionRequest({
    admissions: fixture.reader,
    profiles: fixture.profiles,
    project: { project: { id: "project.ramp" } } as never,
    run: { id: "run.admitted", basis: fixture.command.basis } as never,
    admission,
  });
  assertEquals(
    new TextDecoder().decode(context.request.source.bytes),
    MODELICA_ADMITTED_GENERIC_SOURCE,
  );
  assertEquals(context.request.outputs, [...MODELICA_ADMITTED_OUTPUT_MANIFEST]);
  assertEquals(fixture.profiles.initialCalls, 2);
  assertEquals(fixture.profiles.resolveCalls, 0);
  assertEquals("basisSnapshot" in context, false);
  assertEquals("modelicaText" in context.request, false);
});

Deno.test("reviewed reopen refuses a Build123d projection before isolated request construction", async () => {
  const fixture = await harness();
  const admission = (await fixture.review.execute(fixture.command)).admission;
  const capture = structuredClone(fixture.reopened);
  (capture.document.projections[0] as { target: string }).target = "build123d-source";
  fixture.reader.result = capture;
  await assertRejects(
    () =>
      reopenAdmittedExecutionRequest({
        admissions: fixture.reader,
        profiles: fixture.profiles,
        project: { project: { id: "project.ramp" } } as never,
        run: { id: "run.admitted", basis: fixture.command.basis } as never,
        admission,
      }),
    Error,
  );
});

Deno.test("reviewed authority and scope stay pre-WAL and reject an agent approval", async () => {
  const fixture = await harness();
  const admission = (await fixture.review.execute(fixture.command)).admission;
  const project = await reviewedProject(admission, fixture.command.basis, {
    agentApproval: true,
  });
  await assertRejects(
    () =>
      requireReviewedAdmittedModelicaAuthority(
        project,
        project.agentRuns[0] as EngineeringAgentRun,
      ),
    EngineeringProjectCommandError,
    "human approval",
  );
  const valid = await reviewedProject(admission, fixture.command.basis);
  const authority = await requireReviewedAdmittedModelicaAuthority(
    valid,
    valid.agentRuns[0] as EngineeringAgentRun,
  );
  requireAdmittedModelicaExecutionShape(
    valid,
    valid.agentRuns[0] as EngineeringAgentRun,
  );
  assertAdmittedModelicaAdmissionScope(
    valid,
    valid.agentRuns[0] as EngineeringAgentRun,
    authority.decision,
    authority.admission,
  );
  const foreign = structuredClone(valid) as EngineeringProjectSnapshot & {
    workItems: Array<{ operation: { id: string } }>;
  };
  foreign.workItems[0]!.operation.id = "simulate.run-qualified-modelica-kit";
  assertThrows(
    () =>
      requireAdmittedModelicaExecutionShape(
        foreign,
        foreign.agentRuns[0] as EngineeringAgentRun,
      ),
    EngineeringProjectCommandError,
    "simulate.run-admitted-modelica@1",
  );
});

Deno.test("admitted reviewed reopen stays distinct from the qualified kit by imports and composition", async () => {
  const reopen = await Deno.readTextFile(
    new URL("./reopen-reviewed-execution.ts", import.meta.url),
  );
  const composition = await Deno.readTextFile(
    new URL("../../../../adapters/modelica/server-composition.ts", import.meta.url),
  );
  assertEquals(reopen.includes("qualified-kit"), false);
  assertEquals(reopen.includes("modelicaText"), false);
  assertEquals(reopen.includes("profiles.initial()"), true);
  assertEquals(reopen.includes("modelica-source-qualification"), true);
  assertEquals(composition.includes("SimulateRunAdmittedModelicaRunExecutor"), true);
  assertEquals(
    composition.includes("SimulateRunQualifiedModelicaKitRunExecutor"),
    true,
  );
  assertEquals(
    composition.includes("createAdmittedModelicaExecutionComposition"),
    true,
  );
});

async function reviewedProject(
  admission: Awaited<
    ReturnType<PrepareProjectAdmittedModelicaRunReview["execute"]>
  >["admission"],
  basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
  options: { readonly agentApproval?: boolean } = {},
): Promise<EngineeringProjectSnapshot> {
  const basisRef = {
    snapshotId: basis.snapshotId,
    revision: basis.revision,
    subjectId: basis.subjectId,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...basisRef };
  const evidenceRef = {
    snapshotId: basis.snapshotId,
    snapshotRevision: basis.revision,
    kind: "artifact" as const,
    id: admission.admissionArtifact.id,
  };
  const proposal = {
    summary: "Execute the exact admitted Modelica source.",
    parameters: encodeModelicaAdmittedRunAdmissionParameters(admission),
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: basisRef,
    inputEvidenceRefs: [evidenceRef],
    proposal,
  });
  const operation = {
    ...SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
    bindings: [{
      name: "compilationAdmission",
      source: { kind: "thread-entity" as const, reference: evidenceRef },
    }],
  };
  const runFingerprint = await sha256Fingerprint({
    workItemId: "work.modelica.admitted",
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: "decision.modelica.admitted",
      inputFingerprint: decisionFingerprint,
    }],
  });
  return {
    schemaVersion: "4.0",
    workItems: [{
      id: "work.modelica.admitted",
      decisionIds: ["decision.modelica.admitted"],
      operation,
    }],
    agentRuns: [{
      id: "run.admitted",
      workItemId: "work.modelica.admitted",
      basis: runBasis,
      inputFingerprint: runFingerprint,
    }],
    decisions: [{
      id: "decision.modelica.admitted",
      status: "approved",
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
      approvalIds: ["approval.modelica.admitted"],
      baseSnapshot: basisRef,
      proposal: {
        ...proposal,
        proposedAt: "2026-08-20T05:00:00.000Z",
        proposedBy: { id: "agent.modelica", origin: "agent" },
      },
    }],
    approvals: [{
      id: "approval.modelica.admitted",
      decisionId: "decision.modelica.admitted",
      status: "approved",
      decidedAt: "2026-08-20T05:00:00.000Z",
      decidedBy: "human.reviewer",
      decidedByOrigin: options.agentApproval ? "agent" : "human",
      baseSnapshot: basisRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
    }],
  } as unknown as EngineeringProjectSnapshot;
}

async function harness() {
  const sourceText = MODELICA_ADMITTED_GENERIC_SOURCE;
  const sourceWorkspace = sampleAdmissionSourceWorkspaceFields(
    "source.modelica.generic-oscillator",
    { projectId: "project.ramp" },
  );
  const sourceCapture = technicalSourceCaptureInput({
    profileId: "modelica-closed-subset-v2",
    sourceId: "source.modelica.generic-oscillator",
    sourceText,
    projectId: "project.ramp",
    attachment: sourceWorkspace.attachment,
    sourceClosure: sourceWorkspace.sourceClosure,
  });
  const analysis = await new QualifiedModelicaSourceAnalyzer().analyze({
    sourceId: sourceCapture.sourceId,
    role: "modelica-model",
    language: "modelica",
    sourceText,
  });
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const analysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
  const sysmlFingerprint = { algorithm: "sha256" as const, digest: "2".repeat(64) };
  const provenance = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlFingerprint,
    captureId: "capture.syson",
  };
  const sysmlAnchor = {
    artifactId: "artifact.sysml",
    artifactFingerprint: sysmlFingerprint,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "sysml.package.main",
    rootElementKind: "Package" as const,
    elements: [
      { id: "sysml.package.main", kind: "Package", provenance },
      { id: "sysml.part.oscillator", kind: "PartUsage", provenance },
      { id: "sysml.attribute.initial-position", kind: "AttributeUsage", provenance },
      { id: "sysml.attribute.drive", kind: "AttributeUsage", provenance },
    ],
  };
  const basis: TechnicalCompilationBasis = {
    thread: {
      projectId: "project.ramp",
      subjectId: "subject.ramp",
      snapshotId: "snapshot.7",
      revision: 7,
      snapshotFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    sysmlAnchor,
    sysmlAnchorFingerprint: await fingerprintTechnicalSysmlAnchor(sysmlAnchor),
  };
  const compilationProfile: TechnicalCompilationProfile = {
    id: "modelica-closed-subset-v2",
    version: "2.0.0",
    target: "modelica-source-qualification",
    sourceRole: "modelica-model",
    language: "modelica",
    analyzer: analysis.analyzer,
    analysisPolicyProfile: "modelica-closed-subset-v2",
    requiredBindingSymbolKinds: ["artifact", "parameter"],
  };
  const artifact = analysis.symbols.find((symbol) => symbol.kind === "artifact")!;
  const parameters = analysis.symbols.filter((symbol) => symbol.kind === "parameter");
  const compiled = await compileTechnicalSources({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint: await fingerprintTechnicalCompilationBasis(basis),
    sources: [{
      sourceText,
      analysis,
      analysisFingerprint,
      effectiveUnit: sourceCapture.effectiveUnit,
    }],
    bindings: [
      {
        id: "binding.model",
        sourceId: analysis.source.id,
        sourceSymbolId: artifact.id,
        sysmlElementId: "sysml.part.oscillator",
        sysmlElementKind: "PartUsage",
        relation: "represents",
      },
      {
        id: "binding.initial-position",
        sourceId: analysis.source.id,
        sourceSymbolId: parameters.find((symbol) => symbol.name === "initialPosition")!
          .id,
        sysmlElementId: "sysml.attribute.initial-position",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      },
      {
        id: "binding.drive",
        sourceId: analysis.source.id,
        sourceSymbolId: parameters.find((symbol) => symbol.name === "drive")!.id,
        sysmlElementId: "sysml.attribute.drive",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      },
    ],
    profileRequests: [{
      profileId: compilationProfile.id,
      profileVersion: compilationProfile.version,
      sourceIds: [analysis.source.id],
    }],
  }, {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [compilationProfile],
  });
  const projection = compiled.document.projections[0]!;
  const admission = parseTechnicalCompilationAdmissionParameters(
    encodeTechnicalCompilationAdmissionParameters({
      schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
      draft: {
        draftId: `technical-compilation:project.ramp:${compiled.fingerprint.digest}`,
        projectId: "project.ramp",
        documentFingerprint: compiled.fingerprint,
        envelopeFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
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
          artifactId: basis.sysmlAnchor.artifactId,
          artifactFingerprint: basis.sysmlAnchor.artifactFingerprint,
          captureId: basis.sysmlAnchor.captureId,
          editingContextId: basis.sysmlAnchor.editingContextId,
          rootElementId: basis.sysmlAnchor.rootElementId,
          rootElementKind: basis.sysmlAnchor.rootElementKind,
          anchorFingerprint: basis.sysmlAnchorFingerprint,
        },
      },
      sources: [{
        id: analysis.source.id,
        role: analysis.source.role,
        language: analysis.source.language,
        profileId: compilationProfile.id,
        profileVersion: compilationProfile.version,
        profileFingerprint: await sha256Fingerprint({
          id: compilationProfile.id,
          version: compilationProfile.version,
          role: "modelica-model",
          language: "modelica",
          analyzer: compilationProfile.analyzer,
          maximumSourceBytes: 262_144,
        }),
        analyzer: analysis.analyzer,
        sourceFingerprint,
        captureFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
        analysisFingerprint,
        effectiveUnit: sourceCapture.effectiveUnit,
        attachment: sourceCapture.attachment,
        sourceClosure: sourceCapture.sourceClosure,
        locator: sourceWorkspace.locator,
      }],
      bindings: compiled.document.inputManifest.bindings,
      compilationProfileRequests: [{
        profileId: compilationProfile.id,
        profileVersion: compilationProfile.version,
        target: "modelica-source-qualification",
        sourceIds: [analysis.source.id],
        profileFingerprint: projection.profileFingerprint,
      }],
      compilation: {
        fingerprint: compiled.fingerprint,
        status: "ready-for-review",
      },
    }),
  );
  const artifactFingerprint = await sha256Fingerprint({
    schemaVersion: MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
    projectId: "project.ramp",
    compilation: compiled.fingerprint,
  });
  const command = {
    projectId: "project.ramp",
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snapshot.8",
      revision: 8,
      subjectId: "subject.ramp",
    },
    artifactId: `technical-compilation-admission-${artifactFingerprint.digest}`,
    artifactFingerprint,
  };
  const reopened: ReopenedTechnicalCompilationAdmission = {
    schemaVersion: "technical-compilation-admission-capture/4.0",
    operation: COMPILE_SEAL_ADMISSION_OPERATION,
    trustedRunId: "run.compile.seal",
    decisionId: "decision.compile.seal",
    sealedAt: "2026-08-13T08:00:00.000Z",
    draftReference: {
      schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
      draftId: admission.draft.draftId,
      projectId: admission.draft.projectId,
      documentFingerprint: admission.draft.documentFingerprint,
      envelopeFingerprint: admission.draft.envelopeFingerprint,
    },
    admission,
    document: compiled.document,
  };
  const profileBody: AdmittedModelicaExecutionProfileFingerprintBody = {
    schemaVersion: ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
    executionProfile: MODELICA_ADMITTED_EXECUTION_PROFILE,
    compilationTarget: "modelica-source-qualification",
    compilationProfile: projection.profile,
    compilationProfileFingerprint: projection.profileFingerprint,
    isolationPolicy: {
      id: "isolation.modelica-closed-v1",
      version: "2.0.0",
      fingerprint: await sha256Fingerprint({
        id: "isolation.modelica-closed-v1",
        version: "1.0.0",
        network: "deny-all",
      }),
    },
    runtimeBackend: {
      ...MICROSANDBOX_LOCAL_RUNTIME_REF,
      imageReference: `casys/modelica-microsandbox-worker@sha256:${"5".repeat(64)}`,
      imageDigest: { algorithm: "sha256", digest: "5".repeat(64) },
    },
    runtime: {
      isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
      imageDigest: { algorithm: "sha256", digest: "5".repeat(64) },
      requestedLimits: {
        maxWallTimeMs: 30_000,
        maxCpuTimeMs: 20_000,
        maxMemoryBytes: 1_073_741_824,
        maxProcesses: 32,
        maxStdoutBytes: 65_536,
        maxStderrBytes: 65_536,
        maxOutputFileBytes: 1_048_576,
        maxOutputTotalBytes: 2_097_152,
      },
      limitAssurance: {
        maxWallTimeMs: "backend-attested",
        maxCpuTimeMs: "unattested",
        maxMemoryBytes: "backend-attested",
        maxProcesses: "unattested",
        maxStdoutBytes: "broker-observed-cap",
        maxStderrBytes: "broker-observed-cap",
        maxOutputFileBytes: "broker-observed-cap",
        maxOutputTotalBytes: "broker-observed-cap",
      },
    },
    outputManifest: [...MODELICA_ADMITTED_OUTPUT_MANIFEST],
    outputValidator: {
      id: "modelica-closed-subset-v2-result-normalizer",
      version: "2.0.0",
    },
    maximumSourceBytes: 262_144,
    minimumDestructionAssurance: "proven",
  };
  const profile: AdmittedModelicaExecutionProfile = {
    ...profileBody,
    profileFingerprint: await sha256Fingerprint(profileBody),
  };
  const reader = new FakeAdmissionReader(reopened);
  const profiles = new FakeProfiles(profile);
  return {
    command,
    reopened,
    reader,
    profiles,
    review: new PrepareProjectAdmittedModelicaRunReview({
      admissions: reader,
      profiles,
    }),
  };
}
