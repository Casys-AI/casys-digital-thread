import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sampleAgentResourceReference } from "../../testing/agent-resource-test-support.ts";
import {
  projectSourceWorkspaceFileRead,
  projectSourceWorkspaceSearchPage,
  projectSourceWorkspaceSnapshot,
  projectSourceWorkspaceTreePage,
} from "./reads.ts";
import {
  applyProjectSourceWorkspaceCommand,
  applyProjectSourceWorkspaceEvent,
  emptyProjectSourceWorkspace,
  eventBodyFingerprint,
  replayProjectSourceWorkspaceEvents,
} from "./transitions.ts";
import {
  PROJECT_SOURCE_WORKSPACE_BOUNDS,
  PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA,
  type ProjectSourceFileRevision,
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceEvent,
  type ProjectSourceWorkspaceState,
} from "./types.ts";
import {
  dependencyGraphHasCycle,
  parseSearchQuery,
  parseTreeQuery,
  parseWorkspaceCommand,
  parseWorkspaceEvent,
} from "./validation.ts";

const PROJECT = "generic-project";

Deno.test("empty workspace snapshot is revision 0 with no files and grants none", () => {
  const snapshot = projectSourceWorkspaceSnapshot(emptyProjectSourceWorkspace(PROJECT));
  assertEquals(snapshot.schemaVersion, "project-source-workspace-snapshot/2.0");
  assertEquals(snapshot.workspaceRevision, 0);
  assertEquals(snapshot.moduleCount, 0);
  assertEquals(snapshot.activeFileCount, 0);
  assertEquals(snapshot.activeAttachmentCount, 0);
  assertEquals(snapshot.rootModuleIds, []);
  assertEquals(snapshot.lastEventFingerprint, null);
  assertEquals(snapshot.grants, "none");
});

Deno.test("create then revise a module keeps a stable id and derived sibling uniqueness", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("mut-mod-1", 0, {
      moduleId: "mod-rail",
      slug: "rail",
      displayName: "Rail",
    }),
  )).state;
  state = (await apply(
    state,
    modulePut("mut-mod-2", 1, {
      moduleId: "mod-rail",
      slug: "rail-frame",
      displayName: "Rail frame",
      domain: "cad",
    }),
  )).state;
  assertEquals(state.modules.get("mod-rail")?.slug, "rail-frame");
  await assertCode(
    apply(
      state,
      modulePut("mut-mod-3", 2, {
        moduleId: "mod-other",
        slug: "rail-frame",
        displayName: "Collision",
      }),
    ),
    "path_collision",
  );
});

Deno.test("module domain is an optional generic slug, not a product enum", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("mut-a", 0, {
      moduleId: "mod-a",
      slug: "packaging",
      displayName: "Packaging",
      domain: "supporting",
    }),
  )).state;
  state = (await apply(
    state,
    modulePut("mut-b", 1, {
      moduleId: "mod-b",
      slug: "cad",
      displayName: "Cad",
      domain: "cad",
    }),
  )).state;
  assertEquals(state.modules.get("mod-a")?.domain, "supporting");
  const source = await Deno.readTextFile(new URL("./types.ts", import.meta.url));
  assertEquals(source.includes('"sysml" | "cad" | "fea"'), false);
  assertEquals(/\bprovider\s*\??:/.test(source), false);
  assertEquals(/\bimageReference\s*\??:/.test(source), false);
  assertEquals(/\bruntime\s*\??:/.test(source), false);
});

Deno.test("closed validation rejects provider, path and runtime authority fields", () => {
  const error = assertThrows(
    () =>
      parseWorkspaceCommand({
        projectId: PROJECT,
        mutationId: "mut-x",
        expectedWorkspaceRevision: 0,
        mutation: {
          kind: "module_put",
          moduleId: "mod-a",
          slug: "rail",
          displayName: "Rail",
          provider: "mcp-syson",
        },
      }),
    ProjectSourceWorkspaceError,
  );
  assertEquals(error.code, "invalid_request");
  assertEquals(
    assertThrows(
      () =>
        parseWorkspaceCommand({
          projectId: PROJECT,
          mutationId: "mut-x",
          expectedWorkspaceRevision: 0,
          mutation: {
            kind: "file_put",
            fileId: "file-a",
            moduleId: "mod-a",
            logicalName: "rail.py",
            role: "script",
            dependencies: [],
            path: "/tmp/rail.py",
            resourceRef: resource("rail.py"),
          },
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "invalid_request",
  );
});

Deno.test("create, revise, move and remove a file preserve identity and free the old path", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "mechanical",
      displayName: "Mechanical",
    }),
  )).state;
  state = (await apply(
    state,
    modulePut("m2", 1, {
      moduleId: "mod-b",
      slug: "drive",
      displayName: "Drive",
    }),
  )).state;
  const created = await apply(
    state,
    filePut("f1", 2, {
      fileId: "file-rail",
      moduleId: "mod-a",
      logicalName: "rail.py",
      role: "script",
    }),
  );
  state = created.state;
  const first = headContent(state, "file-rail");
  assertEquals(first.fileRevision, 1);
  assertEquals(first.predecessorFileRevision, undefined);
  const revised = await apply(
    state,
    filePut("f2", 3, {
      fileId: "file-rail",
      predecessorFileRevision: 1,
      moduleId: "mod-a",
      logicalName: "rail.py",
      role: "script",
      resourceName: "rail-v2.py",
    }),
  );
  state = revised.state;
  assertEquals(headContent(state, "file-rail").fileRevision, 2);
  const moved = await apply(
    state,
    filePut("f3", 4, {
      fileId: "file-rail",
      predecessorFileRevision: 2,
      moduleId: "mod-b",
      logicalName: "carriage.py",
      role: "script",
    }),
  );
  state = moved.state;
  const movedHead = headContent(state, "file-rail");
  assertEquals(movedHead.moduleId, "mod-b");
  assertEquals(movedHead.logicalName, "carriage.py");
  assertEquals(movedHead.fileRevision, 3);
  const sibling = await apply(
    state,
    filePut("f4", 5, {
      fileId: "file-other",
      moduleId: "mod-a",
      logicalName: "rail.py",
      role: "script",
      resourceName: "other.py",
    }),
  );
  state = sibling.state;
  const removed = await apply(state, {
    projectId: PROJECT,
    mutationId: "f5",
    expectedWorkspaceRevision: 6,
    mutation: {
      kind: "file_remove",
      fileId: "file-rail",
      activeFileRevision: 3,
    },
  });
  state = removed.state;
  assertEquals(state.files.get("file-rail")?.status, "removed");
  const snapshot = projectSourceWorkspaceSnapshot(state);
  assertEquals(snapshot.activeFileCount, 1);
  assertEquals(snapshot.grants, "none");
});

Deno.test("predecessor must be the unique active revision; branches are refused", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await seedFile(state)).state;
  await assertCode(
    apply(
      state,
      filePut("bad-create", 2, {
        fileId: "file-rail",
        moduleId: "mod-a",
        logicalName: "other.py",
        role: "script",
      }),
    ),
    "branch_ambiguity",
  );
  await assertCode(
    apply(
      state,
      filePut("bad-pred", 2, {
        fileId: "file-rail",
        predecessorFileRevision: 99,
        moduleId: "mod-a",
        logicalName: "rail.py",
        role: "script",
      }),
    ),
    "predecessor_mismatch",
  );
  state = (await apply(
    state,
    filePut("rev", 2, {
      fileId: "file-rail",
      predecessorFileRevision: 1,
      moduleId: "mod-a",
      logicalName: "rail.py",
      role: "script",
      resourceName: "v2.py",
    }),
  )).state;
  await assertCode(
    apply(
      state,
      filePut("stale-pred", 3, {
        fileId: "file-rail",
        predecessorFileRevision: 1,
        moduleId: "mod-a",
        logicalName: "rail.py",
        role: "script",
      }),
    ),
    "predecessor_mismatch",
  );
});

Deno.test("tombstone refuses a later put of the same file id", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await seedFile(state)).state;
  state = (await apply(state, {
    projectId: PROJECT,
    mutationId: "rm",
    expectedWorkspaceRevision: 2,
    mutation: {
      kind: "file_remove",
      fileId: "file-rail",
      activeFileRevision: 1,
    },
  })).state;
  await assertCode(
    apply(
      state,
      filePut("revive", 3, {
        fileId: "file-rail",
        predecessorFileRevision: 2,
        moduleId: "mod-a",
        logicalName: "rail.py",
        role: "script",
      }),
    ),
    "branch_ambiguity",
  );
});

Deno.test("path collision and POSIX-unsafe names fail closed", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await seedFile(state)).state;
  await assertCode(
    apply(
      state,
      filePut("dup", 2, {
        fileId: "file-b",
        moduleId: "mod-a",
        logicalName: "rail.py",
        role: "script",
        resourceName: "b.py",
      }),
    ),
    "path_collision",
  );
  assertEquals(
    assertThrows(
      () =>
        parseWorkspaceCommand(filePut("bad", 2, {
          fileId: "file-c",
          moduleId: "mod-a",
          logicalName: "../secret.py",
          role: "script",
        })),
      ProjectSourceWorkspaceError,
    ).code,
    "invalid_request",
  );
});

Deno.test("module slug and file logical name share one POSIX namespace in both directions", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-root",
      slug: "mech",
      displayName: "Mech",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("f1", 1, {
      fileId: "file-frame",
      moduleId: "mod-root",
      logicalName: "frame",
      role: "script",
    }),
  )).state;
  await assertCode(
    apply(
      state,
      modulePut("child", 2, {
        moduleId: "mod-frame",
        slug: "frame",
        displayName: "Frame",
        parentModuleId: "mod-root",
      }),
    ),
    "path_collision",
  );

  let reverse = emptyProjectSourceWorkspace(PROJECT);
  reverse = (await apply(
    reverse,
    modulePut("m1", 0, {
      moduleId: "mod-root",
      slug: "mech",
      displayName: "Mech",
    }),
  )).state;
  reverse = (await apply(
    reverse,
    modulePut("m2", 1, {
      moduleId: "mod-frame",
      slug: "frame",
      displayName: "Frame",
      parentModuleId: "mod-root",
    }),
  )).state;
  await assertCode(
    apply(
      reverse,
      filePut("f1", 2, {
        fileId: "file-frame",
        moduleId: "mod-root",
        logicalName: "frame",
        role: "script",
      }),
    ),
    "path_collision",
  );
});

Deno.test("module parent cycles and file dependency cycles fail closed", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "a",
      displayName: "A",
    }),
  )).state;
  state = (await apply(
    state,
    modulePut("m2", 1, {
      moduleId: "mod-b",
      slug: "b",
      displayName: "B",
      parentModuleId: "mod-a",
    }),
  )).state;
  await assertCode(
    apply(
      state,
      modulePut("cycle", 2, {
        moduleId: "mod-a",
        slug: "a",
        displayName: "A",
        parentModuleId: "mod-b",
      }),
    ),
    "module_cycle",
  );
  state = (await apply(
    state,
    filePut("fa", 2, {
      fileId: "file-a",
      moduleId: "mod-a",
      logicalName: "a.py",
      role: "script",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fb", 3, {
      fileId: "file-b",
      moduleId: "mod-a",
      logicalName: "b.py",
      role: "script",
      resourceName: "b.py",
      dependencies: [{ fileId: "file-a", fileRevision: 1 }],
    }),
  )).state;
  const revised = await apply(
    state,
    filePut("a2", 4, {
      fileId: "file-a",
      predecessorFileRevision: 1,
      moduleId: "mod-a",
      logicalName: "a.py",
      role: "script",
      resourceName: "a2.py",
      dependencies: [{ fileId: "file-b", fileRevision: 1 }],
    }),
  );
  assertEquals(revised.state.workspaceRevision, 5);
  assertEquals(headContent(revised.state, "file-a").fileRevision, 2);
  await assertCode(
    apply(
      revised.state,
      filePut("future", 5, {
        fileId: "file-b",
        predecessorFileRevision: 1,
        moduleId: "mod-a",
        logicalName: "b.py",
        role: "script",
        resourceName: "b2.py",
        dependencies: [{ fileId: "file-a", fileRevision: 99 }],
      }),
    ),
    "file_not_found",
  );
});

Deno.test("exact file-revision DAG accepts A2 -> B1 -> A1 and older same-file revision deps", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "a",
      displayName: "A",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fa", 1, {
      fileId: "file-a",
      moduleId: "mod-a",
      logicalName: "a.py",
      role: "script",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fb", 2, {
      fileId: "file-b",
      moduleId: "mod-a",
      logicalName: "b.py",
      role: "script",
      resourceName: "b.py",
      dependencies: [{ fileId: "file-a", fileRevision: 1 }],
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fa2", 3, {
      fileId: "file-a",
      predecessorFileRevision: 1,
      moduleId: "mod-a",
      logicalName: "a.py",
      role: "script",
      resourceName: "a2.py",
      dependencies: [{ fileId: "file-b", fileRevision: 1 }],
    }),
  )).state;
  assertEquals(headContent(state, "file-a").dependencies, [
    { fileId: "file-b", fileRevision: 1 },
  ]);
  state = (await apply(
    state,
    filePut("fa3", 4, {
      fileId: "file-a",
      predecessorFileRevision: 2,
      moduleId: "mod-a",
      logicalName: "a.py",
      role: "script",
      resourceName: "a3.py",
      dependencies: [{ fileId: "file-a", fileRevision: 1 }],
    }),
  )).state;
  assertEquals(headContent(state, "file-a").dependencies, [
    { fileId: "file-a", fileRevision: 1 },
  ]);
});

Deno.test("a genuinely cyclic file-revision history fails closed if constructable", async () => {
  assertEquals(
    dependencyGraphHasCycle(
      new Map([
        ["file-a@1", ["file-b@1"]],
        ["file-b@1", ["file-a@1"]],
      ]),
    ),
    true,
  );
  assertEquals(
    dependencyGraphHasCycle(
      new Map([
        ["file-a@2", ["file-b@1"]],
        ["file-b@1", ["file-a@1"]],
        ["file-a@1", []],
      ]),
    ),
    false,
  );

  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "a",
      displayName: "A",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fa", 1, {
      fileId: "file-a",
      moduleId: "mod-a",
      logicalName: "a.py",
      role: "script",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("fb", 2, {
      fileId: "file-b",
      moduleId: "mod-a",
      logicalName: "b.py",
      role: "script",
      resourceName: "b.py",
    }),
  )).state;
  const fileA = state.files.get("file-a")!;
  const fileB = state.files.get("file-b")!;
  const a1 = fileA.revisions.get(1) as ProjectSourceFileRevision;
  const b1 = fileB.revisions.get(1) as ProjectSourceFileRevision;
  const cyclic: ProjectSourceWorkspaceState = {
    ...state,
    files: new Map([
      ["file-a", {
        ...fileA,
        revisions: new Map([[1, {
          ...a1,
          dependencies: [{ fileId: "file-b", fileRevision: 1 }],
        }]]),
      }],
      ["file-b", {
        ...fileB,
        revisions: new Map([[1, {
          ...b1,
          dependencies: [{ fileId: "file-a", fileRevision: 1 }],
        }]]),
      }],
    ]),
  };
  await assertCode(
    apply(
      cyclic,
      filePut("fc", 3, {
        fileId: "file-c",
        moduleId: "mod-a",
        logicalName: "c.py",
        role: "script",
        resourceName: "c.py",
      }),
    ),
    "dependency_cycle",
  );
});

Deno.test("expected workspace revision CAS and mutationId replay vs conflict", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  const first = await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "a",
      displayName: "A",
    }),
  );
  state = first.state;
  await assertCode(
    apply(
      state,
      modulePut("m2", 0, {
        moduleId: "mod-b",
        slug: "b",
        displayName: "B",
      }),
    ),
    "stale_revision",
  );
  const replay = await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "a",
      displayName: "A",
    }),
  );
  assertEquals(replay.replayed, true);
  assertEquals(replay.state.workspaceRevision, 1);
  assertEquals(replay.event.fingerprint, first.event.fingerprint);
  await assertCode(
    apply(
      state,
      modulePut("m1", 0, {
        moduleId: "mod-a",
        slug: "other",
        displayName: "A",
      }),
    ),
    "mutation_id_conflict",
  );
});

Deno.test("canonical event fingerprint is exact; a tampered event fails replay", async () => {
  const created = await apply(
    emptyProjectSourceWorkspace(PROJECT),
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "a",
      displayName: "A",
    }),
  );
  const replayed = await replayProjectSourceWorkspaceEvents(PROJECT, [
    created.event,
  ]);
  assertEquals(replayed.workspaceRevision, 1);
  await assertCode(
    applyProjectSourceWorkspaceEvent(emptyProjectSourceWorkspace(PROJECT), {
      ...created.event,
      fingerprint: {
        algorithm: "sha256",
        digest: "b".repeat(64),
      },
    }),
    "event_fingerprint_mismatch",
  );
});

Deno.test("revision 1 previousEventFingerprint is null; later events name the exact prior fingerprint", async () => {
  const first = await apply(
    emptyProjectSourceWorkspace(PROJECT),
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "a",
      displayName: "A",
    }),
  );
  assertEquals(first.event.schemaVersion, PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA);
  assertEquals(first.event.previousEventFingerprint, null);
  assertEquals(first.state.lastEventFingerprint, first.event.fingerprint);
  const second = await apply(
    first.state,
    modulePut("m2", 1, {
      moduleId: "mod-b",
      slug: "b",
      displayName: "B",
    }),
  );
  assertEquals(second.event.previousEventFingerprint, first.event.fingerprint);
  assertEquals(
    Object.is(
      second.event.previousEventFingerprint?.algorithm,
      first.event.fingerprint.algorithm,
    ),
    true,
  );
  assertEquals(
    Object.is(
      second.event.previousEventFingerprint?.digest,
      first.event.fingerprint.digest,
    ),
    true,
  );
  const replayed = await replayProjectSourceWorkspaceEvents(PROJECT, [
    first.event,
    second.event,
  ]);
  assertEquals(replayed.workspaceRevision, 2);
  assertEquals(replayed.lastEventFingerprint, second.event.fingerprint);
});

Deno.test("wrong or null previousEventFingerprint and V1/V2 schemas are refused", async () => {
  const first = await apply(
    emptyProjectSourceWorkspace(PROJECT),
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "a",
      displayName: "A",
    }),
  );
  const second = await apply(
    first.state,
    modulePut("m2", 1, {
      moduleId: "mod-b",
      slug: "b",
      displayName: "B",
    }),
  );
  await assertCode(
    applyProjectSourceWorkspaceEvent(
      emptyProjectSourceWorkspace(PROJECT),
      await rehashedEvent(first.event, {
        previousEventFingerprint: {
          algorithm: "sha256",
          digest: "a".repeat(64),
        },
      }),
    ),
    "event_chain_mismatch",
  );
  await assertCode(
    applyProjectSourceWorkspaceEvent(
      first.state,
      await rehashedEvent(second.event, { previousEventFingerprint: null }),
    ),
    "event_chain_mismatch",
  );
  await assertCode(
    applyProjectSourceWorkspaceEvent(
      first.state,
      await rehashedEvent(second.event, {
        previousEventFingerprint: {
          algorithm: "sha256",
          digest: "c".repeat(64),
        },
      }),
    ),
    "event_chain_mismatch",
  );
  for (
    const schemaVersion of [
      "project-source-workspace-event/1.0",
      "project-source-workspace-event/2.0",
    ]
  ) {
    const error = assertThrows(
      () => parseWorkspaceEvent({ ...first.event, schemaVersion }),
      ProjectSourceWorkspaceError,
    );
    assertEquals(error.code, "invalid_request");
    assertEquals(error.message.includes("schemaVersion"), true);
  }
});

Deno.test("exact historical file read returns the predecessor resource after a later revision", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  const first = await seedFile(state);
  state = first.state;
  const firstRef = headContent(state, "file-rail").resourceRef;
  state = (await apply(
    state,
    filePut("rev", 2, {
      fileId: "file-rail",
      predecessorFileRevision: 1,
      moduleId: "mod-a",
      logicalName: "rail.py",
      role: "script",
      resourceName: "rail-v2.py",
    }),
  )).state;
  const historical = projectSourceWorkspaceFileRead(state, {
    workspaceRevision: 3,
    fileId: "file-rail",
    fileRevision: 1,
  });
  assertEquals(historical.record.kind, "content");
  if (historical.record.kind === "content") {
    assertEquals(historical.record.resourceRef, firstRef);
    assertEquals(historical.record.fileRevision, 1);
  }
  assertEquals(historical.grants, "none");
  assertEquals(headContent(state, "file-rail").fileRevision, 2);
});

Deno.test("tree and search pagination stay revision-anchored and reject cursor filter mismatch", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "mech",
      displayName: "Mech",
    }),
  )).state;
  for (const [index, name] of ["a.py", "b.py", "c.py"].entries()) {
    state = (await apply(
      state,
      filePut(`f${index}`, index + 1, {
        fileId: `file-${name}`,
        moduleId: "mod-a",
        logicalName: name,
        role: "script",
        resourceName: name,
      }),
    )).state;
  }
  const firstPage = projectSourceWorkspaceTreePage(state, {
    workspaceRevision: 4,
    moduleId: "mod-a",
    pageSize: 1,
  });
  assertEquals(firstPage.entries.length, 1);
  assertEquals(firstPage.entries[0]?.name, "a.py");
  const secondPage = projectSourceWorkspaceTreePage(state, {
    workspaceRevision: 4,
    moduleId: "mod-a",
    pageSize: 1,
    cursor: firstPage.nextCursor ?? undefined,
  });
  assertEquals(secondPage.entries[0]?.name, "b.py");
  assertThrows(
    () =>
      projectSourceWorkspaceTreePage(state, {
        workspaceRevision: 4,
        moduleId: "mod-a",
        pageSize: 1,
        cursor: btoa(JSON.stringify({
          kind: "tree",
          workspaceRevision: 3,
          moduleId: "mod-a",
          after: { kind: "file", id: "file-a.py" },
        })),
      }),
    ProjectSourceWorkspaceError,
    "does not match",
  );
  const search = projectSourceWorkspaceSearchPage(state, {
    workspaceRevision: 4,
    pathPrefix: "/mech/",
    pageSize: 2,
  });
  assertEquals(search.entries.length, 2);
  assertEquals(search.nextCursor !== null, true);
  assertThrows(
    () =>
      projectSourceWorkspaceSearchPage(state, {
        workspaceRevision: 4,
        pathPrefix: "/other/",
        pageSize: 2,
        cursor: search.nextCursor ?? undefined,
      }),
    ProjectSourceWorkspaceError,
    "does not match the requested filter",
  );
});

Deno.test("module move validates depth for the whole subtree, not only the moved node", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  let parent: string | undefined;
  for (let index = 1; index <= 15; index += 1) {
    const moduleId = `mod-${index}`;
    state = (await apply(
      state,
      modulePut(`chain-${index}`, state.workspaceRevision, {
        moduleId,
        slug: `n${index}`,
        displayName: `N${index}`,
        ...(parent ? { parentModuleId: parent } : {}),
      }),
    )).state;
    parent = moduleId;
  }
  state = (await apply(
    state,
    modulePut("leaf-root", state.workspaceRevision, {
      moduleId: "mod-leaf",
      slug: "leaf",
      displayName: "Leaf",
    }),
  )).state;
  state = (await apply(
    state,
    modulePut("leaf-child", state.workspaceRevision, {
      moduleId: "mod-leaf-child",
      slug: "child",
      displayName: "Child",
      parentModuleId: "mod-leaf",
    }),
  )).state;
  await assertCode(
    apply(
      state,
      modulePut("move-leaf", state.workspaceRevision, {
        moduleId: "mod-leaf",
        slug: "leaf",
        displayName: "Leaf",
        parentModuleId: "mod-15",
      }),
    ),
    "bound_exceeded",
  );
});

Deno.test("tombstone file read stays useful and carries no content bytes", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await seedFile(state)).state;
  state = (await apply(state, {
    projectId: PROJECT,
    mutationId: "rm",
    expectedWorkspaceRevision: 2,
    mutation: {
      kind: "file_remove",
      fileId: "file-rail",
      activeFileRevision: 1,
    },
  })).state;
  const tombstone = projectSourceWorkspaceFileRead(state, {
    workspaceRevision: 3,
    fileId: "file-rail",
    fileRevision: 2,
  });
  assertEquals(tombstone.record.kind, "tombstone");
  assertEquals(tombstone.derivedPath, null);
  assertEquals(tombstone.grants, "none");
  const historical = projectSourceWorkspaceFileRead(state, {
    workspaceRevision: 3,
    fileId: "file-rail",
    fileRevision: 1,
  });
  assertEquals(historical.record.kind, "content");
});

Deno.test("search profileId filters captureRequest.profileId and refuses captureProfileId", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "mech",
      displayName: "Mech",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("f1", 1, {
      fileId: "file-a",
      moduleId: "mod-a",
      logicalName: "a.py",
      role: "script",
      captureRequest: { profileId: "python-source" },
    }),
  )).state;
  state = (await apply(
    state,
    filePut("f2", 2, {
      fileId: "file-b",
      moduleId: "mod-a",
      logicalName: "b.py",
      role: "script",
      resourceName: "b.py",
      captureRequest: { profileId: "modelica-source" },
    }),
  )).state;
  const hits = projectSourceWorkspaceSearchPage(state, {
    workspaceRevision: 3,
    profileId: "python-source",
  });
  assertEquals(hits.entries.map((hit) => hit.fileId), ["file-a"]);
  assertEquals(hits.entries[0]?.captureRequest, {
    profileId: "python-source",
  });
  assertEquals(
    assertThrows(
      () =>
        parseSearchQuery({
          projectId: PROJECT,
          workspaceRevision: 3,
          captureProfileId: "python-source",
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "invalid_request",
  );
  assertEquals(
    assertThrows(
      () =>
        parseSearchQuery({
          projectId: PROJECT,
          workspaceRevision: 3,
          sourceId: "rail",
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "invalid_request",
  );
});

Deno.test("tree and search parsers enforce cursor and pathPrefix max lengths", () => {
  assertEquals(
    assertThrows(
      () =>
        parseTreeQuery({
          projectId: PROJECT,
          workspaceRevision: 1,
          cursor: "c".repeat(PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength + 1),
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "bound_exceeded",
  );
  assertEquals(
    assertThrows(
      () =>
        parseSearchQuery({
          projectId: PROJECT,
          workspaceRevision: 1,
          pathPrefix: `/${
            "a".repeat(PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDerivedPathLength)
          }`,
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "bound_exceeded",
  );
});

Deno.test("derived path uses the module slug chain and never a caller-supplied path", async () => {
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-root",
      slug: "product",
      displayName: "Product",
    }),
  )).state;
  state = (await apply(
    state,
    modulePut("m2", 1, {
      moduleId: "mod-child",
      slug: "rail",
      displayName: "Rail",
      parentModuleId: "mod-root",
    }),
  )).state;
  state = (await apply(
    state,
    filePut("f1", 2, {
      fileId: "file-rail",
      moduleId: "mod-child",
      logicalName: "frame.py",
      role: "script",
    }),
  )).state;
  const read = projectSourceWorkspaceFileRead(state, {
    workspaceRevision: 3,
    fileId: "file-rail",
    fileRevision: 1,
  });
  assertEquals(read.derivedPath, "/product/rail/frame.py");
});

function resource(name: string) {
  return sampleAgentResourceReference({
    name,
    mimeType: "text/plain",
    byteCount: 1,
  });
}

function modulePut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  mutation: {
    moduleId: string;
    slug: string;
    displayName: string;
    parentModuleId?: string;
    domain?: string;
  },
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: { kind: "module_put" as const, ...mutation },
  };
}

function filePut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  mutation: {
    fileId: string;
    moduleId: string;
    logicalName: string;
    role: string;
    predecessorFileRevision?: number;
    resourceName?: string;
    dependencies?: { fileId: string; fileRevision: number }[];
    captureRequest?: { profileId: string };
  },
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "file_put" as const,
      fileId: mutation.fileId,
      moduleId: mutation.moduleId,
      logicalName: mutation.logicalName,
      role: mutation.role,
      dependencies: mutation.dependencies ?? [],
      resourceRef: resource(mutation.resourceName ?? mutation.logicalName),
      ...(mutation.predecessorFileRevision !== undefined
        ? { predecessorFileRevision: mutation.predecessorFileRevision }
        : {}),
      ...(mutation.captureRequest ? { captureRequest: mutation.captureRequest } : {}),
    },
  };
}

async function apply(
  state: ProjectSourceWorkspaceState,
  command: unknown,
) {
  return await applyProjectSourceWorkspaceCommand(state, command);
}

async function rehashedEvent<Event extends ProjectSourceWorkspaceEvent>(
  event: Event,
  patch: Partial<Omit<Event, "fingerprint">>,
): Promise<Event> {
  const { fingerprint: _ignored, ...body } = { ...event, ...patch };
  return {
    ...body,
    fingerprint: await eventBodyFingerprint(body),
  } as Event;
}

async function seedFile(state: ProjectSourceWorkspaceState) {
  const withModule = await apply(
    state,
    modulePut("m1", 0, {
      moduleId: "mod-a",
      slug: "mech",
      displayName: "Mech",
    }),
  );
  return await apply(
    withModule.state,
    filePut("f1", 1, {
      fileId: "file-rail",
      moduleId: "mod-a",
      logicalName: "rail.py",
      role: "script",
    }),
  );
}

function headContent(state: ProjectSourceWorkspaceState, fileId: string) {
  const file = state.files.get(fileId)!;
  const head = file.revisions.get(file.headRevision)!;
  if (head.kind !== "content") throw new Error("expected content");
  return head;
}

async function assertCode(
  promise: Promise<unknown>,
  code: ProjectSourceWorkspaceError["code"],
) {
  const error = await assertRejects(() => promise, ProjectSourceWorkspaceError);
  assertEquals(error.code, code);
}
