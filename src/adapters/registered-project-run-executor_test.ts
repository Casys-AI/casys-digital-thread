import { assertEquals, assertRejects } from "@std/assert";
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
  const project = projectFixture("architecture.seed-syson-model", "1");
  const executor = new RegisteredProjectRunExecutor({
    projects: { get: () => Promise.resolve(project) },
    baseline: {
      execute: () => {
        calls.push("baseline");
        return Promise.resolve(project);
      },
    },
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

Deno.test("registered run executor rejects an unreviewed operation before any executor runs", async () => {
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
    sysonModelSeed: {
      execute: () => {
        calls.push("seed");
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

function projectFixture(operationId: string, operationVersion: string) {
  return {
    schemaVersion: "2.0",
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
