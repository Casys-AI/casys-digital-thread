import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  encodeAdmittedObservationEvaluationCloseoutAdmission,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  validateModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  canonicalAdmittedObservationEvaluationCaptureText,
  validateAdmittedObservationEvaluationCapture,
} from "./admitted-observation-evaluation-capture.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DecideAdmittedModelicaEvaluationRunExecutor,
} from "./decide-admitted-modelica-evaluation-run-executor.ts";

const AT = "2026-08-21T12:00:00.000Z";
const RETRY_AT = "2026-08-21T13:00:00.000Z";
const PROJECT_ID = "articulated-led-desk-lamp";
const SUBJECT_ID = "articulated-led-desk-lamp";
const RUN_ID = "run.closeout-evaluation";
const WORK_ID = "work.closeout-evaluation";
const DECISION_ID = "decision.closeout-evaluation";
const APPROVAL_ID = "approval.closeout-evaluation";
const COMMAND_ID = "command.closeout-evaluation";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const OTHER_HUMAN = { kind: "human" as const, actorId: "human:other" };
const CLAIM_SUMMARY =
  "Started the human accept closeout of the admitted Modelica evaluation.";

Deno.test(
  "accept closeout binds the exact L4 capture and sheet without calling an engine",
  async () => {
    const fixture = await executeFixture({ consequence: "accept" });
    const project = await fixture.executor.execute(HUMAN, fixture.command);
    const run = project.agentRuns[0]!;
    assertEquals(run.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "decide.accept-admitted-modelica-evaluation@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(
      snapshot?.evaluations.map((item) => item.status),
      ["unresolved"],
    );
    assertEquals(
      snapshot?.proposedActions.some((item) =>
        item.kind === "review" &&
        item.rationale.includes("An L4 pass is not L5.")
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
    const run = project.agentRuns[0]!;
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    assertEquals(
      snapshot?.artifacts.some((item) =>
        item.producer.tool === "decide.reject-admitted-modelica-evaluation@1"
      ),
      true,
    );
    assertEquals(fixture.evaluationCaptures.saves, 0);
  },
);

Deno.test("admitted Modelica evaluation closeout refuses a non-human origin", async () => {
  const fixture = await executeFixture({ consequence: "accept" });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "human operator",
  );
  assertEquals(fixture.evaluationCaptures.reads, 0);
  assertEquals(fixture.closeoutCaptures.saves, 0);
});

Deno.test(
  "admitted Modelica evaluation closeout refuses a stale L4 capture",
  async () => {
    const fixture = await executeFixture({
      consequence: "accept",
      includeL4Artifact: false,
    });
    await assertRejects(
      () => fixture.executor.execute(HUMAN, fixture.command),
      EngineeringProjectCommandError,
      "stale",
    );
    assertEquals(fixture.closeoutCaptures.saves, 0);
  },
);

Deno.test(
  "admitted Modelica evaluation closeout refuses a non-L4 capture",
  async () => {
    const fixture = await executeFixture({
      consequence: "accept",
      l4Body: { kind: "modelica-qualified-kit", modelicaText: "model Fake" },
    });
    await assertRejects(
      () => fixture.executor.execute(HUMAN, fixture.command),
      EngineeringProjectCommandError,
      "not an L4",
    );
    assertEquals(fixture.closeoutCaptures.saves, 0);
  },
);

Deno.test(
  "admitted Modelica evaluation closeout refuses stale or foreign approval and basis",
  async () => {
    const cases: Array<{
      readonly name: string;
      readonly mutate: (project: MutableProject) => void;
      readonly message: string;
    }> = [
      {
        name: "foreign approval subject",
        mutate: (project) => {
          const approval = project.approvals[0] as {
            baseSnapshot: { subjectId: string };
          };
          approval.baseSnapshot = {
            ...approval.baseSnapshot,
            subjectId: "foreign-subject",
          };
        },
        message: "No exact human-approved",
      },
      {
        name: "stale approval revision with same snapshotId",
        mutate: (project) => {
          const approval = project.approvals[0] as {
            baseSnapshot: { revision: number };
          };
          approval.baseSnapshot = {
            ...approval.baseSnapshot,
            revision: 99,
          };
        },
        message: "No exact human-approved",
      },
      {
        name: "stale decision revision",
        mutate: (project) => {
          const decision = project.decisions[0] as {
            baseSnapshot: { revision: number };
          };
          decision.baseSnapshot = {
            ...decision.baseSnapshot,
            revision: 99,
          };
        },
        message: "No exact human-approved",
      },
      {
        name: "agent self-approval",
        mutate: (project) => {
          const approval = project.approvals[0] as {
            decidedByOrigin: string;
          };
          approval.decidedByOrigin = "agent";
        },
        message: "No exact human-approved",
      },
      {
        name: "foreign approval evidence",
        mutate: (project) => {
          const approval = project.approvals[0] as unknown as {
            inputEvidenceRefs: Array<{
              snapshotId: string;
              snapshotRevision: number;
              kind: "artifact";
              id: string;
            }>;
          };
          approval.inputEvidenceRefs = [{
            snapshotId: "placeholder-thread-snapshot",
            snapshotRevision: 1,
            kind: "artifact",
            id: "foreign-evidence",
          }];
        },
        message: "No exact human-approved",
      },
      {
        name: "tampered decision fingerprint",
        mutate: (project) => {
          const decision = project.decisions[0] as {
            inputFingerprint: { algorithm: "sha256"; digest: string };
          };
          decision.inputFingerprint = {
            algorithm: "sha256",
            digest: "f".repeat(64),
          };
          const approval = project.approvals[0] as {
            inputFingerprint: { algorithm: "sha256"; digest: string };
          };
          approval.inputFingerprint = decision.inputFingerprint;
        },
        message: "decision fingerprint no longer seals",
      },
      {
        name: "tampered run input fingerprint",
        mutate: (project) => {
          const run = project.agentRuns[0] as {
            inputFingerprint: { algorithm: "sha256"; digest: string };
          };
          run.inputFingerprint = {
            algorithm: "sha256",
            digest: "e".repeat(64),
          };
        },
        message: "run fingerprint no longer seals",
      },
    ];
    for (const testCase of cases) {
      const fixture = await executeFixture({ consequence: "accept" });
      testCase.mutate(fixture.project);
      await assertRejects(
        () => fixture.executor.execute(HUMAN, fixture.command),
        EngineeringProjectCommandError,
        testCase.message,
      );
      assertEquals(fixture.closeoutCaptures.saves, 0, testCase.name);
      assertEquals(fixture.project.agentRuns[0]?.status, "queued", testCase.name);
    }
  },
);

Deno.test(
  "admitted Modelica evaluation closeout recovers the same human running or publishing state without a second publish",
  async () => {
    const running = await executeFixture({
      consequence: "accept",
      runStatus: "running",
    });
    await assertRejects(
      () =>
        running.executor.execute(
          OTHER_HUMAN,
          retryCommand(running.project.revision),
        ),
      EngineeringProjectCommandError,
      "exact admitted Modelica evaluation closeout it claimed",
    );
    const recovered = await running.executor.execute(
      HUMAN,
      retryCommand(running.project.revision),
    );
    assertEquals(recovered.agentRuns[0]?.status, "completed");
    assertEquals(
      (recovered.commandReceipts ?? []).filter((item) =>
        item.type === "agent-run.claim"
      ).length,
      1,
    );
    assertEquals(
      (recovered.commandReceipts ?? []).every((item) =>
        item.actor.origin === "human" && item.actor.id === HUMAN.actorId
      ),
      true,
    );
    assertEquals(running.closeoutCaptures.saves, 1);
    assertEquals(running.evaluationCaptures.saves, 0);

    const publishing = await executeFixture({
      consequence: "accept",
      losePublishAck: true,
    });
    await assertRejects(
      () => publishing.executor.execute(HUMAN, publishing.command),
      Error,
      "publish acknowledgement lost",
    );
    assertEquals(publishing.project.agentRuns[0]?.status, "publishing");
    const publishCount = publishing.project.commandReceipts.filter((item) =>
      item.type === "agent-run.publish"
    ).length;
    assertEquals(publishCount, 1);
    const saveCalls = publishing.snapshots.saveCalls;
    const closeoutSaves = publishing.closeoutCaptures.saves;
    const completed = await publishing.executor.execute(
      HUMAN,
      retryCommand(publishing.project.revision),
    );
    assertEquals(completed.agentRuns[0]?.status, "completed");
    assertEquals(
      publishing.project.commandReceipts.filter((item) =>
        item.type === "agent-run.publish"
      ).length,
      publishCount,
    );
    assertEquals(publishing.snapshots.saveCalls, saveCalls);
    assertEquals(publishing.closeoutCaptures.saves, closeoutSaves);
    assertEquals(
      (completed.commandReceipts ?? []).filter((item) =>
        item.type === "agent-run.claim"
      ).length,
      1,
    );
    assertEquals(
      (completed.commandReceipts ?? []).every((item) =>
        item.actor.origin === "human"
      ),
      true,
    );
  },
);

async function executeFixture(options: {
  readonly consequence: "accept" | "reject";
  readonly includeL4Artifact?: boolean;
  readonly l4Body?: unknown;
  readonly runStatus?: "queued" | "running";
  readonly losePublishAck?: boolean;
}) {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  const l4Capture = validateAdmittedObservationEvaluationCapture({
    schemaVersion: "modelica-admitted-observation-evaluation-capture/1.0",
    kind: "modelica-admitted-observation-evaluation",
    operation: {
      id: "verify.evaluate-admitted-modelica-observations",
      version: "1",
    },
    request: {
      name: "syson_constraint_evaluate",
      arguments: { constraints: [], values: {} },
    },
    response: { structuredContent: { results: [] } },
    unresolved: [{
      requirementElementId: "placeholder-requirement",
      reason: "unit-identity-mismatch",
    }],
  });
  const l4Fingerprint = await sha256Fingerprint(l4Capture);
  const l4Id = `modelica-admitted-observation-evaluation-${l4Fingerprint.digest}`;
  const l4Text = options.l4Body === undefined
    ? canonicalAdmittedObservationEvaluationCaptureText(l4Capture)
    : deterministicJson(options.l4Body);
  const storedFingerprint = options.l4Body === undefined
    ? l4Fingerprint
    : await sha256Fingerprint(options.l4Body);
  const captureId = options.l4Body === undefined
    ? l4Id
    : `modelica-admitted-observation-evaluation-${storedFingerprint.digest}`;
  const includeL4Artifact = options.includeL4Artifact !== false;
  const artifacts: Array<ThreadSnapshot["artifacts"][number]> = [{
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
  }];
  const provenance: Array<ThreadSnapshot["provenance"][number]> = [{
    id: "provenance.change.brief",
    relation: "changes",
    from: { kind: "change", id: "change.brief" },
    to: { kind: "artifact", id: "artifact.brief" },
    rationale: "The applied change introduced the brief document.",
  }, {
    id: "trace-requirement-to-brief",
    relation: "traces_to",
    from: { kind: "requirement", id: "placeholder-requirement" },
    to: { kind: "artifact", id: "artifact.brief" },
    rationale: "The placeholder requirement constrains the brief artifact.",
  }];
  const evaluations: Array<ThreadSnapshot["evaluations"][number]> = [];
  if (includeL4Artifact) {
    artifacts.push({
      id: captureId,
      name: "Admitted Modelica observation evaluation",
      kind: "document",
      version: storedFingerprint.digest,
      fingerprint: storedFingerprint,
      uri:
        `casys://modelica-admitted-observation-evaluation-capture/sha256/${storedFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.evaluate-admitted-modelica-observations@1",
        runId: "run.evaluate-observations",
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    });
    evaluations.push({
      id: "placeholder-requirement-evaluation",
      name: "placeholder evaluation",
      requirementId: "placeholder-requirement",
      observationIds: [],
      status: "unresolved",
      evaluatedAt: AT,
      evaluator: {
        serverId: "syson",
        tool: "syson_constraint_evaluate",
        runId: "run.evaluate-observations",
      },
      evidenceArtifactIds: [captureId],
      message:
        "Identity unit policy left this observation unresolved. It is not a fail.",
      freshness: fresh(AT),
    });
    provenance.push({
      id: "change-l4-evaluation",
      relation: "changes",
      from: { kind: "change", id: "change.l4" },
      to: { kind: "artifact", id: captureId },
      rationale: "The L4 evaluation capture was published.",
    }, {
      id: "evaluates-placeholder",
      relation: "evaluates",
      from: { kind: "evaluation", id: "placeholder-requirement-evaluation" },
      to: { kind: "requirement", id: "placeholder-requirement" },
      rationale:
        "The admitted observation evaluation evaluates the named Thread requirement.",
    }, {
      id: "evidences-placeholder",
      relation: "evidences",
      from: { kind: "evaluation", id: "placeholder-requirement-evaluation" },
      to: { kind: "artifact", id: captureId },
      rationale: "The evaluation is evidenced by the reread SysON capture.",
    });
  }
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "placeholder-thread-snapshot",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Closeout fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [
        {
          id: "change.brief",
          kind: "created",
          target: { kind: "artifact", id: "artifact.brief" },
          summary: "Recorded the documentary brief.",
          afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
        },
        ...(includeL4Artifact
          ? [{
            id: "change.l4",
            kind: "created" as const,
            target: { kind: "artifact" as const, id: captureId },
            summary: "Published the L4 evaluation capture.",
            afterFingerprint: storedFingerprint,
          }]
          : []),
      ],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [{
      id: "placeholder-requirement",
      name: "placeholder",
      statement: "Placeholder requirement. Not a thermal verdict.",
      version: "1",
      criterion: {
        metric: "placeholder-output",
        operator: "<=",
        limit: { value: 1, unit: "unit-pending-source" },
      },
      trace: {
        sourceArtifactId: "artifact.brief",
        elementId: "placeholder-requirement",
        targetArtifactIds: ["artifact.brief"],
      },
      freshness: fresh(AT),
    }],
    evaluations,
    violations: [],
    provenance,
    proposedActions: [],
  });
  const basisFingerprint = await sha256Fingerprint(basisSnapshot);
  const operation = options.consequence === "accept"
    ? {
      ...DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    }
    : {
      ...DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    };
  const admission = encodeAdmittedObservationEvaluationCloseoutAdmission({
    schemaVersion: "modelica-admitted-observation-evaluation-closeout/1.0",
    consequence: options.consequence,
    projectId: PROJECT_ID,
    subjectId: SUBJECT_ID,
    basis: {
      snapshotId: basisSnapshot.id,
      revision: basisSnapshot.revision,
      fingerprint: basisFingerprint,
    },
    sheet: { id: sheet.id, fingerprint: sheetFingerprint },
    capture: {
      id: captureId,
      fingerprint: storedFingerprint,
    },
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const summary = "Close out the admitted Modelica evaluation.";
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
    schemaVersion: "3.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Lamp",
      subjectId: SUBJECT_ID,
      objective: { title: "Closeout", statement: summary },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.review",
      name: "Review",
      order: 1,
      description: "Human L5 closeout.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
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
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "queued",
      summary,
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
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
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new ExecuteMemorySnapshots(basisSnapshot);
  const evaluationCaptures = new CountingCaptures();
  evaluationCaptures.seed(storedFingerprint, l4Text);
  const closeoutCaptures = new CountingCaptures();
  const sheets = new MemorySheetStore(sheet, sheetFingerprint);
  const commands = new ExecuteCommands(project, {
    losePublishAck: options.losePublishAck === true,
  });
  if (options.runStatus === "running") {
    await commands.claimRun(HUMAN, {
      commandId: `${COMMAND_ID}:${operation.id}:claim`,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
      summary: CLAIM_SUMMARY,
    });
  }
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: (_projectId, revision) =>
      Promise.resolve(commands.reopenRevision(revision)),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    executor: new DecideAdmittedModelicaEvaluationRunExecutor({
      projects,
      commands,
      snapshots,
      sheets,
      evaluationCaptures,
      closeoutCaptures,
      lease: { withLease: (_projectId, _scope, operationFn) => operationFn() },
    }),
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    project,
    snapshots,
    evaluationCaptures,
    closeoutCaptures,
  };
}

type CommandOrigin = typeof AGENT | typeof HUMAN | typeof OTHER_HUMAN;

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
  saveCalls = 0;
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
    this.saveCalls += 1;
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

class CountingCaptures {
  reads = 0;
  saves = 0;
  readonly #items = new Map<string, string>();
  seed(fingerprint: ContentFingerprint, text: string) {
    this.#items.set(fingerprint.digest, text);
  }
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

class MemorySheetStore implements ThermalMethodSheetStore {
  constructor(
    readonly sheet: ReturnType<typeof validateModelicaThermalMethodSheet>,
    readonly fingerprint: ContentFingerprint,
  ) {}
  save() {
    return Promise.reject(new Error("unused"));
  }
  read(fingerprint: ContentFingerprint) {
    if (fingerprint.digest !== this.fingerprint.digest) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.sheet);
  }
}

class ExecuteCommands {
  #losePublishAck: boolean;
  readonly #revisions = new Map<number, MutableProject>();

  constructor(
    readonly project: MutableProject,
    options: { readonly losePublishAck?: boolean } = {},
  ) {
    this.#losePublishAck = options.losePublishAck === true;
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

  async publishRun(origin: CommandOrigin, command: RunCommand) {
    const project = await this.#transition(
      "agent-run.publish",
      origin,
      command,
      ["running"],
      "publishing",
    );
    if (this.#losePublishAck) {
      this.#losePublishAck = false;
      throw new Error("publish acknowledgement lost after commit");
    }
    return project;
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

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}

function retryCommand(expectedRevision: number) {
  return {
    commandId: COMMAND_ID,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: RETRY_AT,
    runId: RUN_ID,
  };
}
