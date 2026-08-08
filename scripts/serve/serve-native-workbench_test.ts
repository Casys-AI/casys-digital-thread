import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CockpitFocusStore } from "../../src/adapters/stores/file-cockpit-focus-store.ts";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../src/domain/project/engineering-project-command-service.ts";
import type { CockpitFocusSnapshot } from "../../src/domain/platform/cockpit-focus.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../../src/domain/platform/cockpit-focus.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../src/domain/platform/architecture-proposal.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "../../src/orchestration/operations/inspection-drone-v4.ts";
import {
  createNativeWorkbenchHandler,
  NATIVE_WORKBENCH_LEGACY_PROJECT_ID,
  resolveNativeWorkbenchProjectId,
  resolveNativeWorkbenchSubjectId,
} from "./serve-native-workbench.ts";

Deno.test("native Workbench resolves an agent-selected project and its subject", async () => {
  const project = projectFixture("project-one", "subject-one");
  const projects = new ProjectStore([project]);

  assertEquals(
    resolveNativeWorkbenchProjectId(undefined, undefined),
    NATIVE_WORKBENCH_LEGACY_PROJECT_ID,
  );
  assertEquals(
    resolveNativeWorkbenchProjectId(undefined, "subject-one"),
    "subject-one",
  );
  assertEquals(
    resolveNativeWorkbenchProjectId("project-one", "subject-one"),
    "project-one",
  );
  assertEquals(
    await resolveNativeWorkbenchSubjectId("project-one", undefined, projects),
    "subject-one",
  );
  assertEquals(
    await resolveNativeWorkbenchSubjectId("project-one", "subject-override", projects),
    "subject-override",
  );
});

Deno.test("native Workbench serves a planning-only project without borrowing a thread", async () => {
  const project = projectFixture("project-one", "subject-one");
  const store = new EmptyThreadStore();
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("X-Casys-Data-Source"), "engineering-project-plan");
  assertEquals(body.surface, "planning");
  assertEquals(body.project.threadSnapshots, []);
  assertEquals(body.planning.technicalBaseline.status, "not-created");
  assertEquals(store.latestCalls, 0);
});

Deno.test("native Workbench keeps a durable unattached drone architecture snapshot out of preview until completion attaches it", async () => {
  const r2 = droneThreadSnapshot(2);
  const r3 = droneThreadSnapshot(3, r2);
  const projects = new ProjectStore([
    droneArchitectureProject("queued", r2, r3),
  ]);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: projects,
    projectId: "inspection-drone-v4",
    subjectId: r2.subject.id,
    html: "unused",
  });

  for (const status of ["queued", "running", "publishing", "failed"] as const) {
    projects.replace(droneArchitectureProject(status, r2, r3));
    assertEquals(await previewThreadId(handler), r2.id);
  }

  projects.replace(droneArchitectureProject("completed", r2, r3));
  assertEquals(await previewThreadId(handler), r3.id);
});

Deno.test("native Workbench keeps a durable unattached generic architecture snapshot out of preview until completion attaches it", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const projects = new ProjectStore([
    genericArchitectureProject("queued", r2, r3),
  ]);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: projects,
    projectId: "generic-architecture-project",
    subjectId: r2.subject.id,
    html: "unused",
  });

  for (const status of ["queued", "running", "publishing", "failed"] as const) {
    projects.replace(genericArchitectureProject(status, r2, r3));
    assertEquals(await previewThreadId(handler), r2.id);
  }

  projects.replace(genericArchitectureProject("completed", r2, r3));
  assertEquals(await previewThreadId(handler), r3.id);
});

Deno.test("native Workbench follows the durable focus selected by the agent", async () => {
  const first = projectFixture("project-one", "subject-one");
  const second = projectFixture("project-two", "subject-two");
  const focus = new MutableFocus(focusSnapshot("project-one"));
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([first, second]),
    subjectId: "subject-one",
    cockpitFocus: focus,
    workspaceId: "primary",
    html: "unused",
  });

  let response = await handler(new Request("http://localhost/api/thread/workbench"));
  assertEquals((await response.json()).project.project.id, "project-one");

  focus.value = focusSnapshot("project-two", 2);
  response = await handler(new Request("http://localhost/api/thread/workbench"));
  assertEquals((await response.json()).project.project.id, "project-two");
});

Deno.test("native Workbench keeps its BFF read-only and frame-protected", async () => {
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
  });

  const page = await handler(new Request("http://localhost/"));
  assertEquals(page.status, 200);
  assertStringIncludes(await page.text(), "Workbench");
  assertStringIncludes(
    page.headers.get("Content-Security-Policy") ?? "",
    "frame-ancestors 'none'",
  );
  assertEquals(page.headers.get("X-Frame-Options"), "DENY");

  const rejected = await handler(
    new Request("http://localhost/api/thread/workbench", {
      method: "POST",
    }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
  assertEquals(
    (await handler(new Request("http://localhost/api/project/commands"))).status,
    404,
  );
});

Deno.test("native Workbench reports an unknown selected project without substituting another one", async () => {
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    subjectId: "subject-one",
    cockpitFocus: new MutableFocus(focusSnapshot("missing")),
    html: "unused",
  });

  const response = await handler(new Request("http://localhost/api/thread/workbench"));
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error, "engineering_project_not_found");
});

function projectFixture(
  projectId: string,
  subjectId: string,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "1.0",
    id: `${projectId}:r1`,
    revision: 1,
    generatedAt: "2026-08-03T12:00:00.000Z",
    project: {
      id: projectId,
      name: projectId,
      subjectId,
      objective: { title: "Project", statement: "Project" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function droneArchitectureProject(
  status: "queued" | "running" | "publishing" | "failed" | "completed",
  r2: ThreadSnapshot,
  r3: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const completed = status === "completed";
  const evidence = {
    snapshotId: r3.id,
    snapshotRevision: r3.revision,
    kind: "artifact" as const,
    id: r3.artifacts[0]!.id,
  };
  const reference = (snapshot: ThreadSnapshot) => ({
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  });
  return {
    schemaVersion: "1.0",
    id: "inspection-drone-v4:project:r1",
    revision: 1,
    generatedAt: "2026-08-08T05:00:00.000Z",
    project: {
      id: "inspection-drone-v4",
      name: "Inspection drone v4",
      subjectId: r2.subject.id,
      objective: {
        title: "Inspection drone architecture",
        statement: "Keep the reviewed qualitative architecture traceable.",
      },
    },
    threadSnapshots: completed ? [reference(r2), reference(r3)] : [reference(r2)],
    phases: [{
      id: "architecture",
      name: "Architecture",
      order: 1,
      description: "Publish the bounded qualitative SysON architecture.",
      workItemIds: ["author-inspection-drone-architecture"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "author-inspection-drone-architecture",
      phaseId: "architecture",
      title: "Author drone architecture",
      description: "Run the registered qualitative architecture operation.",
      kind: "architect",
      operation: {
        ...INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
        bindings: [],
      },
      status: completed ? "completed" : "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: completed ? [evidence] : [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run:inspection-drone-architecture",
      workItemId: "author-inspection-drone-architecture",
      status,
      summary: "Author the reviewed qualitative inspection-drone architecture.",
      queuedAt: "2026-08-08T04:45:00.000Z",
      ...(status === "queued" ? {} : {
        startedAt: "2026-08-08T04:46:00.000Z",
        claimedAt: "2026-08-08T04:46:00.000Z",
        claimedBy: { origin: "agent" as const, id: "agent:engineering" },
      }),
      ...(completed
        ? {
          completedAt: "2026-08-08T04:47:00.000Z",
          resultSnapshot: reference(r3),
          evidenceRefs: [evidence],
        }
        : status === "failed"
        ? {
          completedAt: "2026-08-08T04:47:00.000Z",
          failure: {
            code: "readback-unavailable",
            message: "r3 durable but unattached",
          },
          evidenceRefs: [],
        }
        : { evidenceRefs: [] }),
    }],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function genericArchitectureProject(
  status: "queued" | "running" | "publishing" | "failed" | "completed",
  r2: ThreadSnapshot,
  r3: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const completed = status === "completed";
  const evidence = {
    snapshotId: r3.id,
    snapshotRevision: r3.revision,
    kind: "artifact" as const,
    id: r3.artifacts[0]!.id,
  };
  const reference = (snapshot: ThreadSnapshot) => ({
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  });
  return {
    schemaVersion: "1.0",
    id: "generic-architecture-project:r1",
    revision: 1,
    generatedAt: "2026-08-08T05:00:00.000Z",
    project: {
      id: "generic-architecture-project",
      name: "Generic architecture project",
      subjectId: r2.subject.id,
      objective: {
        title: "Generic architecture",
        statement: "Keep the approved generic architecture traceable.",
      },
    },
    threadSnapshots: completed ? [reference(r2), reference(r3)] : [reference(r2)],
    phases: [{
      id: "architecture",
      name: "Architecture",
      order: 1,
      description: "Publish the generic SysON architecture.",
      workItemIds: ["author-generic-architecture"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "author-generic-architecture",
      phaseId: "architecture",
      title: "Author generic architecture",
      description: "Run the registered generic architecture operation.",
      kind: "architect",
      operation: { ...MODEL_WRITE_ARCHITECTURE_OPERATION, bindings: [] },
      status: completed ? "completed" : "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: completed ? [evidence] : [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run:generic-architecture",
      workItemId: "author-generic-architecture",
      status,
      summary: "Author the approved generic architecture.",
      queuedAt: "2026-08-08T04:45:00.000Z",
      ...(status === "queued" ? {} : {
        startedAt: "2026-08-08T04:46:00.000Z",
        claimedAt: "2026-08-08T04:46:00.000Z",
        claimedBy: { origin: "agent" as const, id: "agent:engineering" },
      }),
      ...(completed
        ? {
          completedAt: "2026-08-08T04:47:00.000Z",
          resultSnapshot: reference(r3),
          evidenceRefs: [evidence],
        }
        : status === "failed"
        ? {
          completedAt: "2026-08-08T04:47:00.000Z",
          failure: {
            code: "readback-unavailable",
            message: "r3 durable but unattached",
          },
          evidenceRefs: [],
        }
        : { evidenceRefs: [] }),
    }],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function droneThreadSnapshot(
  revision: number,
  previous?: ThreadSnapshot,
): ThreadSnapshot {
  const at = "2026-08-08T05:00:00.000Z";
  const artifactId = `inspection-drone-architecture-r${revision}`;
  const changeId = `inspection-drone-architecture-change-r${revision}`;
  return {
    schemaVersion: "1.0",
    id: `inspection-drone-v4-thread-r${revision}`,
    revision,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: at,
    subject: {
      id: "project:inspection-drone-v4",
      name: "Inspection drone v4",
      kind: "system",
      version: String(revision),
      modelArtifactId: artifactId,
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: changeId,
      name: "Record inspection-drone architecture",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: `inspection-drone-architecture-artifact-r${revision}`,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded one exact qualitative architecture artifact.",
        afterFingerprint: { algorithm: "sha256", digest: String(revision).repeat(64) },
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Inspection-drone qualitative architecture",
      kind: "sysml-model",
      version: String(revision),
      fingerprint: { algorithm: "sha256", digest: String(revision).repeat(64) },
      producer: {
        serverId: "mcp-syson",
        tool: "syson_element_insert_sysml",
        runId: `run:inspection-drone-architecture-r${revision}`,
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `inspection-drone-architecture-provenance-r${revision}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale: "The exact snapshot records this qualitative architecture artifact.",
    }],
    proposedActions: [],
  };
}

function genericArchitectureThreadSnapshot(
  revision: number,
  previous?: ThreadSnapshot,
): ThreadSnapshot {
  const at = "2026-08-08T05:00:00.000Z";
  const digest = String(revision).repeat(64);
  const artifactId = `architecture-${digest}`;
  const changeId = `generic-architecture-change-r${revision}`;
  return {
    schemaVersion: "1.0",
    id: `generic-architecture-thread-r${revision}`,
    revision,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: at,
    subject: {
      id: "project:generic-architecture",
      name: "Generic architecture",
      kind: "system",
      version: String(revision),
      modelArtifactId: artifactId,
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: changeId,
      name: "Record generic architecture",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: `generic-architecture-artifact-r${revision}`,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded one exact generic architecture artifact.",
        afterFingerprint: { algorithm: "sha256", digest },
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Generic architecture",
      kind: "sysml-model",
      version: digest,
      fingerprint: { algorithm: "sha256", digest },
      uri: `casys://architecture-capture/sha256/${digest}`,
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: `run:generic-architecture-r${revision}`,
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `generic-architecture-provenance-r${revision}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale: "The exact snapshot records this generic architecture artifact.",
    }],
    proposedActions: [],
  };
}

async function previewThreadId(
  handler: (request: Request) => Promise<Response>,
): Promise<string> {
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 200);
  const body = await response.json() as {
    surface?: unknown;
    thread?: { id?: unknown };
  };
  assertEquals(body.surface, "evidence");
  if (typeof body.thread?.id !== "string") {
    throw new Error("expected an evidence Workbench thread id");
  }
  return body.thread.id;
}

function focusSnapshot(projectId: string, revision = 1): CockpitFocusSnapshot {
  return {
    schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
    workspaceId: "primary",
    revision,
    commandId: `focus-${revision}`,
    selectedAt: "2026-08-03T12:00:00.000Z",
    selectedBy: { kind: "agent", actorId: "mcp:test@1" },
    target: { kind: "project", projectId },
    ...(revision === 1 ? {} : { previous: { revision: revision - 1 } }),
  };
}

class EmptyThreadStore implements ThreadSnapshotStore {
  latestCalls = 0;

  get(_snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(undefined);
  }

  latest(_subjectId: string): Promise<ThreadSnapshot | undefined> {
    this.latestCalls += 1;
    return Promise.resolve(undefined);
  }

  save(_snapshot: ThreadSnapshot): Promise<void> {
    return Promise.resolve();
  }
}

class ThreadStore implements ThreadSnapshotStore {
  readonly #snapshots = new Map<string, ThreadSnapshot>();

  constructor(snapshots: readonly ThreadSnapshot[]) {
    for (const snapshot of snapshots) this.#snapshots.set(snapshot.id, snapshot);
  }

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(this.#snapshots.get(snapshotId));
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const latest = [...this.#snapshots.values()]
      .filter((snapshot) => snapshot.subject.id === subjectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(latest);
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    this.#snapshots.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class ProjectStore implements EngineeringProjectRevisionStore {
  readonly #projects = new Map<string, EngineeringProjectSnapshot>();

  constructor(projects: readonly EngineeringProjectSnapshot[]) {
    for (const project of projects) this.#projects.set(project.project.id, project);
  }

  replace(project: EngineeringProjectSnapshot): void {
    this.#projects.set(project.project.id, project);
  }

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(this.#projects.get(projectId));
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = this.#projects.get(projectId);
    return Promise.resolve(project?.revision === revision ? project : undefined);
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    return Promise.resolve(snapshot);
  }

  commit(snapshot: EngineeringProjectSnapshot): Promise<EngineeringProjectSnapshot> {
    return Promise.resolve(snapshot);
  }
}

class MutableFocus implements CockpitFocusStore {
  constructor(public value: CockpitFocusSnapshot) {}

  get(_workspaceId: string): Promise<CockpitFocusSnapshot> {
    return Promise.resolve(this.value);
  }

  select(snapshot: CockpitFocusSnapshot): Promise<CockpitFocusSnapshot> {
    this.value = snapshot;
    return Promise.resolve(snapshot);
  }
}
