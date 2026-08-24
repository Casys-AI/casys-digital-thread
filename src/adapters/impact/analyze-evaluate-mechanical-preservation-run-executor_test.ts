import { assertEquals, assertRejects } from "@std/assert";
import type { EvaluateMechanicalPreservationUseCase } from "../../application/ports/in/impact/evaluate-mechanical-preservation.ts";
import type { MechanicalPreservationCaptureStore } from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import type {
  CompleteRunCommand,
  FailRunCommand,
  RunCommand,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  crossDomainImpactMechanicalPreservationCaptureUri,
  type MechanicalPreservationCapture,
  validateMechanicalPreservationCapture,
} from "../../domain/impact/cross-domain-impact-mechanical-preservation-capture.ts";
import { evaluateMechanicalPreservation } from "../../domain/impact/cross-domain-impact-mechanical-preservation.ts";
import { ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION } from "../../domain/impact/cross-domain-impact-mechanical-preservation-proposal.ts";
import { MECHANICAL_PRESERVATION_LIMITS } from "../../domain/impact/cross-domain-impact-mechanical-preservation-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { impactFingerprint } from "../../testing/cross-domain-impact-fixtures.ts";
import { validMechanicalPreservationInput } from "../../testing/mechanical-preservation-fixtures.ts";
import {
  AnalyzeEvaluateMechanicalPreservationRunExecutor,
  type MechanicalPreservationThreadSnapshotStore,
} from "./analyze-evaluate-mechanical-preservation-run-executor.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project-mechanical-preservation";
const SUBJECT = "subject-mechanical-preservation";
const RUN = "run-mechanical-preservation";
const WORK = "work-mechanical-preservation";
const AGENT = { kind: "agent" as const, actorId: "agent-mechanical-preservation" };
const HUMAN = { kind: "human" as const, actorId: "human-mechanical-preservation" };

Deno.test("X11 captures carried-forward FEA identities as Thread consumptions and replays without writes", async () => {
  const fixture = await executorFixture();
  const completed = await fixture.executor.execute(AGENT, fixture.command);
  const result = completed.agentRuns[0]!.resultSnapshot!;
  const successor = await fixture.snapshots.getFresh(result.snapshotId);
  const document = successor!.artifacts.find((artifact) =>
    artifact.producer.tool === "analyze.evaluate-mechanical-preservation@2"
  )!;

  assertEquals(
    document.inputArtifactIds,
    fixture.capture.artifactInputs.map((item) => item.id),
  );
  assertEquals(
    successor!.consumptions
      .filter((item) =>
        deterministicJson(item.consumer) === deterministicJson(document.producer)
      )
      .map((item) => item.artifactId)
      .sort(),
    [...document.inputArtifactIds].sort(),
  );
  assertEquals(fixture.capture.preservation.status, "carried-forward");
  assertEquals(successor!.proposedActions, fixture.basis.proposedActions);
  assertEquals(completed.workItems.length, 1);

  const revision = completed.revision;
  const replay = await fixture.executor.execute(AGENT, fixture.command);
  assertEquals(replay.revision, revision);
  assertEquals(fixture.snapshots.saves, 1);
  assertEquals(fixture.captures.saves, 1);
});

Deno.test("X11 refuses a human origin and never queues a work item or CalculiX call", async () => {
  const fixture = await executorFixture();
  await assertRejects(
    () => fixture.executor.execute(HUMAN, fixture.command),
    Error,
    "authenticated agent",
  );
  assertEquals(fixture.captures.saves, 0);
  assertEquals(fixture.snapshots.saves, 0);
});

async function executorFixture(): Promise<{
  readonly executor: AnalyzeEvaluateMechanicalPreservationRunExecutor;
  readonly command: {
    commandId: string;
    projectId: string;
    expectedRevision: number;
    issuedAt: string;
    runId: string;
  };
  readonly snapshots: MemorySnapshots;
  readonly captures: MemoryCaptures;
  readonly capture: MechanicalPreservationCapture;
  readonly basis: ThreadSnapshot;
}> {
  const capture = await captureFixture();
  const basis = basisFixture(capture);
  const basisRef = {
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: basis.subject.id,
  };
  const operation = {
    id: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION.id,
    version: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const project = {
    schemaVersion: "4.0",
    id: "project-mechanical-preservation-r1",
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT,
      name: "Preservation project",
      subjectId: SUBJECT,
      objective: { title: "Preserve", statement: "Preserve mechanics." },
    },
    threadSnapshots: [basisRef],
    phases: [{
      id: "phase-mechanical-preservation",
      name: "Preserve",
      order: 1,
      description: "Capture preservation",
      workItemIds: [WORK],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK,
      activityId: `activity:${WORK}`,
      phaseId: "phase-mechanical-preservation",
      title: "Preserve mechanics",
      description: "Capture provider-free mechanical preservation",
      kind: "review",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN,
      workItemId: WORK,
      status: "queued",
      summary: "Preserve mechanics",
      queuedAt: AT,
      basis: { kind: "thread-snapshot" as const, ...basisRef },
      evidenceRefs: [],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(basis);
  const captures = new MemoryCaptures();
  const evaluation = new FixedEvaluation(capture);
  const commands = new MemoryCommands(project);
  return {
    executor: new AnalyzeEvaluateMechanicalPreservationRunExecutor({
      projects: { get: () => Promise.resolve(project) },
      commands,
      snapshots,
      evaluation,
      captures,
      lease: { withLease: (_projectId, _scope, work) => work() },
    }),
    command: {
      commandId: "command-mechanical-preservation",
      projectId: PROJECT,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN,
    },
    snapshots,
    captures,
    capture,
    basis,
  };
}

async function captureFixture(): Promise<MechanicalPreservationCapture> {
  const input = await validMechanicalPreservationInput();
  const preservation = await evaluateMechanicalPreservation(input);
  const decision = {
    id: "impact-decision-document",
    fingerprint: impactFingerprint("4"),
  };
  const evaluation = {
    id: "impact-evaluation-document",
    fingerprint: impactFingerprint("5"),
  };
  const manifestSeal = {
    id: "manifest-seal-document",
    fingerprint: impactFingerprint("9"),
  };
  const artifactInputs = [
    decision,
    evaluation,
    manifestSeal,
    {
      id: preservation.feaEvidence!.execution.id,
      fingerprint: preservation.feaEvidence!.execution.fingerprint,
    },
    {
      id: preservation.feaEvidence!.sealedProof.id,
      fingerprint: preservation.feaEvidence!.sealedProof.fingerprint,
    },
    {
      id: preservation.feaEvidence!.canonicalStep.id,
      fingerprint: preservation.feaEvidence!.canonicalStep.fingerprint,
    },
    {
      id: preservation.feaEvidence!.l4Evaluation.id,
      fingerprint: preservation.feaEvidence!.l4Evaluation.fingerprint,
    },
    preservation.closeout!.artifact,
  ].sort((left, right) =>
    `${left.id}:${left.fingerprint.digest}`.localeCompare(
      `${right.id}:${right.fingerprint.digest}`,
    )
  );
  return await validateMechanicalPreservationCapture({
    schemaVersion: "cross-domain-impact-mechanical-preservation-capture/2.0",
    kind: "cross-domain-impact-mechanical-preservation",
    operation: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
    trustedRunId: RUN,
    evaluatedAt: AT,
    decision: { artifact: decision, trustedRunId: "run-impact-decision" },
    evaluation: { artifact: evaluation, trustedRunId: "run-impact-evaluation" },
    manifestSeal: { artifact: manifestSeal, trustedRunId: "run-manifest-seal" },
    artifactInputs,
    manifest: {
      id: preservation.manifest.id,
      fingerprint: preservation.manifest.fingerprint,
      reference: impactFingerprint("8"),
    },
    brief: {
      id: "brief-mechanical-preservation",
      revision: 2,
      fingerprint: impactFingerprint("7"),
      gates: input.evaluation.gateClaims.map((claim, index) => ({
        gateItemId: claim.gateItemId,
        kind: "success-criterion" as const,
        branchId: claim.branchId,
        role: claim.role,
        fingerprint: impactFingerprint(String(index + 1)),
        dependsOnItemIds: [],
      })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
    },
    preservation,
    limits: MECHANICAL_PRESERVATION_LIMITS,
  });
}

function basisFixture(capture: MechanicalPreservationCapture): ThreadSnapshot {
  const artifacts: ThreadArtifact[] = capture.artifactInputs.map((input) => ({
    id: input.id,
    name: input.id,
    kind: input.id === capture.preservation.feaEvidence?.canonicalStep.id
      ? "step"
      : input.id === capture.preservation.feaEvidence?.execution.id
      ? "evidence"
      : "document",
    version: "1",
    fingerprint: input.fingerprint,
    mediaType: input.id === capture.preservation.feaEvidence?.canonicalStep.id
      ? "model/step"
      : "application/json",
    producer: {
      serverId: "digital-thread",
      tool: input.id === capture.decision.artifact.id
        ? "decide.accept-cross-domain-impact@2"
        : "recorded-test@1",
      runId: input.id === capture.decision.artifact.id
        ? "run-impact-decision"
        : `run-${input.id}`,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  }));
  const decision = artifacts.find((item) => item.id === capture.decision.artifact.id)!;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread-mechanical-preservation-r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Preservation subject",
      kind: "system",
      version: "r1",
      modelArtifactId: decision.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-mechanical-preservation-r1",
      name: "Decision basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-impact-decision",
        kind: "created",
        target: { kind: "artifact", id: decision.id },
        summary: "Impact decision document.",
        afterFingerprint: decision.fingerprint,
      }],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance-change-impact-decision",
      relation: "changes",
      from: { kind: "change", id: "change-impact-decision" },
      to: { kind: "artifact", id: decision.id },
      rationale: "Impact decision document.",
    }],
    proposedActions: [],
  });
}

class FixedEvaluation implements EvaluateMechanicalPreservationUseCase {
  constructor(readonly capture: MechanicalPreservationCapture) {}
  execute() {
    return Promise.resolve({
      status: "resolved" as const,
      capture: this.capture,
      artifactInputs: this.capture.artifactInputs,
      decisionArtifactId: this.capture.decision.artifact.id,
      diagnostics: [],
    });
  }
}

class MemorySnapshots implements MechanicalPreservationThreadSnapshotStore {
  readonly items = new Map<string, ThreadSnapshot>();
  saves = 0;
  constructor(basis: ThreadSnapshot) {
    this.items.set(basis.id, structuredClone(basis));
  }
  get(id: string) {
    const value = this.items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }
  getFresh(id: string) {
    return this.get(id);
  }
  latest(subjectId: string) {
    const values = [...this.items.values()].filter((item) =>
      item.subject.id === subjectId
    );
    return Promise.resolve(
      values.sort((left, right) => right.revision - left.revision)[0],
    );
  }
  save(snapshot: ThreadSnapshot) {
    const existing = this.items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(snapshot)) {
      return Promise.reject(new Error("non-idempotent snapshot"));
    }
    if (!existing) {
      this.items.set(snapshot.id, structuredClone(snapshot));
      this.saves += 1;
    }
    return Promise.resolve();
  }
}

class MemoryCaptures implements MechanicalPreservationCaptureStore {
  readonly items = new Map<string, MechanicalPreservationCapture>();
  saves = 0;
  async save(value: MechanicalPreservationCapture) {
    const capture = await validateMechanicalPreservationCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    if (!this.items.has(fingerprint.digest)) this.saves += 1;
    this.items.set(fingerprint.digest, structuredClone(capture));
    return {
      fingerprint,
      uri: crossDomainImpactMechanicalPreservationCaptureUri(fingerprint.digest),
    };
  }
  read(fingerprint: ContentFingerprint) {
    const value = this.items.get(fingerprint.digest);
    return Promise.resolve(value && structuredClone(value));
  }
}

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    (this.project.agentRuns[0] as MutableRun).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  async completeRun(origin: typeof AGENT, command: CompleteRunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "completed") return this.project;
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    const work = this.project.workItems[0] as MutableWork;
    work.status = "completed";
    work.evidenceRefs = [...command.evidenceRefs];
    (this.project.phases[0] as MutablePhase).evidenceRefs = [...command.evidenceRefs];
    this.project.threadSnapshots.push(command.resultSnapshot);
    this.project.revision += 1;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "agent-run.complete",
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint: await sha256Fingerprint({ command }),
      resultingSnapshot: {
        snapshotId: `project-mechanical-preservation-r${this.project.revision}`,
        revision: this.project.revision,
      },
    });
    return this.project;
  }
  failRun(_origin: typeof AGENT, command: FailRunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    run.status = "failed";
    run.failure = { code: command.code, message: command.message };
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: Array<
    NonNullable<EngineeringProjectSnapshot["commandReceipts"]>[number]
  >;
};
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

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
