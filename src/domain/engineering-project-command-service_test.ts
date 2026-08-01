import { assertEquals, assertRejects } from "@std/assert";
import {
  deriveEngineeringProjectStatus,
  type EngineeringProjectSnapshot,
  type EngineeringThreadSnapshotRef,
} from "./engineering-project.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectCompletionEvidenceValidator,
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "./engineering-project-command-service.ts";
import { validateEngineeringProjectSnapshot } from "./engineering-project-validation.ts";

const CONFIG = new URL(
  "../../config/projects/coffee-machine-cm01.project.json",
  import.meta.url,
);
const HUMAN = { kind: "human" as const, actorId: "operator-7" };
const AGENT = { kind: "agent" as const, actorId: "agent-worker-3" };
const OTHER_AGENT = { kind: "agent" as const, actorId: "agent-worker-9" };

Deno.test("proposal is typed, server-timestamped, fingerprinted and idempotent", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  const command = {
    ...context("propose-criterion", 1),
    issuedAt: "2026-08-01T18:59:00+08:00",
    decisionId: "define-mechanical-criterion",
    proposal: proposal("criterion"),
    baseSnapshot: baseSnapshot(await store.get(PROJECT_ID)),
  };

  const proposed = await service.proposeDecision(HUMAN, command);
  const decision = findDecision(proposed, command.decisionId);

  assertEquals(proposed.revision, 2);
  assertEquals(decision.status, "proposed");
  assertEquals(decision.proposal?.proposedAt, "2026-08-01T11:00:01.000Z");
  assertEquals(decision.proposal?.proposedBy, { id: HUMAN.actorId, origin: "human" });
  assertEquals(decision.proposal?.parameters[0].value, "criterion");
  assertEquals(decision.inputFingerprint?.digest.length, 64);
  assertEquals(proposed.approvals[0].status, "pending");
  assertEquals(proposed.commandReceipts?.[0].appliedAt, "2026-08-01T11:00:01.000Z");
  assertEquals(proposed.commandReceipts?.[0].issuedAt, "2026-08-01T10:59:00.000Z");

  const replay = await service.proposeDecision(HUMAN, {
    ...command,
    issuedAt: "2026-08-01T10:59:00.000Z",
  });
  assertEquals(replay.id, proposed.id);
  assertEquals((await store.get(PROJECT_ID))?.revision, 2);

  await assertCommandError(
    () =>
      service.proposeDecision(HUMAN, {
        ...command,
        proposal: proposal("different"),
      }),
    "command_id_conflict",
  );
});

Deno.test("stale revision and approval scope mismatch fail without mutation", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  const proposed = await propose(service, store, "define-mechanical-criterion", 1, 1);

  await assertCommandError(
    () => propose(service, store, "select-material-model", 1, 2),
    "stale_revision",
  );
  await assertCommandError(
    () =>
      service.approveDecision(HUMAN, {
        ...context("approve-wrong-scope", proposed.revision),
        decisionId: "define-mechanical-criterion",
        rationale: "Reviewed in the test.",
        inputFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      }),
    "approval_scope_mismatch",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, proposed.revision);
});

Deno.test("rejected proposal can be replaced without rewriting historical approval scope", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  let project = await propose(
    service,
    store,
    "define-mechanical-criterion",
    1,
    1,
  );
  const firstDecision = findDecision(project, "define-mechanical-criterion");
  project = await service.rejectDecision(HUMAN, {
    ...context("reject-first-scope", project.revision),
    decisionId: firstDecision.id,
    rationale: "The first test scope is not acceptable.",
    inputFingerprint: firstDecision.inputFingerprint!,
  });
  assertEquals(deriveEngineeringProjectStatus(project), "attention-required");
  const historicalApproval = structuredClone(project.approvals[0]);

  project = await service.proposeDecision(HUMAN, {
    ...context("propose-replacement-scope", project.revision),
    decisionId: firstDecision.id,
    proposal: proposal("replacement"),
    baseSnapshot: baseSnapshot(project),
  });
  const replacementDecision = findDecision(project, firstDecision.id);
  assertEquals(project.approvals[0], historicalApproval);
  assertEquals(project.approvals[0].status, "rejected");
  assertEquals(project.approvals[1].status, "pending");
  assertEquals(
    project.approvals[0].inputFingerprint?.digest ===
      project.approvals[1].inputFingerprint?.digest,
    false,
  );

  project = await service.approveDecision(HUMAN, {
    ...context("approve-replacement-scope", project.revision),
    decisionId: replacementDecision.id,
    rationale: "The replacement scope was explicitly reviewed.",
    inputFingerprint: replacementDecision.inputFingerprint!,
  });
  assertEquals(findDecision(project, firstDecision.id).status, "approved");
  assertEquals(project.approvals.map((item) => item.status), [
    "rejected",
    "approved",
  ]);
  assertEquals(project.approvals[0], historicalApproval);
});

Deno.test("human approvals resolve their blockers and unlock work only after all decisions", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  let project = (await store.get(PROJECT_ID))!;
  const decisionIds =
    project.workItems.find((item) => item.id === "verify-current-mechanical-design")!
      .decisionIds;

  for (const [index, decisionId] of decisionIds.entries()) {
    project = await propose(
      service,
      store,
      decisionId,
      project.revision,
      index * 2 + 1,
    );
    const decision = findDecision(project, decisionId);
    project = await service.approveDecision(HUMAN, {
      ...context(`approve-${decisionId}`, project.revision),
      decisionId,
      rationale: "Explicit test review.",
      inputFingerprint: decision.inputFingerprint!,
    });
    const blocker = project.blockers.find((item) =>
      item.decisionIds.includes(decisionId)
    )!;
    assertEquals(blocker.status, "resolved");
    assertEquals(blocker.resolvedAt !== undefined, true);
    const status = project.workItems.find((item) =>
      item.id === "verify-current-mechanical-design"
    )!.status;
    assertEquals(
      status,
      index === decisionIds.length - 1 ? "ready" : "waiting-for-decision",
    );
  }

  assertEquals(project.blockers.every((item) => item.status === "resolved"), true);
  assertEquals(
    project.approvals.every((item) =>
      item.status === "approved" && item.decidedByOrigin === "human"
    ),
    true,
  );
});

Deno.test("browser cannot claim and a second agent cannot hijack a claimed run", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  const project = await approveAll(service, store);
  const queued = await service.queueRun(HUMAN, {
    ...context("queue-verification", project.revision),
    runId: "verify-run-1",
    workItemId: "verify-current-mechanical-design",
    summary: "Queue reviewed verification inputs.",
    baseSnapshot: baseSnapshot(project),
  });

  assertEquals(queued.agentRuns[0].status, "queued");
  assertEquals(
    findWorkItem(queued, "verify-current-mechanical-design").status,
    "in-progress",
  );
  await assertCommandError(
    () =>
      service.claimRun(HUMAN, {
        ...context("browser-fake-start", queued.revision),
        runId: "verify-run-1",
        summary: "Pretend to start.",
      }),
    "permission_denied",
  );
  await assertCommandError(
    () =>
      service.publishRun(AGENT, {
        ...context("publish-before-start", queued.revision),
        runId: "verify-run-1",
        summary: "Publish too early.",
      }),
    "invalid_transition",
  );
  await assertCommandError(
    () =>
      service.queueRun(AGENT, {
        ...context("agent-self-queue", queued.revision),
        runId: "verify-run-2",
        workItemId: "verify-current-mechanical-design",
        summary: "Agent cannot authorize itself.",
        baseSnapshot: baseSnapshot(queued),
      }),
    "permission_denied",
  );
  const claimed = await service.claimRun(AGENT, {
    ...context("agent-claims-run", queued.revision),
    runId: "verify-run-1",
    summary: "Assigned worker claimed the run.",
  });
  await assertCommandError(
    () =>
      service.progressRun(OTHER_AGENT, {
        ...context("other-agent-progress", claimed.revision),
        runId: "verify-run-1",
        summary: "A different worker attempts to take over.",
      }),
    "permission_denied",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, claimed.revision);
  const progressed = await service.progressRun(AGENT, {
    ...context("owner-agent-progress", claimed.revision),
    runId: "verify-run-1",
    summary: "Assigned worker reports progress.",
  });
  assertEquals(progressed.agentRuns[0].status, "running");
  assertEquals(
    progressed.agentRuns[0].statusHistory?.at(-1)?.summary,
    "Assigned worker reports progress.",
  );
});

Deno.test("agent lifecycle completes only after publishing exact externally validated evidence", async () => {
  const store = await memoryStoreWithVerificationDependent();
  const validator = new RecordingEvidenceValidator();
  const service = serviceFor(store, validator);
  let project = await approveAll(service, store);
  project = await service.queueRun(HUMAN, {
    ...context("queue-exact-run", project.revision),
    runId: "verify-run-exact",
    workItemId: "verify-current-mechanical-design",
    summary: "Queue exact verification.",
    baseSnapshot: baseSnapshot(project),
  });
  project = await service.claimRun(AGENT, {
    ...context("claim-exact-run", project.revision),
    runId: "verify-run-exact",
    summary: "Worker claimed verification.",
  });
  project = await service.publishRun(AGENT, {
    ...context("publish-exact-run", project.revision),
    runId: "verify-run-exact",
    summary: "Publishing verified outputs.",
  });
  const completion = completionCommand(project);
  project = await service.completeRun(AGENT, completion);

  const run = project.agentRuns.find((item) => item.id === "verify-run-exact")!;
  assertEquals(run.status, "completed");
  assertEquals(run.resultSnapshot, completion.resultSnapshot);
  assertEquals(run.statusHistory?.map((item) => item.status), [
    "queued",
    "running",
    "publishing",
    "completed",
  ]);
  assertEquals(validator.calls, 1);
  assertEquals(validator.lastBase, baseSnapshot(project));
  assertEquals(validator.lastResult, completion.resultSnapshot);
  assertEquals(
    project.threadSnapshots.some((item) =>
      item.snapshotId === completion.resultSnapshot.snapshotId &&
      item.revision === completion.resultSnapshot.revision
    ),
    true,
  );
  assertEquals(findWorkItem(project, "observe-erp-definition").status, "ready");
});

Deno.test("completion fails closed without exact evidence validation", async () => {
  const store = await memoryStore();
  const service = serviceFor(store);
  let project = await approveAll(service, store);
  project = await service.queueRun(HUMAN, {
    ...context("queue-no-validator", project.revision),
    runId: "verify-run-exact",
    workItemId: "verify-current-mechanical-design",
    summary: "Queue exact verification.",
    baseSnapshot: baseSnapshot(project),
  });
  project = await service.claimRun(AGENT, {
    ...context("claim-no-validator", project.revision),
    runId: "verify-run-exact",
    summary: "Worker claimed verification.",
  });
  project = await service.publishRun(AGENT, {
    ...context("publish-no-validator", project.revision),
    runId: "verify-run-exact",
    summary: "Publishing outputs.",
  });

  await assertCommandError(
    () => service.completeRun(AGENT, completionCommand(project)),
    "invalid_input",
  );
  assertEquals((await store.get(PROJECT_ID))?.revision, project.revision);
});

Deno.test("completion refuses a result that does not advance the exact run base", async () => {
  const store = await memoryStore();
  const validator = new RecordingEvidenceValidator();
  const service = serviceFor(store, validator);
  let project = await approveAll(service, store);
  project = await service.queueRun(HUMAN, {
    ...context("queue-non-advancing", project.revision),
    runId: "verify-run-exact",
    workItemId: "verify-current-mechanical-design",
    summary: "Queue exact verification.",
    baseSnapshot: baseSnapshot(project),
  });
  project = await service.claimRun(AGENT, {
    ...context("claim-non-advancing", project.revision),
    runId: "verify-run-exact",
    summary: "Worker claimed verification.",
  });
  project = await service.publishRun(AGENT, {
    ...context("publish-non-advancing", project.revision),
    runId: "verify-run-exact",
    summary: "Publishing outputs.",
  });
  const runBase = project.agentRuns.find((run) => run.id === "verify-run-exact")!
    .baseSnapshot!;
  const completion = completionCommand(project);

  await assertCommandError(
    () =>
      service.completeRun(AGENT, {
        ...completion,
        resultSnapshot: {
          ...completion.resultSnapshot,
          snapshotId: runBase.snapshotId,
          revision: runBase.revision + 1,
        },
      }),
    "invalid_input",
  );
  await assertCommandError(
    () =>
      service.completeRun(AGENT, {
        ...completion,
        resultSnapshot: {
          ...completion.resultSnapshot,
          revision: runBase.revision,
        },
      }),
    "invalid_input",
  );
  assertEquals(validator.calls, 0);
  assertEquals((await store.get(PROJECT_ID))?.revision, project.revision);
});

const PROJECT_ID = "coffee-machine-cm01";

async function memoryStore(): Promise<MemoryRevisionStore> {
  return new MemoryRevisionStore(await projectFixture());
}

async function memoryStoreWithVerificationDependent(): Promise<MemoryRevisionStore> {
  const project = structuredClone(await projectFixture()) as Mutable<
    EngineeringProjectSnapshot
  >;
  const dependent = project.workItems.find((item) =>
    item.id === "observe-erp-definition"
  )!;
  dependent.status = "planned";
  dependent.dependsOnWorkItemIds = ["verify-current-mechanical-design"];
  dependent.evidenceRefs = [];
  return new MemoryRevisionStore(validateEngineeringProjectSnapshot(project));
}

function serviceFor(
  store: EngineeringProjectRevisionStore,
  validator?: EngineeringProjectCompletionEvidenceValidator,
) {
  let tick = 0;
  return new EngineeringProjectCommandService(
    store,
    validator,
    () =>
      new Date(Date.parse("2026-08-01T11:00:00.000Z") + ++tick * 1_000).toISOString(),
  );
}

async function projectFixture(): Promise<EngineeringProjectSnapshot> {
  return validateEngineeringProjectSnapshot(
    JSON.parse(await Deno.readTextFile(CONFIG)),
  );
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-01T10:59:00.000Z",
  };
}

function proposal(value: string) {
  return {
    summary: "Test-only reviewed input.",
    parameters: [{ key: "choice", label: "Choice", value }],
  };
}

async function propose(
  service: EngineeringProjectCommandService,
  store: EngineeringProjectRevisionStore,
  decisionId: string,
  expectedRevision: number,
  sequence: number,
) {
  return await service.proposeDecision(HUMAN, {
    ...context(`propose-${decisionId}-${sequence}`, expectedRevision),
    decisionId,
    proposal: proposal(`fixture-${sequence}`),
    baseSnapshot: baseSnapshot((await store.get(PROJECT_ID))!),
  });
}

async function approveAll(
  service: EngineeringProjectCommandService,
  store: EngineeringProjectRevisionStore,
): Promise<EngineeringProjectSnapshot> {
  let project = (await store.get(PROJECT_ID))!;
  const decisionIds = findWorkItem(project, "verify-current-mechanical-design")
    .decisionIds;
  for (const [index, decisionId] of decisionIds.entries()) {
    project = await propose(service, store, decisionId, project.revision, index);
    const decision = findDecision(project, decisionId);
    project = await service.approveDecision(HUMAN, {
      ...context(`approve-all-${decisionId}`, project.revision),
      decisionId,
      rationale: "Reviewed for lifecycle test.",
      inputFingerprint: decision.inputFingerprint!,
    });
  }
  return project;
}

function completionCommand(project: EngineeringProjectSnapshot): CompleteRunCommand {
  const resultSnapshot = {
    snapshotId: "coffee-machine-cm01:r6:verified-result",
    revision: 6,
    subjectId: PROJECT_ID,
  };
  return {
    ...context("complete-exact-run", project.revision),
    runId: "verify-run-exact",
    summary: "Exact verification evidence published.",
    resultSnapshot,
    evidenceRefs: [{
      snapshotId: resultSnapshot.snapshotId,
      snapshotRevision: resultSnapshot.revision,
      kind: "artifact",
      id: "calculix-result-exact",
    }],
  };
}

function baseSnapshot(project: EngineeringProjectSnapshot | undefined) {
  return structuredClone(project!.threadSnapshots[0]);
}

function findDecision(project: EngineeringProjectSnapshot, id: string) {
  return project.decisions.find((item) => item.id === id)!;
}

function findWorkItem(project: EngineeringProjectSnapshot, id: string) {
  return project.workItems.find((item) => item.id === id)!;
}

async function assertCommandError(
  operation: () => Promise<unknown>,
  code: EngineeringProjectCommandError["code"],
): Promise<void> {
  const error = await assertRejects(operation, EngineeringProjectCommandError);
  assertEquals(error.code, code);
}

class RecordingEvidenceValidator
  implements EngineeringProjectCompletionEvidenceValidator {
  calls = 0;
  lastBase?: EngineeringThreadSnapshotRef;
  lastResult?: EngineeringThreadSnapshotRef;

  validate(
    base: EngineeringThreadSnapshotRef,
    result: EngineeringThreadSnapshotRef,
  ): Promise<void> {
    this.calls++;
    this.lastBase = structuredClone(base);
    this.lastResult = structuredClone(result);
    return Promise.resolve();
  }
}

class MemoryRevisionStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  constructor(initial: EngineeringProjectSnapshot) {
    this.#revisions.set(initial.revision, structuredClone(initial));
  }

  get(_projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const revision = Math.max(...this.#revisions.keys());
    return Promise.resolve(structuredClone(this.#revisions.get(revision)));
  }

  getRevision(
    _projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(structuredClone(this.#revisions.get(revision)));
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    this.#revisions.set(1, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = Math.max(...this.#revisions.keys());
    if (current !== expectedRevision || this.#revisions.has(snapshot.revision)) {
      throw new EngineeringProjectStoreConflictError("concurrent commit");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
