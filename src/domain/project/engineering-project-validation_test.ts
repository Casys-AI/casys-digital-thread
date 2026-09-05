import { assertEquals, assertThrows } from "@std/assert";
import {
  deriveEngineeringPhaseStatus,
  deriveEngineeringProjectStatus,
  type EngineeringProjectSnapshot,
} from "./engineering-project.ts";
import {
  collectEngineeringProjectIssues,
  collectEngineeringProjectThreadReferenceIssues,
  EngineeringProjectValidationError,
  validateEngineeringProjectSnapshot,
  validateEngineeringProjectThreadReferences,
} from "./engineering-project-validation.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../thread/thread-snapshot.ts";

const CONFIG = new URL(
  "../../testing/generic-engineering-project.fixture.json",
  import.meta.url,
);

Deno.test("generic project reports observed phases and an honest blocked verification phase", async () => {
  const project = validateEngineeringProjectSnapshot(await projectJson());

  assertEquals(deriveEngineeringProjectStatus(project), "attention-required");
  assertEquals(
    project.phases.map((phase) => [
      phase.id,
      deriveEngineeringPhaseStatus(project, phase.id),
    ]),
    [
      ["definition", "completed"],
      ["architecture", "completed"],
      ["design", "completed"],
      ["simulation", "completed"],
      ["verification", "blocked"],
      ["industrialization", "completed"],
    ],
  );
  assertEquals(
    project.decisions.map((decision) => decision.status),
    ["required"],
  );
  assertEquals(project.approvals, []);
  assertEquals(project.blockers.every((blocker) => blocker.status === "open"), true);

  const serialized = JSON.stringify(project).toLowerCase();
  assertEquals(serialized.includes("120 mpa"), false);
  assertEquals(serialized.includes("90 °c"), false);
  assertEquals(serialized.includes("90 degc"), false);
});

Deno.test("EngineeringProjectSnapshot is cloned, deeply frozen and strictly versioned", async () => {
  const input = await projectJson();
  const project = validateEngineeringProjectSnapshot(input);
  (input as Record<string, unknown>).id = "mutated-outside-validator";

  assertEquals(project.id, "engineering-project-generic-test-system-r1");
  assertEquals(Object.isFrozen(project), true);
  assertEquals(Object.isFrozen(project.project), true);
  assertEquals(Object.isFrozen(project.phases), true);

  const invalid = await projectJson();
  (invalid.phases[0] as unknown as Record<string, unknown>).status = "completed";
  const issues = collectEngineeringProjectIssues(invalid);
  assertEquals(
    issues.some((issue) =>
      issue.code === "unknown_property" && issue.path === "$.phases[0].status"
    ),
    true,
  );
});

Deno.test("one persisted MRTR decision cannot be scoped to two work items", async () => {
  const invalid = await projectJson();
  const original = invalid.workItems.find((item) =>
    item.id === "verify-current-mechanical-design"
  )!;
  const duplicate = {
    ...structuredClone(original),
    id: "verify-current-mechanical-design-duplicate-scope",
  };
  invalid.workItems.push(duplicate);
  const phase = invalid.phases.find((item) => item.id === original.phaseId)!;
  phase.workItemIds.push(duplicate.id);

  const issues = collectEngineeringProjectIssues(invalid);
  assertEquals(
    issues.some((issue) =>
      issue.code === "ambiguous_decision_scope" &&
      issue.path === "$.workItems[6].decisionIds[0]"
    ),
    true,
  );
});

Deno.test("blocker-mediated decision scope has one global work-item owner", async () => {
  const sameOwner = await projectJson();
  assertEquals(
    collectEngineeringProjectIssues(sameOwner).some((issue) =>
      issue.code === "ambiguous_decision_scope"
    ),
    false,
    "a direct link and blocker link may repeat the same decision for the same work item",
  );
  for (
    const scenario of [
      "one-blocker-two-work-items",
      "two-blockers-one-work-item-each",
      "direct-and-blocker-different-work-items",
    ] as const
  ) {
    const invalid = await projectWithAmbiguousBlockerDecisionScope(scenario);
    assertEquals(
      collectEngineeringProjectIssues(invalid).some((issue) =>
        issue.code === "ambiguous_decision_scope"
      ),
      true,
      scenario,
    );
  }
});

Deno.test("ordinary receipt issuedAt remains client audit metadata", async () => {
  const project = await projectJson();
  const previousSnapshotId = project.id;
  project.id = "engineering-project-generic-test-system-r3";
  project.revision = 3;
  project.previous = { snapshotId: previousSnapshotId, revision: 2 };
  project.generatedAt = "2026-08-02T06:04:27.475Z";
  project.commandReceipts = [
    ...project.commandReceipts ?? [],
    {
      commandId: "client-clock-ahead-of-server-application",
      type: "agent-run.progress",
      actor: { id: "agent-worker-3", origin: "agent" },
      issuedAt: "2026-08-02T06:05:00.000Z",
      appliedAt: "2026-08-02T06:04:27.475Z",
      requestFingerprint: fingerprint("d"),
      resultingSnapshot: { snapshotId: project.id, revision: 3 },
    },
  ];

  assertEquals(
    collectEngineeringProjectIssues(project).some((issue) =>
      issue.path === "$.commandReceipts[0].issuedAt"
    ),
    false,
  );
  validateEngineeringProjectSnapshot(project);
});

Deno.test("phase status cannot be duplicated as blocked work-item state", async () => {
  const invalid = await projectJson();
  (invalid.workItems[4] as unknown as { status: string }).status = "blocked";

  assertEquals(
    collectEngineeringProjectIssues(invalid).some((issue) =>
      issue.code === "invalid_enum" && issue.path === "$.workItems[4].status"
    ),
    true,
  );
});

Deno.test("only exact admitted Modelica and SPICE @1 runs may carry their required resolved operation plan", async () => {
  for (
    const operation of [
      { id: "simulate.run-admitted-modelica", version: "1" },
      { id: "simulate.run-admitted-spice", version: "1" },
    ]
  ) {
    const project = await projectWithQueuedResolvedOperationPlan(operation);
    const planIssues = collectEngineeringProjectIssues(project).filter((issue) =>
      issue.code.includes("resolved_operation_plan")
    );
    assertEquals(planIssues, [], `${operation.id}@${operation.version}`);

    delete project.agentRuns[0]!.resolvedOperationPlan;
    delete project.commandReceipts![2]!.queuedRun!.resolvedOperationPlan;
    assertEquals(
      collectEngineeringProjectIssues(project).some((issue) =>
        issue.code === "missing_resolved_operation_plan"
      ),
      true,
      `${operation.id}@${operation.version} requires its resolved operation plan`,
    );
  }

  for (
    const operation of [
      { id: "simulate.run-admitted-modelica", version: "2" },
      { id: "simulate.run-admitted-spice", version: "2" },
      { id: "simulate.run-qualified-modelica-kit", version: "1" },
    ]
  ) {
    const issues = collectEngineeringProjectIssues(
      await projectWithQueuedResolvedOperationPlan(operation),
    );
    assertEquals(
      issues.some((issue) => issue.code === "unexpected_resolved_operation_plan"),
      true,
      `${operation.id}@${operation.version}`,
    );
  }
});

Deno.test("a cancelled run has exactly one queued transition and one human cancellation", async () => {
  const exact = await projectJson();
  const workItem = exact.workItems.find((item) =>
    item.id === "verify-current-mechanical-design"
  )!;
  workItem.status = "ready";
  workItem.decisionIds = [];
  workItem.blockerIds = [];
  const queuedAt = "2026-08-01T10:37:00.000Z";
  const cancelledAt = "2026-08-01T10:37:01.000Z";
  exact.generatedAt = cancelledAt;
  const thread = exact.threadSnapshots[0]!;
  exact.agentRuns = [{
    id: "run:queued-cancellation",
    workItemId: workItem.id,
    status: "cancelled",
    summary: "Cancelled before agent claim: reviewed record.",
    queuedAt,
    basis: {
      kind: "thread-snapshot",
      snapshotId: thread.snapshotId,
      revision: thread.revision,
      subjectId: thread.subjectId,
    },
    inputFingerprint: fingerprint("a"),
    evidenceRefs: [],
    cancellation: {
      rationale: "Reviewed record",
      cancelledAt,
      cancelledBy: { id: "human-reviewer", origin: "human" },
    },
    statusHistory: [{
      commandId: "queue-before-cancellation",
      status: "queued",
      at: queuedAt,
      actor: { id: "agent-worker", origin: "agent" },
      summary: "Queue reviewed work.",
    }, {
      commandId: "human-cancel-queued-run",
      status: "cancelled",
      at: cancelledAt,
      actor: { id: "human-reviewer", origin: "human" },
      summary: "Cancelled before agent claim: reviewed record.",
    }],
  }];

  const exactIssues = collectEngineeringProjectIssues(exact);
  assertEquals(
    exactIssues.some((issue) =>
      issue.code === "invalid_run_history" &&
      issue.path === "$.agentRuns[0].statusHistory"
    ),
    false,
  );

  const forgedOrigin = structuredClone(exact);
  const forgedRun = forgedOrigin.agentRuns[0]!;
  forgedRun.cancellation!.cancelledBy = { id: "agent-forger", origin: "agent" };
  forgedRun.statusHistory![1]!.actor = { id: "agent-forger", origin: "agent" };
  const forgedIssues = collectEngineeringProjectIssues(forgedOrigin);
  assertEquals(
    forgedIssues.some((issue) => issue.code === "cancellation_origin_forbidden"),
    true,
  );
  assertEquals(
    forgedIssues.some((issue) => issue.code === "missing_cancellation_receipt"),
    true,
  );

  const queuedAfterCancellation = structuredClone(exact);
  queuedAfterCancellation.agentRuns[0]!.queuedAt = "2026-08-01T10:37:02.000Z";
  assertEquals(
    collectEngineeringProjectIssues(queuedAfterCancellation).some((issue) =>
      issue.code === "invalid_run_history" &&
      issue.path === "$.agentRuns[0].statusHistory"
    ),
    true,
  );

  const extraTransition = structuredClone(exact);
  extraTransition.agentRuns[0]!.statusHistory!.push({
    commandId: "forged-running-transition",
    status: "running",
    at: "2026-08-01T10:37:02.000Z",
    actor: { id: "agent-worker", origin: "agent" },
    summary: "Forged execution after cancellation.",
  });
  assertEquals(
    collectEngineeringProjectIssues(extraTransition).some((issue) =>
      issue.code === "invalid_run_history" &&
      issue.path === "$.agentRuns[0].statusHistory"
    ),
    true,
  );
});

Deno.test("execution base and normalized input fingerprint are atomic and exact", async () => {
  const invalid = await projectJson();
  invalid.decisions[0].baseSnapshot = structuredClone(invalid.threadSnapshots[0]);

  assertEquals(
    collectEngineeringProjectIssues(invalid).some((issue) =>
      issue.code === "incomplete_execution_binding"
    ),
    true,
  );

  const proposed = await projectJson();
  const decision = proposed.decisions[0];
  decision.status = "proposed";
  decision.baseSnapshot = structuredClone(proposed.threadSnapshots[0]);
  decision.inputFingerprint = fingerprint("a");
  decision.proposal = {
    summary: "Test-only proposal",
    parameters: [{ key: "choice", label: "Choice", value: "fixture" }],
    proposedAt: decision.requestedAt,
    proposedBy: { id: "test-human", origin: "human" },
  };
  decision.approvalIds = ["approval-mechanical-criterion-v1"];
  proposed.approvals = [{
    id: "approval-mechanical-criterion-v1",
    decisionId: decision.id,
    status: "pending",
    requestedAt: decision.requestedAt,
    baseSnapshot: structuredClone(decision.baseSnapshot),
    inputFingerprint: structuredClone(decision.inputFingerprint),
    inputEvidenceRefs: structuredClone(decision.inputEvidenceRefs),
  }];

  validateEngineeringProjectSnapshot(proposed);
  proposed.approvals[0].inputFingerprint = fingerprint("b");
  assertEquals(
    collectEngineeringProjectIssues(proposed).some((issue) =>
      issue.code === "approval_input_mismatch"
    ),
    true,
  );
});

Deno.test("approval lifecycle cannot contradict its decision", async () => {
  const invalid = await projectJson();
  const decision = invalid.decisions[0];
  decision.status = "approved";
  decision.approvalIds = [];

  assertThrows(
    () => validateEngineeringProjectSnapshot(invalid),
    EngineeringProjectValidationError,
    "an approved decision requires an approved approval",
  );
});

Deno.test("every evidence reference names a declared exact snapshot revision", async () => {
  const invalid = await projectJson();
  invalid.workItems[0].evidenceRefs[0].snapshotRevision = 8;

  assertEquals(
    collectEngineeringProjectIssues(invalid).some((issue) =>
      issue.code === "unknown_thread_snapshot" &&
      issue.path === "$.workItems[0].evidenceRefs[0]"
    ),
    true,
  );
});

Deno.test("cross-validation resolves entities in the exact ThreadSnapshot, not latest", async () => {
  const project = validateEngineeringProjectSnapshot(await projectJson());
  const thread = threadSnapshotFor(project);

  assertEquals(
    validateEngineeringProjectThreadReferences(project, [thread]).id,
    project.id,
  );

  const incomplete = mutableClone(thread);
  incomplete.artifacts = incomplete.artifacts.filter((artifact) =>
    artifact.id !== "syson-inventory-ca7f3bda7bfa"
  );
  const issues = collectEngineeringProjectThreadReferenceIssues(project, [incomplete]);
  assertEquals(
    issues.some((issue) =>
      issue.code === "missing_thread_entity" &&
      issue.message.includes("exact ThreadSnapshot revision")
    ),
    true,
  );

  const newerOnly = mutableClone(thread);
  newerOnly.id = `${thread.subject.id}:r8:newer`;
  newerOnly.revision = 8;
  assertEquals(
    collectEngineeringProjectThreadReferenceIssues(project, [newerOnly]).some(
      (issue) => issue.code === "missing_thread_snapshot",
    ),
    true,
  );
});

Deno.test("work dependencies must remain acyclic", async () => {
  const invalid = await projectJson();
  invalid.workItems[0].dependsOnWorkItemIds = ["build-current-cad"];

  assertEquals(
    collectEngineeringProjectIssues(invalid).some((issue) =>
      issue.code === "dependency_cycle"
    ),
    true,
  );
});

async function projectJson(): Promise<Mutable<EngineeringProjectSnapshot>> {
  return JSON.parse(
    await Deno.readTextFile(CONFIG),
  ) as Mutable<EngineeringProjectSnapshot>;
}

async function projectWithQueuedResolvedOperationPlan(
  operation: { id: string; version: string },
): Promise<Mutable<EngineeringProjectSnapshot>> {
  const project = await projectJson();
  const previousSnapshotId = project.id;
  const runId = "run:admitted-plan";
  const queueCommandId = "queue:admitted-plan";
  const queuedAt = "2026-08-01T10:36:58.345Z";
  const workItem = project.workItems.find((item) =>
    item.id === "observe-modelica-run"
  )!;
  workItem.status = "in-progress";
  workItem.operation = { ...operation, bindings: [] };
  project.id = "engineering-project-generic-test-system-r2";
  project.revision = 3;
  project.previous = { snapshotId: previousSnapshotId, revision: 2 };
  const resolvedOperationPlan = {
    schemaVersion: "resolved-operation-plan-ref/1.0" as const,
    planId: runId,
    fingerprint: fingerprint("f"),
    byteCount: 256,
    casUri: `casys://resolved-operation-plan/sha256/${"f".repeat(64)}`,
  };
  project.agentRuns = [{
    id: runId,
    workItemId: workItem.id,
    status: "queued",
    summary: "Queued admitted source execution.",
    queuedAt,
    basis: {
      kind: "thread-snapshot",
      snapshotId: project.threadSnapshots[0]!.snapshotId,
      revision: project.threadSnapshots[0]!.revision,
      subjectId: project.threadSnapshots[0]!.subjectId,
    },
    inputFingerprint: fingerprint("a"),
    evidenceRefs: [],
    statusHistory: [{
      commandId: queueCommandId,
      status: "queued",
      at: queuedAt,
      actor: { id: "agent:fixture", origin: "agent" },
      summary: "Queued admitted source execution.",
    }],
    resolvedOperationPlan,
  }];
  project.commandReceipts!.push({
    commandId: queueCommandId,
    type: "agent-run.queue",
    actor: { id: "agent:fixture", origin: "agent" },
    issuedAt: queuedAt,
    appliedAt: queuedAt,
    requestFingerprint: fingerprint("a"),
    resultingSnapshot: { snapshotId: project.id, revision: project.revision },
    queuedRun: { runId, workItemId: workItem.id, resolvedOperationPlan },
  });
  return project;
}

async function projectWithAmbiguousBlockerDecisionScope(
  scenario:
    | "one-blocker-two-work-items"
    | "two-blockers-one-work-item-each"
    | "direct-and-blocker-different-work-items",
): Promise<Mutable<EngineeringProjectSnapshot>> {
  const project = await projectJson();
  const first = project.workItems.find((item) =>
    item.id === "verify-current-mechanical-design"
  )!;
  const phase = project.phases.find((item) => item.id === first.phaseId)!;
  const firstBlocker = project.blockers.find((item) =>
    item.id === first.blockerIds[0]
  )!;
  const second = {
    ...structuredClone(first),
    id: "verify-current-mechanical-design-second",
    status: "planned" as const,
    decisionIds: [],
    blockerIds: [] as string[],
  };
  project.workItems.push(second);
  phase.workItemIds.push(second.id);

  if (scenario === "one-blocker-two-work-items") {
    first.status = "planned";
    first.decisionIds = [];
    second.blockerIds = [firstBlocker.id];
    firstBlocker.workItemIds = [first.id, second.id];
  } else if (scenario === "two-blockers-one-work-item-each") {
    first.status = "planned";
    first.decisionIds = [];
    const secondBlocker = {
      ...structuredClone(firstBlocker),
      id: "missing-reviewed-mechanical-proof-case-second",
      workItemIds: [second.id],
    };
    second.blockerIds = [secondBlocker.id];
    project.blockers.push(secondBlocker);
  } else {
    first.blockerIds = [];
    firstBlocker.workItemIds = [second.id];
    second.blockerIds = [firstBlocker.id];
  }
  return project;
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function fingerprint(digit: string): { algorithm: "sha256"; digest: string } {
  return { algorithm: "sha256", digest: digit.repeat(64) };
}

function threadSnapshotFor(project: EngineeringProjectSnapshot): ThreadSnapshot {
  const reference = project.threadSnapshots[0];
  const artifactIds = new Set<string>();
  project.phases.forEach((phase) =>
    phase.evidenceRefs.forEach((evidence) => artifactIds.add(evidence.id))
  );
  project.workItems.forEach((item) =>
    item.evidenceRefs.forEach((evidence) => artifactIds.add(evidence.id))
  );
  project.decisions.forEach((decision) =>
    decision.inputEvidenceRefs.forEach((evidence) => artifactIds.add(evidence.id))
  );

  return {
    schemaVersion: "1.0",
    id: reference.snapshotId,
    revision: reference.revision,
    generatedAt: project.generatedAt,
    subject: {
      id: project.project.subjectId,
      name: project.project.name,
      kind: "system",
      version: String(reference.revision),
      modelArtifactId: "syson-inventory-ca7f3bda7bfa",
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-none",
      name: "Observed project state",
      status: "applied",
      createdAt: project.generatedAt,
      appliedAt: project.generatedAt,
      changes: [],
    },
    artifacts: [...artifactIds].map(artifact),
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

function artifact(id: string): ThreadArtifact {
  return {
    id,
    name: id,
    kind: "other",
    version: "1",
    fingerprint: fingerprint("c"),
    producer: {
      serverId: "test",
      tool: "fixture",
      runId: "fixture-run",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: "2026-08-01T10:36:58.345Z",
    invalidatedByChangeIds: [],
  };
}

Deno.test(
  "a reviewed variadic slot may repeat its binding name for distinct targets",
  async () => {
    // WHY THIS TEST EXISTS — the archive operation names N entities to retire
    // through repeated `archiveTarget` bindings, a contract the registry admits
    // for a declared one-or-more cardinality. Enforcing name-uniqueness in this
    // validator contradicted it and made every multi-target operation
    // unqueueable: the real path refused what the declared contract allowed.
    const project = await projectJson() as Record<string, unknown>;
    const workItems = project.workItems as Record<string, unknown>[];
    const target = workItems[0];
    if (!target) throw new Error("fixture lost its work items");
    const ref = (id: string) => ({
      kind: "thread-entity",
      reference: {
        snapshotId: "thread-variadic",
        snapshotRevision: 1,
        kind: "artifact",
        id,
      },
    });
    target.operation = {
      id: "record.archive-project-lineage",
      version: "1",
      bindings: [
        { name: "archiveTarget", source: ref("artifact-a") },
        { name: "archiveTarget", source: ref("artifact-b") },
      ],
    };

    const issues = collectEngineeringProjectIssues(project);

    assertEquals(
      issues.filter((entry) => entry.code === "duplicate_reference"),
      [],
    );
  },
);

Deno.test("structural snapshot issues suppress later project-graph invariants", () => {
  const issues = collectEngineeringProjectIssues({
    extra: true,
    schemaVersion: "4.0",
    id: "project-structure-gate",
    revision: 1,
    generatedAt: "2026-08-01T10:36:58.345Z",
    previous: { snapshotId: "project-structure-gate-r0", revision: 1 },
    project: {
      id: "project-structure-gate",
      name: "Structure gate",
      subjectId: "subject-structure-gate",
      objective: { title: "Title", statement: "Statement" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  });

  assertEquals(
    issues.some((entry) =>
      entry.code === "unknown_property" && entry.path === "$.extra"
    ),
    true,
  );
  assertEquals(
    issues.some((entry) =>
      entry.code === "unexpected_previous" ||
      entry.code === "missing_reference" ||
      entry.code === "incomplete_command_history"
    ),
    false,
  );
});

Deno.test("the exact same binding may never be supplied twice", async () => {
  const project = await projectJson() as Record<string, unknown>;
  const workItems = project.workItems as Record<string, unknown>[];
  const target = workItems[0];
  if (!target) throw new Error("fixture lost its work items");
  const binding = {
    name: "archiveTarget",
    source: {
      kind: "thread-entity",
      reference: {
        snapshotId: "thread-variadic",
        snapshotRevision: 1,
        kind: "artifact",
        id: "artifact-a",
      },
    },
  };
  target.operation = {
    id: "record.archive-project-lineage",
    version: "1",
    bindings: [binding, binding],
  };

  const issues = collectEngineeringProjectIssues(project);

  assertEquals(
    issues.some((entry) => entry.code === "duplicate_reference"),
    true,
  );
});
