import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import type {
  LiveThreadUpdate,
  LiveThreadWorkbenchSnapshot,
} from "./live-thread-update-store.ts";
import {
  ENGINEERING_WORKBENCH_SCHEMA,
  projectEngineeringPlanningWorkbenchSnapshot,
  projectEngineeringWorkbenchSnapshot,
} from "./engineering-workbench-projector.ts";

Deno.test("engineering Workbench projection composes intent and observed proof without mutation", () => {
  const project = projectFixture("coffee-machine-cm01");
  const thread = threadFixture("coffee-machine-cm01");

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1);

  assertEquals(result.schemaVersion, ENGINEERING_WORKBENCH_SCHEMA);
  if (result.surface !== "evidence") {
    throw new Error("Expected the observed thread fixture to remain evidence.");
  }
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

Deno.test("engineering Workbench projects the exact V2 documentary baseline without an evidence graph", () => {
  const thread = documentaryThreadFixture("drone-concept");
  const project: EngineeringProjectSnapshot = {
    ...projectFixture("drone-concept"),
    schemaVersion: "2.0",
    project: {
      ...projectFixture("drone-concept").project,
      subjectId: "drone-concept",
      name: "Drone concept",
    },
    threadSnapshots: [{
      snapshotId: thread.id,
      revision: 1,
      subjectId: "drone-concept",
    }],
  };

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1);

  assertEquals(result.surface, "documentary");
  if (result.surface !== "documentary") {
    throw new Error("Expected the approved-discovery root record.");
  }
  assertEquals(result.documentary.status, "recorded");
  assertEquals(result.documentary.record, {
    origin: "approved-discovery",
    snapshotId: thread.id,
    snapshotRevision: 1,
    artifactId: "approved-discovery-document-r1",
    label: "Approved discovery documentary baseline (pre-technical)",
    fingerprint: "sha256:documentary-r1",
    uri: "state/approved-discovery-baselines/documentary-r1.json",
    recordedAt: "2026-08-01T12:00:00.000Z",
  });
  assertEquals(result.documentary.technicalEvidence.status, "not-recorded");
  assertEquals("thread" in result, false);
  assertEquals("alignment" in result, false);
  assertEquals("capabilities" in result, false);
});

Deno.test("documentary Workbench exposes only the safe live SysON seed sequence", () => {
  const thread = documentaryThreadFixture("drone-concept");
  const project = documentaryProjectWithRunningSeed(thread);
  const updates: LiveThreadUpdate[] = [
    liveSeedUpdate(
      4,
      "syson_project_create",
      "fresh",
      "2026-08-02T12:01:00.000Z",
    ),
    liveSeedUpdate(
      5,
      "syson_model_create",
      "running",
      "2026-08-02T12:01:05.000Z",
    ),
    {
      ...liveSeedUpdate(
        6,
        "unrelated_tool",
        "fresh",
        "2026-08-02T12:01:10.000Z",
      ),
      operationId: "unrelated-provider-operation",
    },
  ];

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1, updates);

  assertEquals(result.surface, "documentary");
  if (result.surface !== "documentary") {
    throw new Error("Expected the r1 project to retain its documentary surface.");
  }
  assertEquals(result.documentary.technicalStart, {
    kind: "sysml-container-seed",
    state: "running",
    message:
      "The agent is creating and reading back the first empty SysON model container. These live steps orient the review; they are not canonical engineering evidence yet.",
    activity: {
      version: 5,
      steps: [
        {
          id: "project-container",
          state: "fresh",
          label: "SysON project container",
          summary: "Container created. It does not yet contain a system architecture.",
          recordedAt: "2026-08-02T12:01:00.000Z",
        },
        {
          id: "sysml-document",
          state: "running",
          label: "Editable SysML document",
          summary: "Reading or creating the document and empty root package.",
          recordedAt: "2026-08-02T12:01:05.000Z",
          predecessor: "project-container",
        },
      ],
    },
  });
  const payload = JSON.stringify(result);
  assertEquals(payload.includes("provider-secret"), false);
  assertEquals(payload.includes("private provider structured content"), false);
  assertEquals("thread" in result, false);
});

Deno.test("a failed seed milestone makes the documentary cockpit require review", () => {
  const thread = documentaryThreadFixture("drone-concept");
  const project = documentaryProjectWithRunningSeed(thread);
  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1, [
    liveSeedUpdate(
      4,
      "syson_project_create",
      "failed",
      "2026-08-02T12:01:00.000Z",
    ),
  ]);

  if (result.surface !== "documentary") {
    throw new Error("Expected the r1 project to retain its documentary surface.");
  }
  assertEquals(result.documentary.technicalStart?.state, "failed");
  assertEquals(
    result.documentary.technicalStart?.message,
    "The technical start did not publish a model-container record. It is not retried automatically; this early slice exposes no recovery action in the cockpit.",
  );
  assertEquals(result.documentary.technicalStart?.activity.steps[0]?.state, "failed");
});

Deno.test("documentary Workbench remains read-only when a SysON seed is ready", () => {
  const thread = documentaryThreadFixture("drone-concept");
  const runningProject = documentaryProjectWithRunningSeed(thread);
  const project: EngineeringProjectSnapshot = {
    ...runningProject,
    agentRuns: [],
    workItems: runningProject.workItems.map((item) =>
      item.id === "seed-syson-model" ? { ...item, status: "ready" } : item
    ),
  };

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1);

  assertEquals(result.surface, "documentary");
  assertEquals("capabilities" in result, false);
  if (result.surface !== "documentary") {
    throw new Error("Expected the r1 project to retain its documentary surface.");
  }
  assertEquals(result.documentary.technicalStart, undefined);
});

Deno.test("only the exact approved-discovery documentary root bypasses the evidence surface", () => {
  const thread = documentaryThreadFixture("drone-concept");
  const project: EngineeringProjectSnapshot = {
    ...projectFixture("drone-concept"),
    schemaVersion: "2.0",
    project: {
      ...projectFixture("drone-concept").project,
      subjectId: "drone-concept",
      name: "Drone concept",
    },
    threadSnapshots: [{
      snapshotId: thread.id,
      revision: 1,
      subjectId: "drone-concept",
    }],
  };
  const nonBaseline = structuredClone(thread);
  nonBaseline.artifacts[0]!.producedBy = "some_other_document_operation";

  const result = projectEngineeringWorkbenchSnapshot(project, nonBaseline, 1);

  assertEquals(result.surface, "evidence");
});

Deno.test("engineering Workbench projects a discovery plan without inventing a technical thread", () => {
  const project = projectFixture("drone-concept");
  const planningProject: EngineeringProjectSnapshot = {
    ...project,
    project: {
      ...project.project,
      subjectId: "drone-concept",
      name: "Drone concept",
    },
    threadSnapshots: [],
    phases: [{
      id: "define",
      name: "Define",
      order: 1,
      description: "Turn the approved intent into a bounded first path.",
      workItemIds: ["work-define"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work-define",
      phaseId: "define",
      title: "Prepare the first system definition",
      description: "Record the initial planning scope.",
      kind: "define",
      status: "planned",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
  };

  const result = projectEngineeringPlanningWorkbenchSnapshot(planningProject);

  assertEquals(result.surface, "planning");
  assertEquals(result.project.threadSnapshots, []);
  assertEquals(result.planning.technicalBaseline.status, "not-created");
  assertEquals(result.planning.technicalBaseline.message.includes("not created"), true);
  assertEquals(result.planning.baselineRun, undefined);
  assertEquals(result.planning.activity, { version: 0, milestones: [] });
  assertEquals("thread" in result, false);
});

Deno.test("planning Workbench projects only public status milestones for the first baseline run", () => {
  const project = planningProjectWithRun("running");
  const updates: LiveThreadUpdate[] = [
    {
      schemaVersion: "live-thread-update/1.0",
      sequence: 6,
      subjectId: "drone-concept",
      runId: "run-baseline",
      operationId: "provider-hidden",
      baseRevision: 0,
      state: "running",
      recordedAt: "2026-08-01T12:02:00.000Z",
      graph: {
        nodes: [{
          id: "raw-graph-node",
          ref: { kind: "artifact", id: "provider-secret" },
          entityKind: "artifact",
          label: "raw provider structured content",
          system: "private-provider",
          freshness: "running",
          summary: "do not expose",
        }],
        edges: [],
      },
    },
    {
      schemaVersion: "live-thread-update/1.0",
      sequence: 7,
      subjectId: "drone-concept",
      runId: "another-run",
      operationId: "not-the-baseline",
      baseRevision: 0,
      state: "failed",
      recordedAt: "2026-08-01T12:03:00.000Z",
      graph: { nodes: [], edges: [] },
    },
  ];

  const result = projectEngineeringPlanningWorkbenchSnapshot(project, updates);

  assertEquals(result.planning.technicalBaseline.status, "running");
  assertEquals(result.planning.baselineRun, {
    id: "run-baseline",
    status: "running",
    workItem: {
      id: "work-define",
      title: "Prepare the first system definition",
      kind: "define",
    },
    queuedAt: "2026-08-01T12:00:00.000Z",
    startedAt: "2026-08-01T12:01:00.000Z",
    statusHistory: [{
      status: "queued",
      at: "2026-08-01T12:00:00.000Z",
    }, {
      status: "running",
      at: "2026-08-01T12:01:00.000Z",
    }],
  });
  assertEquals(result.planning.activity, {
    version: 7,
    milestones: [{
      sequence: 6,
      state: "running",
      recordedAt: "2026-08-01T12:02:00.000Z",
    }],
  });

  const browserPayload = JSON.stringify(result);
  assertEquals(browserPayload.includes("raw provider structured content"), false);
  assertEquals(browserPayload.includes("provider-secret"), false);
  assertEquals(browserPayload.includes("not-the-baseline"), false);
  assertEquals(browserPayload.includes("provider failure detail"), false);
  assertEquals(browserPayload.includes("provider raw run summary"), false);
  assertEquals(browserPayload.includes("queue-baseline"), false);
  assertEquals(browserPayload.includes("claim-baseline"), false);
  assertEquals(browserPayload.includes("private-run-basis"), false);
  assertEquals(browserPayload.includes("private-agent"), false);
});

Deno.test("planning Workbench maps terminal pre-evidence runs without claiming a baseline", () => {
  const failed = projectEngineeringPlanningWorkbenchSnapshot(
    planningProjectWithRun("failed"),
  );
  const completed = projectEngineeringPlanningWorkbenchSnapshot(
    planningProjectWithRun("completed"),
  );

  assertEquals(failed.planning.technicalBaseline.status, "failed");
  assertEquals(completed.planning.technicalBaseline.status, "not-created");
  assertEquals(JSON.stringify(failed).includes("provider failure detail"), false);
  assertEquals(JSON.stringify(failed).includes("provider raw run summary"), false);
  assertEquals(
    completed.planning.technicalBaseline.message.includes("completed without"),
    true,
  );
});

Deno.test("planning-only Workbench projection refuses a project with technical references", () => {
  assertThrows(
    () => projectEngineeringPlanningWorkbenchSnapshot(projectFixture("CM-01")),
    Error,
    "cannot include a technical thread snapshot",
  );
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

  if (result.surface !== "evidence") {
    throw new Error("Expected a later canonical revision to remain evidence.");
  }
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

function planningProjectWithRun(
  status: "running" | "failed" | "completed",
): EngineeringProjectSnapshot {
  const project = projectFixture("drone-concept");
  return {
    ...project,
    project: {
      ...project.project,
      subjectId: "drone-concept",
    },
    threadSnapshots: [],
    phases: [{
      id: "define",
      name: "Define",
      order: 1,
      description: "Turn discovery into a bounded technical baseline.",
      workItemIds: ["work-define"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work-define",
      phaseId: "define",
      title: "Prepare the first system definition",
      description: "Record the first baseline from reviewed discovery.",
      kind: "define",
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run-baseline",
      workItemId: "work-define",
      status,
      summary: "provider raw run summary",
      queuedAt: "2026-08-01T12:00:00.000Z",
      startedAt: "2026-08-01T12:01:00.000Z",
      claimedBy: { id: "private-agent", origin: "agent" },
      basis: {
        kind: "thread-snapshot",
        snapshotId: "private-run-basis",
        revision: 1,
        subjectId: "drone-concept",
      },
      ...(status !== "running" ? { completedAt: "2026-08-01T12:04:00.000Z" } : {}),
      evidenceRefs: [],
      ...(status === "failed"
        ? {
          failure: {
            code: "provider-failed",
            message: "provider failure detail",
          },
        }
        : {}),
      statusHistory: [{
        commandId: "queue-baseline",
        status: "queued",
        at: "2026-08-01T12:00:00.000Z",
        actor: { id: "operator", origin: "human" },
        summary: "provider raw run summary",
      }, {
        commandId: "claim-baseline",
        status,
        at: "2026-08-01T12:01:00.000Z",
        actor: { id: "agent", origin: "agent" },
        summary: "provider raw run summary",
      }],
    }],
  };
}

function documentaryProjectWithRunningSeed(
  thread: LiveThreadWorkbenchSnapshot,
): EngineeringProjectSnapshot {
  const project = projectFixture(thread.subject.id);
  return {
    ...project,
    schemaVersion: "2.0",
    project: {
      ...project.project,
      id: "drone-concept",
      name: "Drone concept",
      subjectId: thread.subject.id,
    },
    threadSnapshots: [{
      snapshotId: thread.id,
      revision: 1,
      subjectId: thread.subject.id,
    }],
    phases: [{
      id: "baseline",
      name: "Starting record",
      order: 1,
      description: "Record the approved discovery.",
      workItemIds: ["record-approved-discovery"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }, {
      id: "architecture",
      name: "System model",
      order: 2,
      description: "Create an editable system-model container.",
      workItemIds: ["seed-syson-model"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "record-approved-discovery",
      phaseId: "baseline",
      title: "Record approved discovery",
      description: "Create documentary r1.",
      kind: "define",
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
      operation: {
        id: "baseline.from-approved-discovery",
        version: "1",
        bindings: [{
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        }],
      },
    }, {
      id: "seed-syson-model",
      phaseId: "architecture",
      title: "Create the first editable system model",
      description: "Create only a blank SysON model container.",
      kind: "architect",
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-discovery"],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
      operation: {
        id: "architecture.seed-syson-model",
        version: "1",
        bindings: [{
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        }],
      },
    }],
    agentRuns: [{
      id: "run-seed",
      workItemId: "seed-syson-model",
      status: "running",
      summary: "Provider detail must not reach the browser.",
      queuedAt: "2026-08-02T12:00:00.000Z",
      startedAt: "2026-08-02T12:00:10.000Z",
      evidenceRefs: [],
      statusHistory: [{
        commandId: "queue-seed",
        status: "queued",
        at: "2026-08-02T12:00:00.000Z",
        actor: { id: "reviewer", origin: "human" },
        summary: "Queued.",
      }, {
        commandId: "claim-seed",
        status: "running",
        at: "2026-08-02T12:00:10.000Z",
        actor: { id: "agent", origin: "agent" },
        summary: "Running.",
      }],
    }],
  };
}

function liveSeedUpdate(
  sequence: number,
  tool: string,
  state: "running" | "fresh" | "failed",
  recordedAt: string,
): LiveThreadUpdate {
  return {
    schemaVersion: "live-thread-update/1.0",
    sequence,
    subjectId: "drone-concept",
    runId: "run-seed",
    operationId: `architecture.seed-syson-model:${tool}`,
    baseRevision: 1,
    state,
    recordedAt,
    graph: {
      nodes: [{
        id: `private-${tool}`,
        ref: { kind: "artifact", id: "provider-secret" },
        entityKind: "artifact",
        label: "private provider structured content",
        system: "private-provider",
        freshness: state,
        summary: "provider-secret",
      }],
      edges: [],
    },
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
    evidenceFamilyGraph: {
      schemaVersion: "thread-evidence-family-graph/1.0",
      asOf: { snapshotId: "thread-snapshot-r1", revision: 1 },
      families: [],
      edges: [],
      omittedSelfLoops: [],
      omittedCycleEdges: [],
    },
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

function documentaryThreadFixture(subjectId: string): LiveThreadWorkbenchSnapshot {
  return {
    schemaVersion: "thread-workbench/0.1",
    id: `${subjectId}:r1:approved-discovery-baseline`,
    subject: { id: subjectId, label: "Drone concept", program: "Not recorded" },
    generatedAt: "2026-08-01T12:00:00.000Z",
    source: "observed",
    sourceLabel: "CANONICAL THREAD SNAPSHOT",
    change: {
      id: "approved-discovery-change-r1",
      title: "Record approved discovery documentary baseline",
      summary: "Recorded pre-technical documentary provenance.",
      author: "Not recorded",
      revision: "documentary-r1",
      changedAt: "2026-08-01T12:00:00.000Z",
      status: "pending",
      files: [],
    },
    components: {
      schemaVersion: "thread-components/1.0",
      authority: "workspace-declared",
      subjectId,
      rationale: "No product components are recorded in a documentary baseline.",
      systemViews: {},
      components: [],
    },
    graph: { nodes: [], edges: [] },
    evidenceFamilyGraph: {
      schemaVersion: "thread-evidence-family-graph/1.0",
      asOf: {
        snapshotId: `${subjectId}:r1:approved-discovery-baseline`,
        revision: 1,
      },
      families: [],
      edges: [],
      omittedSelfLoops: [],
      omittedCycleEdges: [],
    },
    flow: [],
    artifacts: [{
      id: "approved-discovery-document-r1",
      label: "Approved discovery documentary baseline (pre-technical)",
      kind: "document",
      system: "casys-digital-thread",
      revision: "documentary-r1",
      freshness: "fresh",
      fingerprint: "sha256:documentary-r1",
      uri: "state/approved-discovery-baselines/documentary-r1.json",
      producedBy: "baseline_from_approved_discovery",
      dependsOn: [],
    }],
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
