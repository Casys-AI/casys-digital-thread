import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import {
  parseRecoverSuccessorCli,
  RECOVER_SUCCESSOR_ACTOR,
  runRecoverWorkItemSuccessor,
} from "./reconcile-work-item-successor.ts";

const SNAPSHOT = {
  snapshotId: "thread-ca01:r2",
  revision: 2,
  subjectId: "cantilever-arm-ca01",
};
const EVIDENCE = [{
  kind: "artifact" as const,
  id: "syson-model-seed-1",
  snapshotId: SNAPSHOT.snapshotId,
  snapshotRevision: SNAPSHOT.revision,
}];

Deno.test("recover successor CLI requires --project-id", () => {
  assertThrows(
    () => parseRecoverSuccessorCli([]),
    TypeError,
    "recover:work-item-successor requires --project-id.",
  );
});

Deno.test("recover successor CLI refuses a partial closeout", () => {
  assertThrows(
    () =>
      parseRecoverSuccessorCli([
        "--project-id=cantilever-arm-ca01",
        "--failed-work-item-id=wi-seed",
        "--apply",
      ]),
    TypeError,
    "closeout requires",
  );
});

Deno.test("recover successor CLI inspects by default", () => {
  const request = parseRecoverSuccessorCli([
    "--project-id=cantilever-arm-ca01",
  ]);
  assertEquals(request.apply, false);
  assertEquals(request.projectId, "cantilever-arm-ca01");
});

Deno.test("recover successor inspect lists a ready orphan and does not write", async () => {
  const calls: unknown[] = [];
  const outcome = await runRecoverWorkItemSuccessor(
    parseRecoverSuccessorCli(["--project-id=cantilever-arm-ca01"]),
    {
      loadProject: () => Promise.resolve(orphanProject()),
      commands: {
        reconcileWorkItemWithSuccessor: (origin, command) => {
          calls.push({ origin, command });
          return Promise.resolve(orphanProject());
        },
      },
    },
  );
  assertEquals(outcome.exitCode, 0);
  assertEquals(outcome.result, {
    code: "inspect",
    apply: false,
    projectId: "cantilever-arm-ca01",
    revision: 30,
    orphans: [{
      workItemId: "wi-seed",
      operation: "architecture.seed-syson-model@2",
      failedRuns: [{ id: "run:ca01-queue-seed", status: "cancelled" }],
      suggestedSuccessors: [{
        workItemId: "wi-seed-2",
        runId: "run:ca01-seed-2",
        operation: "architecture.seed-syson-model@2",
      }],
    }],
  });
  assertEquals(calls, []);
});

Deno.test("recover successor preview derives successor evidence without writing", async () => {
  const calls: unknown[] = [];
  const outcome = await runRecoverWorkItemSuccessor(
    parseRecoverSuccessorCli([
      "--project-id=cantilever-arm-ca01",
      "--failed-work-item-id=wi-seed",
      "--failed-run-id=run:ca01-queue-seed",
      "--successor-run-id=run:ca01-seed-2",
      "--rationale=wi-seed omitted dependsOn; wi-seed-2 completed the seed.",
    ]),
    {
      loadProject: () => Promise.resolve(orphanProject()),
      commands: {
        reconcileWorkItemWithSuccessor: (origin, command) => {
          calls.push({ origin, command });
          return Promise.resolve(orphanProject());
        },
      },
    },
  );
  assertEquals(outcome.exitCode, 0);
  assertEquals(outcome.result.code, "preview");
  if (outcome.result.code !== "preview") return;
  assertEquals(outcome.result.apply, false);
  assertEquals(outcome.result.command.successorRunSnapshot, SNAPSHOT);
  assertEquals(outcome.result.command.successorEvidenceRefs, EVIDENCE);
  assertEquals(calls, []);
});

Deno.test("recover successor apply persists through the command service", async () => {
  const calls: Array<{ origin: unknown; command: unknown }> = [];
  const outcome = await runRecoverWorkItemSuccessor(
    parseRecoverSuccessorCli([
      "--project-id=cantilever-arm-ca01",
      "--failed-work-item-id=wi-seed",
      "--failed-run-id=run:ca01-queue-seed",
      "--successor-run-id=run:ca01-seed-2",
      "--rationale=wi-seed omitted dependsOn; wi-seed-2 completed the seed.",
      "--apply",
    ]),
    {
      loadProject: () => Promise.resolve(orphanProject()),
      now: () => "2026-08-18T12:00:00.000Z",
      commands: {
        reconcileWorkItemWithSuccessor: (origin, command) => {
          calls.push({ origin, command });
          return Promise.resolve({ ...orphanProject(), revision: 31 });
        },
      },
    },
  );
  assertEquals(outcome.exitCode, 0);
  assertEquals(outcome.result.code, "applied");
  if (outcome.result.code !== "applied") return;
  assertEquals(outcome.result.revision, 31);
  assertEquals(calls[0]?.origin, RECOVER_SUCCESSOR_ACTOR);
  assertEquals(calls[0]?.command, {
    commandId:
      "recover:reconcile-successor:wi-seed:run:ca01-queue-seed:run:ca01-seed-2",
    projectId: "cantilever-arm-ca01",
    expectedRevision: 30,
    issuedAt: "2026-08-18T12:00:00.000Z",
    failedWorkItemId: "wi-seed",
    failedRunId: "run:ca01-queue-seed",
    successorRunId: "run:ca01-seed-2",
    successorRunSnapshot: SNAPSHOT,
    successorEvidenceRefs: EVIDENCE,
    rationale: "wi-seed omitted dependsOn; wi-seed-2 completed the seed.",
  });
});

Deno.test(
  "recover successor inspect omits a later same-operation work item in a different stable activity",
  async () => {
    const calls: unknown[] = [];
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli(["--project-id=inspection-drone-id01"]),
      {
        loadProject: () => Promise.resolve(crossActivitySameOperationProject()),
        commands: {
          reconcileWorkItemWithSuccessor: (origin, command) => {
            calls.push({ origin, command });
            return Promise.resolve(crossActivitySameOperationProject());
          },
        },
      },
    );
    assertEquals(outcome.exitCode, 0);
    assertEquals(outcome.result, {
      code: "inspect",
      apply: false,
      projectId: "inspection-drone-id01",
      revision: 614,
      orphans: [{
        workItemId: "wi-proof-seal-id01-camera-bracket-bench-r2",
        operation: "verify.run-fea-static-proof@3",
        failedRuns: [{
          id: "run:id01-queue-bench-r2-seal-20260907",
          status: "cancelled",
        }],
        suggestedSuccessors: [],
      }],
    });
    assertEquals(calls, []);
  },
);

Deno.test(
  "recover successor preview refuses a successor in a different stable activity",
  async () => {
    const calls: unknown[] = [];
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli([
        "--project-id=inspection-drone-id01",
        "--failed-work-item-id=wi-proof-seal-id01-camera-bracket-bench-r2",
        "--failed-run-id=run:id01-queue-bench-r2-seal-20260907",
        "--successor-run-id=run:id01-queue-bench-r3-seal-20260907",
        "--rationale=r3 completed the same proof operation after r2 was cancelled.",
      ]),
      {
        loadProject: () => Promise.resolve(crossActivitySameOperationProject()),
        commands: {
          reconcileWorkItemWithSuccessor: (origin, command) => {
            calls.push({ origin, command });
            return Promise.resolve(crossActivitySameOperationProject());
          },
        },
      },
    );
    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.result, {
      code: "invalid_input",
      message:
        "Successor work item wi-proof-seal-id01-camera-bracket-bench-r3 is not in the same stable activity as wi-proof-seal-id01-camera-bracket-bench-r2.",
      recovery:
        "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
    });
    assertEquals(calls, []);
  },
);

Deno.test(
  "recover successor inspect omits a same-activity sibling with the matching operation",
  async () => {
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli(["--project-id=cantilever-arm-ca01"]),
      {
        loadProject: () => Promise.resolve(sameActivitySiblingProject()),
        commands: {
          reconcileWorkItemWithSuccessor: () =>
            Promise.reject(new Error("must not write")),
        },
      },
    );
    assertEquals(outcome.exitCode, 0);
    assertEquals(outcome.result.code, "inspect");
    if (outcome.result.code !== "inspect") return;
    assertEquals(outcome.result.orphans, [{
      workItemId: "wi-seed",
      operation: "architecture.seed-syson-model@2",
      failedRuns: [{ id: "run:ca01-queue-seed", status: "cancelled" }],
      suggestedSuccessors: [],
    }]);
  },
);

Deno.test(
  "recover successor preview refuses a same-activity sibling as successor",
  async () => {
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli([
        "--project-id=cantilever-arm-ca01",
        "--failed-work-item-id=wi-seed",
        "--failed-run-id=run:ca01-queue-seed",
        "--successor-run-id=run:ca01-seed-2",
        "--rationale=matching operation in the same activity is not a successor.",
      ]),
      {
        loadProject: () => Promise.resolve(sameActivitySiblingProject()),
        commands: {
          reconcileWorkItemWithSuccessor: () =>
            Promise.reject(new Error("must not write")),
        },
      },
    );
    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.result, {
      code: "invalid_input",
      message:
        "Successor work item wi-seed-2 must name failed work item wi-seed as its direct predecessor revision.",
      recovery:
        "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
    });
  },
);

Deno.test(
  "recover successor inspect omits a direct successor with different bindings",
  async () => {
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli(["--project-id=cantilever-arm-ca01"]),
      {
        loadProject: () => Promise.resolve(differentBindingsSuccessorProject()),
        commands: {
          reconcileWorkItemWithSuccessor: () =>
            Promise.reject(new Error("must not write")),
        },
      },
    );
    assertEquals(outcome.exitCode, 0);
    assertEquals(outcome.result.code, "inspect");
    if (outcome.result.code !== "inspect") return;
    assertEquals(outcome.result.orphans, [{
      workItemId: "wi-seed",
      operation: "architecture.seed-syson-model@2",
      failedRuns: [{ id: "run:ca01-queue-seed", status: "cancelled" }],
      suggestedSuccessors: [],
    }]);
  },
);

Deno.test(
  "recover successor preview refuses a direct successor with different bindings",
  async () => {
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli([
        "--project-id=cantilever-arm-ca01",
        "--failed-work-item-id=wi-seed",
        "--failed-run-id=run:ca01-queue-seed",
        "--successor-run-id=run:ca01-seed-2",
        "--rationale=same id and version are not enough when bindings differ.",
      ]),
      {
        loadProject: () => Promise.resolve(differentBindingsSuccessorProject()),
        commands: {
          reconcileWorkItemWithSuccessor: () =>
            Promise.reject(new Error("must not write")),
        },
      },
    );
    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.result, {
      code: "invalid_input",
      message: "Successor work item wi-seed-2 does not carry the same operation " +
        "(id, version, bindings) as the failed work item wi-seed. " +
        "Use the exact registered operation the failed work was supposed to execute.",
      recovery:
        "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
    });
  },
);

Deno.test(
  "recover successor inspect omits a direct successor with a different operation",
  async () => {
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli(["--project-id=cantilever-arm-ca01"]),
      {
        loadProject: () => Promise.resolve(differentOperationSuccessorProject()),
        commands: {
          reconcileWorkItemWithSuccessor: () =>
            Promise.reject(new Error("must not write")),
        },
      },
    );
    assertEquals(outcome.exitCode, 0);
    assertEquals(outcome.result.code, "inspect");
    if (outcome.result.code !== "inspect") return;
    assertEquals(outcome.result.orphans, [{
      workItemId: "wi-seed",
      operation: "architecture.seed-syson-model@2",
      failedRuns: [{ id: "run:ca01-queue-seed", status: "cancelled" }],
      suggestedSuccessors: [],
    }]);
  },
);

Deno.test(
  "recover successor preview refuses a direct successor with a different operation",
  async () => {
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli([
        "--project-id=cantilever-arm-ca01",
        "--failed-work-item-id=wi-seed",
        "--failed-run-id=run:ca01-queue-seed",
        "--successor-run-id=run:ca01-seed-2",
        "--rationale=a later completed run of another operation is not a successor.",
      ]),
      {
        loadProject: () => Promise.resolve(differentOperationSuccessorProject()),
        commands: {
          reconcileWorkItemWithSuccessor: () =>
            Promise.reject(new Error("must not write")),
        },
      },
    );
    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.result, {
      code: "invalid_input",
      message: "Successor work item wi-seed-2 does not carry the same operation " +
        "(id, version, bindings) as the failed work item wi-seed. " +
        "Use the exact registered operation the failed work was supposed to execute.",
      recovery:
        "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
    });
  },
);

Deno.test("recover successor reports a missing project without writing", async () => {
  const outcome = await runRecoverWorkItemSuccessor(
    parseRecoverSuccessorCli(["--project-id=missing"]),
    {
      loadProject: () => Promise.resolve(undefined),
      commands: {
        reconcileWorkItemWithSuccessor: () =>
          Promise.reject(new Error("must not write")),
      },
    },
  );
  assertEquals(outcome.exitCode, 1);
  assertEquals(outcome.result.code, "project_not_found");
});

Deno.test("recover successor preview refuses an unknown successor run", async () => {
  const outcome = await runRecoverWorkItemSuccessor(
    parseRecoverSuccessorCli([
      "--project-id=cantilever-arm-ca01",
      "--failed-work-item-id=wi-seed",
      "--failed-run-id=run:ca01-queue-seed",
      "--successor-run-id=run:missing",
      "--rationale=missing successor",
    ]),
    {
      loadProject: () => Promise.resolve(orphanProject()),
      commands: {
        reconcileWorkItemWithSuccessor: () =>
          Promise.reject(new Error("must not write")),
      },
    },
  );
  assertEquals(outcome.exitCode, 1);
  assertEquals(outcome.result.code, "entity_not_found");
});

Deno.test("recover successor preview refuses an unknown failed run", async () => {
  const calls: unknown[] = [];
  const outcome = await runRecoverWorkItemSuccessor(
    parseRecoverSuccessorCli([
      "--project-id=cantilever-arm-ca01",
      "--failed-work-item-id=wi-seed",
      "--failed-run-id=run:missing",
      "--successor-run-id=run:ca01-seed-2",
      "--rationale=missing failed run",
    ]),
    {
      loadProject: () => Promise.resolve(orphanProject()),
      commands: {
        reconcileWorkItemWithSuccessor: (origin, command) => {
          calls.push({ origin, command });
          return Promise.resolve(orphanProject());
        },
      },
    },
  );
  assertEquals(outcome.exitCode, 1);
  assertEquals(outcome.result, {
    code: "entity_not_found",
    message: "Failed run run:missing was not found.",
    recovery:
      "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
  });
  assertEquals(calls, []);
});

Deno.test(
  "recover successor preview refuses a foreign completed run as the failed anchor",
  async () => {
    const project = orphanProject();
    const foreignAnchor = {
      ...project,
      agentRuns: [
        ...project.agentRuns,
        {
          id: "run:ca01-foreign",
          workItemId: "wi-seed-2",
          status: "completed",
          resultSnapshot: SNAPSHOT,
          evidenceRefs: EVIDENCE,
        },
      ],
    } as EngineeringProjectSnapshot;
    const calls: unknown[] = [];
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli([
        "--project-id=cantilever-arm-ca01",
        "--failed-work-item-id=wi-seed",
        "--failed-run-id=run:ca01-foreign",
        "--successor-run-id=run:ca01-seed-2",
        "--rationale=a completed run of another work item is not a recoverable failed anchor.",
      ]),
      {
        loadProject: () => Promise.resolve(foreignAnchor),
        commands: {
          reconcileWorkItemWithSuccessor: (origin, command) => {
            calls.push({ origin, command });
            return Promise.resolve(foreignAnchor);
          },
        },
      },
    );
    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.result, {
      code: "invalid_transition",
      message:
        "Run run:ca01-foreign must be an evidence-free failed attempt or a pre-claim cancelled run for wi-seed.",
      recovery:
        "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
    });
    assertEquals(calls, []);
  },
);

Deno.test(
  "recover successor preview refuses an evidenced failed work item without writing",
  async () => {
    const project = orphanProject();
    const evidencedFailedWork = {
      ...project,
      workItems: project.workItems.map((item) =>
        item.id === "wi-seed"
          ? { ...item, status: "completed", evidenceRefs: EVIDENCE }
          : item
      ),
    } as EngineeringProjectSnapshot;
    const calls: unknown[] = [];
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli([
        "--project-id=cantilever-arm-ca01",
        "--failed-work-item-id=wi-seed",
        "--failed-run-id=run:ca01-queue-seed",
        "--successor-run-id=run:ca01-seed-2",
        "--rationale=completed evidenced work is outside leftover ready scope.",
      ]),
      {
        loadProject: () => Promise.resolve(evidencedFailedWork),
        commands: {
          reconcileWorkItemWithSuccessor: (origin, command) => {
            calls.push({ origin, command });
            return Promise.resolve(evidencedFailedWork);
          },
        },
      },
    );
    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.result, {
      code: "invalid_transition",
      message:
        "Work item wi-seed already owns evidence and cannot be reconciled as failed work.",
      recovery:
        "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
    });
    assertEquals(calls, []);
  },
);

Deno.test(
  "recover successor preview refuses a successor run that is not completed",
  async () => {
    const project = orphanProject();
    const incompleteSuccessor = {
      ...project,
      agentRuns: project.agentRuns.map((run) =>
        run.id === "run:ca01-seed-2" ? { ...run, status: "failed" } : run
      ),
    } as EngineeringProjectSnapshot;
    const calls: unknown[] = [];
    const outcome = await runRecoverWorkItemSuccessor(
      parseRecoverSuccessorCli([
        "--project-id=cantilever-arm-ca01",
        "--failed-work-item-id=wi-seed",
        "--failed-run-id=run:ca01-queue-seed",
        "--successor-run-id=run:ca01-seed-2",
        "--rationale=evidence without completed status is not a successor.",
      ]),
      {
        loadProject: () => Promise.resolve(incompleteSuccessor),
        commands: {
          reconcileWorkItemWithSuccessor: (origin, command) => {
            calls.push({ origin, command });
            return Promise.resolve(incompleteSuccessor);
          },
        },
      },
    );
    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.result, {
      code: "invalid_transition",
      message: "Run run:ca01-seed-2 is not a completed successor with evidence.",
      recovery:
        "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
    });
    assertEquals(calls, []);
  },
);

function orphanProject(): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    revision: 30,
    project: { id: "cantilever-arm-ca01", subjectId: "cantilever-arm-ca01" },
    phases: [{
      id: "phase-seed",
      order: 2,
      workItemIds: ["wi-seed", "wi-seed-2"],
    }],
    workItems: [
      workItem("wi-seed", "ready", []),
      workItem("wi-seed-2", "completed", EVIDENCE, {
        activityId: "activity:wi-seed",
        predecessorRevisionId: "wi-seed",
      }),
    ],
    agentRuns: [
      {
        id: "run:ca01-queue-seed",
        workItemId: "wi-seed",
        status: "cancelled",
        evidenceRefs: [],
      },
      {
        id: "run:ca01-seed-2",
        workItemId: "wi-seed-2",
        status: "completed",
        resultSnapshot: SNAPSHOT,
        evidenceRefs: EVIDENCE,
      },
    ],
    threadSnapshots: [SNAPSHOT],
  } as unknown as EngineeringProjectSnapshot;
}

function crossActivitySameOperationProject(): EngineeringProjectSnapshot {
  const proof = { id: "verify.run-fea-static-proof", version: "3" };
  return {
    schemaVersion: "4.0",
    revision: 614,
    project: {
      id: "inspection-drone-id01",
      subjectId: "inspection-drone-id01",
    },
    phases: [{
      id: "phase-proof",
      order: 4,
      workItemIds: [
        "wi-proof-seal-id01-camera-bracket-bench-r2",
        "wi-proof-seal-id01-camera-bracket-bench-r3",
      ],
    }],
    workItems: [
      workItem(
        "wi-proof-seal-id01-camera-bracket-bench-r2",
        "ready",
        [],
        { operation: proof },
      ),
      workItem(
        "wi-proof-seal-id01-camera-bracket-bench-r3",
        "completed",
        EVIDENCE,
        { operation: proof },
      ),
    ],
    agentRuns: [
      {
        id: "run:id01-queue-bench-r2-seal-20260907",
        workItemId: "wi-proof-seal-id01-camera-bracket-bench-r2",
        status: "cancelled",
        evidenceRefs: [],
      },
      {
        id: "run:id01-queue-bench-r3-seal-20260907",
        workItemId: "wi-proof-seal-id01-camera-bracket-bench-r3",
        status: "completed",
        resultSnapshot: SNAPSHOT,
        evidenceRefs: EVIDENCE,
      },
    ],
    threadSnapshots: [SNAPSHOT],
  } as unknown as EngineeringProjectSnapshot;
}

function differentBindingsSuccessorProject(): EngineeringProjectSnapshot {
  return directSuccessorProject({
    failedOperation: {
      id: "architecture.seed-syson-model",
      version: "2",
      bindings: [{ name: "project", source: { kind: "approved-brief" } }],
    },
    successorOperation: {
      id: "architecture.seed-syson-model",
      version: "2",
      bindings: [
        { name: "project", source: { kind: "approved-brief" } },
        { name: "extra", source: { kind: "approved-brief" } },
      ],
    },
  });
}

function differentOperationSuccessorProject(): EngineeringProjectSnapshot {
  return directSuccessorProject({
    failedOperation: {
      id: "architecture.seed-syson-model",
      version: "2",
      bindings: [],
    },
    successorOperation: {
      id: "design.write-geometry",
      version: "1",
      bindings: [],
    },
  });
}

function directSuccessorProject(operations: {
  readonly failedOperation: {
    readonly id: string;
    readonly version: string;
    readonly bindings: readonly {
      readonly name: string;
      readonly source: { readonly kind: "approved-brief" };
    }[];
  };
  readonly successorOperation: {
    readonly id: string;
    readonly version: string;
    readonly bindings: readonly {
      readonly name: string;
      readonly source: { readonly kind: "approved-brief" };
    }[];
  };
}): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    revision: 30,
    project: { id: "cantilever-arm-ca01", subjectId: "cantilever-arm-ca01" },
    phases: [{
      id: "phase-seed",
      order: 2,
      workItemIds: ["wi-seed", "wi-seed-2"],
    }],
    workItems: [
      workItem("wi-seed", "ready", [], {
        operation: operations.failedOperation,
      }),
      workItem("wi-seed-2", "completed", EVIDENCE, {
        activityId: "activity:wi-seed",
        predecessorRevisionId: "wi-seed",
        operation: operations.successorOperation,
      }),
    ],
    agentRuns: [
      {
        id: "run:ca01-queue-seed",
        workItemId: "wi-seed",
        status: "cancelled",
        evidenceRefs: [],
      },
      {
        id: "run:ca01-seed-2",
        workItemId: "wi-seed-2",
        status: "completed",
        resultSnapshot: SNAPSHOT,
        evidenceRefs: EVIDENCE,
      },
    ],
    threadSnapshots: [SNAPSHOT],
  } as unknown as EngineeringProjectSnapshot;
}

function sameActivitySiblingProject(): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    revision: 30,
    project: { id: "cantilever-arm-ca01", subjectId: "cantilever-arm-ca01" },
    phases: [{
      id: "phase-seed",
      order: 2,
      workItemIds: ["wi-root", "wi-seed", "wi-seed-2"],
    }],
    workItems: [
      workItem("wi-root", "completed", EVIDENCE),
      workItem("wi-seed", "ready", [], {
        activityId: "activity:wi-root",
        predecessorRevisionId: "wi-root",
      }),
      workItem("wi-seed-2", "completed", EVIDENCE, {
        activityId: "activity:wi-root",
        predecessorRevisionId: "wi-root",
      }),
    ],
    agentRuns: [
      {
        id: "run:ca01-queue-seed",
        workItemId: "wi-seed",
        status: "cancelled",
        evidenceRefs: [],
      },
      {
        id: "run:ca01-seed-2",
        workItemId: "wi-seed-2",
        status: "completed",
        resultSnapshot: SNAPSHOT,
        evidenceRefs: EVIDENCE,
      },
    ],
    threadSnapshots: [SNAPSHOT],
  } as unknown as EngineeringProjectSnapshot;
}

function workItem(
  id: string,
  status: "ready" | "completed",
  evidenceRefs: typeof EVIDENCE,
  lineage: {
    activityId?: string;
    predecessorRevisionId?: string;
    operation?: {
      id: string;
      version: string;
      bindings?: readonly {
        readonly name: string;
        readonly source: { readonly kind: "approved-brief" };
      }[];
    };
  } = {},
) {
  return {
    id,
    activityId: lineage.activityId ?? `activity:${id}`,
    ...(lineage.predecessorRevisionId
      ? { predecessorRevisionId: lineage.predecessorRevisionId }
      : {}),
    status,
    evidenceRefs,
    operation: {
      id: "architecture.seed-syson-model",
      version: "2",
      bindings: [],
      ...lineage.operation,
    },
  };
}
