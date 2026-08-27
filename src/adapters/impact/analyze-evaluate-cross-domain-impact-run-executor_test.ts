import { assertEquals, assertRejects } from "@std/assert";
import type { EvaluateCrossDomainImpactUseCase } from "../../application/ports/in/impact/evaluate-cross-domain-impact.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { CrossDomainImpactEvaluationCaptureStore } from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import type {
  CompleteRunCommand,
  FailRunCommand,
  RunCommand,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  evaluateCrossDomainImpact,
} from "../../domain/impact/cross-domain-impact-evaluation.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
  validateCrossDomainImpactEvaluationCapture,
} from "../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import {
  ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
} from "../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
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
import {
  impactFingerprint,
  validCrossDomainImpactEvaluationInput,
} from "../../testing/cross-domain-impact-fixtures.ts";
import {
  AnalyzeEvaluateCrossDomainImpactRunExecutor,
  type CrossDomainImpactEvaluationThreadSnapshotStore,
} from "./analyze-evaluate-cross-domain-impact-run-executor.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project-impact-evaluation";
const SUBJECT = "subject-impact-evaluation";
const RUN = "run-impact-evaluation";
const WORK = "work-impact-evaluation";
const AGENT = { kind: "agent" as const, actorId: "agent-impact-evaluation" };

Deno.test(
  "X08 captures carried-forward mechanical evidence and inspected inputs as exact Thread consumptions",
  async () => {
    const fixture = await executorFixture();
    const completed = await fixture.executor.execute(AGENT, fixture.command);
    const result = completed.agentRuns[0]!.resultSnapshot!;
    const successor = await fixture.snapshots.getFresh(result.snapshotId);
    const document = successor!.artifacts.find((artifact) =>
      artifact.producer.tool === "analyze.evaluate-cross-domain-impact@2"
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
    const carried = fixture.capture.mechanicalFact;
    assertEquals(carried.status, "current");
    assertEquals(document.inputArtifactIds.includes(carried.evidence!.id), true);
    for (const consumption of carried.consumptions) {
      assertEquals(document.inputArtifactIds.includes(consumption.input.id), true);
      assertEquals(
        successor!.provenance.some((link) =>
          link.relation === "uses" && link.from.kind === "consumption" &&
          link.to.kind === "artifact" && link.to.id === consumption.input.id
        ),
        true,
      );
    }
    assertEquals(successor!.evaluations, fixture.basis.evaluations);
    assertEquals(successor!.requirements, fixture.basis.requirements);
    assertEquals(successor!.proposedActions, fixture.basis.proposedActions);

    const revision = completed.revision;
    const replay = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(replay.revision, revision);
    assertEquals(fixture.snapshots.saves, 1);
  },
);

Deno.test("X08 rejects a completed run whose result snapshot revision or subject was tampered", async () => {
  for (const field of ["revision", "subjectId"] as const) {
    const fixture = await executorFixture();
    await fixture.executor.execute(AGENT, fixture.command);
    const run = fixture.project.agentRuns[0] as MutableRun;
    run.resultSnapshot = {
      ...run.resultSnapshot!,
      [field]: field === "revision" ? 999 : "forged-subject",
    };
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      Error,
      "direct Thread successor",
      field,
    );
  }
});

async function executorFixture(): Promise<{
  readonly executor: AnalyzeEvaluateCrossDomainImpactRunExecutor;
  readonly command: {
    commandId: string;
    projectId: string;
    expectedRevision: number;
    issuedAt: string;
    runId: string;
  };
  readonly project: MutableProject;
  readonly basis: ThreadSnapshot;
  readonly snapshots: MemorySnapshots;
  readonly capture: CrossDomainImpactEvaluationCapture;
}> {
  const capture = await captureFixture();
  const basis = basisFixture(capture);
  const basisRef = {
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: basis.subject.id,
  };
  const operation = {
    id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const project = {
    schemaVersion: "4.0",
    id: "project-impact-evaluation-r1",
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT,
      name: "Impact evaluation project",
      subjectId: SUBJECT,
      objective: { title: "Impact", statement: "Capture impact evidence." },
    },
    threadSnapshots: [basisRef],
    phases: [{
      id: "phase-impact-evaluation",
      name: "Impact",
      order: 1,
      description: "Capture impact evaluation",
      workItemIds: [WORK],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK,
      activityId: `activity:${WORK}`,
      phaseId: "phase-impact-evaluation",
      title: "Evaluate impact",
      description: "Capture provider-free impact evaluation",
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
      summary: "Evaluate impact",
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
  const projects: Pick<EngineeringProjectRevisionStore, "get"> = {
    get: () => Promise.resolve(project),
  };
  return {
    executor: new AnalyzeEvaluateCrossDomainImpactRunExecutor({
      projects,
      commands,
      snapshots,
      evaluation,
      captures,
      lease: { withLease: (_projectId, _scope, work) => work() },
    }),
    command: {
      commandId: "command-impact-evaluation",
      projectId: PROJECT,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN,
    },
    project,
    basis,
    snapshots,
    capture,
  };
}

async function captureFixture(): Promise<CrossDomainImpactEvaluationCapture> {
  const input = await validCrossDomainImpactEvaluationInput();
  const evaluation = await evaluateCrossDomainImpact(input);
  const branchFacts = input.branchReadiness.map((branch) => ({
    branchId: branch.branchId,
    method: { reference: branch.method.reference, availability: "available" as const },
    joins: branch.joins.map((join) => ({
      reference: join.reference,
      currentness: "current" as const,
    })),
  }));
  const mechanicalEvidence = input.mechanicalEvidence!;
  const mechanicalFact = {
    status: "current" as const,
    assertionId: input.manifest.independenceAssertions[0]!.id,
    reviewTrigger: input.reviewTrigger,
    evidence: mechanicalEvidence.evidence,
    evidenceFreshness: "fresh" as const,
    consumptions: mechanicalEvidence.consumptions,
  };
  const artifactInputs = [
    { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
    ...branchFacts.flatMap((
      branch,
    ) => [branch.method.reference, ...branch.joins.map((join) => join.reference)]),
    mechanicalEvidence.evidence,
    ...mechanicalEvidence.consumptions.map((item) => item.input),
  ].sort((left, right) =>
    `${left.id}:${left.fingerprint.digest}`.localeCompare(
      `${right.id}:${right.fingerprint.digest}`,
    )
  );
  return await validateCrossDomainImpactEvaluationCapture({
    schemaVersion: "cross-domain-impact-evaluation-capture/2.0",
    kind: "cross-domain-impact-evaluation",
    operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
    trustedRunId: RUN,
    evaluatedAt: AT,
    manifestSeal: {
      artifact: { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
      trustedRunId: "run-manifest-seal",
    },
    artifactInputs,
    manifest: {
      id: evaluation.manifest.id,
      fingerprint: evaluation.manifest.fingerprint,
      reference: impactFingerprint("8"),
    },
    brief: {
      id: "brief-impact-evaluation",
      revision: 2,
      fingerprint: impactFingerprint("7"),
      gates: evaluation.gateClaims.map((claim, index) => ({
        gateItemId: claim.gateItemId,
        kind: "success-criterion" as const,
        branchId: claim.branchId,
        role: claim.role,
        fingerprint: impactFingerprint(String(index + 1)),
        dependsOnItemIds: [],
      })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
    },
    branchFacts,
    mechanicalFact,
    evaluation,
    limits: {
      providerCalls: "none",
      solverCalls: "none",
      gateClaimTransitions: "none",
      workItemInvalidations: "none",
      rerunProposals: "none",
    },
  });
}

function basisFixture(capture: CrossDomainImpactEvaluationCapture): ThreadSnapshot {
  const artifacts: ThreadArtifact[] = capture.artifactInputs.map((input) => ({
    id: input.id,
    name: input.id,
    kind: input.id === "mechanical-fea-evidence" ? "evidence" : "document",
    version: "1",
    fingerprint: input.fingerprint,
    producer: {
      serverId: "digital-thread",
      tool: input.id === "manifest-seal-document"
        ? "verify.seal-cross-domain-impact-manifest@2"
        : "recorded-test@1",
      runId: input.id === "manifest-seal-document"
        ? "run-manifest-seal"
        : `run-${input.id}`,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  }));
  const seal = artifacts.find((artifact) => artifact.id === "manifest-seal-document")!;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread-impact-evaluation-r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Impact evaluation subject",
      kind: "system",
      version: "r1",
      modelArtifactId: seal.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-impact-evaluation-r1",
      name: "Impact evaluation basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-manifest-seal",
        kind: "created",
        target: { kind: "artifact", id: seal.id },
        summary: "Manifest seal document.",
        afterFingerprint: seal.fingerprint,
      }],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance-change-manifest-seal",
      relation: "changes",
      from: { kind: "change", id: "change-manifest-seal" },
      to: { kind: "artifact", id: seal.id },
      rationale: "Manifest seal document.",
    }],
    proposedActions: [],
  });
}

class FixedEvaluation implements EvaluateCrossDomainImpactUseCase {
  constructor(readonly capture: CrossDomainImpactEvaluationCapture) {}

  execute() {
    return Promise.resolve({
      status: "resolved" as const,
      capture: this.capture,
      artifactInputs: this.capture.artifactInputs,
      manifestSealArtifactId: this.capture.manifestSeal.artifact.id,
      diagnostics: [],
    });
  }
}

class MemorySnapshots implements CrossDomainImpactEvaluationThreadSnapshotStore {
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

class MemoryCaptures implements CrossDomainImpactEvaluationCaptureStore {
  readonly items = new Map<string, CrossDomainImpactEvaluationCapture>();

  async save(value: CrossDomainImpactEvaluationCapture) {
    const capture = await validateCrossDomainImpactEvaluationCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    this.items.set(fingerprint.digest, structuredClone(capture));
    return {
      fingerprint,
      uri: crossDomainImpactEvaluationCaptureUri(fingerprint.digest),
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
        snapshotId: `project-impact-evaluation-r${this.project.revision}`,
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
