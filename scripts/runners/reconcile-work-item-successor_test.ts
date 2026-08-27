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
      workItem("wi-seed-2", "completed", EVIDENCE),
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
) {
  return {
    id,
    activityId: `activity:${id}`,
    status,
    evidenceRefs,
    operation: { id: "architecture.seed-syson-model", version: "2" },
  };
}
