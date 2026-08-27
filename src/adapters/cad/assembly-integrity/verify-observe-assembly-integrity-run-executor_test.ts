import { assertEquals, assertRejects } from "@std/assert";
import type {
  AssemblyIntegrityInputResolver,
  ExactAssemblyIntegrityInputRequest,
  ResolvedAssemblyIntegrityInput,
} from "../../../application/ports/out/cad/assembly-integrity/exact-assembly-integrity-input-resolver.ts";
import type { AssemblyIntegrityObservationCaptureStore } from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observation-capture-store.ts";
import type {
  AssemblyIntegrityObserver,
  AssemblyIntegrityObserverRequest,
  AssemblyIntegrityObserverResult,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observer.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type AssemblyIntegrityObservationCapture,
  assemblyIntegrityObservationCaptureUri,
  fingerprintAssemblyIntegrityObservationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import { createAssemblyIntegrityObserverProfile } from "../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import { encodeAssemblyIntegrityObservationAdmissionParameters } from "../../../domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import {
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_UNIT_SYSTEM,
} from "../../../domain/cad/geometry-module-contract.ts";
import { immutableBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  AssemblyIntegrityObservationRunOutcomeUnknownError,
  FileAssemblyIntegrityObservationAttemptStore,
} from "./file-assembly-integrity-observation-attempt-store.ts";
import {
  type AssemblyIntegrityObservationThreadSnapshotStore,
  VerifyObserveAssemblyIntegrityRunExecutor,
} from "./verify-observe-assembly-integrity-run-executor.ts";

const AT = "2026-08-26T00:00:00.000Z";
const PROJECT_ID = "project.assembly-integrity";
const SUBJECT_ID = "subject.assembly-integrity";
const RUN_ID = "run.assembly-integrity";
const WORK_ID = "work.assembly-integrity";
const DECISION_ID = "decision.assembly-integrity";
const APPROVAL_ID = "approval.assembly-integrity";
const GEOMETRY_ARTIFACT_ID = `geometry-${"a".repeat(64)}`;
const STEP_ARTIFACT_ID = `cad-asset-${"a".repeat(64)}-module-step-${"b".repeat(64)}`;
const AGENT = { kind: "agent" as const, actorId: "agent:assembly-observer" };

Deno.test("verify.observe-assembly-integrity@1 appends only factual L3 evidence", async () => {
  const fixture = await createFixture();
  try {
    const project = await fixture.executor.execute(AGENT, fixture.command);
    const run = project.agentRuns[0]!;
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const artifact = snapshot!.artifacts.find((candidate) =>
      candidate.producer.tool === "verify.observe-assembly-integrity@1"
    );

    assertEquals(run.status, "completed");
    assertEquals(fixture.observer.calls, 1);
    assertEquals(
      artifact?.id,
      `assembly-integrity-observation-${artifact?.fingerprint.digest}`,
    );
    assertEquals(artifact?.kind, "evidence");
    assertEquals(artifact?.mediaType, "application/json");
    assertEquals(artifact?.producer, {
      serverId: "digital-thread",
      tool: "verify.observe-assembly-integrity@1",
      runId: RUN_ID,
    });
    assertEquals(artifact?.inputArtifactIds, [
      GEOMETRY_ARTIFACT_ID,
      STEP_ARTIFACT_ID,
    ]);
    assertEquals(snapshot?.consumptions.length, 2);
    assertEquals(
      snapshot?.consumptions.map((consumption) => consumption.artifactId),
      [GEOMETRY_ARTIFACT_ID, STEP_ARTIFACT_ID],
    );
    assertEquals(
      snapshot?.provenance.filter((link) => link.relation === "derived_from")
        .length,
      2,
    );
    assertEquals(
      snapshot?.provenance.filter((link) => link.relation === "uses").length,
      2,
    );
    assertEquals(snapshot?.observations.length, 0);
    assertEquals(snapshot?.requirements.length, 0);
    assertEquals(snapshot?.evaluations.length, 0);
    assertEquals(snapshot?.violations.length, 0);
    assertEquals(snapshot?.proposedActions.length, 0);
    assertEquals(fixture.project.workItems[0]!.gateClaims, [{
      gateItemId: "gate.generic-evidence",
      role: "contributes-to",
      status: "current",
    }]);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("verify.observe-assembly-integrity@1 lowers the signed observer profile for the exact input boundary", async () => {
  const fixture = await createFixture();
  try {
    await fixture.executor.execute(AGENT, fixture.command);

    assertEquals(fixture.inputs.calls[0]?.observerProfile, {
      profile: {
        id: fixture.profile.profile.id,
        version: fixture.profile.profile.version,
      },
      fingerprint: fixture.profile.profileFingerprint,
    });
  } finally {
    await fixture.dispose();
  }
});

Deno.test("verify.observe-assembly-integrity@1 completed replay reopens exact evidence without a provider call", async () => {
  const fixture = await createFixture();
  try {
    const completed = await fixture.executor.execute(AGENT, fixture.command);
    const replayed = await fixture.executor.execute(AGENT, fixture.command);

    assertEquals(replayed.id, completed.id);
    assertEquals(replayed.revision, completed.revision);
    assertEquals(fixture.observer.calls, 1);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("verify.observe-assembly-integrity@1 fails normally before durable dispatch", async () => {
  const fixture = await createFixture({
    inputFailure: new Error("input bundle unavailable"),
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      Error,
      "input bundle unavailable",
    );

    assertEquals(fixture.observer.calls, 0);
    assertEquals(fixture.project.agentRuns[0]!.status, "failed");
    assertEquals(
      fixture.project.agentRuns[0]!.failure?.code,
      "verify-observe-assembly-integrity-failed",
    );
  } finally {
    await fixture.dispose();
  }
});

Deno.test("verify.observe-assembly-integrity@1 never redispatches a dispatched-only WAL", async () => {
  const fixture = await createFixture({
    observerFailure: new Error("observer transport lost"),
  });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      AssemblyIntegrityObservationRunOutcomeUnknownError,
    );
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      AssemblyIntegrityObservationRunOutcomeUnknownError,
    );

    assertEquals(fixture.observer.calls, 1);
    assertEquals(fixture.project.agentRuns[0]!.status, "running");
  } finally {
    await fixture.dispose();
  }
});

Deno.test("verify.observe-assembly-integrity@1 quarantines a tampered capture reread without redispatch", async () => {
  const fixture = await createFixture({ tamperCaptureRead: true });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      AssemblyIntegrityObservationRunOutcomeUnknownError,
    );
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      AssemblyIntegrityObservationRunOutcomeUnknownError,
    );

    assertEquals(fixture.observer.calls, 1);
    assertEquals(fixture.project.agentRuns[0]!.status, "running");
  } finally {
    await fixture.dispose();
  }
});

Deno.test("verify.observe-assembly-integrity@1 resumes a recorded capture after successor-save failure", async () => {
  const fixture = await createFixture({ failSnapshotSave: true });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      Error,
      "snapshot save interrupted",
    );
    assertEquals(fixture.project.agentRuns[0]!.status, "running");
    assertEquals(fixture.observer.calls, 1);

    const resumed = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(resumed.agentRuns[0]!.status, "completed");
    assertEquals(fixture.observer.calls, 1);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("verify.observe-assembly-integrity@1 keeps a completed WAL resumable when publication retries fail", async () => {
  const fixture = await createFixture({ publishFailures: 2 });
  try {
    // This first failure creates the successor and advances the WAL to
    // completed, while the run remains running for publication recovery.
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      Error,
      "publish interrupted",
    );
    assertEquals(fixture.project.agentRuns[0]!.status, "running");
    assertEquals(fixture.observer.calls, 1);

    // The second attempt exercises wal.action === completed. It must not
    // terminally fail the run if publication itself remains unavailable.
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      Error,
      "publish interrupted",
    );
    assertEquals(fixture.project.agentRuns[0]!.status, "running");
    assertEquals(fixture.observer.calls, 1);

    const completed = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(completed.agentRuns[0]!.status, "completed");
    assertEquals(fixture.observer.calls, 1);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("verify.observe-assembly-integrity@1 rejects a tampered MRTR fingerprint before claim", async () => {
  const fixture = await createFixture({ tamperDecisionFingerprint: true });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "decision fingerprint",
    );

    assertEquals(fixture.observer.calls, 0);
    assertEquals(fixture.project.agentRuns[0]!.status, "queued");
  } finally {
    await fixture.dispose();
  }
});

interface FixtureOptions {
  readonly inputFailure?: Error;
  readonly observerFailure?: Error;
  readonly tamperCaptureRead?: boolean;
  readonly failSnapshotSave?: boolean;
  readonly publishFailures?: number;
  readonly tamperDecisionFingerprint?: boolean;
}

interface Fixture {
  readonly executor: VerifyObserveAssemblyIntegrityRunExecutor;
  readonly command: {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly issuedAt: string;
    readonly runId: string;
  };
  readonly project: MutableProject;
  readonly snapshots: MemorySnapshots;
  readonly inputs: FakeInputs;
  readonly observer: FakeObserver;
  readonly profile: Awaited<
    ReturnType<typeof createAssemblyIntegrityObserverProfile>
  >;
  readonly dispose: () => Promise<void>;
}

async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const directory = await Deno.makeTempDir({ prefix: "assembly-integrity-executor-" });
  const geometryFingerprint = fingerprint("a");
  const stepFingerprint = fingerprint("b");
  const profile = await createAssemblyIntegrityObserverProfile({
    schemaVersion: "assembly-integrity-observer-profile/1.0",
    profile: { id: "assembly-integrity-factual", version: "1.0.0" },
    capability: { id: "assembly-integrity-observation", version: "1.0.0" },
    method: {
      id: "assembly-integrity-factual-method",
      version: "1.0.0",
      linearToleranceMm: 0.001,
    },
    producer: {
      rawSchemaVersion: "assembly-integrity-observer-raw/1.0",
      engine: { id: "observer-engine", version: "1.0.0" },
      package: { id: "observer-package", version: "1.0.0" },
    },
    configuredRuntime: { kind: "image-digest", imageDigest: fingerprint("c") },
    maximumStepBytes: 1,
    maximumOccurrences: 2,
    maximumPairs: 1,
  });
  const basisSnapshot = createBasisSnapshot(geometryFingerprint, stepFingerprint);
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const geometryRef: EngineeringThreadEntityRef = {
    snapshotId: basisSnapshot.id,
    snapshotRevision: basisSnapshot.revision,
    kind: "artifact",
    id: GEOMETRY_ARTIFACT_ID,
  };
  const admission = {
    schemaVersion: "assembly-integrity-observation-admission/1.0" as const,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    projectId: PROJECT_ID,
    basis: runBasis,
    geometryModule: {
      artifactId: GEOMETRY_ARTIFACT_ID,
      fingerprint: geometryFingerprint,
    },
    observer: {
      profile: {
        ...profile.profile,
        fingerprint: profile.profileFingerprint,
      },
      method: profile.method,
      configuredRuntime: profile.configuredRuntime,
    },
  };
  const parameters = encodeAssemblyIntegrityObservationAdmissionParameters(admission);
  const summary = "Observe exact factual assembly-integrity evidence.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [geometryRef],
    proposal: { summary, parameters },
  });
  const persistedDecisionFingerprint = options.tamperDecisionFingerprint
    ? fingerprint("e")
    : decisionFingerprint;
  const operation = {
    ...VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    bindings: [{
      name: "geometryModule",
      source: { kind: "thread-entity" as const, reference: geometryRef },
    }],
  };
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
  });
  const briefFingerprint = fingerprint("d");
  const approvedBriefBasis = {
    kind: "approved-brief" as const,
    projectId: PROJECT_ID,
    projectSnapshotId: `${PROJECT_ID}:r7`,
    projectRevision: 7,
    briefId: "brief.assembly-integrity",
    briefSnapshotId: "brief.assembly-integrity:r2",
    briefRevision: 2,
    approvedBriefFingerprint: briefFingerprint,
  };
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r8`,
    revision: 8,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Assembly integrity fixture",
      subjectId: SUBJECT_ID,
      objective: {
        title: "Observe assembly integrity",
        statement: "Record factual evidence only.",
      },
    },
    planChanges: [{
      id: "change.assembly-integrity",
      commandId: "command.change.assembly-integrity",
      approvedBriefBasis,
      baseSnapshot: reviewBasis,
      phaseIds: ["phase.verify"],
      workItemIds: [WORK_ID],
      decisionIds: [DECISION_ID],
      publishedAt: AT,
      publishedBy: { id: AGENT.actorId, origin: "agent" as const },
    }],
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.verify",
      name: "Verify",
      order: 1,
      description: "Record factual observation.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.verify",
      title: "Observe assembly integrity",
      description: "Observe the exact admitted assembly input.",
      kind: "verify" as const,
      operation,
      gateClaims: [{
        gateItemId: "gate.generic-evidence",
        role: "contributes-to" as const,
        status: "current" as const,
      }],
      status: "in-progress" as const,
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION_ID],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "queued" as const,
      summary: "Observe exact assembly integrity.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.verify",
      title: "Approve assembly-integrity observation",
      question: "Observe this exact factual assembly input?",
      status: "approved" as const,
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: persistedDecisionFingerprint,
      inputEvidenceRefs: [geometryRef],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary,
        parameters,
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" as const },
      },
    }],
    approvals: [{
      id: APPROVAL_ID,
      decisionId: DECISION_ID,
      status: "approved" as const,
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: "human:assembly-review",
      decidedByOrigin: "human" as const,
      rationale: "Reviewed exact basis, evidence, profile, method, and runtime.",
      baseSnapshot: reviewBasis,
      inputFingerprint: persistedDecisionFingerprint,
      inputEvidenceRefs: [geometryRef],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const approvedBriefProject = {
    schemaVersion: "4.0",
    id: approvedBriefBasis.projectSnapshotId,
    revision: approvedBriefBasis.projectRevision,
    generatedAt: AT,
    project: project.project,
    framing: {
      intent: {
        statement: "Record factual assembly evidence.",
        source: { kind: "human" as const, reference: "human:assembly-review" },
        capturedAt: AT,
        capturedBy: { id: "human:assembly-review", origin: "human" as const },
      },
      questions: [],
      answers: [],
      currentBrief: {
        contractVersion: "2.0" as const,
        briefId: approvedBriefBasis.briefId,
        id: approvedBriefBasis.briefSnapshotId,
        revision: approvedBriefBasis.briefRevision,
        items: [{
          id: "gate.generic-evidence",
          kind: "verification-activity" as const,
          statement: "Keep factual evidence for the declared engineering activity.",
          sourceRefs: [{ kind: "human" as const, reference: "human:assembly-review" }],
          dependsOnItemIds: [],
        }],
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" as const },
      },
      currentBriefApproval: {
        briefSnapshotId: approvedBriefBasis.briefSnapshotId,
        briefRevision: approvedBriefBasis.briefRevision,
        status: "approved" as const,
        inputFingerprint: briefFingerprint,
        requestedAt: AT,
        decidedAt: AT,
        decidedBy: { id: "human:assembly-review", origin: "human" as const },
        rationale: "Approved generic factual evidence gate.",
      },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  } as unknown as EngineeringProjectSnapshot;
  const snapshots = new MemorySnapshots(basisSnapshot);
  snapshots.failNextSave = options.failSnapshotSave ?? false;
  const captures = new MemoryCaptures(options.tamperCaptureRead ?? false);
  const observer = new FakeObserver(options.observerFailure);
  const resolved = resolvedInput(profile, geometryFingerprint, stepFingerprint);
  const inputs = new FakeInputs(resolved, options.inputFailure);
  const commands = new MemoryCommands(project, options.publishFailures ?? 0);
  const projects = new MemoryProjects(project, approvedBriefProject);

  return {
    executor: new VerifyObserveAssemblyIntegrityRunExecutor({
      projects,
      commands,
      snapshots,
      inputs,
      observer,
      captures,
      attempts: new FileAssemblyIntegrityObservationAttemptStore(`${directory}/wal`),
      lease: { withLease: (_projectId, _scope, operation) => operation() },
    }),
    command: {
      commandId: "command.assembly-integrity",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: AT,
      runId: RUN_ID,
    },
    project,
    snapshots,
    inputs,
    observer,
    profile,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

function createBasisSnapshot(
  geometryFingerprint: ContentFingerprint,
  stepFingerprint: ContentFingerprint,
): ThreadSnapshot {
  const briefArtifact = artifact({
    id: "artifact.brief",
    name: "Brief",
    kind: "document",
    fingerprint: fingerprint("f"),
    mediaType: "application/json",
    producer: "project.approved-brief@1",
  });
  const geometryArtifact = artifact({
    id: GEOMETRY_ARTIFACT_ID,
    name: "Canonical geometry module",
    kind: "evidence",
    fingerprint: geometryFingerprint,
    mediaType: "application/json",
    producer: "design.write-geometry@1",
  });
  const stepArtifact = artifact({
    id: STEP_ARTIFACT_ID,
    name: "Canonical assembly STEP",
    kind: "step",
    fingerprint: stepFingerprint,
    mediaType: "model/step",
    producer: "design.write-geometry@1",
  });
  const artifacts = [briefArtifact, geometryArtifact, stepArtifact];
  const changes = artifacts.map((item) => ({
    id: `change.${item.id}`,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: item.id },
    summary: `Recorded ${item.name}.`,
    afterFingerprint: item.fingerprint,
  }));

  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread.assembly-integrity.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Assembly integrity fixture",
      kind: "assembly",
      version: "r1",
      modelArtifactId: briefArtifact.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.assembly-integrity",
      name: "Assembly integrity basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes,
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: changes.map((change) => ({
      id: `provenance.${change.id}`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: change.id },
      to: change.target,
      rationale: change.summary,
    })),
    proposedActions: [],
  });
}

function resolvedInput(
  profile: Awaited<ReturnType<typeof createAssemblyIntegrityObserverProfile>>,
  geometryFingerprint: ContentFingerprint,
  stepFingerprint: ContentFingerprint,
): ResolvedAssemblyIntegrityInput {
  const bytes = immutableBytes(new Uint8Array([1, 2, 3]));
  const stepBytes = immutableBytes(new Uint8Array([4]));
  return {
    basis: {
      snapshotId: "thread.assembly-integrity.r1",
      revision: 1,
      subjectId: SUBJECT_ID,
    },
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: GEOMETRY_ARTIFACT_ID,
      fingerprint: geometryFingerprint,
    },
    primary: artifact({
      id: GEOMETRY_ARTIFACT_ID,
      name: "Canonical geometry module",
      kind: "evidence",
      fingerprint: geometryFingerprint,
      mediaType: "application/json",
      producer: "design.write-geometry@1",
    }),
    assemblyStep: artifact({
      id: STEP_ARTIFACT_ID,
      name: "Canonical assembly STEP",
      kind: "step",
      fingerprint: stepFingerprint,
      mediaType: "model/step",
      producer: "design.write-geometry@1",
    }),
    assemblyStepBytes: stepBytes,
    capture: {} as ResolvedAssemblyIntegrityInput["capture"],
    profile,
    observerProfile: {
      profile: profile.profile,
      fingerprint: profile.profileFingerprint,
    },
    inputBundle: {
      manifest: {
        schemaVersion: "assembly-integrity-input-bundle/1.0",
        geometryModule: {
          schemaVersion: "geometry-module-capture/1.0",
          artifactId: GEOMETRY_ARTIFACT_ID,
          fingerprint: geometryFingerprint,
          byteCount: 1,
        },
        assemblyStep: {
          mediaType: "model/step",
          byteOffset: 0,
          byteCount: stepBytes.byteLength,
          sha256: stepFingerprint.digest,
        },
        unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
        placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
        occurrences: [],
        method: profile.method,
      },
      bytes,
      fingerprint: fingerprint("0"),
      geometryModuleCapture: {} as ResolvedAssemblyIntegrityInput["capture"],
      assemblyStep: stepBytes,
    },
  };
}

function artifact(input: {
  readonly id: string;
  readonly name: string;
  readonly kind: "document" | "evidence" | "step";
  readonly fingerprint: ContentFingerprint;
  readonly mediaType: string;
  readonly producer: string;
}) {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    version: input.fingerprint.digest,
    fingerprint: input.fingerprint,
    uri: `casys://fixture/sha256/${input.fingerprint.digest}`,
    mediaType: input.mediaType,
    producer: {
      serverId: "digital-thread",
      tool: input.producer,
      runId: "run.fixture",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  } as const;
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function fingerprint(digestCharacter: string): ContentFingerprint {
  return { algorithm: "sha256", digest: digestCharacter.repeat(64) };
}

class FakeInputs implements AssemblyIntegrityInputResolver {
  readonly calls: ExactAssemblyIntegrityInputRequest[] = [];

  constructor(
    private readonly resolved: ResolvedAssemblyIntegrityInput,
    private readonly failure?: Error,
  ) {}

  resolve(
    value: ExactAssemblyIntegrityInputRequest,
  ): Promise<ResolvedAssemblyIntegrityInput> {
    this.calls.push(value);
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.resolved);
  }
}

class FakeObserver implements AssemblyIntegrityObserver {
  calls = 0;

  constructor(private readonly failure?: Error) {}

  observe(
    request: AssemblyIntegrityObserverRequest,
  ): Promise<AssemblyIntegrityObserverResult> {
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve({
      observation: {
        schemaVersion: "assembly-integrity-observation/1.0",
        operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
        inputBundle: {
          schemaVersion: request.inputBundle.manifest.schemaVersion,
          fingerprint: request.inputBundle.fingerprint,
          byteCount: request.inputBundle.bytes.byteLength,
        },
        method: request.profile.method,
        importability: { status: "observed", value: "imported" },
        importFacts: {
          unitSystem: { status: "observed", value: "mm" },
          solidCount: { status: "observed", value: 1 },
        },
        topology: {
          brepValidity: { status: "observed", value: "valid" },
          degenerateEdgeCount: { status: "observed", value: 0 },
          freeEdgeCount: { status: "observed", value: 0 },
          shellCount: { status: "observed", value: 1 },
        },
        occurrences: [],
        pairs: [],
      },
      execution: {
        profile: {
          id: request.profile.profile.id,
          version: request.profile.profile.version,
          fingerprint: request.profile.profileFingerprint,
        },
        configuredRuntime: request.profile.configuredRuntime,
        raw: {
          schemaVersion: request.profile.producer.rawSchemaVersion,
          producer: {
            service: request.profile.producer.package.id,
            packageVersion: request.profile.producer.package.version,
            tool: "factual-observe",
            engine: request.profile.producer.engine,
          },
          requestFingerprint: fingerprint("1"),
          responseFingerprint: fingerprint("2"),
        },
      },
    });
  }
}

class MemoryCaptures implements AssemblyIntegrityObservationCaptureStore {
  readonly #items = new Map<string, AssemblyIntegrityObservationCapture>();

  constructor(private readonly tamperOnRead: boolean) {}

  async save(capture: AssemblyIntegrityObservationCapture) {
    const fingerprint = await fingerprintAssemblyIntegrityObservationCapture(capture);
    this.#items.set(fingerprint.digest, structuredClone(capture));
    return {
      capture,
      fingerprint,
      uri: assemblyIntegrityObservationCaptureUri(fingerprint.digest),
    };
  }

  read(
    captureFingerprint: ContentFingerprint,
  ): Promise<AssemblyIntegrityObservationCapture | undefined> {
    const capture = this.#items.get(captureFingerprint.digest);
    if (!capture) return Promise.resolve(undefined);
    const reread = structuredClone(capture);
    if (!this.tamperOnRead) return Promise.resolve(reread);
    return Promise.resolve({ ...reread, trustedRunId: "run.tampered" });
  }
}

class MemorySnapshots implements AssemblyIntegrityObservationThreadSnapshotStore {
  readonly #items = new Map<string, ThreadSnapshot>();
  failNextSave = false;

  constructor(basis: ThreadSnapshot) {
    this.#items.set(basis.id, structuredClone(basis));
  }

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    const snapshot = this.#items.get(snapshotId);
    return Promise.resolve(snapshot && structuredClone(snapshot));
  }

  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return this.get(snapshotId);
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const latest =
      [...this.#items.values()].filter((snapshot) => snapshot.subject.id === subjectId)
        .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(latest && structuredClone(latest));
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      return Promise.reject(new Error("snapshot save interrupted"));
    }
    const existing = this.#items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(snapshot)) {
      return Promise.reject(
        new Error(`immutable snapshot ${snapshot.id} was rewritten`),
      );
    }
    if (!existing) this.#items.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }
}

class MemoryProjects implements EngineeringProjectRevisionStore {
  constructor(
    private readonly current: EngineeringProjectSnapshot,
    private readonly approvedBrief: EngineeringProjectSnapshot,
  ) {}

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(
      projectId === this.current.project.id ? this.current : undefined,
    );
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    if (
      projectId === this.approvedBrief.project.id &&
      revision === this.approvedBrief.revision
    ) return Promise.resolve(this.approvedBrief);
    return Promise.resolve(undefined);
  }

  createInitial(): Promise<EngineeringProjectSnapshot> {
    return Promise.reject(new Error("unused"));
  }

  commit(): Promise<EngineeringProjectSnapshot> {
    return Promise.reject(new Error("unused"));
  }
}

class MemoryCommands {
  constructor(
    private readonly project: MutableProject,
    private remainingPublishFailures: number,
  ) {}

  claimRun(
    origin: typeof AGENT,
    _command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const run = this.project.agentRuns[0]!;
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }

  publishRun(): Promise<EngineeringProjectSnapshot> {
    if (this.remainingPublishFailures > 0) {
      this.remainingPublishFailures -= 1;
      return Promise.reject(new Error("publish interrupted"));
    }
    const run = this.project.agentRuns[0]!;
    if (run.status === "running") {
      run.status = "publishing";
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }

  completeRun(
    _origin: typeof AGENT,
    command: CompleteRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const run = this.project.agentRuns[0]!;
    if (run.status === "publishing") {
      run.status = "completed";
      run.completedAt = AT;
      run.resultSnapshot = command.resultSnapshot;
      run.evidenceRefs = [...command.evidenceRefs];
      const work = this.project.workItems[0]!;
      work.status = "completed";
      work.evidenceRefs = [...command.evidenceRefs];
      this.project.phases[0]!.evidenceRefs = [...command.evidenceRefs];
      if (
        !this.project.threadSnapshots.some((snapshot) =>
          snapshot.snapshotId === command.resultSnapshot.snapshotId
        )
      ) this.project.threadSnapshots.push(command.resultSnapshot);
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }

  failRun(
    _origin: typeof AGENT,
    command: FailRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const run = this.project.agentRuns[0]!;
    run.status = "failed";
    run.failure = { code: command.code, message: command.message };
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}

type MutableProject =
  & Omit<
    EngineeringProjectSnapshot,
    "revision" | "threadSnapshots" | "phases" | "workItems" | "agentRuns"
  >
  & {
    revision: number;
    threadSnapshots: EngineeringProjectSnapshot["threadSnapshots"][number][];
    phases: MutablePhase[];
    workItems: MutableWorkItem[];
    agentRuns: MutableRun[];
  };

type MutableRun = {
  -readonly [Key in keyof EngineeringAgentRun]: EngineeringAgentRun[Key];
};

type MutableWorkItem = {
  -readonly [Key in keyof EngineeringWorkItem]: EngineeringWorkItem[Key];
};

type MutablePhase = {
  -readonly [Key in keyof EngineeringProjectSnapshot["phases"][number]]:
    EngineeringProjectSnapshot["phases"][number][Key];
};
