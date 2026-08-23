import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { EngineeringOperationPathLaneResolver } from "../../application/ports/out/project/engineering-operation-path-lane-resolver.ts";
import {
  projectEngineeringPlanningWorkbenchSnapshot,
  projectEngineeringWorkbenchSnapshot,
} from "./engineering-workbench-projector.ts";
import {
  LIVE_THREAD_OVERLAY_SCHEMA,
  type LiveThreadWorkbenchSnapshot,
} from "../shared/stores/live-thread-update-store.ts";
import { GENERIC_ENGINEERING_WORKBENCH_FIXTURE } from "../../testing/workbench/generic-engineering-workbench-fixture.ts";

Deno.test("engineering Workbench composes project intent and observed proof without mutation", () => {
  const thread = threadFixture();
  const project = projectFixture(thread.subject.id, thread.id);

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1);

  assertEquals(result.surface, "evidence");
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.project.project.subjectId, thread.subject.id);
  assertEquals(result.thread.id, thread.id);
  assertEquals(result.alignment, {
    status: "aligned",
    projectThreadRevision: 1,
    currentThreadRevision: 1,
  });
  assertEquals(result.unresolvedEvidenceReferences, []);
  assertEquals(result.projectPath, { phaseLanes: [] });
});

Deno.test("engineering Workbench classifies contextual phases from exact downstream operations", () => {
  const thread = threadFixture();
  const base = projectFixture(thread.subject.id, thread.id);
  const project: EngineeringProjectSnapshot = {
    ...base,
    phases: [
      projectPhase("requirements", 1, "work-requirements"),
      projectPhase("admission", 2, "work-admission"),
      projectPhase("target", 3, "work-target"),
      projectPhase("orphan", 4, "work-orphan"),
    ],
    workItems: [
      projectWork("work-requirements", "requirements", "requirements@1"),
      projectWork("work-admission", "admission", "admission@1"),
      projectWork("work-target", "target", "modelica@1"),
      projectWork("work-orphan", "orphan", "admission@1"),
    ],
  };
  const resolver: EngineeringOperationPathLaneResolver = {
    resolve(operation) {
      if (operation.id === "requirements") {
        return {
          kind: "fixed",
          lane: "requirements",
        };
      }
      if (operation.id === "admission") {
        return {
          kind: "contextual",
          allowedNext: ["geometry", "physics"],
          fallback: "system-model",
        };
      }
      if (operation.id === "modelica") {
        return { kind: "fixed", lane: "physics" };
      }
      return undefined;
    },
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    resolver,
  );

  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.projectPath.phaseLanes, [
    { phaseId: "requirements", lane: "requirements" },
    { phaseId: "admission", lane: "physics" },
    { phaseId: "target", lane: "physics" },
    { phaseId: "orphan", lane: "system-model" },
  ]);
});

Deno.test("engineering Workbench labels a dangling evidence reference instead of hiding the projection", () => {
  const thread = threadFixture();
  const project = projectFixture(thread.subject.id, thread.id);
  const issue = {
    path: "$.decisions[15].inputEvidenceRefs[0]",
    message: "does not resolve to a artifact in the exact ThreadSnapshot revision",
  };

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1, [], [issue]);

  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to remain an evidence surface.");
  }
  assertEquals(result.unresolvedEvidenceReferences, [issue]);
});

Deno.test("planning Workbench exposes intent without inventing a technical thread", () => {
  const project = planningProjectFixture();

  const result = projectEngineeringPlanningWorkbenchSnapshot(project);

  assertEquals(result.surface, "planning");
  assertEquals(result.project.threadSnapshots, []);
  assertEquals(result.planning.technicalBaseline.status, "not-created");
  assertEquals(result.planning.baselineRun, undefined);
  assertEquals(result.planning.activity, { version: 0, milestones: [] });
  assertEquals("thread" in result, false);
});

Deno.test("engineering Workbench rejects cross-subject composition", () => {
  const thread = threadFixture();
  const project = projectFixture("another-subject", thread.id);

  assertThrows(
    () => projectEngineeringWorkbenchSnapshot(project, thread, 1),
    Error,
    "does not match thread subject",
  );
});

Deno.test("engineering Workbench makes a newer current thread explicit", () => {
  const thread = threadFixture();
  const project = projectFixture(thread.subject.id, thread.id);

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 2);

  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to remain an evidence surface.");
  }
  assertEquals(result.alignment, {
    status: "thread-ahead",
    projectThreadRevision: 1,
    currentThreadRevision: 2,
  });
});

Deno.test("engineering Workbench rejects a current thread older than project intent", () => {
  const thread = threadFixture();
  const project = projectFixture(thread.subject.id, thread.id, 2);

  assertThrows(
    () => projectEngineeringWorkbenchSnapshot(project, thread, 1),
    Error,
    "precedes project thread revision",
  );
});

function projectFixture(
  subjectId: string,
  snapshotId: string,
  revision = 1,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "1.0",
    id: `project-snapshot-r${revision}`,
    revision,
    generatedAt: "2026-08-01T12:00:00.000Z",
    project: {
      id: "project-generic",
      name: "Generic Product GEN-01",
      subjectId,
      objective: {
        title: "Build a verifiable generic product",
        statement: "Connect project intent to observed technical proof.",
      },
    },
    threadSnapshots: [{ snapshotId, revision, subjectId }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function planningProjectFixture(): EngineeringProjectSnapshot {
  return {
    ...projectFixture("project:planning", "unused"),
    threadSnapshots: [],
  };
}

function projectPhase(
  id: string,
  order: number,
  workItemId: string,
): EngineeringProjectSnapshot["phases"][number] {
  return {
    id,
    name: "Deliberately non-classifying phase label",
    order,
    description: "Classification comes from the exact operation only.",
    workItemIds: [workItemId],
    requiredDecisionIds: [],
    evidenceRefs: [],
  };
}

function projectWork(
  id: string,
  phaseId: string,
  operationKey?: string,
): EngineeringProjectSnapshot["workItems"][number] {
  const [operationId, version] = operationKey?.split("@") ?? [];
  return {
    id,
    phaseId,
    title: "Exact registered work",
    description: "Exact registered work.",
    kind: "simulate",
    ...(operationId && version
      ? { operation: { id: operationId, version, bindings: [] } }
      : {}),
    status: "completed",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  };
}

function threadFixture(): LiveThreadWorkbenchSnapshot {
  return {
    ...structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE.thread),
    live: { schemaVersion: LIVE_THREAD_OVERLAY_SCHEMA, version: 0, active: [] },
  };
}
