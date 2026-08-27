import { assertEquals, assertRejects } from "@std/assert";
import type {
  Build123dExecutionCaptureStore,
  PersistedBuild123dExecutionCapture,
} from "../../../application/ports/out/cad/isolated/build123d-execution-evidence-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { IsolatedOutputPublicationReader } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type Build123dExecutionCapture,
  createBuild123dExecutionCapture,
  createBuild123dExecutionDraft,
  deriveBuild123dExecutionRunId,
} from "../../../domain/cad/isolated/build123d-execution-evidence.ts";
import {
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
  validateBuild123dExecutionAdmission,
} from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeOutputReceiptRecord,
  type IsolatedOutputPublicationRef,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { encodeIsolatedGeometrySealParameters } from "../../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  DesignSealIsolatedGeometryRunExecutor,
  type IsolatedGeometrySealCaptureStore,
  type IsolatedGeometryThreadSnapshotStore,
} from "./design-seal-isolated-geometry-run-executor.ts";

const AT = "2026-08-14T00:00:00.000Z";
const PROJECT_ID = "project.isolated-geometry";
const SUBJECT_ID = "subject.isolated-geometry";
const RUN_ID = "run.isolated-geometry";
const WORK_ID = "work.isolated-geometry";
const DECISION_ID = "decision.isolated-geometry";
const APPROVAL_ID = "approval.isolated-geometry";
const COMMAND_ID = "command.isolated-geometry";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const AGENT_RUN_ID = "run.execute.build123d";

Deno.test("design.seal-isolated-geometry@1 writes a document-only successor and never a STEP artifact", async () => {
  const fixture = await executeFixture();
  try {
    const project = await fixture.executor.execute(AGENT, fixture.command);
    const run = project.agentRuns[0]!;
    assertEquals(run.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "design.seal-isolated-geometry@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(sealed?.[0]?.mediaType, "application/json");
    assertEquals(
      sealed?.[0]?.id.startsWith("isolated-geometry-seal-"),
      true,
    );
    assertEquals(
      snapshot?.artifacts.some((item) =>
        item.kind === "step" || item.kind === "cad-model"
      ),
      false,
    );
    const captureText = await fixture.captures.read(sealed![0]!.fingerprint);
    const capture = JSON.parse(captureText!);
    assertEquals(capture.sysmlBindings, "unresolved");
    assertEquals(capture.kind, "isolated-geometry-seal");
    assertEquals(fixture.publications.reads.length >= 1, true);
    assertEquals(fixture.threadAssetsWrites, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("design.seal-isolated-geometry@1 reopens published STEP bytes without writing thread-assets", async () => {
  const fixture = await executeFixture();
  try {
    await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(fixture.publications.reads.length >= 1, true);
    assertEquals(
      fixture.publications.reads[0]!.member.sha256,
      fixture.stepSha256,
    );
    assertEquals(fixture.threadAssetsWrites, 0);
    const leftover = [];
    for await (const entry of Deno.readDir(fixture.threadAssetsDirectory)) {
      leftover.push(entry.name);
    }
    assertEquals(leftover, []);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("design.seal-isolated-geometry@1 refuses a step or cad-model binding", async () => {
  const fixture = await executeFixture({ artifactKind: "step" });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "not a document",
    );
    assertEquals(fixture.publications.reads.length, 0);
    assertEquals(fixture.threadAssetsWrites, 0);
  } finally {
    await fixture.dispose();
  }

  const cad = await executeFixture({ artifactKind: "cad-model" });
  try {
    await assertRejects(
      () => cad.executor.execute(AGENT, cad.command),
      EngineeringProjectCommandError,
      "not a document",
    );
  } finally {
    await cad.dispose();
  }
});

Deno.test("design.seal-isolated-geometry@1 refuses a non-agent origin", async () => {
  const fixture = await executeFixture();
  try {
    await assertRejects(
      () => fixture.executor.execute(HUMAN, fixture.command),
      EngineeringProjectCommandError,
      "authenticated agent",
    );
  } finally {
    await fixture.dispose();
  }
});

async function executeFixture(options: {
  readonly artifactKind?: "document" | "step" | "cad-model";
} = {}): Promise<{
  readonly executor: DesignSealIsolatedGeometryRunExecutor;
  readonly command: {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly issuedAt: string;
    readonly runId: string;
  };
  readonly snapshots: ExecuteMemorySnapshots;
  readonly captures: ExecuteMemoryCaptures;
  readonly publications: FakePublications;
  readonly threadAssetsWrites: number;
  readonly threadAssetsDirectory: string;
  readonly stepSha256: string;
  readonly dispose: () => Promise<void>;
}> {
  const directory = await Deno.makeTempDir({ prefix: "isolated-geometry-seal-" });
  const threadAssetsDirectory = `${directory}/thread-assets`;
  await Deno.mkdir(threadAssetsDirectory);
  const evidence = await executionEvidence();
  const captureFingerprint = await sha256Fingerprint(evidence.capture);
  const executionArtifact = {
    id: `build123d-execution-capture-${captureFingerprint.digest}`,
    name: "Build123d execution capture",
    kind: options.artifactKind ?? "document",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: `casys://build123d-execution-capture/sha256/${captureFingerprint.digest}`,
    mediaType: options.artifactKind === "step" ? "model/step" : "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.execute-build123d@1",
      runId: AGENT_RUN_ID,
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.isolated-geometry.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Isolated geometry fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.execution",
      name: "Execution",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.execution",
        kind: "created",
        target: { kind: "artifact", id: executionArtifact.id },
        summary: "Recorded the isolated execution document.",
        afterFingerprint: captureFingerprint,
      }],
    },
    artifacts: [{
      id: "artifact.brief",
      name: "Brief",
      kind: "document",
      version: "1",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      producer: {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run.brief",
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    }, executionArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.execution",
      relation: "changes",
      from: { kind: "change", id: "change.execution" },
      to: { kind: "artifact", id: executionArtifact.id },
      rationale: "The applied change introduced the execution document.",
    }],
    proposedActions: [],
  });
  const basisFingerprint = await sha256Fingerprint(basisSnapshot);
  const admission = encodeIsolatedGeometrySealParameters({
    schemaVersion: "isolated-geometry-seal-admission/1.0",
    executionCapture: {
      id: executionArtifact.id,
      fingerprint: captureFingerprint,
    },
    draft: evidence.capture.noncanonicalDraft,
    publication: {
      fingerprint: evidence.capture.publicationRef.fingerprint,
    },
    step: {
      role: BUILD123D_EXECUTION_OUTPUT.role,
      basename: BUILD123D_EXECUTION_OUTPUT.basename,
      mediaType: BUILD123D_EXECUTION_OUTPUT.mediaType,
      format: BUILD123D_EXECUTION_OUTPUT.format,
      sha256: evidence.stepSha256,
      byteCount: evidence.step.byteLength,
    },
    basis: {
      snapshotId: basisSnapshot.id,
      revision: basisSnapshot.revision,
      subjectId: SUBJECT_ID,
      fingerprint: basisFingerprint,
    },
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const evidenceRef = {
    snapshotId: basisSnapshot.id,
    snapshotRevision: basisSnapshot.revision,
    kind: "artifact" as const,
    id: executionArtifact.id,
  };
  const operation = {
    ...DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
    bindings: [{
      name: "executionCapture",
      source: { kind: "thread-entity" as const, reference: evidenceRef },
    }],
  };
  const summary = "Seal the exact reviewed isolated geometry document.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [evidenceRef],
    proposal: { summary, parameters: admission },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
  });
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Isolated geometry fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Seal", statement: "Seal exact isolated geometry." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.design",
      name: "Design",
      order: 1,
      description: "Seal isolated geometry.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.design",
      title: "Seal isolated geometry",
      description: "Seal exact reviewed isolated geometry.",
      kind: "design",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION_ID],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "queued",
      summary: "Seal isolated geometry.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.design",
      title: "Approve isolated geometry seal",
      question: "Seal the exact isolated geometry document?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary,
        parameters: admission,
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: APPROVAL_ID,
      decisionId: DECISION_ID,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Reviewed exact identities.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new ExecuteMemorySnapshots(basisSnapshot);
  const captures = new ExecuteMemoryCaptures();
  const executionCaptures = new FakeExecutionCaptures(
    evidence.capture,
    captureFingerprint,
  );
  const publications = new FakePublications(
    evidence.capture.publicationRef,
    evidence.stepOutput,
    evidence.step,
  );
  const commands = new ExecuteCommands(project);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: () => Promise.resolve(project),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    executor: new DesignSealIsolatedGeometryRunExecutor({
      projects,
      commands,
      snapshots,
      executionCaptures,
      publications,
      captures,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
    }),
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    snapshots,
    captures,
    publications,
    threadAssetsWrites: 0,
    threadAssetsDirectory,
    stepSha256: evidence.stepSha256,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

async function executionEvidence() {
  const source = new TextEncoder().encode(
    "from build123d import Box\nresult = Box(20, 10, 2)\n",
  );
  const sourceSha256 = await fingerprintResourceBytes(source);
  const imageReference = `ghcr.io/casys-ai/build123d-runtime@sha256:${"c".repeat(64)}`;
  const runtime = createMicrosandboxRuntimeAttestation({
    imageReference,
    limits: {
      maxWallTimeMs: 30_000,
      maxCpuTimeMs: 20_000,
      maxMemoryBytes: 1_073_741_824,
      maxProcesses: 32,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      maxOutputFileBytes: 33_554_432,
      maxOutputTotalBytes: 33_554_432,
    },
  });
  const executionAdmission = validateBuild123dExecutionAdmission({
    schemaVersion: "build123d-execution-admission/2.0",
    admissionArtifact: {
      schemaVersion: "technical-compilation-admission-capture/4.0",
      id: `technical-compilation-admission-${"1".repeat(64)}`,
      fingerprint: hash("1"),
    },
    compilation: {
      document: {
        schemaVersion: "technical-compilation/2.0",
        fingerprint: hash("2"),
        status: "ready-for-review",
      },
      projection: {
        target: "build123d-source",
        fingerprint: hash("3"),
        status: "ready-for-review",
      },
      source: {
        id: "source.box",
        sourceFingerprint: { algorithm: "sha256", digest: sourceSha256 },
        captureFingerprint: hash("4"),
        analysisFingerprint: hash("5"),
      },
      profile: {
        id: "build123d-closed-subset-v1",
        version: "1.0.0",
        fingerprint: hash("6"),
      },
    },
    execution: {
      profile: { ...BUILD123D_EXECUTION_PROFILE, fingerprint: hash("a") },
      isolationPolicy: {
        id: "isolation.build123d-closed-v1",
        version: "1.0.0",
        fingerprint: hash("b"),
      },
      runtimeBackend: {
        ...MICROSANDBOX_LOCAL_RUNTIME_REF,
        imageReference,
        imageDigest: runtime.imageDigest,
      },
      runtime: {
        imageDigest: runtime.imageDigest,
        isolationClass: runtime.isolationClass,
        limits: runtime.requestedLimits,
        limitAssurance: runtime.limitAssurance,
      },
      outputValidator: { id: "occt-step-ap214", version: "1.0.0" },
      output: BUILD123D_EXECUTION_OUTPUT,
      minimumDestructionAssurance: "proven",
    },
    status: "ready-for-execution-review",
  });
  const executionRunId = await deriveBuild123dExecutionRunId(PROJECT_ID, AGENT_RUN_ID);
  const step = new TextEncoder().encode("STEP");
  const stepSha256 = await fingerprintResourceBytes(step);
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: executionRunId,
    producerGeneration: 0,
    profile: BUILD123D_EXECUTION_PROFILE,
    source: { bytes: source, sha256: sourceSha256 },
    policy: executionAdmission.execution.isolationPolicy,
    outputs: [BUILD123D_EXECUTION_OUTPUT],
  });
  const publicationMember = {
    ...BUILD123D_EXECUTION_OUTPUT,
    byteCount: step.byteLength,
    sha256: stepSha256,
    casUri: `casys://isolated-output/sha256/${stepSha256}`,
  };
  const outputRecord = {
    ...publicationMember,
    validation: "accepted" as const,
    persistence: "staged-reread-atomic-commit" as const,
  };
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    executionRunId,
    0,
    [publicationMember],
  );
  const receipt = isolatedCodeExecutionReceiptRecord(
    await createIsolatedCodeExecutionReceipt({
      request,
      runtime: {
        isolationClass: executionAdmission.execution.runtime.isolationClass,
        imageDigest: executionAdmission.execution.runtime.imageDigest,
        requestedLimits: executionAdmission.execution.runtime.limits,
        limitAssurance: executionAdmission.execution.runtime.limitAssurance,
      },
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs: [{ ...outputRecord, bytes: step }],
      destruction: {
        status: "proven",
        runId: executionRunId,
        proofFingerprint: hash("d"),
      },
      publication: await createIsolatedOutputPublicationRef(
        executionRunId,
        0,
        publicationFingerprint,
      ),
    }),
  );
  const input = {
    projectId: PROJECT_ID,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snapshot.isolated-geometry.r1",
      revision: 1,
      subjectId: SUBJECT_ID,
      fingerprint: hash("e"),
    },
    agentRunId: AGENT_RUN_ID,
    executionRunId,
    decisionId: "decision.execute.build123d",
    executedAt: AT,
    admission: executionAdmission,
    receiptRecord: receipt,
  };
  const draft = await createBuild123dExecutionDraft(input);
  const capture = await createBuild123dExecutionCapture({
    ...input,
    draftReference: {
      schemaVersion: "build123d-execution-draft-reference/1.0",
      draftId: `build123d-execution-draft-${(await sha256Fingerprint(draft)).digest}`,
      fingerprint: await sha256Fingerprint(draft),
    },
  });
  return {
    capture,
    step,
    stepSha256,
    stepOutput: receipt.outputs[0]!,
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};

class ExecuteMemorySnapshots implements IsolatedGeometryThreadSnapshotStore {
  readonly #items = new Map<string, ThreadSnapshot>();

  constructor(basis: ThreadSnapshot) {
    this.#items.set(basis.id, structuredClone(basis));
  }

  get(id: string): Promise<ThreadSnapshot | undefined> {
    const value = this.#items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }

  getFresh(id: string): Promise<ThreadSnapshot | undefined> {
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
    const existing = this.#items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(attempted)) {
      return Promise.reject(
        new Error(`immutable snapshot ${snapshot.id} was rewritten`),
      );
    }
    if (!existing) this.#items.set(snapshot.id, attempted);
    return Promise.resolve();
  }
}

class ExecuteMemoryCaptures implements IsolatedGeometrySealCaptureStore {
  readonly #items = new Map<string, string>();

  save(fingerprint: ContentFingerprint, text: string): Promise<void> {
    this.#items.set(fingerprint.digest, text);
    return Promise.resolve();
  }

  read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class FakeExecutionCaptures implements Build123dExecutionCaptureStore {
  constructor(
    readonly capture: Build123dExecutionCapture,
    readonly fingerprint: ContentFingerprint,
  ) {}

  save(): Promise<PersistedBuild123dExecutionCapture> {
    return Promise.reject(new Error("seal must not persist a new execution capture"));
  }

  read(fingerprint: ContentFingerprint) {
    if (fingerprint.digest !== this.fingerprint.digest) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.capture);
  }

  uriFor(fingerprint: ContentFingerprint) {
    return `casys://build123d-execution-capture/sha256/${fingerprint.digest}`;
  }
}

class FakePublications implements IsolatedOutputPublicationReader {
  readonly reads: Array<{
    readonly ref: IsolatedOutputPublicationRef;
    readonly member: IsolatedCodeOutputReceiptRecord;
  }> = [];

  constructor(
    readonly publicationRef: IsolatedOutputPublicationRef,
    readonly member: IsolatedCodeOutputReceiptRecord,
    readonly bytes: Uint8Array,
  ) {}

  resolvePublicationByRunId() {
    return Promise.resolve({
      status: "published" as const,
      runId: this.publicationRef.runId,
      producerGeneration: this.publicationRef.producerGeneration,
      ref: this.publicationRef,
      receipt: undefined as never,
    });
  }

  readReceipt() {
    return Promise.resolve(undefined);
  }

  readPublishedObject(
    ref: IsolatedOutputPublicationRef,
    member: IsolatedCodeOutputReceiptRecord,
  ) {
    this.reads.push({ ref, member });
    if (
      deterministicJson(ref) !== deterministicJson(this.publicationRef) ||
      deterministicJson(member) !== deterministicJson(this.member)
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(Uint8Array.from(this.bytes));
  }
}

class ExecuteCommands {
  #claimIdentity?: string;
  #completeResult?: EngineeringProjectCommandReceipt["resultingSnapshot"];

  constructor(readonly project: MutableProject) {}

  claimRun(
    origin: typeof AGENT,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const identity = deterministicJson({ origin, command });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      this.#claimIdentity = identity;
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
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

  publishRun(): Promise<EngineeringProjectSnapshot> {
    (this.project.agentRuns[0] as MutableRun).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }

  async completeRun(
    origin: typeof AGENT,
    command: CompleteRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const requestFingerprint = await sha256Fingerprint({
      type: "agent-run.complete",
      origin,
      command,
    });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "completed") {
      return this.project;
    }
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    const work = this.project.workItems[0] as MutableWork;
    work.status = "completed";
    work.evidenceRefs = [...command.evidenceRefs];
    (this.project.phases[0] as MutablePhase).evidenceRefs = [...command.evidenceRefs];
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
      appliedAt: AT,
      requestFingerprint,
      resultingSnapshot: this.#completeResult,
    });
    return this.project;
  }

  failRun(
    _origin: typeof AGENT,
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

function hash(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}
