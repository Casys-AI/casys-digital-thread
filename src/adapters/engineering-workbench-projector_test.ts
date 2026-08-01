import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import type { LiveThreadWorkbenchSnapshot } from "./live-thread-update-store.ts";
import {
  ENGINEERING_WORKBENCH_SCHEMA,
  projectEngineeringWorkbenchSnapshot,
} from "./engineering-workbench-projector.ts";

Deno.test("engineering Workbench projection composes intent and observed proof without mutation", () => {
  const project = projectFixture("coffee-machine-cm01");
  const thread = threadFixture("coffee-machine-cm01");

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1);

  assertEquals(result.schemaVersion, ENGINEERING_WORKBENCH_SCHEMA);
  assertEquals(result.project, project);
  assertEquals(result.thread, thread);
  assertEquals(result.alignment, {
    status: "aligned",
    projectThreadRevision: 1,
    currentThreadRevision: 1,
  });
  assertEquals(result.project === project, false);
  assertEquals(result.thread === thread, false);
});

Deno.test("engineering Workbench projection rejects cross-subject composition", () => {
  assertThrows(
    () =>
      projectEngineeringWorkbenchSnapshot(
        projectFixture("coffee-machine-cm01"),
        threadFixture("another-subject"),
        1,
      ),
    Error,
    "does not match thread subject",
  );
});

Deno.test("engineering Workbench projection exposes a newer current thread without hiding project lag", () => {
  const result = projectEngineeringWorkbenchSnapshot(
    projectFixture("coffee-machine-cm01"),
    threadFixture("coffee-machine-cm01"),
    2,
  );

  assertEquals(result.alignment, {
    status: "thread-ahead",
    projectThreadRevision: 1,
    currentThreadRevision: 2,
  });
});

Deno.test("engineering Workbench projection rejects a current thread older than project intent", () => {
  assertThrows(
    () =>
      projectEngineeringWorkbenchSnapshot(
        projectFixture("coffee-machine-cm01", 2),
        threadFixture("coffee-machine-cm01"),
        1,
      ),
    Error,
    "precedes project thread revision",
  );
});

function projectFixture(
  subjectId: string,
  threadRevision = 1,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "1.0",
    id: "project-snapshot-r1",
    revision: 1,
    generatedAt: "2026-08-01T12:00:00.000Z",
    project: {
      id: "project-cm01",
      name: "Coffee Machine CM-01",
      subjectId,
      objective: {
        title: "Build a verifiable coffee machine",
        statement: "Connect project intent to observed technical proof.",
      },
    },
    threadSnapshots: [{
      snapshotId: `thread-snapshot-r${threadRevision}`,
      revision: threadRevision,
      subjectId,
    }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function threadFixture(subjectId: string): LiveThreadWorkbenchSnapshot {
  return {
    schemaVersion: "thread-workbench/0.1",
    id: "thread-snapshot-r1",
    subject: { id: subjectId, label: "Coffee Machine CM-01", program: "CM-01" },
    generatedAt: "2026-08-01T12:00:00.000Z",
    source: "observed",
    sourceLabel: "CANONICAL THREAD SNAPSHOT",
    change: {
      id: "change-r1",
      title: "Initial capture",
      summary: "Observed state captured.",
      author: "Not recorded",
      revision: "r1",
      changedAt: "2026-08-01T12:00:00.000Z",
      status: "pending",
      files: [],
    },
    components: {
      schemaVersion: "thread-components/1.0",
      authority: "workspace-declared",
      subjectId,
      rationale: "Projector test fixture.",
      systemViews: {},
      components: [],
    },
    graph: { nodes: [], edges: [] },
    flow: [],
    artifacts: [],
    observations: [],
    requirements: [],
    violations: [],
    actions: [],
    live: {
      schemaVersion: "live-thread-overlay/1.0",
      version: 0,
      active: [],
    },
  };
}
