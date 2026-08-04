import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CockpitFocusStore } from "../src/adapters/file-cockpit-focus-store.ts";
import type { EngineeringProjectSnapshot } from "../src/domain/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../src/domain/engineering-project-command-service.ts";
import type { CockpitFocusSnapshot } from "../src/domain/cockpit-focus.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../src/domain/cockpit-focus.ts";
import type { ThreadSnapshot } from "../src/domain/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../src/domain/thread-snapshot-store.ts";
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

class ProjectStore implements EngineeringProjectRevisionStore {
  readonly #projects = new Map<string, EngineeringProjectSnapshot>();

  constructor(projects: readonly EngineeringProjectSnapshot[]) {
    for (const project of projects) this.#projects.set(project.project.id, project);
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
