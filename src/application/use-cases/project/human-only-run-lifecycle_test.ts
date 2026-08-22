import { assertEquals, assertRejects } from "@std/assert";
import { SYSON_MODEL_SEED_OPERATION } from "../../../domain/architecture/seed/syson-model-seed.ts";
import { DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION } from "../../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import type {
  EngineeringBasisRef,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../../../domain/project/project-brief.ts";
import {
  getRegisteredEngineeringOperation,
  REGISTERED_ENGINEERING_OPERATION_REGISTRY,
} from "../../../orchestration/operations/registry.ts";
import type { EngineeringProjectCommandOrigin } from "../../ports/in/engineering-project-command-origin.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../ports/in/project-run-executor.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import { EngineeringProjectStoreConflictError } from "../../ports/out/engineering-project-revision-store.ts";
import { RegisteredProjectRunExecutor } from "../registered-project-run-executor.ts";
import { ProjectBriefCommandService } from "./project-brief-command-service.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type RunCommand,
} from "./engineering-project-command-service.ts";

const PROJECT_ID = "project-human-only-lifecycle";
const CLOCK = "2026-08-03T09:00:00.000Z";
const AGENT = { kind: "agent" as const, actorId: "agent:guide" };
const YOLO = {
  kind: "human" as const,
  actorId: "local-yolo:startup-opt-in",
};
const APPROVED_BRIEF = {
  name: "approvedBrief",
  source: { kind: "approved-brief" as const },
};
const BASELINE_WORK = "record-approved-brief";
const HUMAN_WORK = "work-human-only-closeout";
const AGENT_WORK = "work-ordinary-seed";
const HUMAN_RUN = "run-human-only-closeout";
const AGENT_RUN = "run-ordinary-seed";

Deno.test(
  "local-yolo human origin claims, publishes, and completes a mustOrigin:human run through the registered executor",
  async () => {
    assertEquals(
      getRegisteredEngineeringOperation(
        DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
      )?.mustOrigin,
      "human",
    );
    const world = await queuedHumanAndAgentRuns();
    const completed = await world.executor.execute(YOLO, {
      commandId: "execute-human-only",
      projectId: PROJECT_ID,
      expectedRevision: world.project.revision,
      issuedAt: CLOCK,
      runId: HUMAN_RUN,
    });
    const run = completed.agentRuns.find((item) => item.id === HUMAN_RUN)!;
    assertEquals(run.status, "completed");
    assertEquals(run.claimedBy, { id: YOLO.actorId, origin: "human" });
    assertEquals(
      (completed.commandReceipts ?? []).filter((receipt) =>
        receipt.commandId.startsWith("execute-human-only:")
      ).every((receipt) =>
        receipt.actor.origin === "human" && receipt.actor.id === YOLO.actorId
      ),
      true,
    );
  },
);

Deno.test(
  "human origin cannot claim an ordinary queued agent run",
  async () => {
    assertEquals(
      getRegisteredEngineeringOperation(SYSON_MODEL_SEED_OPERATION)?.mustOrigin,
      undefined,
    );
    const world = await queuedHumanAndAgentRuns();
    const error = await assertRejects(
      () =>
        world.commands.claimRun(YOLO, {
          commandId: "human-claim-ordinary",
          projectId: PROJECT_ID,
          expectedRevision: world.project.revision,
          issuedAt: CLOCK,
          runId: AGENT_RUN,
          summary: "Human origin must not claim an ordinary agent run.",
        }),
      EngineeringProjectCommandError,
      "human origin cannot execute agent-run.claim.",
    );
    assertEquals(error.code, "permission_denied");
    assertEquals(
      (await world.store.get(PROJECT_ID))?.agentRuns.find((item) =>
        item.id === AGENT_RUN
      )?.status,
      "queued",
    );
  },
);

Deno.test(
  "agent origin cannot claim a mustOrigin:human queued run",
  async () => {
    const world = await queuedHumanAndAgentRuns();
    const error = await assertRejects(
      () =>
        world.commands.claimRun(AGENT, {
          commandId: "agent-claim-human-only",
          projectId: PROJECT_ID,
          expectedRevision: world.project.revision,
          issuedAt: CLOCK,
          runId: HUMAN_RUN,
          summary: "Agent origin must not claim a mustOrigin:human run.",
        }),
      EngineeringProjectCommandError,
      "agent origin cannot execute agent-run.claim on a mustOrigin:human operation.",
    );
    assertEquals(error.code, "permission_denied");
    assertEquals(
      (await world.store.get(PROJECT_ID))?.agentRuns.find((item) =>
        item.id === HUMAN_RUN
      )?.status,
      "queued",
    );
  },
);

Deno.test(
  "registered executor refuses an agent origin before claiming a mustOrigin:human run",
  async () => {
    const world = await queuedHumanAndAgentRuns();
    const error = await assertRejects(
      () =>
        world.executor.execute(AGENT, {
          commandId: "execute-human-only-as-agent",
          projectId: PROJECT_ID,
          expectedRevision: world.project.revision,
          issuedAt: CLOCK,
          runId: HUMAN_RUN,
        }),
      EngineeringProjectCommandError,
      "Only a human operator can execute a mustOrigin:human registered run.",
    );
    assertEquals(error.code, "permission_denied");
    assertEquals(
      (await world.store.get(PROJECT_ID))?.agentRuns.find((item) =>
        item.id === HUMAN_RUN
      )?.status,
      "queued",
    );
  },
);

async function queuedHumanAndAgentRuns(): Promise<{
  readonly store: MemoryProjectStore;
  readonly commands: EngineeringProjectCommandService;
  readonly executor: RegisteredProjectRunExecutor;
  readonly project: EngineeringProjectSnapshot;
}> {
  const store = new MemoryProjectStore();
  const briefs = new ProjectBriefCommandService(store, () => CLOCK);
  let tick = 0;
  const commands = new EngineeringProjectCommandService(
    store,
    { validate: () => Promise.resolve() },
    () => new Date(Date.parse(CLOCK) + ++tick * 1_000).toISOString(),
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  const executor = new RegisteredProjectRunExecutor({
    projects: store,
    baseline: {
      execute: () => Promise.reject(new Error("baseline executor must not run")),
    },
    additional: [{
      operation: DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
      executor: new HumanOnlyLifecycleExecutor(commands),
    }],
  });
  let project = await approvedProject(briefs);
  project = await commands.publishPlan(
    AGENT,
    baselinePlanCommand("publish-baseline", project.revision),
  );
  project = await completeRun(commands, project, {
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
  project = await commands.appendChange(AGENT, {
    ...context("append-lifecycle-work", project.revision),
    baseSnapshot: threadHead(project),
    phases: [{
      id: "phase-lifecycle",
      name: "Lifecycle",
      description: "Queued human-only and ordinary agent runs.",
    }],
    workItems: [{
      id: HUMAN_WORK,
      phaseId: "phase-lifecycle",
      owner: "human",
      dependsOnWorkItemIds: [BASELINE_WORK],
      decisionIds: [],
      operation: {
        id: DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.id,
        version: DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.version,
        bindings: [APPROVED_BRIEF],
      },
    }, {
      id: AGENT_WORK,
      phaseId: "phase-lifecycle",
      owner: "agent",
      dependsOnWorkItemIds: [BASELINE_WORK],
      decisionIds: [],
      operation: {
        id: SYSON_MODEL_SEED_OPERATION.id,
        version: SYSON_MODEL_SEED_OPERATION.version,
        bindings: [APPROVED_BRIEF],
      },
    }],
    requiredDecisions: [],
  });
  const basis = threadSnapshotBasis(project);
  project = await commands.queueRun(AGENT, {
    ...context("queue-human-only", project.revision),
    runId: HUMAN_RUN,
    workItemId: HUMAN_WORK,
    summary: "Queue the reviewed mustOrigin:human operation.",
    basis,
  });
  project = await commands.queueRun(AGENT, {
    ...context("queue-ordinary", project.revision),
    runId: AGENT_RUN,
    workItemId: AGENT_WORK,
    summary: "Queue the reviewed ordinary agent operation.",
    basis,
  });
  return { store, commands, executor, project };
}

class HumanOnlyLifecycleExecutor {
  constructor(
    private readonly commands: Pick<
      EngineeringProjectCommandService,
      "claimRun" | "publishRun" | "completeRun"
    >,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "human") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only a human operator can execute a mustOrigin:human registered run.",
      );
    }
    let project = await this.commands.claimRun(
      origin,
      step(command, "claim", {
        summary: "Started the mustOrigin:human registered run.",
      }),
    );
    project = await this.commands.publishRun(
      origin,
      step(command, "publish", {
        expectedRevision: project.revision,
        summary: "Published the mustOrigin:human registered run.",
      }),
    );
    const resultSnapshot = nextThreadSnapshot(project);
    return await this.commands.completeRun(origin, {
      ...step(command, "complete", {
        expectedRevision: project.revision,
        summary: "Completed the mustOrigin:human registered run.",
      }),
      resultSnapshot,
      evidenceRefs: [{
        snapshotId: resultSnapshot.snapshotId,
        snapshotRevision: resultSnapshot.revision,
        kind: "artifact",
        id: "human-only-lifecycle-result",
      }],
    });
  }
}

function step(
  command: RegisteredProjectRunExecutorCommand,
  name: "claim" | "publish" | "complete",
  extra: Partial<RunCommand> & { readonly summary: string },
): RunCommand {
  return {
    commandId: `${command.commandId}:${name}`,
    projectId: command.projectId,
    expectedRevision: extra.expectedRevision ?? command.expectedRevision,
    issuedAt: command.issuedAt,
    runId: command.runId,
    summary: extra.summary,
  };
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
    items: briefItems(),
  });
  const proposal = project.framing!.proposedBrief!;
  return await service.approveBrief(YOLO, {
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

function briefItems(): readonly ProjectBriefItem[] {
  return [{
    id: "objective",
    kind: "objective",
    statement: "Demonstrate a reviewable system safely.",
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

function threadHead(
  project: EngineeringProjectSnapshot,
): EngineeringThreadSnapshotRef {
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
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}
