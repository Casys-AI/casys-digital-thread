import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { APPROVED_BRIEF_BASELINE_OPERATION } from "../orchestration/operations/approved-brief-baseline.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../domain/syson-model-seed.ts";
import { RegisteredProjectRunExecutor } from "./registered-project-run-executor.ts";
import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";

const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const COMMAND = {
  commandId: "execute",
  projectId: "project",
  expectedRevision: 2,
  issuedAt: "2026-08-02T12:00:00.000Z",
  runId: "run:seed",
};

Deno.test("registered run executor dispatches only exact reviewed operation identities", async () => {
  const calls: string[] = [];
  const project = projectFixture(
    SYSON_MODEL_SEED_OPERATION.id,
    SYSON_MODEL_SEED_OPERATION.version,
  );
  const executor = new RegisteredProjectRunExecutor({
    projects: { get: () => Promise.resolve(project) },
    baseline: { execute: () => Promise.resolve(project) },
    sysonModelSeed: {
      execute: () => {
        calls.push("seed");
        return Promise.resolve(project);
      },
    },
  });

  assertEquals(await executor.execute(AGENT, COMMAND), project);
  assertEquals(calls, ["seed"]);
});

Deno.test("registered run executor maps the approved-brief baseline to its executor", async () => {
  const calls: string[] = [];
  const project = projectFixture(
    APPROVED_BRIEF_BASELINE_OPERATION.id,
    APPROVED_BRIEF_BASELINE_OPERATION.version,
  );
  const executor = new RegisteredProjectRunExecutor({
    projects: { get: () => Promise.resolve(project) },
    baseline: {
      execute: () => {
        calls.push("baseline");
        return Promise.resolve(project);
      },
    },
  });

  assertEquals(await executor.execute(AGENT, COMMAND), project);
  assertEquals(calls, ["baseline"]);
});

Deno.test("registered run executor rejects unreviewed operations before any executor runs", async () => {
  const calls: string[] = [];
  const project = projectFixture("provider.call-anything", "1");
  const executor = new RegisteredProjectRunExecutor({
    projects: { get: () => Promise.resolve(project) },
    baseline: {
      execute: () => {
        calls.push("baseline");
        return Promise.resolve(project);
      },
    },
  });

  await assertRejects(
    () => executor.execute(AGENT, COMMAND),
    Error,
    "not backed by a trusted registered executor",
  );
  assertEquals(calls, []);
});

Deno.test("registered run executor preserves a missing current executor error", async () => {
  const project = projectFixture(
    SYSON_MODEL_SEED_OPERATION.id,
    SYSON_MODEL_SEED_OPERATION.version,
  );
  const executor = new RegisteredProjectRunExecutor({
    projects: { get: () => Promise.resolve(project) },
    baseline: { execute: () => Promise.resolve(project) },
  });

  await assertRejects(
    () => executor.execute(AGENT, COMMAND),
    Error,
    "no trusted SysON model-seed executor configured",
  );
});

Deno.test("registered run executor dispatches a code-owned additional exact operation", async () => {
  const calls: string[] = [];
  const operation = { id: "simulate.cm01-nominal", version: "1" };
  const project = projectFixture(operation.id, operation.version);
  const executor = new RegisteredProjectRunExecutor({
    projects: { get: () => Promise.resolve(project) },
    baseline: { execute: () => Promise.resolve(project) },
    additional: [{
      operation,
      executor: {
        execute: () => {
          calls.push("cm01-thermal");
          return Promise.resolve(project);
        },
      },
    }],
  });

  assertEquals(await executor.execute(AGENT, COMMAND), project);
  assertEquals(calls, ["cm01-thermal"]);
});

Deno.test("registered run executor refuses ambiguous additional registrations", () => {
  const operation = { id: "simulate.cm01-nominal", version: "1" };
  const project = projectFixture(operation.id, operation.version);

  assertThrows(
    () => {
      new RegisteredProjectRunExecutor({
        projects: { get: () => Promise.resolve(project) },
        baseline: { execute: () => Promise.resolve(project) },
        additional: [
          { operation, executor: { execute: () => Promise.resolve(project) } },
          { operation, executor: { execute: () => Promise.resolve(project) } },
        ],
      });
    },
    Error,
    "Duplicate trusted executor registration for simulate.cm01-nominal@1",
  );
});

function projectFixture(operationId: string, operationVersion: string) {
  return {
    schemaVersion: "3.0",
    id: "project@2",
    revision: 2,
    generatedAt: "2026-08-02T12:00:00.000Z",
    project: {
      id: "project",
      name: "Project",
      subjectId: "project:subject",
      objective: { title: "Project", statement: "Project" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [{
      id: "work",
      phaseId: "phase",
      title: "Work",
      description: "Work",
      kind: "architect",
      operation: { id: operationId, version: operationVersion, bindings: [] },
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run:seed",
      workItemId: "work",
      status: "queued",
      summary: "Queued",
      queuedAt: "2026-08-02T12:00:00.000Z",
      basis: {
        kind: "thread-snapshot",
        snapshotId: "thread:r1",
        revision: 1,
        subjectId: "project:subject",
      },
      evidenceRefs: [],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
  } as unknown as EngineeringProjectSnapshot;
}
