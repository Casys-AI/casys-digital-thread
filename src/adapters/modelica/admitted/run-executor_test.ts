import { assert, assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  AdmittedModelicaExecutionAttemptStore,
  AdmittedModelicaExecutionDispatchTransition,
} from "../../../application/ports/out/modelica/admitted-execution-attempt-store.ts";
import type {
  CompleteRunCommand,
  FailRunCommand,
  RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import { QualifiedModelicaSourceAnalyzer } from "../source/qualified-source-analyzer.ts";
import { PrepareProjectAdmittedModelicaRunReview } from "../../../application/use-cases/modelica/admitted/prepare-run-review.ts";
import {
  ADMITTED_MODELICA_EXECUTION_PROFILE_SCHEMA,
  type AdmittedModelicaExecutionProfile,
  type AdmittedModelicaExecutionProfileCatalog,
  type AdmittedModelicaExecutionProfileFingerprintBody,
} from "../../../application/ports/out/modelica/admitted-execution-profile-catalog.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  encodeModelicaAdmittedRunAdmissionParameters,
  MODELICA_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  MODELICA_ADMITTED_EXECUTION_PROFILE,
  MODELICA_ADMITTED_OUTPUT_MANIFEST,
  type ModelicaAdmittedRunAdmission,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
} from "../../../domain/modelica/admitted/run-proposal.ts";
import { admittedModelicaExecutionContractFromSourceBytes } from "../../../domain/modelica/admitted/execution-evidence.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintSourceAnalysisBundle } from "../../../domain/compile/source/source-analysis.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSourceText,
  fingerprintTechnicalSysmlAnchor,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationProfile,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  sampleAdmissionSourceWorkspaceFields,
  technicalSourceCaptureInput,
} from "../../../testing/technical-source-capture-test-support.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputProducerGenerationAdvance,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { IsolatedCodeOutputValidationRejectedError } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { FileAdmittedModelicaExecutionAttemptStore } from "./file-execution-attempt-store.ts";
import { FileEngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  reopenAdmittedExecutionRequest,
  SimulateRunAdmittedModelicaRunExecutor,
  type SimulateRunAdmittedModelicaRunExecutorDependencies,
} from "./run-executor.ts";

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

Deno.test("admitted execute reopens sealed Modelica bytes and never takes caller text", async () => {
  const fixture = await harness();
  const context = await reopenAdmittedExecutionRequest({
    admissions: fixture.reader,
    profiles: fixture.profiles,
    project: { project: { id: "project.ramp" } } as never,
    run: { id: "run.admitted", basis: fixture.command.basis } as never,
    admission: (await fixture.review.execute(fixture.command)).admission,
  });
  const sourceSha = (await fingerprintTechnicalSourceText(
    MODELICA_ADMITTED_GENERIC_SOURCE,
  )).digest;
  assertEquals(context.request.source.sha256, sourceSha);
  assertEquals(
    new TextDecoder().decode(context.request.source.bytes),
    MODELICA_ADMITTED_GENERIC_SOURCE,
  );
  assertEquals(context.request.outputs, [...MODELICA_ADMITTED_OUTPUT_MANIFEST]);
});

Deno.test("admitted execute refuses a Build123d projection", async () => {
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

class FakeAdmissionReader implements TechnicalCompilationAdmissionReader {
  constructor(public result: ReopenedTechnicalCompilationAdmission) {}
  read(): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    return Promise.resolve(structuredClone(this.result));
  }
}

class FakeProfiles implements AdmittedModelicaExecutionProfileCatalog {
  constructor(public profile: AdmittedModelicaExecutionProfile) {}
  initial(): Promise<AdmittedModelicaExecutionProfile> {
    return Promise.resolve(structuredClone(this.profile));
  }
  resolve(): Promise<AdmittedModelicaExecutionProfile> {
    return Promise.resolve(structuredClone(this.profile));
  }
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
      {
        id: "sysml.attribute.drive",
        kind: "AttributeUsage",
        provenance,
      },
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
    requiredBindingSymbolKinds: ["parameter"],
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

const EXECUTION_AT = "2026-08-20T05:00:00.000Z";
const EXECUTION_AGENT = { kind: "agent" as const, actorId: "agent.modelica" };
const EXECUTION_COMMAND = {
  commandId: "execute.modelica.admitted",
  projectId: "project.ramp",
  expectedRevision: 1,
  issuedAt: EXECUTION_AT,
  runId: "run.admitted",
};

Deno.test("admitted project executor journals, dispatches once, completes, and replays read-only", async () => {
  const fixture = await executorHarness();
  try {
    const completed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    assertEquals(runStatus(completed), "completed");
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.attempts.prepareCalls, 1);
    assertEquals(
      (await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      ))?.phase,
      "completed",
    );
    const saveCalls = fixture.snapshots.saveCalls;
    const captureSaves = fixture.captures.saveCalls;
    const replay = await fixture.executor.execute(EXECUTION_AGENT, {
      ...EXECUTION_COMMAND,
      expectedRevision: completed.revision,
    });
    assertEquals(runStatus(replay), "completed");
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.snapshots.saveCalls, saveCalls);
    assertEquals(fixture.captures.saveCalls, captureSaves);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("admitted executor refuses evidence that misattests the reopened source or result bytes", async () => {
  for (
    const options of [
      { evidenceInputBundleDrift: true },
      { evidenceResultDrift: true },
    ] as const
  ) {
    const fixture = await executorHarness(options);
    try {
      await assertRejects(
        () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
        "does not attest the reopened source and exact result bytes",
      );
      assertEquals(fixture.runtime.runs, [0]);
      assertEquals(fixture.captures.saveCalls, 0);
      assertEquals(fixture.snapshots.saveCalls, 0);
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("admitted authority and basis-artifact drift stop before WAL and isolated effects", async () => {
  for (
    const drift of [
      "agent-approval",
      "decision-fingerprint",
      "run-fingerprint",
      "artifact-id",
      "artifact-fingerprint",
      "artifact-version",
      "artifact-uri",
      "artifact-media",
      "artifact-producer",
      "artifact-stale",
      "artifact-archived",
    ] as const
  ) {
    const fixture = await executorHarness({ drift });
    try {
      await assertRejects(
        () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
      );
      assertEquals(fixture.attempts.prepareCalls, 0, drift);
      assertEquals(fixture.runtime.runs, [], drift);
      assertEquals(fixture.runtime.recoveries, [], drift);
      assertEquals(runStatus(fixture.project), "queued", drift);
      assertEquals(fixture.project.commandReceipts, [], drift);
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("an already-running admitted run without WAL is permanently quarantined", async () => {
  const fixture = await executorHarness({ initialStatus: "running" });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
      "no durable execution journal",
    );
    assertEquals(fixture.attempts.prepareCalls, 0);
    assertEquals(fixture.runtime.runs, []);
    assertEquals(fixture.runtime.recoveries, []);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("a lost prepared-WAL acknowledgement resumes with one generation-zero dispatch", async () => {
  const fixture = await executorHarness({ losePrepareAck: true });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
      "prepared WAL acknowledgement lost",
    );
    assertEquals(runStatus(fixture.project), "running");
    assertEquals(fixture.runtime.runs, []);
    assertEquals(
      (await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      ))?.phase,
      "prepared",
    );
    const completed = await fixture.executor.execute(EXECUTION_AGENT, {
      ...EXECUTION_COMMAND,
      expectedRevision: fixture.project.revision,
    });
    assertEquals(runStatus(completed), "completed");
    assertEquals(fixture.attempts.prepareCalls, 1);
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("an active admitted WAL cannot be transplanted to another command identity", async () => {
  const fixture = await executorHarness({ loseDispatchAck: true });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
    );
    const receiptCount = fixture.project.commandReceipts.length;
    assertEquals(fixture.runtime.runs, []);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(
      (await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      ))?.phase,
      "dispatching",
    );
    await assertRejects(
      () =>
        fixture.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          commandId: "foreign-command",
          expectedRevision: fixture.project.revision,
        }),
      Error,
      "no unique exact agent-run.claim receipt",
    );
    assertEquals(fixture.runtime.runs, []);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.project.commandReceipts.length, receiptCount);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("active claim and publishing receipts must reopen from their exact historical revisions", async () => {
  const active = await executorHarness({ loseDispatchAck: true });
  try {
    await assertRejects(
      () => active.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
    );
    const claimReceipt = active.project.commandReceipts.find((receipt) =>
      receipt.type === "agent-run.claim"
    ) as MutableReceipt;
    claimReceipt.resultingSnapshot = {
      ...claimReceipt.resultingSnapshot,
      snapshotId: "project.ramp:r1",
    };
    const receiptCount = active.project.commandReceipts.length;
    await assertRejects(
      () =>
        active.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: active.project.revision,
        }),
      Error,
      "exact immutable project revision",
    );
    assertEquals(runStatus(active.project), "running");
    assertEquals(active.project.commandReceipts.length, receiptCount);
    assertEquals(active.runtime.runs, []);
    assertEquals(active.runtime.recoveries, []);
  } finally {
    await active.dispose();
  }

  const publishing = await executorHarness({ acknowledgementLoss: "publish" });
  try {
    await assertRejects(
      () => publishing.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
    );
    assertEquals(runStatus(publishing.project), "publishing");
    const publishReceipt = publishing.project.commandReceipts.find((receipt) =>
      receipt.type === "agent-run.publish"
    ) as MutableReceipt;
    publishReceipt.resultingSnapshot = {
      ...publishReceipt.resultingSnapshot,
      snapshotId: "project.ramp:r2",
    };
    const receiptCount = publishing.project.commandReceipts.length;
    const snapshotSaves = publishing.snapshots.saveCalls;
    const captureSaves = publishing.captures.saveCalls;
    await assertRejects(
      () =>
        publishing.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: publishing.project.revision,
        }),
      Error,
      "exact immutable project revision",
    );
    assertEquals(runStatus(publishing.project), "publishing");
    assertEquals(publishing.project.commandReceipts.length, receiptCount);
    assertEquals(publishing.snapshots.saveCalls, snapshotSaves);
    assertEquals(publishing.captures.saveCalls, captureSaves);
    assertEquals(publishing.runtime.runs, [0]);
    assertEquals(publishing.runtime.recoveries, []);
  } finally {
    await publishing.dispose();
  }
});

Deno.test("a lost generation-zero WAL acknowledgement never dispatches from replay", async () => {
  const fixture = await executorHarness({ loseDispatchAck: true });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
    );
    assertEquals(fixture.runtime.runs, []);
    const completed = await fixture.executor.execute(EXECUTION_AGENT, {
      ...EXECUTION_COMMAND,
      expectedRevision: fixture.project.revision,
    });
    assertEquals(runStatus(completed), "completed");
    assertEquals(fixture.runtime.runs, [1]);
    assertEquals(fixture.runtime.recoveries, [0]);
    assertEquals(fixture.runtime.advances, 1);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("a lost generation-one WAL acknowledgement is CAS-only and never dispatches generation one", async () => {
  const fixture = await executorHarness({
    failGenerationZero: true,
    loseRedispatchAck: true,
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
    );
    assertEquals(fixture.runtime.runs, [0]);
    await assertRejects(
      () =>
        fixture.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: fixture.project.revision,
        }),
      Error,
      "no third dispatch",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, [0, 1]);
    assertEquals(fixture.runtime.advances, 1);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("generation-zero not-published recovery advances once and dispatches one generation one", async () => {
  const fixture = await executorHarness({ failGenerationZero: true });
  try {
    const completed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    assertEquals(runStatus(completed), "completed");
    assertEquals(fixture.runtime.runs, [0, 1]);
    assertEquals(fixture.runtime.recoveries, [0]);
    assertEquals(fixture.runtime.advances, 1);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("CAS publication followed by a runner throw is adopted for either admitted generation", async () => {
  for (
    const options of [
      { publishThenThrow: [0] as const },
      { failGenerationZero: true, publishThenThrow: [1] as const },
    ]
  ) {
    const fixture = await executorHarness(options);
    try {
      const completed = await fixture.executor.execute(
        EXECUTION_AGENT,
        EXECUTION_COMMAND,
      );
      assertEquals(runStatus(completed), "completed");
      assertEquals(
        fixture.runtime.runs,
        options.failGenerationZero ? [0, 1] : [0],
      );
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("outcome-unknown CAS recovery never cleans, advances, or redispatches", async () => {
  const fixture = await executorHarness({
    loseDispatchAck: true,
    outcomeUnknownGeneration: 0,
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
    );
    await assertRejects(
      () =>
        fixture.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: fixture.project.revision,
        }),
      Error,
      "outcome remains unknown",
    );
    assertEquals(fixture.runtime.runs, []);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.runtime.advances, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("cleanup and generation-advance acknowledgement losses resume without duplicate dispatch", async () => {
  for (
    const options of [
      { loseDestroyAck: true },
      { loseGenerationZeroCleanedAck: true },
      { loseAdvanceAck: true },
    ]
  ) {
    const fixture = await executorHarness({
      failGenerationZero: true,
      ...options,
    });
    try {
      await assertRejects(
        () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
      );
      const completed = await fixture.executor.execute(EXECUTION_AGENT, {
        ...EXECUTION_COMMAND,
        expectedRevision: fixture.project.revision,
      });
      assertEquals(runStatus(completed), "completed");
      assertEquals(fixture.runtime.runs, [0, 1]);
      assertEquals(fixture.runtime.advances, 1);
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("a divergent CAS resolution reference is quarantined without cleanup or replay dispatch", async () => {
  const fixture = await executorHarness({
    publishThenThrow: [0],
    resolutionRefDrift: true,
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
      "reference differs",
    );
    await assertRejects(
      () =>
        fixture.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: fixture.project.revision,
        }),
      Error,
      "reference differs",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.runtime.advances, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("capture and publish acknowledgement losses resume from output-published without rerunning", async () => {
  for (const loss of ["capture", "publish"] as const) {
    const fixture = await executorHarness({ acknowledgementLoss: loss });
    try {
      await assertRejects(
        () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
        Error,
      );
      assertEquals(fixture.runtime.runs, [0], loss);
      const completed = await fixture.executor.execute(EXECUTION_AGENT, {
        ...EXECUTION_COMMAND,
        expectedRevision: fixture.project.revision,
      });
      assertEquals(runStatus(completed), "completed", loss);
      assertEquals(fixture.runtime.runs, [0], loss);
      assertEquals(fixture.runtime.recoveries, [], loss);
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("durable output, Thread, project-complete, and WAL-complete acknowledgement losses never rerun", async () => {
  for (
    const options of [
      { loseOutputPublishedAck: true },
      { loseThreadSaveAck: true },
      { loseCompleteAck: true },
      { loseCompletedAck: true },
    ]
  ) {
    const fixture = await executorHarness(options);
    try {
      try {
        await fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND);
      } catch {
        // The durable write may deliberately lose its acknowledgement.
      }
      const completed = await fixture.executor.execute(EXECUTION_AGENT, {
        ...EXECUTION_COMMAND,
        expectedRevision: fixture.project.revision,
      });
      assertEquals(runStatus(completed), "completed");
      assertEquals(fixture.runtime.runs, [0]);
      assertEquals(fixture.runtime.recoveries, []);
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("project-completed plus output-published WAL window closes only after exact reopen", async () => {
  const fixture = await executorHarness({ loseCompletionJournalBeforeWrite: true });
  try {
    await assertRejects(
      () => fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      Error,
    );
    assertEquals(runStatus(fixture.project), "completed");
    assertEquals(
      (await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      ))?.phase,
      "output-published",
    );
    const completed = await fixture.executor.execute(EXECUTION_AGENT, {
      ...EXECUTION_COMMAND,
      expectedRevision: fixture.project.revision,
    });
    assertEquals(runStatus(completed), "completed");
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(
      (await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      ))?.phase,
      "completed",
    );
  } finally {
    await fixture.dispose();
  }
});

Deno.test("completed admitted replay rejects capture, Thread, phase, or work-state drift without runner or recovery", async () => {
  for (const drift of ["capture", "thread", "phase", "work-status"] as const) {
    const fixture = await executorHarness();
    try {
      const completed = await fixture.executor.execute(
        EXECUTION_AGENT,
        EXECUTION_COMMAND,
      );
      if (drift === "capture") fixture.captures.drift = true;
      else if (drift === "thread") fixture.snapshots.driftLatest = true;
      else if (drift === "phase") {
        (fixture.project.phases[0] as MutablePhase).evidenceRefs = fixture.project
          .phases[0]!.evidenceRefs.slice(1);
      } else {
        (fixture.project.workItems[0] as MutableWork).status = "in-progress";
      }
      await assertRejects(
        () =>
          fixture.executor.execute(EXECUTION_AGENT, {
            ...EXECUTION_COMMAND,
            expectedRevision: completed.revision,
          }),
        Error,
      );
      assertEquals(fixture.runtime.runs, [0], drift);
      assertEquals(fixture.runtime.recoveries, [], drift);
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("completed admitted replay rejects command-receipt drift and command transplant read-only", async () => {
  for (
    const drift of [
      "fingerprint",
      "revision",
      "snapshot-id",
      "issued-at",
      "applied-at",
      "status-history",
      "summary",
      "claimed-at",
      "completed-at",
      "coordinated-claim-timeline",
      "historical-receipt",
      "historical-generated-at",
      "command",
    ] as const
  ) {
    const fixture = await executorHarness();
    try {
      const completed = await fixture.executor.execute(
        EXECUTION_AGENT,
        EXECUTION_COMMAND,
      );
      const saveCalls = fixture.snapshots.saveCalls;
      const captureSaves = fixture.captures.saveCalls;
      let replayCommand = {
        ...EXECUTION_COMMAND,
        expectedRevision: completed.revision,
      };
      if (drift === "command") {
        replayCommand = { ...replayCommand, commandId: "foreign-command" };
      } else if (drift === "status-history") {
        const run = fixture.project.agentRuns[0] as MutableRun;
        run.statusHistory = run.statusHistory?.map((transition) =>
          transition.status === "completed"
            ? { ...transition, summary: "Transplanted completion" }
            : transition
        );
      } else if (drift === "summary") {
        (fixture.project.agentRuns[0] as MutableRun).summary =
          "Transplanted completion";
      } else if (drift === "claimed-at") {
        (fixture.project.agentRuns[0] as MutableRun).claimedAt =
          "2026-08-20T05:00:01.000Z";
      } else if (drift === "completed-at") {
        (fixture.project.agentRuns[0] as MutableRun).completedAt =
          "2026-08-20T05:00:01.000Z";
      } else if (drift === "coordinated-claim-timeline") {
        const changedAt = "2026-08-20T05:00:01.000Z";
        const run = fixture.project.agentRuns[0] as MutableRun;
        const receipt = fixture.project.commandReceipts.find((item) =>
          item.type === "agent-run.claim"
        ) as MutableReceipt;
        receipt.appliedAt = changedAt;
        run.claimedAt = changedAt;
        run.startedAt = changedAt;
        run.statusHistory = run.statusHistory?.map((transition) =>
          transition.status === "running"
            ? { ...transition, at: changedAt }
            : transition
        );
      } else {
        const receipt = fixture.project.commandReceipts.find((item) =>
          item.type === "agent-run.complete"
        ) as MutableReceipt;
        if (drift === "historical-receipt") {
          fixture.commands.driftHistoricalReceipt(
            receipt.resultingSnapshot.revision,
            receipt.commandId,
          );
        } else if (drift === "historical-generated-at") {
          fixture.commands.driftHistoricalGeneratedAt(
            receipt.resultingSnapshot.revision,
          );
        } else if (drift === "fingerprint") {
          receipt.requestFingerprint = {
            algorithm: "sha256",
            digest: "5".repeat(64),
          };
        } else if (drift === "revision") {
          receipt.resultingSnapshot = {
            ...receipt.resultingSnapshot,
            revision: receipt.resultingSnapshot.revision + 1,
          };
        } else if (drift === "snapshot-id") {
          receipt.resultingSnapshot = {
            ...receipt.resultingSnapshot,
            snapshotId: "project.ramp:r2",
          };
        } else if (drift === "issued-at") {
          receipt.issuedAt = "2026-08-20T05:00:01.000Z";
        } else {
          receipt.appliedAt = "2026-08-20T05:00:01.000Z";
        }
      }
      await assertRejects(
        () => fixture.executor.execute(EXECUTION_AGENT, replayCommand),
        Error,
      );
      assertEquals(fixture.runtime.runs, [0], drift);
      assertEquals(fixture.runtime.recoveries, [], drift);
      assertEquals(fixture.snapshots.saveCalls, saveCalls, drift);
      assertEquals(fixture.captures.saveCalls, captureSaves, drift);
    } finally {
      await fixture.dispose();
    }
  }
});

Deno.test("two admitted executors sharing File leases and WAL dispatch exactly once", async () => {
  const fixture = await executorHarness({ twoInstances: true });
  try {
    assert(fixture.peerExecutor);
    const [left, right] = await Promise.all([
      fixture.executor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
      fixture.peerExecutor.execute(EXECUTION_AGENT, EXECUTION_COMMAND),
    ]);
    assertEquals(runStatus(left), "completed");
    assertEquals(runStatus(right), "completed");
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("admitted Modelica fails the claimed run on output-validation rejection without Thread write", async () => {
  const fixture = await executorHarness({ rejectOutputValidation: true });
  try {
    const beforeSnapshots = [...fixture.project.threadSnapshots];
    const failed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    const run = failed.agentRuns.find((item) => item.id === EXECUTION_COMMAND.runId);
    assertEquals(run?.status, "failed");
    assertEquals(run?.failure?.code, "isolated_output_validation_failed");
    assertEquals(run?.failure?.message.includes("evidence"), true);
    assertEquals(run?.failure?.message.includes("/tmp/"), false);
    assertEquals(failed.threadSnapshots, beforeSnapshots);
    assertEquals(
      (await fixture.attempts.read(
        EXECUTION_COMMAND.projectId,
        EXECUTION_COMMAND.runId,
      ))?.phase,
      "output-validation-rejected",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
    assertEquals(fixture.runtime.advances, 0);

    const replayed = await fixture.executor.execute(EXECUTION_AGENT, {
      ...EXECUTION_COMMAND,
      expectedRevision: failed.revision,
    });
    assertEquals(replayed.agentRuns[0]?.status, "failed");
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(replayed.threadSnapshots, beforeSnapshots);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("admitted Modelica refuses a divergent fail code on output-validation replay without redispatch", async () => {
  const fixture = await executorHarness({ rejectOutputValidation: true });
  try {
    const failed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    const run = failed.agentRuns.find((item) =>
      item.id === EXECUTION_COMMAND.runId
    ) as MutableRun;
    run.failure = {
      code: "isolated_execution_rejected",
      message: run.failure!.message,
    };
    await assertRejects(
      () =>
        fixture.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: failed.revision,
        }),
      Error,
      "evidence-free terminal failure",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("admitted Modelica refuses a divergent fail receipt on output-validation replay without redispatch", async () => {
  const fixture = await executorHarness({ rejectOutputValidation: true });
  try {
    const failed = await fixture.executor.execute(
      EXECUTION_AGENT,
      EXECUTION_COMMAND,
    );
    const receipts = fixture.project.commandReceipts;
    const index = receipts.findIndex((item) => item.type === "agent-run.fail");
    assertEquals(index >= 0, true);
    receipts[index] = {
      ...receipts[index]!,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
    };
    await assertRejects(
      () =>
        fixture.executor.execute(EXECUTION_AGENT, {
          ...EXECUTION_COMMAND,
          expectedRevision: failed.revision,
        }),
      Error,
      "agent-run.fail receipt",
    );
    assertEquals(fixture.runtime.runs, [0]);
    assertEquals(fixture.runtime.recoveries, []);
  } finally {
    await fixture.dispose();
  }
});

type ExecutorDrift =
  | "agent-approval"
  | "decision-fingerprint"
  | "run-fingerprint"
  | "artifact-id"
  | "artifact-fingerprint"
  | "artifact-version"
  | "artifact-uri"
  | "artifact-media"
  | "artifact-producer"
  | "artifact-stale"
  | "artifact-archived";

interface ExecutorHarnessOptions {
  readonly drift?: ExecutorDrift;
  readonly initialStatus?: "queued" | "running";
  readonly failGenerationZero?: boolean;
  readonly rejectOutputValidation?: boolean;
  readonly losePrepareAck?: boolean;
  readonly loseDispatchAck?: boolean;
  readonly loseRedispatchAck?: boolean;
  readonly loseGenerationZeroCleanedAck?: boolean;
  readonly loseOutputPublishedAck?: boolean;
  readonly loseCompletedAck?: boolean;
  readonly publishThenThrow?: readonly (0 | 1)[];
  readonly outcomeUnknownGeneration?: 0 | 1;
  readonly resolutionRefDrift?: boolean;
  readonly loseDestroyAck?: boolean;
  readonly loseAdvanceAck?: boolean;
  readonly acknowledgementLoss?: "capture" | "publish";
  readonly loseThreadSaveAck?: boolean;
  readonly loseCompleteAck?: boolean;
  readonly loseCompletionJournalBeforeWrite?: boolean;
  readonly twoInstances?: boolean;
  readonly evidenceInputBundleDrift?: boolean;
  readonly evidenceResultDrift?: boolean;
}

interface ExecutorHarness {
  readonly executor: SimulateRunAdmittedModelicaRunExecutor;
  readonly project: MutableProject;
  readonly attempts: FaultInjectingAttemptStore;
  readonly runtime: FakeAdmittedRuntime;
  readonly captures: FakeAdmittedCaptures;
  readonly snapshots: FakeAdmittedSnapshots;
  readonly commands: FakeAdmittedCommands;
  readonly peerExecutor?: SimulateRunAdmittedModelicaRunExecutor;
  readonly dispose: () => Promise<void>;
}

async function executorHarness(
  options: ExecutorHarnessOptions = {},
): Promise<ExecutorHarness> {
  const source = await harness();
  const admission = (await source.review.execute(source.command)).admission;
  const { basis, lineage } = await admittedThreadLineage(
    admission,
    options.drift,
  );
  const basisRef = {
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: basis.subject.id,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...basisRef };
  const evidenceRef = {
    snapshotId: basis.id,
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
  const project = {
    schemaVersion: "4.0",
    id: options.initialStatus === "running" ? "project.ramp:r2" : "project.ramp:r1",
    revision: options.initialStatus === "running" ? 2 : 1,
    generatedAt: EXECUTION_AT,
    project: {
      id: EXECUTION_COMMAND.projectId,
      name: "Ramp",
      subjectId: basis.subject.id,
      objective: { title: "Ramp", statement: "Execute admitted Modelica." },
    },
    threadSnapshots: [basisRef],
    phases: [{
      id: "phase.simulate",
      name: "Simulate",
      order: 1,
      description: "Run admitted Modelica.",
      workItemIds: ["work.modelica.admitted"],
      requiredDecisionIds: ["decision.modelica.admitted"],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work.modelica.admitted",
      activityId: "activity:work.modelica.admitted",
      phaseId: "phase.simulate",
      title: "Run admitted Modelica",
      description: "Run the sealed source.",
      kind: "simulate",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: ["decision.modelica.admitted"],
      blockerIds: [],
    }],
    agentRuns: [{
      id: EXECUTION_COMMAND.runId,
      workItemId: "work.modelica.admitted",
      status: options.initialStatus ?? "queued",
      summary: "Run admitted Modelica.",
      queuedAt: EXECUTION_AT,
      ...(options.initialStatus === "running"
        ? {
          startedAt: EXECUTION_AT,
          claimedAt: EXECUTION_AT,
          claimedBy: { id: EXECUTION_AGENT.actorId, origin: EXECUTION_AGENT.kind },
        }
        : {}),
      basis: runBasis,
      inputFingerprint: options.drift === "run-fingerprint"
        ? { algorithm: "sha256", digest: "e".repeat(64) }
        : runFingerprint,
      evidenceRefs: [],
      statusHistory: [],
    }],
    decisions: [{
      id: "decision.modelica.admitted",
      phaseId: "phase.simulate",
      title: "Admitted Modelica run",
      question: "Execute this admission?",
      status: "approved",
      requestedAt: EXECUTION_AT,
      baseSnapshot: basisRef,
      inputFingerprint: options.drift === "decision-fingerprint"
        ? { algorithm: "sha256", digest: "d".repeat(64) }
        : decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
      approvalIds: ["approval.modelica.admitted"],
      proposal: {
        ...proposal,
        proposedAt: EXECUTION_AT,
        proposedBy: { id: EXECUTION_AGENT.actorId, origin: EXECUTION_AGENT.kind },
      },
    }],
    approvals: [{
      id: "approval.modelica.admitted",
      decisionId: "decision.modelica.admitted",
      status: "approved",
      requestedAt: EXECUTION_AT,
      decidedAt: EXECUTION_AT,
      decidedBy: "human.reviewer",
      decidedByOrigin: options.drift === "agent-approval" ? "agent" : "human",
      baseSnapshot: basisRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  if (options.initialStatus === "running") {
    const claim = {
      ...EXECUTION_COMMAND,
      commandId: `${EXECUTION_COMMAND.commandId}:simulate-run-admitted-modelica:claim`,
      expectedRevision: 1,
      summary: "Started the exact reviewed admitted Modelica run.",
    };
    project.commandReceipts.push({
      commandId: claim.commandId,
      type: "agent-run.claim",
      actor: { id: EXECUTION_AGENT.actorId, origin: EXECUTION_AGENT.kind },
      issuedAt: claim.issuedAt,
      appliedAt: EXECUTION_AT,
      requestFingerprint: await sha256Fingerprint({
        type: "agent-run.claim",
        origin: EXECUTION_AGENT,
        command: claim,
      }),
      resultingSnapshot: { snapshotId: project.id, revision: project.revision },
    });
    (project.agentRuns[0] as MutableRun).statusHistory = [{
      commandId: claim.commandId,
      status: "running",
      at: EXECUTION_AT,
      actor: { id: EXECUTION_AGENT.actorId, origin: EXECUTION_AGENT.kind },
      summary: claim.summary,
    }];
    (project.agentRuns[0] as MutableRun).summary = claim.summary;
  }
  const directory = await Deno.realPath(
    await Deno.makeTempDir({
      prefix: "casys-admitted-modelica-executor-",
    }),
  );
  const attempts = new FaultInjectingAttemptStore(
    new FileAdmittedModelicaExecutionAttemptStore(`${directory}/attempts`),
    options,
  );
  const runtime = new FakeAdmittedRuntime(
    source.profiles.profile,
    options,
  );
  const captures = new FakeAdmittedCaptures(
    options.acknowledgementLoss === "capture",
  );
  const snapshots = new FakeAdmittedSnapshots(
    lineage,
    options.loseThreadSaveAck ?? false,
  );
  const commands = new FakeAdmittedCommands(
    project,
    options.acknowledgementLoss === "publish",
    options.loseCompleteAck ?? false,
  );
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: (_projectId, revision) =>
      Promise.resolve(commands.reopenRevision(revision)),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  const commonDependencies = {
    projects,
    commands,
    snapshots,
    admissions: source.reader,
    profiles: source.profiles,
    runner: runtime,
    recovery: runtime,
    publications: runtime,
    captures,
  };
  const dependencies = {
    ...commonDependencies,
    attempts,
    lease: options.twoInstances
      ? new FileEngineeringProjectRunLease(`${directory}/leases`)
      : new TestSerialLease(),
  } as unknown as SimulateRunAdmittedModelicaRunExecutorDependencies;
  const peerExecutor = options.twoInstances
    ? new SimulateRunAdmittedModelicaRunExecutor({
      ...commonDependencies,
      attempts: new FaultInjectingAttemptStore(
        new FileAdmittedModelicaExecutionAttemptStore(`${directory}/attempts`),
        options,
      ),
      lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
    } as unknown as SimulateRunAdmittedModelicaRunExecutorDependencies)
    : undefined;
  return {
    executor: new SimulateRunAdmittedModelicaRunExecutor(dependencies),
    project,
    attempts,
    runtime,
    captures,
    snapshots,
    commands,
    peerExecutor,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

async function admittedThreadLineage(
  admission: ModelicaAdmittedRunAdmission,
  drift: ExecutorDrift | undefined,
): Promise<{ readonly basis: ThreadSnapshot; readonly lineage: ThreadSnapshot[] }> {
  const modelFingerprint = await sha256Fingerprint({ model: "ramp" });
  const modelArtifact = {
    id: "artifact.model.ramp",
    name: "Ramp model",
    kind: "sysml-model" as const,
    version: modelFingerprint.digest,
    fingerprint: modelFingerprint,
    uri: `casys://sysml/sha256/${modelFingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "capture", runId: "run.syson" },
    inputArtifactIds: [],
    freshness: freshAt(),
  };
  let current = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.ramp.1",
    revision: 1,
    generatedAt: EXECUTION_AT,
    subject: {
      id: "subject.ramp",
      name: "Ramp",
      kind: "system",
      version: "1",
      modelArtifactId: modelArtifact.id,
    },
    freshness: freshAt(),
    changeSet: {
      id: "changes.ramp.1",
      name: "Ramp baseline",
      status: "applied",
      createdAt: EXECUTION_AT,
      appliedAt: EXECUTION_AT,
      changes: [{
        id: "change.artifact.model.ramp",
        kind: "created",
        target: { kind: "artifact", id: modelArtifact.id },
        summary: "Created the Ramp model.",
        afterFingerprint: modelArtifact.fingerprint,
      }],
    },
    artifacts: [modelArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.artifact.model.ramp",
      relation: "changes",
      from: { kind: "change", id: "change.artifact.model.ramp" },
      to: { kind: "artifact", id: modelArtifact.id },
      rationale: "Created the Ramp model.",
    }],
    proposedActions: [],
  });
  const lineage = [current];
  for (let revision = 2; revision <= 7; revision += 1) {
    const fingerprint = await sha256Fingerprint({ revision });
    const artifact = {
      id: `artifact.ramp.history.${revision}`,
      name: `Ramp history ${revision}`,
      kind: "document" as const,
      version: fingerprint.digest,
      fingerprint,
      uri: `casys://history/sha256/${fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "history.record@1",
        runId: `run.history.${revision}`,
      },
      inputArtifactIds: [],
      freshness: freshAt(),
    };
    const applied = applyThreadSnapshotExtensionIfNew(current, {
      id: `history-${revision}`,
      name: `History ${revision}`,
      subjectId: current.subject.id,
      capturedAt: EXECUTION_AT,
      artifacts: [artifact],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
    }, { appliedAt: EXECUTION_AT });
    assert(applied.applied);
    current = validateThreadSnapshot(applied.snapshot);
    lineage.push(current);
  }
  const admittedFingerprint = drift === "artifact-fingerprint"
    ? { algorithm: "sha256" as const, digest: "f".repeat(64) }
    : admission.admissionArtifact.fingerprint;
  const admittedDigest = admission.admissionArtifact.fingerprint.digest;
  const admissionArtifact = {
    id: drift === "artifact-id"
      ? `technical-compilation-admission-${"a".repeat(64)}`
      : admission.admissionArtifact.id,
    name: "Modelica technical compilation admission",
    kind: "document" as const,
    version: drift === "artifact-version"
      ? "wrong-version"
      : admittedFingerprint.digest,
    fingerprint: admittedFingerprint,
    uri: drift === "artifact-uri"
      ? `casys://foreign/sha256/${admittedDigest}`
      : `casys://technical-compilation-admission-capture/sha256/${admittedDigest}`,
    mediaType: drift === "artifact-media" ? "text/plain" : "application/json",
    producer: {
      serverId: "digital-thread",
      tool: drift === "artifact-producer"
        ? "foreign.seal@1"
        : "compile.seal-admission@3",
      runId: "run.compile.seal",
    },
    inputArtifactIds: [],
    freshness: freshAt(),
  };
  const applied = applyThreadSnapshotExtensionIfNew(current, {
    id: "admitted-modelica-basis",
    name: "Admitted Modelica basis",
    subjectId: current.subject.id,
    capturedAt: EXECUTION_AT,
    artifacts: [admissionArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: EXECUTION_AT });
  assert(applied.applied);
  let basis = validateThreadSnapshot(applied.snapshot);
  if (drift === "artifact-stale") {
    const mutable = structuredClone(basis) as MutableThreadSnapshot & {
      artifacts: Array<ThreadSnapshot["artifacts"][number]>;
      freshness: ThreadSnapshot["freshness"];
    };
    const artifact = mutable.artifacts.find((item) =>
      item.id === admission.admissionArtifact.id
    )!;
    const changeId = mutable.changeSet.changes.find((change) =>
      change.target.kind === "artifact" && change.target.id === artifact.id
    )!.id;
    Object.assign(artifact, {
      freshness: {
        status: "stale",
        changedAt: EXECUTION_AT,
        reason: "Superseded admission",
        invalidatedByChangeIds: [changeId],
      },
    });
    mutable.freshness = {
      status: "stale",
      changedAt: EXECUTION_AT,
      reason: "Contains a superseded admission",
      invalidatedByChangeIds: [changeId],
    };
    basis = validateThreadSnapshot(mutable);
  }
  lineage.push(basis);
  if (drift === "artifact-archived") {
    const archived = applyThreadSnapshotExtensionIfNew(basis, {
      id: "archive-admitted-modelica-basis",
      name: "Archive admitted Modelica basis",
      subjectId: basis.subject.id,
      capturedAt: EXECUTION_AT,
      artifacts: [],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
      archived: [{
        target: { kind: "artifact", id: admission.admissionArtifact.id },
        summary: "Retired the admitted Modelica compilation.",
      }],
    }, { appliedAt: EXECUTION_AT });
    assert(archived.applied);
    basis = validateThreadSnapshot(archived.snapshot);
    lineage.push(basis);
  }
  return { basis, lineage };
}

class FaultInjectingAttemptStore implements AdmittedModelicaExecutionAttemptStore {
  prepareCalls = 0;
  #losePrepareAck: boolean;
  #loseDispatchAck: boolean;
  #loseRedispatchAck: boolean;
  #loseGenerationZeroCleanedAck: boolean;
  #loseOutputPublishedAck: boolean;
  #loseCompletedAck: boolean;
  #loseCompletionBeforeWrite: boolean;

  constructor(
    readonly inner: AdmittedModelicaExecutionAttemptStore,
    options: ExecutorHarnessOptions,
  ) {
    this.#losePrepareAck = options.losePrepareAck ?? false;
    this.#loseDispatchAck = options.loseDispatchAck ?? false;
    this.#loseRedispatchAck = options.loseRedispatchAck ?? false;
    this.#loseGenerationZeroCleanedAck = options.loseGenerationZeroCleanedAck ?? false;
    this.#loseOutputPublishedAck = options.loseOutputPublishedAck ?? false;
    this.#loseCompletedAck = options.loseCompletedAck ?? false;
    this.#loseCompletionBeforeWrite = options.loseCompletionJournalBeforeWrite ?? false;
  }

  read(projectId: string, agentRunId: string) {
    return this.inner.read(projectId, agentRunId);
  }

  async prepare(
    ...args: Parameters<AdmittedModelicaExecutionAttemptStore["prepare"]>
  ) {
    this.prepareCalls += 1;
    const result = await this.inner.prepare(...args);
    if (this.#losePrepareAck) {
      this.#losePrepareAck = false;
      throw new Error("prepared WAL acknowledgement lost");
    }
    return result;
  }

  async markDispatching(
    ...args: Parameters<AdmittedModelicaExecutionAttemptStore["markDispatching"]>
  ): Promise<AdmittedModelicaExecutionDispatchTransition> {
    const result = await this.inner.markDispatching(...args);
    if (this.#loseDispatchAck && result.outcome === "transitioned-now") {
      this.#loseDispatchAck = false;
      throw new Error("generation-zero WAL acknowledgement lost");
    }
    return result;
  }

  async markGenerationZeroCleaned(
    ...args: Parameters<
      AdmittedModelicaExecutionAttemptStore["markGenerationZeroCleaned"]
    >
  ) {
    const result = await this.inner.markGenerationZeroCleaned(...args);
    if (this.#loseGenerationZeroCleanedAck) {
      this.#loseGenerationZeroCleanedAck = false;
      throw new Error("generation-zero cleanup WAL acknowledgement lost");
    }
    return result;
  }

  async markRedispatching(
    ...args: Parameters<
      AdmittedModelicaExecutionAttemptStore["markRedispatching"]
    >
  ): Promise<AdmittedModelicaExecutionDispatchTransition> {
    const result = await this.inner.markRedispatching(...args);
    if (this.#loseRedispatchAck && result.outcome === "transitioned-now") {
      this.#loseRedispatchAck = false;
      throw new Error("generation-one WAL acknowledgement lost");
    }
    return result;
  }

  async markOutputPublished(
    ...args: Parameters<
      AdmittedModelicaExecutionAttemptStore["markOutputPublished"]
    >
  ) {
    const result = await this.inner.markOutputPublished(...args);
    if (this.#loseOutputPublishedAck) {
      this.#loseOutputPublishedAck = false;
      throw new Error("output-published WAL acknowledgement lost");
    }
    return result;
  }

  markCompleted(
    ...args: Parameters<AdmittedModelicaExecutionAttemptStore["markCompleted"]>
  ) {
    if (this.#loseCompletionBeforeWrite) {
      this.#loseCompletionBeforeWrite = false;
      return Promise.reject(
        new Error("completion journal unavailable before durable write"),
      );
    }
    if (this.#loseCompletedAck) {
      this.#loseCompletedAck = false;
      return this.inner.markCompleted(...args).then(() => {
        throw new Error("completed WAL acknowledgement lost");
      });
    }
    return this.inner.markCompleted(...args);
  }

  markOutputValidationRejected(
    ...args: Parameters<
      AdmittedModelicaExecutionAttemptStore["markOutputValidationRejected"]
    >
  ) {
    return this.inner.markOutputValidationRejected(...args);
  }
}

class FakeAdmittedRuntime {
  readonly runs: number[] = [];
  readonly recoveries: number[] = [];
  advances = 0;
  readonly #receipts = new Map<number, IsolatedCodeExecutionReceipt>();
  readonly #bytes = new Map<string, Uint8Array>();
  readonly #destructions = new Map<
    0 | 1,
    IsolatedCodeExecutionReceipt["destruction"]
  >();
  #advance:
    | ReturnType<typeof createIsolatedOutputProducerGenerationAdvance>
    | undefined;
  #loseDestroyAck: boolean;
  #loseAdvanceAck: boolean;

  constructor(
    readonly profile: AdmittedModelicaExecutionProfile,
    readonly options: ExecutorHarnessOptions,
  ) {
    this.#loseDestroyAck = options.loseDestroyAck ?? false;
    this.#loseAdvanceAck = options.loseAdvanceAck ?? false;
  }

  async run(request: IsolatedCodeExecutionRequest) {
    this.runs.push(request.producerGeneration);
    if (this.options.publishThenThrow?.includes(request.producerGeneration)) {
      const receipt = await this.#receipt(request);
      this.#receipts.set(request.producerGeneration, receipt);
      throw new Error(
        `generation-${request.producerGeneration} acknowledgement lost after CAS publication`,
      );
    }
    if (this.options.rejectOutputValidation) {
      throw new IsolatedCodeOutputValidationRejectedError(
        { role: "evidence", byteCount: 32, sha256: "7".repeat(64) },
        {
          status: "proven",
          runId: request.runId,
          proofFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        },
      );
    }
    if (this.options.failGenerationZero && request.producerGeneration === 0) {
      throw new Error("generation-zero acknowledgement lost before publication");
    }
    const receipt = await this.#receipt(request);
    this.#receipts.set(request.producerGeneration, receipt);
    return receipt;
  }

  resolvePublicationByRunId(runId: string, producerGeneration: 0 | 1) {
    if (this.options.outcomeUnknownGeneration === producerGeneration) {
      return Promise.resolve({
        status: "outcome-unknown" as const,
        runId,
        producerGeneration,
      });
    }
    const receipt = this.#receipts.get(producerGeneration);
    const ref = receipt && this.options.resolutionRefDrift
      ? {
        ...receipt.publication.ref,
        fingerprint: {
          algorithm: "sha256" as const,
          digest: "6".repeat(64),
        },
      }
      : receipt?.publication.ref;
    return Promise.resolve(
      receipt
        ? {
          status: "published" as const,
          runId,
          producerGeneration,
          ref: ref!,
          receipt: isolatedCodeExecutionReceiptRecord(receipt),
        }
        : { status: "not-published" as const, runId, producerGeneration },
    );
  }

  readReceipt(ref: { readonly producerGeneration: 0 | 1 }) {
    return Promise.resolve(this.#receipts.get(ref.producerGeneration));
  }

  readPublishedObject(
    _ref: unknown,
    member: { readonly role: string },
  ) {
    return Promise.resolve(this.#bytes.get(member.role)?.slice());
  }

  destroyByRunId(runId: string, producerGeneration: 0 | 1) {
    this.recoveries.push(producerGeneration);
    const existing = this.#destructions.get(producerGeneration);
    if (existing) return Promise.resolve(existing);
    const destruction = {
      status: "proven" as const,
      runId,
      proofFingerprint: {
        algorithm: "sha256" as const,
        digest: producerGeneration === 0 ? "8".repeat(64) : "9".repeat(64),
      },
    };
    this.#destructions.set(producerGeneration, destruction);
    if (this.#loseDestroyAck) {
      this.#loseDestroyAck = false;
      return Promise.reject(
        new Error("destruction acknowledgement lost after durable fence"),
      );
    }
    return Promise.resolve(destruction);
  }

  advanceProducerGeneration(input: {
    readonly runId: string;
    readonly closedGeneration: 0;
    readonly nextGeneration: 1;
  }) {
    if (!this.#advance) {
      this.advances += 1;
      this.#advance = createIsolatedOutputProducerGenerationAdvance(input);
      if (this.#loseAdvanceAck) {
        this.#loseAdvanceAck = false;
        throw new Error("producer-generation advance acknowledgement lost");
      }
    }
    return this.#advance;
  }

  async #receipt(request: IsolatedCodeExecutionRequest) {
    const contract = admittedModelicaExecutionContractFromSourceBytes(
      request.source.bytes,
    );
    const resultBytes = new TextEncoder().encode(
      `time,${contract.outputs.map((output) => output.name).join(",")}\n0,${
        contract.outputs.map(() => "0").join(",")
      }\n`,
    );
    const resultSha256 = await fingerprintResourceBytes(resultBytes);
    const evidenceBytes = new TextEncoder().encode(deterministicJson({
      schemaVersion: "modelica-isolated-evidence/2.0",
      inputBundleSha256: this.options.evidenceInputBundleDrift
        ? "a".repeat(64)
        : request.source.sha256,
      status: "succeeded",
      method: {
        lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
        resultNormalizer: {
          id: "modelica-closed-subset-v2-result-normalizer",
          version: "2.0.0",
        },
        engine: { name: "OpenModelica", version: "1.25.0", mslVersion: "not-used" },
      },
      modelName: contract.modelName,
      scenario: contract.scenario,
      resolvedParameters: contract.parameters,
      metrics: contract.outputs.flatMap((output) => [
        {
          outputName: output.name,
          statistic: "final",
          value: 0,
          unit: output.unit,
        },
        {
          outputName: output.name,
          statistic: "max_abs",
          value: 0,
          unit: output.unit,
        },
      ]),
      result: {
        role: "result",
        basename: "result.csv",
        byteCount: resultBytes.byteLength,
        sha256: this.options.evidenceResultDrift ? "b".repeat(64) : resultSha256,
      },
      warnings: [],
    }));
    this.#bytes.set("evidence", evidenceBytes);
    this.#bytes.set("result", resultBytes);
    const outputs = await Promise.all(
      this.profile.outputManifest.map(async (declaration) => {
        const bytes = this.#bytes.get(declaration.role)!;
        const sha256 = await fingerprintResourceBytes(bytes);
        return {
          ...declaration,
          bytes,
          byteCount: bytes.byteLength,
          sha256,
          casUri: `casys://isolated-output/sha256/${sha256}`,
        };
      }),
    );
    const publication = await createIsolatedOutputPublicationRef(
      request.runId,
      request.producerGeneration,
      await fingerprintIsolatedOutputPublicationManifest(
        request.runId,
        request.producerGeneration,
        outputs.map(({ bytes: _bytes, ...output }) => output),
      ),
    );
    return await createIsolatedCodeExecutionReceipt({
      request: await validateIsolatedCodeExecutionRequest(request),
      runtime: this.profile.runtime,
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs,
      destruction: {
        status: "proven",
        runId: request.runId,
        proofFingerprint: {
          algorithm: "sha256",
          digest: "7".repeat(64),
        },
      },
      publication,
    });
  }
}

class FakeAdmittedCaptures {
  readonly items = new Map<string, string>();
  saveCalls = 0;
  drift = false;
  #loseSaveAck: boolean;

  constructor(loseSaveAck: boolean) {
    this.#loseSaveAck = loseSaveAck;
  }

  save(
    fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
    canonicalText: string,
  ) {
    this.saveCalls += 1;
    const existing = this.items.get(fingerprint.digest);
    if (existing !== undefined && existing !== canonicalText) {
      return Promise.reject(new Error("immutable capture rewrite"));
    }
    this.items.set(fingerprint.digest, canonicalText);
    if (this.#loseSaveAck) {
      this.#loseSaveAck = false;
      return Promise.reject(new Error("capture save acknowledgement lost"));
    }
    return Promise.resolve({
      uri: this.uriFor(fingerprint),
      fingerprint,
    });
  }

  read(fingerprint: { readonly digest: string }) {
    const text = this.items.get(fingerprint.digest);
    if (!text || !this.drift) return Promise.resolve(text);
    const parsed = JSON.parse(text);
    parsed.metrics[0].value += 1;
    return Promise.resolve(deterministicJson(parsed));
  }

  uriFor(fingerprint: { readonly digest: string }) {
    return `casys://modelica-admitted-execution/sha256/${fingerprint.digest}`;
  }
}

class FakeAdmittedSnapshots {
  readonly items = new Map<string, ThreadSnapshot>();
  saveCalls = 0;
  driftLatest = false;
  readonly #basisId: string;
  #loseSaveAck: boolean;

  constructor(snapshots: ThreadSnapshot[], loseSaveAck: boolean) {
    this.#basisId = snapshots.at(-1)!.id;
    this.#loseSaveAck = loseSaveAck;
    for (const snapshot of snapshots) {
      this.items.set(snapshot.id, structuredClone(snapshot));
    }
  }

  get(id: string) {
    const value = this.items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }

  async getFresh(id: string) {
    const value = await this.get(id);
    if (!value || !this.driftLatest || value.id === this.#basisId) return value;
    const mutable = value as MutableThreadSnapshot;
    mutable.generatedAt = "2099-01-01T00:00:00.000Z";
    return value;
  }

  latest(subjectId: string) {
    const value =
      [...this.items.values()].filter((item) => item.subject.id === subjectId).sort((
        left,
        right,
      ) => right.revision - left.revision)[0];
    return Promise.resolve(value && structuredClone(value));
  }

  save(snapshot: ThreadSnapshot) {
    this.saveCalls += 1;
    const existing = this.items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(snapshot)) {
      return Promise.reject(new Error("immutable Thread snapshot rewrite"));
    }
    this.items.set(snapshot.id, structuredClone(snapshot));
    if (this.#loseSaveAck) {
      this.#loseSaveAck = false;
      return Promise.reject(new Error("Thread save acknowledgement lost"));
    }
    return Promise.resolve();
  }
}

class FakeAdmittedCommands {
  #losePublishAck: boolean;
  #loseCompleteAck: boolean;
  readonly #revisions = new Map<number, MutableProject>();

  constructor(
    readonly project: MutableProject,
    losePublishAck: boolean,
    loseCompleteAck: boolean,
  ) {
    this.#losePublishAck = losePublishAck;
    this.#loseCompleteAck = loseCompleteAck;
    for (let revision = 1; revision <= project.revision; revision += 1) {
      const snapshot = structuredClone(project);
      snapshot.id = `project.ramp:r${revision}`;
      snapshot.revision = revision;
      snapshot.commandReceipts = snapshot.commandReceipts.filter((receipt) =>
        receipt.resultingSnapshot.revision <= revision
      );
      const receiptIds = new Set(
        snapshot.commandReceipts.map((receipt) => receipt.commandId),
      );
      for (const run of snapshot.agentRuns as MutableRun[]) {
        run.statusHistory = run.statusHistory?.filter((transition) =>
          receiptIds.has(transition.commandId)
        );
      }
      this.#revisions.set(revision, snapshot);
    }
  }

  reopenRevision(revision: number): EngineeringProjectSnapshot | undefined {
    const snapshot = this.#revisions.get(revision);
    return snapshot && structuredClone(snapshot);
  }

  driftHistoricalReceipt(revision: number, commandId: string): void {
    const snapshot = this.#revisions.get(revision);
    const receipt = snapshot?.commandReceipts.find((candidate) =>
      candidate.commandId === commandId
    ) as MutableReceipt | undefined;
    if (!receipt) throw new Error("historical receipt not found");
    receipt.requestFingerprint = {
      algorithm: "sha256",
      digest: "4".repeat(64),
    };
  }

  driftHistoricalGeneratedAt(revision: number): void {
    const snapshot = this.#revisions.get(revision);
    if (!snapshot) throw new Error("historical revision not found");
    snapshot.generatedAt = "2026-08-20T05:00:01.000Z";
  }

  async claimRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = EXECUTION_AT;
      run.claimedAt = EXECUTION_AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      await this.#receipt("agent-run.claim", origin, command);
      return this.project;
    }
    const receipt = this.project.commandReceipts.find((item) =>
      item.commandId === command.commandId && item.type === "agent-run.claim"
    );
    if (!receipt) throw new Error("claim command identity mismatch");
    return this.project;
  }

  async publishRun(origin: EngineeringProjectCommandOrigin, command: RunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "running") {
      run.status = "publishing";
      await this.#receipt("agent-run.publish", origin, command);
      if (this.#losePublishAck) {
        this.#losePublishAck = false;
        throw new Error("publish acknowledgement lost after commit");
      }
      return this.project;
    }
    const receipt = this.project.commandReceipts.find((item) =>
      item.commandId === command.commandId && item.type === "agent-run.publish"
    );
    if (!receipt) throw new Error("publish command identity mismatch");
    return this.project;
  }

  async completeRun(
    origin: EngineeringProjectCommandOrigin,
    command: CompleteRunCommand,
  ) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "publishing") {
      run.status = "completed";
      run.completedAt = EXECUTION_AT;
      run.resultSnapshot = command.resultSnapshot;
      run.evidenceRefs = [...command.evidenceRefs];
      const work = this.project.workItems[0] as MutableWork;
      work.status = "completed";
      work.evidenceRefs = [...command.evidenceRefs];
      (this.project.phases[0] as MutablePhase).evidenceRefs = [
        ...command.evidenceRefs,
      ];
      this.project.threadSnapshots.push(command.resultSnapshot);
      await this.#receipt("agent-run.complete", origin, command);
      if (this.#loseCompleteAck) {
        this.#loseCompleteAck = false;
        throw new Error("complete acknowledgement lost after commit");
      }
      return this.project;
    }
    const receipt = this.project.commandReceipts.find((item) =>
      item.commandId === command.commandId && item.type === "agent-run.complete"
    );
    if (!receipt) throw new Error("complete command identity mismatch");
    return this.project;
  }

  async failRun(origin: EngineeringProjectCommandOrigin, command: FailRunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "running" || run.status === "publishing") {
      run.status = "failed";
      run.completedAt = EXECUTION_AT;
      run.failure = { code: command.code, message: command.message };
      const work = this.project.workItems[0] as MutableWork;
      work.status = "ready";
      await this.#receipt("agent-run.fail", origin, command);
      return this.project;
    }
    return this.project;
  }

  async #receipt(
    type:
      | "agent-run.claim"
      | "agent-run.publish"
      | "agent-run.complete"
      | "agent-run.fail",
    origin: EngineeringProjectCommandOrigin,
    command: RunCommand | CompleteRunCommand | FailRunCommand,
  ) {
    this.project.revision += 1;
    this.project.id = `project.ramp:r${this.project.revision}`;
    this.project.generatedAt = EXECUTION_AT;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type,
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: EXECUTION_AT,
      requestFingerprint: await sha256Fingerprint({ type, origin, command }),
      resultingSnapshot: {
        snapshotId: `project.ramp:r${this.project.revision}`,
        revision: this.project.revision,
      },
    });
    const run = this.project.agentRuns[0] as MutableRun;
    run.summary = command.summary;
    const status = type === "agent-run.claim"
      ? "running" as const
      : type === "agent-run.publish"
      ? "publishing" as const
      : type === "agent-run.fail"
      ? "failed" as const
      : "completed" as const;
    run.statusHistory = [...(run.statusHistory ?? []), {
      commandId: command.commandId,
      status,
      at: EXECUTION_AT,
      actor: { id: origin.actorId, origin: origin.kind },
      summary: command.summary,
    }];
    this.#revisions.set(this.project.revision, structuredClone(this.project));
  }
}

class TestSerialLease {
  #tail: Promise<void> = Promise.resolve();

  async withLease<Result>(
    _projectId: string,
    _scope: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => release = resolve);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function freshAt() {
  return {
    status: "fresh" as const,
    changedAt: EXECUTION_AT,
    invalidatedByChangeIds: [],
  };
}

function runStatus(project: EngineeringProjectSnapshot) {
  return project.agentRuns.find((run) => run.id === EXECUTION_COMMAND.runId)?.status;
}

type MutableProject = EngineeringProjectSnapshot & {
  id: string;
  revision: number;
  generatedAt: string;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};
type MutableRun = {
  -readonly [Key in keyof MutableProject["agentRuns"][number]]:
    MutableProject["agentRuns"][number][Key];
};
type MutableWork = {
  -readonly [Key in keyof MutableProject["workItems"][number]]:
    MutableProject["workItems"][number][Key];
};
type MutablePhase = {
  -readonly [Key in keyof MutableProject["phases"][number]]:
    MutableProject["phases"][number][Key];
};
type MutableThreadSnapshot = {
  -readonly [Key in keyof ThreadSnapshot]: ThreadSnapshot[Key];
};
type MutableReceipt = {
  -readonly [Key in keyof EngineeringProjectCommandReceipt]:
    EngineeringProjectCommandReceipt[Key];
};
