import { assertEquals, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "./engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "./project-brief-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringBasisRef,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../../../domain/project/project-brief.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../orchestration/operations/registry.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../../domain/architecture/seed/syson-model-seed.ts";
import { VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION } from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import {
  CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
  encodeCrossDomainImpactDecisionAdmission,
} from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import { recrossCrossDomainImpactWorkItemClaims } from "../../../domain/impact/cross-domain-impact-decision.ts";

const PROJECT_ID = "project-v3";
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const HUMAN = { kind: "human" as const, actorId: "human:owner" };
const CLOCK = "2026-08-03T09:00:00.000Z";
const DIGEST = "a".repeat(64);
const BASELINE_WORK = "record-approved-brief";
const EXTRA_WORK = "work-unrelated-seed";
const MANIFEST_WORK = "work-manifest-seal";
const EVAL_WORK = "work-impact-evaluation";
const DECISION_WORK = "work-impact-decision";
const DECISION = "decision-impact-accept";
const RUN = "run-impact-decision";
const APPROVED_BRIEF = {
  name: "approvedBrief",
  source: { kind: "approved-brief" as const },
};

Deno.test("impact-decision.accept cannot be executed by an agent origin", async () => {
  const service = new EngineeringProjectCommandService(
    new EmptyStore(),
  );
  await assertRejects(
    () =>
      service.acceptCrossDomainImpactDecision(AGENT, {
        commandId: "command-impact-decision",
        projectId: "project-impact",
        expectedRevision: 1,
        issuedAt: "2026-08-22T09:00:00.000Z",
        runId: "run-impact-decision",
        summary: "Accept impact",
        decisionId: "decision-impact",
        resultSnapshot: {
          snapshotId: "thread-r2",
          revision: 2,
          subjectId: "subject",
        },
        evidenceRefs: [{
          snapshotId: "thread-r2",
          snapshotRevision: 2,
          kind: "artifact",
          id: "artifact-decision",
        }],
        evaluationCapture: {
          id: `cross-domain-impact-evaluation-${DIGEST}`,
          fingerprint: { algorithm: "sha256", digest: DIGEST },
        },
        appliedGateClaims: [{
          workItemId: "work-electrical",
          gateItemId: "gate-electrical",
          role: "satisfies",
          previousStatus: "current",
          status: "invalidated",
        }],
        limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
      }),
    EngineeringProjectCommandError,
    "cannot execute impact-decision.accept",
  );
});

Deno.test(
  "impact-decision.accept commits one revision that applies only signed claim transitions",
  async () => {
    const world = await queuedImpactDecision();
    const commitsBefore = world.store.commits;
    const workItemIds = world.project.workItems.map((item) => item.id);
    const runIds = world.project.agentRuns.map((item) => item.id);
    const extraBefore = world.project.workItems.find((item) => item.id === EXTRA_WORK)!;
    const resultSnapshot = nextThreadSnapshot(world.project);

    const completed = await world.service.acceptCrossDomainImpactDecision(HUMAN, {
      commandId: "accept-impact-decision",
      projectId: PROJECT_ID,
      expectedRevision: world.project.revision,
      issuedAt: CLOCK,
      runId: RUN,
      summary: "Accepted the exact cross-domain impact decision.",
      decisionId: DECISION,
      resultSnapshot,
      evidenceRefs: [{
        snapshotId: resultSnapshot.snapshotId,
        snapshotRevision: resultSnapshot.revision,
        kind: "artifact",
        id: "cross-domain-impact-decision",
      }],
      evaluationCapture: {
        id: `cross-domain-impact-evaluation-${DIGEST}`,
        fingerprint: { algorithm: "sha256", digest: DIGEST },
      },
      appliedGateClaims: world.appliedGateClaims,
      limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
    });

    assertEquals(world.store.commits, commitsBefore + 1);
    assertEquals(completed.revision, world.project.revision + 1);
    assertEquals(completed.commandReceipts?.at(-1)?.type, "impact-decision.accept");
    assertEquals(
      completed.workItems.find((item) => item.id === BASELINE_WORK)
        ?.gateClaims?.[0]?.status,
      "invalidated",
    );
    const extraAfter = completed.workItems.find((item) => item.id === EXTRA_WORK)!;
    assertEquals(extraAfter.status, extraBefore.status);
    assertEquals(extraAfter.gateClaims, extraBefore.gateClaims);
    assertEquals(completed.workItems.map((item) => item.id), workItemIds);
    assertEquals(completed.agentRuns.map((item) => item.id), runIds);
    assertEquals(
      completed.workItems.find((item) => item.id === DECISION_WORK)?.status,
      "completed",
    );
    assertEquals(
      completed.agentRuns.find((item) => item.id === RUN)?.status,
      "completed",
    );
    assertEquals(
      completed.agentRuns.filter((item) => item.status === "queued").length,
      0,
    );
  },
);

Deno.test(
  "impact-decision.accept with a stale previousStatus commits nothing",
  async () => {
    const world = await queuedImpactDecision();
    const commitsBefore = world.store.commits;
    const revision = world.project.revision;
    const resultSnapshot = nextThreadSnapshot(world.project);
    const stale = world.appliedGateClaims.map((claim) => ({
      ...claim,
      previousStatus: "invalidated" as const,
    }));

    await assertRejects(
      () =>
        world.service.acceptCrossDomainImpactDecision(HUMAN, {
          commandId: "accept-stale-previous-status",
          projectId: PROJECT_ID,
          expectedRevision: revision,
          issuedAt: CLOCK,
          runId: RUN,
          summary: "Accepted the exact cross-domain impact decision.",
          decisionId: DECISION,
          resultSnapshot,
          evidenceRefs: [{
            snapshotId: resultSnapshot.snapshotId,
            snapshotRevision: resultSnapshot.revision,
            kind: "artifact",
            id: "cross-domain-impact-decision",
          }],
          evaluationCapture: {
            id: `cross-domain-impact-evaluation-${DIGEST}`,
            fingerprint: { algorithm: "sha256", digest: DIGEST },
          },
          appliedGateClaims: stale,
          limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
        }),
      EngineeringProjectCommandError,
      "do not equal the signed impact-decision recross",
    );

    const current = await world.store.get(PROJECT_ID);
    assertEquals(world.store.commits, commitsBefore);
    assertEquals(current?.revision, revision);
    assertEquals(
      current?.workItems.find((item) => item.id === BASELINE_WORK)
        ?.gateClaims?.[0]?.status,
      "current",
    );
    assertEquals(
      current?.agentRuns.find((item) => item.id === RUN)?.status,
      "queued",
    );
  },
);

async function queuedImpactDecision(): Promise<{
  readonly service: EngineeringProjectCommandService;
  readonly store: MemoryProjectStore;
  readonly project: EngineeringProjectSnapshot;
  readonly appliedGateClaims: ReturnType<
    typeof recrossCrossDomainImpactWorkItemClaims
  >;
}> {
  const store = new MemoryProjectStore();
  const briefs = new ProjectBriefCommandService(store, () => CLOCK);
  let project = await approvedProject(briefs);
  let tick = 0;
  const service = new EngineeringProjectCommandService(
    store,
    { validate: () => Promise.resolve() },
    () => new Date(Date.parse(CLOCK) + ++tick * 1_000).toISOString(),
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  const baseline = baselinePlanCommand("plan-baseline", project.revision);
  project = await service.publishPlan(AGENT, {
    ...baseline,
    workItems: [{
      ...baseline.workItems[0]!,
      gateClaims: [{
        gateItemId: "success-reviewed-system",
        role: "satisfies",
        status: "current",
      }],
    }],
  });
  project = await completeRun(service, project, {
    prefix: "baseline-run",
    runId: "run-baseline",
    workItemId: BASELINE_WORK,
    basis: project.plan!.basis,
    resultSnapshot: {
      snapshotId: `${project.project.subjectId}:thread:r1`,
      revision: 1,
      subjectId: project.project.subjectId,
    },
    evidenceId: "approved-brief-baseline",
  });
  project = await service.appendChange(AGENT, {
    ...context("append-impact", project.revision),
    baseSnapshot: threadHead(project),
    phases: [{
      id: "phase-impact",
      name: "Impact",
      description: "Cross-domain impact decision.",
    }],
    workItems: [
      {
        id: EXTRA_WORK,
        phaseId: "phase-impact",
        owner: "agent",
        dependsOnWorkItemIds: [BASELINE_WORK],
        decisionIds: [],
        operation: {
          id: SYSON_MODEL_SEED_OPERATION.id,
          version: SYSON_MODEL_SEED_OPERATION.version,
          bindings: [APPROVED_BRIEF],
        },
        gateClaims: [{
          gateItemId: "verify-traceable-record",
          role: "satisfies",
          status: "current",
        }],
      },
      {
        id: MANIFEST_WORK,
        phaseId: "phase-impact",
        owner: "agent",
        dependsOnWorkItemIds: [],
        decisionIds: [],
        operation: {
          id: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id,
          version: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version,
          bindings: [APPROVED_BRIEF],
        },
      },
      {
        id: EVAL_WORK,
        phaseId: "phase-impact",
        owner: "agent",
        dependsOnWorkItemIds: [MANIFEST_WORK],
        decisionIds: [],
        operation: {
          id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
          version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
          bindings: [APPROVED_BRIEF],
        },
      },
      {
        id: DECISION_WORK,
        phaseId: "phase-impact",
        owner: "human",
        dependsOnWorkItemIds: [EVAL_WORK],
        decisionIds: [DECISION],
        operation: {
          id: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
          version: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
          bindings: [APPROVED_BRIEF],
        },
      },
    ],
    requiredDecisions: [{
      id: DECISION,
      phaseId: "phase-impact",
      title: "Accept impact",
      question: "Accept the exact proposed gate-claim statuses?",
    }],
  });
  project = await completeRun(service, project, {
    prefix: "manifest-run",
    runId: "run-manifest-seal",
    workItemId: MANIFEST_WORK,
    basis: threadSnapshotBasis(project),
    resultSnapshot: nextThreadSnapshot(project),
    evidenceId: "manifest-seal",
  });
  project = await completeRun(service, project, {
    prefix: "evaluation-run",
    runId: "run-impact-evaluation",
    workItemId: EVAL_WORK,
    basis: threadSnapshotBasis(project),
    resultSnapshot: nextThreadSnapshot(project),
    evidenceId: "impact-evaluation",
  });
  const appliedGateClaims = recrossCrossDomainImpactWorkItemClaims(
    project.workItems,
    [{
      gateItemId: "success-reviewed-system",
      role: "satisfies",
      status: "invalidated",
    }],
    { excludeWorkItemId: DECISION_WORK },
  );
  const brief = project.framing!.currentBrief!;
  const admission = {
    schemaVersion: "cross-domain-impact-decision-admission/2.0" as const,
    consequence: "accept" as const,
    projectId: PROJECT_ID,
    subjectId: project.project.subjectId,
    basis: {
      snapshotId: threadHead(project).snapshotId,
      revision: threadHead(project).revision,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    brief: {
      id: brief.id,
      revision: brief.revision,
      fingerprint: project.framing!.currentBriefApproval!.inputFingerprint,
    },
    evaluation: {
      capture: {
        id: `cross-domain-impact-evaluation-${DIGEST}`,
        fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
      },
      trustedRunId: "run-impact-evaluation",
    },
    manifestSeal: {
      id: "manifest-seal",
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    workItemClaims: appliedGateClaims,
    limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  };
  project = await service.proposeDecision(AGENT, {
    ...context("propose-impact", project.revision),
    decisionId: DECISION,
    proposal: {
      summary: "Accept the exact proposed gate-claim statuses.",
      parameters: encodeCrossDomainImpactDecisionAdmission(admission),
    },
    baseSnapshot: threadHead(project),
  });
  const decision = project.decisions.find((item) => item.id === DECISION)!;
  project = await service.approveDecision(HUMAN, {
    ...context("approve-impact", project.revision),
    decisionId: DECISION,
    rationale: "Reviewed the exact proposed gate-claim statuses.",
    inputFingerprint: decision.inputFingerprint!,
  });
  project = await service.queueRun(AGENT, {
    ...context("queue-impact", project.revision),
    runId: RUN,
    workItemId: DECISION_WORK,
    summary: "Accept the exact cross-domain impact decision.",
    basis: threadSnapshotBasis(project),
  });
  return { service, store, project, appliedGateClaims };
}

async function completeRun(
  service: EngineeringProjectCommandService,
  project: EngineeringProjectSnapshot,
  input: {
    readonly prefix: string;
    readonly runId: string;
    readonly workItemId: string;
    readonly basis: EngineeringBasisRef;
    readonly resultSnapshot: EngineeringThreadSnapshotRef;
    readonly evidenceId: string;
  },
): Promise<EngineeringProjectSnapshot> {
  let next = await service.queueRun(AGENT, {
    ...context(`queue-${input.prefix}`, project.revision),
    runId: input.runId,
    workItemId: input.workItemId,
    summary: `Queue ${input.prefix}.`,
    basis: input.basis,
  });
  next = await service.claimRun(AGENT, {
    ...context(`claim-${input.prefix}`, next.revision),
    runId: input.runId,
    summary: `Claim ${input.prefix}.`,
  });
  next = await service.publishRun(AGENT, {
    ...context(`publish-${input.prefix}`, next.revision),
    runId: input.runId,
    summary: `Publish ${input.prefix}.`,
  });
  return await service.completeRun(AGENT, {
    ...context(`complete-${input.prefix}`, next.revision),
    runId: input.runId,
    summary: `Complete ${input.prefix}.`,
    resultSnapshot: input.resultSnapshot,
    evidenceRefs: [{
      snapshotId: input.resultSnapshot.snapshotId,
      snapshotRevision: input.resultSnapshot.revision,
      kind: "artifact",
      id: input.evidenceId,
    }],
  });
}

async function approvedProject(service: ProjectBriefCommandService) {
  let project = await service.startProject(AGENT, {
    commandId: "start-project",
    projectId: PROJECT_ID,
    projectName: "Reviewable engineering system",
    issuedAt: "2026-08-03T08:59:00.000Z",
    intent: "Build a reviewable engineering system.",
    intentSource: { kind: "human", reference: "conversation:turn-1" },
  });
  project = await service.proposeBrief(AGENT, {
    ...context("propose-initial-brief", project.revision),
    items: briefItems("Demonstrate a reviewable system safely"),
  });
  const proposal = project.framing!.proposedBrief!;
  return await service.approveBrief(HUMAN, {
    ...context("approve-initial-brief", project.revision),
    briefSnapshotId: proposal.id,
    briefRevision: proposal.revision,
    rationale: "Approved for initial engineering.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
}

function baselinePlanCommand(commandId: string, expectedRevision: number) {
  return {
    ...context(commandId, expectedRevision),
    startingPoint: "idea-or-spec" as const,
    phases: [{
      id: "phase-baseline",
      name: "Engineering baseline",
      description: "Record the reviewed intent before technical work begins.",
    }],
    workItems: [{
      id: BASELINE_WORK,
      phaseId: "phase-baseline",
      owner: "agent" as const,
      dependsOnWorkItemIds: [] as const,
      decisionIds: [] as const,
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [APPROVED_BRIEF],
      },
    }],
    requiredDecisions: [] as const,
  };
}

function briefItems(objective: string): readonly ProjectBriefItem[] {
  return [{
    id: "objective",
    kind: "objective",
    statement: objective,
    sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
  }, {
    id: "mission-bounded-demonstration",
    kind: "mission-scenario",
    statement: "Demonstrate a bounded operating scenario with traceable evidence.",
    sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
  }, {
    id: "success-reviewed-system",
    kind: "success-criterion",
    statement: "Complete the reviewed scenario with a traceable engineering record.",
    sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    dependsOnItemIds: [],
  }, {
    id: "verify-traceable-record",
    kind: "verification-activity",
    statement: "Verify the reviewed record against the declared success criterion.",
    sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    dependsOnItemIds: ["success-reviewed-system"],
  }];
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-03T08:59:30.000Z",
  };
}

function threadHead(project: EngineeringProjectSnapshot): EngineeringThreadSnapshotRef {
  return project.threadSnapshots.reduce((latest, item) =>
    !latest || item.revision > latest.revision ? item : latest
  );
}

function threadSnapshotBasis(
  project: EngineeringProjectSnapshot,
): Extract<EngineeringBasisRef, { kind: "thread-snapshot" }> {
  const head = threadHead(project);
  return {
    kind: "thread-snapshot",
    snapshotId: head.snapshotId,
    revision: head.revision,
    subjectId: head.subjectId,
  };
}

function nextThreadSnapshot(
  project: EngineeringProjectSnapshot,
): EngineeringThreadSnapshotRef {
  const head = threadHead(project);
  return {
    snapshotId: `${project.project.subjectId}:thread:r${head.revision + 1}`,
    revision: head.revision + 1,
    subjectId: project.project.subjectId,
  };
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();
  commits = 0;

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const revisions = [...this.#revisions.values()].filter((snapshot) =>
      snapshot.project.id === projectId
    );
    const current = revisions.sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(current ? structuredClone(current) : undefined);
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const snapshot = this.#revisions.get(revision);
    return Promise.resolve(
      snapshot?.project.id === projectId ? structuredClone(snapshot) : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size > 0) {
      throw new EngineeringProjectStoreConflictError("Already exists.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  async commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(snapshot.project.id);
    if (!current || current.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError("Stale revision.");
    }
    this.commits += 1;
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}

class EmptyStore implements EngineeringProjectRevisionStore {
  get(): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(undefined);
  }
  getRevision(): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(undefined);
  }
  createInitial(): Promise<EngineeringProjectSnapshot> {
    return Promise.reject(new Error("must not create"));
  }
  commit(): Promise<EngineeringProjectSnapshot> {
    return Promise.reject(new Error("must not commit"));
  }
}
