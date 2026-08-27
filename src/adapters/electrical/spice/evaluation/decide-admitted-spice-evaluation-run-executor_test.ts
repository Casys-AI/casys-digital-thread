import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import { encodeSpiceAdmittedObservationEvaluationCloseoutAdmission } from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import {
  createAdmittedSpiceCloseoutEvidenceFixture,
  SPICE_CLOSEOUT_REVIEW_AT as AT,
  SPICE_CLOSEOUT_REVIEW_PROJECT_ID as PROJECT_ID,
  SPICE_CLOSEOUT_REVIEW_SUBJECT_ID as SUBJECT_ID,
} from "../../../../testing/admitted-spice-evaluation-closeout-fixture.ts";
import {
  admittedSpiceEvaluationCloseoutAdmission,
  resolveAdmittedSpiceEvaluationCloseoutEvidence,
} from "./admitted-spice-observation-evaluation-closeout-evidence-resolver.ts";
import {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DecideAdmittedSpiceEvaluationRunExecutor,
} from "./decide-admitted-spice-evaluation-run-executor.ts";

const RUN_ID = "run.closeout-evaluation";
const WORK_ID = "work.closeout-evaluation";
const DECISION_ID = "decision.closeout-evaluation";
const APPROVAL_ID = "approval.closeout-evaluation";
const COMMAND_ID = "command.closeout-evaluation";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
Deno.test(
  "accept closeout binds the exact L4 capture and sheet without calling an engine",
  async () => {
    const fixture = await executeFixture({ consequence: "accept" });
    const project = await fixture.executor.execute(HUMAN, fixture.command);
    const run = project.agentRuns[0]!;
    assertEquals(run.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "decide.accept-admitted-spice-evaluation@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(snapshot?.evaluations.map((item) => item.status), ["unresolved"]);
    assertEquals(
      snapshot?.proposedActions.some((item) =>
        item.kind === "review" && item.rationale.includes("An L4 pass is not L5.")
      ),
      true,
    );
    assertEquals(fixture.evaluationCaptures.saves, 0);
    assertEquals(fixture.evaluationCaptures.reads > 0, true);
    assertEquals(fixture.closeoutCaptures.saves, 1);
    assertEquals(
      (project.commandReceipts ?? []).every((receipt) =>
        receipt.actor.origin === "human"
      ),
      true,
    );
  },
);

Deno.test(
  "reject closeout records the declared consequence without re-executing L4",
  async () => {
    const fixture = await executeFixture({ consequence: "reject" });
    const project = await fixture.executor.execute(HUMAN, fixture.command);
    const snapshot = await fixture.snapshots.getFresh(
      project.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    assertEquals(
      snapshot?.artifacts.some((item) =>
        item.producer.tool === "decide.reject-admitted-spice-evaluation@1"
      ),
      true,
    );
    assertEquals(fixture.evaluationCaptures.saves, 0);
  },
);

Deno.test("admitted SPICE evaluation closeout refuses a non-human origin", async () => {
  const fixture = await executeFixture({ consequence: "accept" });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "human operator",
  );
  assertEquals(fixture.closeoutCaptures.saves, 0);
});

Deno.test(
  "admitted SPICE evaluation closeout recrosses the same shared L4 evidence as the review resolver",
  async () => {
    const fixture = await executeFixture({ consequence: "accept" });
    const snapshot = await fixture.snapshots.getFresh(fixture.basis.snapshotId);
    const resolved = await resolveAdmittedSpiceEvaluationCloseoutEvidence(
      fixture.dependencies,
      {
        project: fixture.project,
        basis: fixture.basis,
        snapshot: snapshot!,
      },
    );
    assertEquals(
      fixture.project.decisions[0]!.proposal!.parameters,
      encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(
        admittedSpiceEvaluationCloseoutAdmission(resolved, "accept"),
      ),
    );
    const project = await fixture.executor.execute(HUMAN, fixture.command);
    assertEquals(project.agentRuns[0]?.status, "completed");
    assertEquals(fixture.evaluationCaptures.saves, 0);
  },
);

Deno.test(
  "admitted SPICE evaluation closeout refuses a missing L4 capture",
  async () => {
    const fixture = await executeFixture({
      consequence: "accept",
      includeL4Artifact: false,
    });
    await assertRejects(
      () => fixture.executor.execute(HUMAN, fixture.command),
      EngineeringProjectCommandError,
      "cannot be recrossed",
    );
    assertEquals(fixture.closeoutCaptures.saves, 0);
  },
);

async function executeFixture(options: {
  readonly consequence: "accept" | "reject";
  readonly includeL4Artifact?: boolean;
}) {
  const evidence = await createAdmittedSpiceCloseoutEvidenceFixture({
    projectId: PROJECT_ID,
    subjectId: SUBJECT_ID,
    includeL4Artifact: options.includeL4Artifact,
  });
  const basisSnapshot = evidence.snapshot;
  const operation = options.consequence === "accept"
    ? {
      ...DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    }
    : {
      ...DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    };
  let admission;
  try {
    const resolved = await resolveAdmittedSpiceEvaluationCloseoutEvidence(
      evidence.dependencies,
      {
        project: evidence.project,
        basis: evidence.basis,
        snapshot: basisSnapshot,
      },
    );
    admission = encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(
      admittedSpiceEvaluationCloseoutAdmission(resolved, options.consequence),
    );
  } catch {
    const basisFingerprint = await sha256Fingerprint(basisSnapshot);
    admission = encodeSpiceAdmittedObservationEvaluationCloseoutAdmission({
      schemaVersion: "spice-admitted-observation-evaluation-closeout/1.0",
      consequence: options.consequence,
      projectId: PROJECT_ID,
      subjectId: SUBJECT_ID,
      basis: {
        snapshotId: basisSnapshot.id,
        revision: basisSnapshot.revision,
        fingerprint: basisFingerprint,
      },
      sheet: { id: evidence.sheet.id, fingerprint: evidence.sheetFingerprint },
      capture: {
        id: `spice-admitted-observation-evaluation-${evidence.l4Fingerprint.digest}`,
        fingerprint: evidence.l4Fingerprint,
      },
    });
  }
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const summary = "Close out the admitted SPICE evaluation.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary, parameters: admission },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
  });
  const project = {
    ...evidence.project,
    phases: [
      {
        id: "phase.review",
        name: "Review",
        order: 1,
        description: "Human L5 closeout.",
        workItemIds: [WORK_ID],
        requiredDecisionIds: [DECISION_ID],
        evidenceRefs: [],
      },
      ...evidence.project.phases.map(
        (phase: (typeof evidence.project.phases)[number]) => ({
          ...phase,
          order: phase.order + 1,
        }),
      ),
    ],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.review",
      title: "Close out evaluation",
      description: summary,
      kind: "review",
      operation,
      status: "in-progress",
      owner: "human",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION_ID],
      blockerIds: [],
    }, ...evidence.project.workItems],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "queued",
      summary,
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }, ...evidence.project.agentRuns],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.review",
      title: "Approve closeout",
      question: "Close out the exact L4 evaluation?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary,
        parameters: admission,
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    commandReceipts: [],
    approvals: [{
      id: APPROVAL_ID,
      decisionId: DECISION_ID,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Reviewed identities.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
  } as unknown as MutableProject;
  const snapshots = new ExecuteMemorySnapshots(
    basisSnapshot,
    evidence.previousSnapshot,
  );
  const closeoutCaptures = new CountingCaptures();
  const commands = new ExecuteCommands(project);
  evidence.evaluationCaptures.reads = 0;
  evidence.sheetCaptures.saves = 0;
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: (_projectId, revision) =>
      Promise.resolve(commands.reopenRevision(revision)),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    executor: new DecideAdmittedSpiceEvaluationRunExecutor({
      projects,
      commands,
      snapshots,
      sheets: evidence.sheets,
      evaluationCaptures: evidence.evaluationCaptures,
      sheetCaptures: evidence.sheetCaptures,
      spiceCaptures: evidence.spiceCaptures,
      evidence: evidence.evidence,
      closeoutCaptures,
      lease: { withLease: (_projectId, _scope, operationFn) => operationFn() },
    }),
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: AT,
      runId: RUN_ID,
    },
    project,
    snapshots,
    evaluationCaptures: evidence.evaluationCaptures,
    closeoutCaptures,
    dependencies: evidence.dependencies,
    basis: evidence.basis,
  };
}

type CommandOrigin = typeof AGENT | typeof HUMAN;

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

class ExecuteMemorySnapshots {
  readonly #items = new Map<string, ThreadSnapshot>();
  constructor(basis: ThreadSnapshot, previous?: ThreadSnapshot) {
    this.#items.set(basis.id, structuredClone(basis));
    if (previous) this.#items.set(previous.id, structuredClone(previous));
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
    if (existing && JSON.stringify(existing) !== JSON.stringify(attempted)) {
      return Promise.reject(
        new Error(`immutable snapshot ${snapshot.id} was rewritten`),
      );
    }
    if (!existing) this.#items.set(snapshot.id, attempted);
    return Promise.resolve();
  }
}

class CountingCaptures {
  reads = 0;
  saves = 0;
  readonly #items = new Map<string, string>();
  save(fingerprint: ContentFingerprint, text: string) {
    this.saves += 1;
    this.#items.set(fingerprint.digest, text);
    return Promise.resolve({ fingerprint, uri: `casys://x/${fingerprint.digest}` });
  }
  read(fingerprint: ContentFingerprint) {
    this.reads += 1;
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class ExecuteCommands {
  readonly #revisions = new Map<number, MutableProject>();

  constructor(readonly project: MutableProject) {
    this.#revisions.set(project.revision, structuredClone(project));
  }

  reopenRevision(revision: number): EngineeringProjectSnapshot | undefined {
    const snapshot = this.#revisions.get(revision);
    return snapshot && structuredClone(snapshot);
  }

  claimRun(origin: CommandOrigin, command: RunCommand) {
    return this.#transition(
      "agent-run.claim",
      origin,
      command,
      ["queued"],
      "running",
      (run) => {
        run.startedAt = AT;
        run.claimedAt = AT;
        run.claimedBy = { id: origin.actorId, origin: origin.kind };
      },
    );
  }

  publishRun(origin: CommandOrigin, command: RunCommand) {
    return this.#transition(
      "agent-run.publish",
      origin,
      command,
      ["running"],
      "publishing",
    );
  }

  completeRun(origin: CommandOrigin, command: CompleteRunCommand) {
    return this.#transition(
      "agent-run.complete",
      origin,
      command,
      ["publishing"],
      "completed",
      (run) => {
        run.completedAt = AT;
        run.resultSnapshot = command.resultSnapshot;
        run.evidenceRefs = [...command.evidenceRefs];
        const work = this.project.workItems[0] as MutableWork;
        work.status = "completed";
        work.evidenceRefs = [...command.evidenceRefs];
        if (
          !this.project.threadSnapshots.some((item) =>
            item.snapshotId === command.resultSnapshot.snapshotId
          )
        ) {
          this.project.threadSnapshots.push(command.resultSnapshot);
        }
      },
    );
  }

  failRun(_origin: CommandOrigin, command: FailRunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    run.status = "failed";
    run.failure = { code: command.code, message: command.message };
    this.project.revision += 1;
    this.project.id = `${PROJECT_ID}:r${this.project.revision}`;
    this.project.generatedAt = AT;
    this.#revisions.set(this.project.revision, structuredClone(this.project));
    return Promise.resolve(this.project);
  }

  async #transition(
    type: "agent-run.claim" | "agent-run.publish" | "agent-run.complete",
    origin: CommandOrigin,
    command: RunCommand | CompleteRunCommand,
    allowed: readonly string[],
    status: "running" | "publishing" | "completed",
    update?: (run: MutableRun) => void,
  ) {
    const requestFingerprint = await sha256Fingerprint({
      type,
      origin,
      command,
    });
    const existing = this.project.commandReceipts.find((receipt) =>
      receipt.commandId === command.commandId
    );
    if (existing) {
      if (!fingerprintsEqual(existing.requestFingerprint, requestFingerprint)) {
        throw new EngineeringProjectCommandError(
          "command_id_conflict",
          `Command id ${command.commandId} was already used for a different request.`,
        );
      }
      const historical = this.#revisions.get(existing.resultingSnapshot.revision);
      if (
        !historical || historical.id !== existing.resultingSnapshot.snapshotId
      ) {
        throw new EngineeringProjectCommandError(
          "command_id_conflict",
          `Command id ${command.commandId} has an invalid immutable result receipt.`,
        );
      }
      return structuredClone(historical);
    }
    if (this.project.revision !== command.expectedRevision) {
      throw new EngineeringProjectCommandError(
        "stale_revision",
        `Engineering project ${command.projectId} expected revision ${command.expectedRevision} but is at ${this.project.revision}.`,
      );
    }
    const run = this.project.agentRuns[0] as MutableRun;
    if (!allowed.includes(run.status)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Agent run ${run.id} cannot transition from ${run.status} to ${status}.`,
      );
    }
    update?.(run);
    run.status = status;
    run.summary = command.summary;
    run.statusHistory = [...(run.statusHistory ?? []), {
      commandId: command.commandId,
      status,
      at: AT,
      actor: { id: origin.actorId, origin: origin.kind },
      summary: command.summary,
    }];
    this.project.revision += 1;
    this.project.id = `${PROJECT_ID}:r${this.project.revision}`;
    this.project.generatedAt = AT;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type,
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint,
      resultingSnapshot: {
        snapshotId: this.project.id,
        revision: this.project.revision,
      },
    });
    this.#revisions.set(this.project.revision, structuredClone(this.project));
    return this.project;
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
