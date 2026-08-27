import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sampleAgentResourceReference } from "../../testing/agent-resource-test-support.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import {
  projectSourceWorkspaceAttachmentList,
  projectSourceWorkspaceAttachmentRead,
  projectSourceWorkspaceSnapshot,
} from "./reads.ts";
import {
  applyProjectSourceWorkspaceCommand,
  applyProjectSourceWorkspaceEvent,
  cloneProjectSourceWorkspaceState,
  emptyProjectSourceWorkspace,
  eventBodyFingerprint,
  replayProjectSourceWorkspaceEvents,
} from "./transitions.ts";
import {
  PROJECT_SOURCE_WORKSPACE_BOUNDS,
  PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA,
  PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA_V3,
  type ProjectSourceAttachmentRevision,
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceEvent,
  type ProjectSourceWorkspaceEventBodyV3,
  type ProjectSourceWorkspaceEventV3,
  type ProjectSourceWorkspaceEventV4,
  type ProjectSourceWorkspaceState,
} from "./types.ts";
import {
  parseAttachmentListQuery,
  parseAttachmentRecrossRequest,
  parseWorkspaceCommand,
  parseWorkspaceEvent,
} from "./validation.ts";

const PROJECT = "generic-project";

Deno.test("attachment put creates a stable edge with a canonical fingerprint", async () => {
  let state = (await seedFile()).state;
  const created = await apply(state, attachmentPut("a1", 2));
  state = created.state;
  const head = headAttachment(state, "att-rail");
  assertEquals(head.attachmentRevision, 1);
  assertEquals(head.predecessorAttachmentRevision, undefined);
  assertEquals(head.fileId, "file-rail");
  assertEquals(head.role, { id: "design-source", version: 1 });
  assertEquals(head.target, {
    elementId: "def-rail",
    elementKind: "PartDefinition",
  });
  assertEquals(created.event.schemaVersion, PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA);
  const snapshot = projectSourceWorkspaceSnapshot(state);
  assertEquals(snapshot.activeAttachmentCount, 1);
  assertEquals(snapshot.schemaVersion, "project-source-workspace-snapshot/2.0");
});

Deno.test("attachment successor may retarget; predecessor must be the unique active head", async () => {
  let state = (await seedFile()).state;
  state = (await apply(state, attachmentPut("a1", 2))).state;
  await assertCode(
    apply(state, attachmentPut("bad-create", 3)),
    "branch_ambiguity",
  );
  await assertCode(
    apply(
      state,
      attachmentPut("bad-pred", 3, { predecessorAttachmentRevision: 99 }),
    ),
    "predecessor_mismatch",
  );
  state = (await apply(
    state,
    attachmentPut("a2", 3, {
      predecessorAttachmentRevision: 1,
      target: { elementId: "usage-left", elementKind: "PartUsage" },
    }),
  )).state;
  const head = headAttachment(state, "att-rail");
  assertEquals(head.attachmentRevision, 2);
  assertEquals(head.predecessorAttachmentRevision, 1);
  assertEquals(head.target.elementKind, "PartUsage");
  assertEquals(head.fileId, "file-rail");
  await assertCode(
    apply(
      state,
      attachmentPut("stale", 4, { predecessorAttachmentRevision: 1 }),
    ),
    "predecessor_mismatch",
  );
});

Deno.test("fileId is stable across an attachment chain", async () => {
  let state = (await seedFile()).state;
  state = (await apply(state, attachmentPut("a1", 2))).state;
  state = (await apply(
    state,
    filePut("f2", 3, {
      fileId: "file-other",
      moduleId: "mod-a",
      logicalName: "other.py",
      role: "script",
      resourceName: "other.py",
    }),
  )).state;
  await assertCode(
    apply(
      state,
      attachmentPut("a2", 4, {
        predecessorAttachmentRevision: 1,
        fileId: "file-other",
      }),
    ),
    "file_id_mismatch",
  );
});

Deno.test("new workspace commands write V4 while a V3 legacy event remains replayable", async () => {
  const transition = await apply(
    emptyProjectSourceWorkspace(PROJECT),
    {
      projectId: PROJECT,
      mutationId: "v4-writer",
      expectedWorkspaceRevision: 0,
      mutation: {
        kind: "module_put" as const,
        moduleId: "mod-a",
        slug: "mech",
        displayName: "Mech",
      },
    },
  );
  if (transition.replayed) throw new Error("Expected a newly written event.");
  assertEquals(transition.event.schemaVersion, "project-source-workspace-event/4.0");
  const legacy = await asV3Event(transition.event);
  assertEquals(
    parseWorkspaceEvent(legacy).schemaVersion,
    PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA_V3,
  );
  const replayed = await replayProjectSourceWorkspaceEvents(PROJECT, [legacy]);
  assertEquals(replayed.workspaceRevision, 1);
  assertEquals(replayed.modules.get("mod-a")?.slug, "mech");
});

Deno.test("internal attachment recross applies a whole batch in one replayable event or changes no prior state", async () => {
  const seeded = await seedFile();
  let state = (await apply(seeded.state, attachmentPut("a1", 2))).state;
  state = (await apply(
    state,
    attachmentPut("a2", 3, {
      attachmentId: "att-usage",
      target: { elementId: "usage-left", elementKind: "PartUsage" },
    }),
  )).state;
  const command = {
    projectId: PROJECT,
    mutationId: "recross-1",
    expectedWorkspaceRevision: 4,
    mutation: {
      kind: "attachment_recross" as const,
      intent: {
        expectedWorkspaceRevision: 4,
        attachments: [
          { attachmentId: "att-usage", activeAttachmentRevision: 1 },
          { attachmentId: "att-rail", activeAttachmentRevision: 1 },
        ],
      },
      declaredAgainst: declaredAgainst({
        thread: {
          snapshotId: "thread:p:r2",
          revision: 2,
          subjectId: "subject.p",
        },
      }),
      successors: [
        {
          attachmentId: "att-usage",
          predecessorAttachmentRevision: 1,
          fileId: "file-rail",
          role: { id: "design-source", version: 1 },
          target: { elementId: "usage-left", elementKind: "PartUsage" },
        },
        {
          attachmentId: "att-rail",
          predecessorAttachmentRevision: 1,
          fileId: "file-rail",
          role: { id: "design-source", version: 1 },
          target: { elementId: "def-rail", elementKind: "PartDefinition" },
        },
      ],
    },
  };
  const recrossed = await apply(state, command);
  assertEquals(recrossed.state.workspaceRevision, 5);
  assertEquals(headAttachment(recrossed.state, "att-rail").attachmentRevision, 2);
  assertEquals(headAttachment(recrossed.state, "att-usage").attachmentRevision, 2);
  assertEquals(recrossed.event.mutation.kind, "attachment_recross");
  if (recrossed.event.mutation.kind !== "attachment_recross") {
    throw new Error("Expected attachment_recross event.");
  }
  assertEquals(recrossed.event.mutation.intent.attachments, [
    { attachmentId: "att-rail", activeAttachmentRevision: 1 },
    { attachmentId: "att-usage", activeAttachmentRevision: 1 },
  ]);
  const legacyRecross = assertThrows(
    () =>
      parseWorkspaceEvent({
        ...recrossed.event,
        schemaVersion: PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA_V3,
      }),
    ProjectSourceWorkspaceError,
  );
  assertEquals(legacyRecross.code, "invalid_request");
  assertEquals(
    legacyRecross.message.includes("attachment_recross requires"),
    true,
  );
  const replayed = await replayProjectSourceWorkspaceEvents(PROJECT, [
    ...seeded.eventFromStart,
    (await apply(seeded.state, attachmentPut("a1", 2))).event,
    (await apply(
      (await apply(seeded.state, attachmentPut("a1", 2))).state,
      attachmentPut("a2", 3, {
        attachmentId: "att-usage",
        target: { elementId: "usage-left", elementKind: "PartUsage" },
      }),
    )).event,
    recrossed.event,
  ]);
  assertEquals(headAttachment(replayed, "att-rail").attachmentRevision, 2);
  const invalid = {
    ...command,
    mutationId: "recross-invalid",
    mutation: {
      ...command.mutation,
      successors: command.mutation.successors.map((successor) =>
        successor.attachmentId === "att-usage"
          ? {
            ...successor,
            target: { elementId: "def-other", elementKind: "PartDefinition" as const },
          }
          : successor
      ),
    },
  };
  await assertCode(apply(state, invalid), "invalid_request");
  assertEquals(headAttachment(state, "att-rail").attachmentRevision, 1);
  assertEquals(headAttachment(state, "att-usage").attachmentRevision, 1);
});

Deno.test("duplicate active fileId+role+target is refused; a successor of the same edge is not", async () => {
  let state = (await seedFile()).state;
  state = (await apply(state, attachmentPut("a1", 2))).state;
  await assertCode(
    apply(
      state,
      attachmentPut("a-dup", 3, { attachmentId: "att-other" }),
    ),
    "duplicate_attachment",
  );
  const successor = await apply(
    state,
    attachmentPut("a2", 3, {
      predecessorAttachmentRevision: 1,
      declaredAgainst: declaredAgainst({
        thread: {
          snapshotId: "thread:p:r2",
          revision: 2,
          subjectId: "subject.p",
        },
      }),
    }),
  );
  assertEquals(headAttachment(successor.state, "att-rail").attachmentRevision, 2);
});

Deno.test("detach writes a tombstone and refuses revival", async () => {
  let state = (await seedFile()).state;
  state = (await apply(state, attachmentPut("a1", 2))).state;
  state = (await apply(state, attachmentDetach("d1", 3, 1))).state;
  assertEquals(state.attachments.get("att-rail")?.status, "detached");
  assertEquals(projectSourceWorkspaceSnapshot(state).activeAttachmentCount, 0);
  const tombstone = projectSourceWorkspaceAttachmentRead(state, {
    workspaceRevision: 4,
    attachmentId: "att-rail",
    attachmentRevision: 2,
  });
  assertEquals(tombstone.record.kind, "tombstone");
  assertEquals(tombstone.sourceStatus, "active");
  assertEquals(tombstone.fileId, "file-rail");
  assertEquals(tombstone.grants, "none");
  await assertCode(
    apply(
      state,
      attachmentPut("revive", 4, { predecessorAttachmentRevision: 2 }),
    ),
    "branch_ambiguity",
  );
  await assertCode(
    apply(state, attachmentPut("revive-create", 4)),
    "branch_ambiguity",
  );
});

Deno.test("file remove does not cascade; reads publish source-removed", async () => {
  let state = (await seedFile()).state;
  state = (await apply(state, attachmentPut("a1", 2))).state;
  state = (await apply(state, {
    projectId: PROJECT,
    mutationId: "rm",
    expectedWorkspaceRevision: 3,
    mutation: {
      kind: "file_remove",
      fileId: "file-rail",
      activeFileRevision: 1,
    },
  })).state;
  const listed = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 4,
    fileId: "file-rail",
  });
  assertEquals(listed.entries.length, 1);
  assertEquals(listed.entries[0]?.sourceStatus, "source-removed");
  assertEquals(listed.entries[0]?.fileHeadRevision, 2);
  assertEquals(listed.grants, "none");
  const read = projectSourceWorkspaceAttachmentRead(state, {
    workspaceRevision: 4,
    attachmentId: "att-rail",
    attachmentRevision: 1,
  });
  assertEquals(read.sourceStatus, "source-removed");
  assertEquals(read.record.kind, "content");
  assertEquals(state.attachments.get("att-rail")?.status, "active");
});

Deno.test("attachment list is revision-anchored, at-most-one-filter, and omits detached heads", async () => {
  let state = await seedListedAttachments();
  const byFile = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 6,
    fileId: "file-rail",
    pageSize: 1,
  });
  assertEquals(byFile.entries.map((entry) => entry.attachmentId), ["att-rail"]);
  assertEquals(byFile.nextCursor !== null, true);
  const second = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 6,
    fileId: "file-rail",
    pageSize: 1,
    cursor: byFile.nextCursor ?? undefined,
  });
  assertEquals(second.entries.map((entry) => entry.attachmentId), ["att-usage"]);
  const byTarget = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 6,
    target: { elementId: "def-other", elementKind: "PartDefinition" },
  });
  assertEquals(byTarget.entries.map((entry) => entry.attachmentId), ["att-b"]);
  const unfiltered = parseAttachmentListQuery({
    projectId: PROJECT,
    workspaceRevision: 6,
  });
  assertEquals("fileId" in unfiltered, false);
  assertEquals("target" in unfiltered, false);
  assertThrows(
    () =>
      projectSourceWorkspaceAttachmentList(state, {
        workspaceRevision: 6,
        fileId: "file-b",
        cursor: byFile.nextCursor ?? undefined,
      }),
    ProjectSourceWorkspaceError,
    "does not match the requested filter",
  );
  state = (await apply(
    state,
    attachmentDetach("d-b", 6, 1, "att-b"),
  )).state;
  const afterDetach = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 7,
    target: { elementId: "def-other", elementKind: "PartDefinition" },
  });
  assertEquals(afterDetach.entries, []);
});

Deno.test("unfiltered attachment list pages every active head at the exact revision", async () => {
  const state = await seedListedAttachments();
  const first = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 6,
    pageSize: 1,
  });
  assertEquals(first.entries.map((entry) => entry.attachmentId), ["att-b"]);
  assertEquals(first.nextCursor !== null, true);
  const second = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 6,
    pageSize: 1,
    cursor: first.nextCursor ?? undefined,
  });
  assertEquals(second.entries.map((entry) => entry.attachmentId), ["att-rail"]);
  assertEquals(second.nextCursor !== null, true);
  const third = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 6,
    pageSize: 1,
    cursor: second.nextCursor ?? undefined,
  });
  assertEquals(third.entries.map((entry) => entry.attachmentId), ["att-usage"]);
  assertEquals(third.nextCursor, null);
  assertEquals(third.grants, "none");
});

Deno.test("attachment list refuses fileId and target together", async () => {
  const state = await seedListedAttachments();
  const both = {
    projectId: PROJECT,
    workspaceRevision: 6,
    fileId: "file-rail",
    target: { elementId: "def-rail", elementKind: "PartDefinition" as const },
  };
  assertEquals(
    assertThrows(
      () => parseAttachmentListQuery(both),
      ProjectSourceWorkspaceError,
      "at most one of fileId or target",
    ).code,
    "invalid_request",
  );
  assertEquals(
    assertThrows(
      () =>
        projectSourceWorkspaceAttachmentList(state, {
          workspaceRevision: 6,
          fileId: "file-rail",
          target: { elementId: "def-rail", elementKind: "PartDefinition" },
        }),
      ProjectSourceWorkspaceError,
      "at most one of fileId or target",
    ).code,
    "invalid_request",
  );
});

Deno.test("attachment list cursors cannot cross filtered and unfiltered scopes", async () => {
  const state = await seedListedAttachments();
  const unfiltered = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 6,
    pageSize: 1,
  });
  const byFile = projectSourceWorkspaceAttachmentList(state, {
    workspaceRevision: 6,
    fileId: "file-rail",
    pageSize: 1,
  });
  const targetCursor = btoa(deterministicJson({
    kind: "attachment-list",
    workspaceRevision: 6,
    filter: {
      target: { elementId: "def-other", elementKind: "PartDefinition" },
    },
    after: { attachmentId: "att-b" },
  }));
  assertEquals(unfiltered.nextCursor !== null, true);
  assertEquals(byFile.nextCursor !== null, true);
  assertEquals(
    assertThrows(
      () =>
        projectSourceWorkspaceAttachmentList(state, {
          workspaceRevision: 6,
          fileId: "file-rail",
          cursor: unfiltered.nextCursor ?? undefined,
        }),
      ProjectSourceWorkspaceError,
      "does not match the requested filter",
    ).code,
    "cursor_mismatch",
  );
  assertEquals(
    assertThrows(
      () =>
        projectSourceWorkspaceAttachmentList(state, {
          workspaceRevision: 6,
          cursor: byFile.nextCursor ?? undefined,
        }),
      ProjectSourceWorkspaceError,
      "does not match the requested filter",
    ).code,
    "cursor_mismatch",
  );
  assertEquals(
    assertThrows(
      () =>
        projectSourceWorkspaceAttachmentList(state, {
          workspaceRevision: 6,
          cursor: targetCursor,
        }),
      ProjectSourceWorkspaceError,
      "does not match the requested filter",
    ).code,
    "cursor_mismatch",
  );
  const bothFilterCursor = btoa(deterministicJson({
    kind: "attachment-list",
    workspaceRevision: 6,
    filter: {
      fileId: "file-rail",
      target: { elementId: "def-rail", elementKind: "PartDefinition" },
    },
    after: { attachmentId: "att-rail" },
  }));
  assertEquals(
    assertThrows(
      () =>
        projectSourceWorkspaceAttachmentList(state, {
          workspaceRevision: 6,
          cursor: bothFilterCursor,
        }),
      ProjectSourceWorkspaceError,
      "cursor filter is not exact",
    ).code,
    "cursor_mismatch",
  );
});

Deno.test("new attachment requires an active file", async () => {
  const empty = emptyProjectSourceWorkspace(PROJECT);
  await assertCode(apply(empty, attachmentPut("a1", 0)), "file_not_found");
  let state = (await seedFile()).state;
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
  await assertCode(apply(state, attachmentPut("a1", 3)), "file_not_found");
});

Deno.test("attachment events are hash-chained; tamper and historical schemas fail closed", async () => {
  const seeded = await seedFile();
  const created = await apply(seeded.state, attachmentPut("a1", 2));
  assertEquals(
    created.event.previousEventFingerprint,
    seeded.state.lastEventFingerprint,
  );
  const replayed = await replayProjectSourceWorkspaceEvents(PROJECT, [
    ...seeded.eventFromStart,
    created.event,
  ]);
  assertEquals(replayed.workspaceRevision, 3);
  assertEquals(headAttachment(replayed, "att-rail").attachmentRevision, 1);
  await assertCode(
    applyProjectSourceWorkspaceEvent(seeded.state, {
      ...created.event,
      fingerprint: {
        algorithm: "sha256",
        digest: "b".repeat(64),
      },
    }),
    "event_fingerprint_mismatch",
  );
  const chained = await rehashedEvent(created.event, {
    previousEventFingerprint: {
      algorithm: "sha256",
      digest: "c".repeat(64),
    },
  });
  await assertCode(
    applyProjectSourceWorkspaceEvent(seeded.state, chained),
    "event_chain_mismatch",
  );
  assertEquals(
    assertThrows(
      () =>
        parseWorkspaceEvent({
          ...created.event,
          schemaVersion: "project-source-workspace-event/2.0",
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "invalid_request",
  );
  assertEquals(
    assertThrows(
      () =>
        parseWorkspaceCommand({
          ...attachmentPut("x", 3),
          mutation: {
            ...attachmentPut("x", 3).mutation,
            provider: "mcp-syson",
          },
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "invalid_request",
  );
});

Deno.test("replay of attachment events stays inside the aggregate and never names a validator", async () => {
  const seeded = await seedFile();
  const created = await apply(seeded.state, attachmentPut("a1", 2));
  const replayed = await replayProjectSourceWorkspaceEvents(PROJECT, [
    ...seeded.eventFromStart,
    created.event,
  ]);
  assertEquals(replayed.attachments.get("att-rail")?.status, "active");
  const cloned = cloneProjectSourceWorkspaceState(replayed);
  (cloned.attachments as Map<string, unknown>).clear();
  assertEquals(replayed.attachments.get("att-rail")?.status, "active");
  const transitionSource = await Deno.readTextFile(
    new URL("./transitions.ts", import.meta.url),
  );
  const typesSource = await Deno.readTextFile(
    new URL("./types.ts", import.meta.url),
  );
  for (const source of [transitionSource, typesSource]) {
    assertEquals(/syson/i.test(source), false);
    assertEquals(/graphology/i.test(source), false);
    assertEquals(source.includes("RoleCatalog"), false);
    assertEquals(source.includes("hasElement"), false);
    assertEquals(source.includes("HttpMcpToolClient"), false);
  }
});

Deno.test("identical mutationId replays the accepted attachment event", async () => {
  const state = (await seedFile()).state;
  const first = await apply(state, attachmentPut("a1", 2));
  const replay = await apply(first.state, attachmentPut("a1", 2));
  assertEquals(replay.replayed, true);
  assertEquals(replay.event.fingerprint, first.event.fingerprint);
  await assertCode(
    apply(
      first.state,
      attachmentPut("a1", 2, {
        target: { elementId: "def-other", elementKind: "PartDefinition" },
      }),
    ),
    "mutation_id_conflict",
  );
});

Deno.test("public attachment recross requests are closed, bounded, unique and canonicalized", () => {
  const parsed = parseAttachmentRecrossRequest({
    projectId: PROJECT,
    mutationId: "recross-request",
    expectedWorkspaceRevision: 4,
    attachments: [
      { attachmentId: "att-z", activeAttachmentRevision: 1 },
      { attachmentId: "att-a", activeAttachmentRevision: 2 },
    ],
  });
  assertEquals(parsed.attachments, [
    { attachmentId: "att-a", activeAttachmentRevision: 2 },
    { attachmentId: "att-z", activeAttachmentRevision: 1 },
  ]);
  assertEquals(
    assertThrows(
      () =>
        parseAttachmentRecrossRequest({
          projectId: PROJECT,
          mutationId: "recross-extra",
          expectedWorkspaceRevision: 4,
          attachments: [{ attachmentId: "att-a", activeAttachmentRevision: 1 }],
          fileId: "file-rail",
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "invalid_request",
  );
  assertThrows(
    () =>
      parseAttachmentRecrossRequest({
        projectId: PROJECT,
        mutationId: "recross-duplicate",
        expectedWorkspaceRevision: 4,
        attachments: [
          { attachmentId: "att-a", activeAttachmentRevision: 1 },
          { attachmentId: "att-a", activeAttachmentRevision: 1 },
        ],
      }),
    ProjectSourceWorkspaceError,
  );
  assertEquals(
    assertThrows(
      () =>
        parseAttachmentRecrossRequest({
          projectId: PROJECT,
          mutationId: "recross-bound",
          expectedWorkspaceRevision: 4,
          attachments: Array.from(
            { length: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxAttachmentRecrossItems + 1 },
            (_, index) => ({
              attachmentId: `att-${index}`,
              activeAttachmentRevision: 1,
            }),
          ),
        }),
      ProjectSourceWorkspaceError,
    ).code,
    "bound_exceeded",
  );
});

Deno.test("a derived maximum attachment recross mutation remains inside the event byte bound", () => {
  assertEquals(PROJECT_SOURCE_WORKSPACE_BOUNDS.maxAttachmentRecrossItems, 32);
  const attachments = Array.from(
    { length: PROJECT_SOURCE_WORKSPACE_BOUNDS.maxAttachmentRecrossItems },
    (_, index) => ({
      attachmentId: `att-${String(index).padStart(2, "0")}`,
      activeAttachmentRevision: 1,
    }),
  );
  const command = parseWorkspaceCommand({
    projectId: PROJECT,
    mutationId: "recross-max",
    expectedWorkspaceRevision: 4,
    mutation: {
      kind: "attachment_recross",
      intent: { expectedWorkspaceRevision: 4, attachments },
      declaredAgainst: declaredAgainst({
        thread: { snapshotId: "thread:p:r2", revision: 2, subjectId: "subject.p" },
      }),
      successors: attachments.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        predecessorAttachmentRevision: attachment.activeAttachmentRevision,
        fileId: "file-rail",
        role: { id: "design-source", version: 1 },
        target: {
          elementId: `def-${attachment.attachmentId}`,
          elementKind: "PartDefinition",
        },
      })),
    },
  });
  if (command.mutation.kind !== "attachment_recross") {
    throw new Error("Expected a derived attachment_recross mutation.");
  }
  assertEquals(command.mutation.successors.length, 32);
  assertEquals(
    deterministicJson(command.mutation).length <
      PROJECT_SOURCE_WORKSPACE_BOUNDS.maxMutationJsonBytes,
    true,
  );
});

function declaredAgainst(
  overrides: {
    thread?: { snapshotId: string; revision: number; subjectId: string };
  } = {},
) {
  return {
    thread: overrides.thread ?? {
      snapshotId: "thread:p:r1",
      revision: 1,
      subjectId: "subject.p",
    },
    architecture: {
      artifactId: "architecture-" + "a".repeat(64),
      fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
      captureSchema: "architecture-capture/4.0" as const,
    },
  };
}

function attachmentPut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  overrides: {
    attachmentId?: string;
    fileId?: string;
    predecessorAttachmentRevision?: number;
    role?: { id: string; version: number };
    target?: { elementId: string; elementKind: "PartDefinition" | "PartUsage" };
    declaredAgainst?: ReturnType<typeof declaredAgainst>;
  } = {},
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "attachment_put" as const,
      attachmentId: overrides.attachmentId ?? "att-rail",
      fileId: overrides.fileId ?? "file-rail",
      role: overrides.role ?? { id: "design-source", version: 1 },
      target: overrides.target ?? {
        elementId: "def-rail",
        elementKind: "PartDefinition" as const,
      },
      declaredAgainst: overrides.declaredAgainst ?? declaredAgainst(),
      ...(overrides.predecessorAttachmentRevision !== undefined
        ? {
          predecessorAttachmentRevision: overrides.predecessorAttachmentRevision,
        }
        : {}),
    },
  };
}

function attachmentDetach(
  mutationId: string,
  expectedWorkspaceRevision: number,
  activeAttachmentRevision: number,
  attachmentId = "att-rail",
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "attachment_detach" as const,
      attachmentId,
      activeAttachmentRevision,
    },
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
    resourceName?: string;
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
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: mutation.resourceName ?? mutation.logicalName,
        mimeType: "text/plain",
        byteCount: 1,
      }),
    },
  };
}

async function seedListedAttachments() {
  let state = (await seedFile()).state;
  state = (await apply(
    state,
    filePut("f2", 2, {
      fileId: "file-b",
      moduleId: "mod-a",
      logicalName: "b.py",
      role: "script",
      resourceName: "b.py",
    }),
  )).state;
  state = (await apply(state, attachmentPut("a1", 3))).state;
  state = (await apply(
    state,
    attachmentPut("a2", 4, {
      attachmentId: "att-b",
      fileId: "file-b",
      target: { elementId: "def-other", elementKind: "PartDefinition" },
    }),
  )).state;
  state = (await apply(
    state,
    attachmentPut("a3", 5, {
      attachmentId: "att-usage",
      fileId: "file-rail",
      role: { id: "behavior-source", version: 1 },
      target: { elementId: "usage-left", elementKind: "PartUsage" },
    }),
  )).state;
  return state;
}

async function seedFile() {
  const moduleEvent = await apply(
    emptyProjectSourceWorkspace(PROJECT),
    {
      projectId: PROJECT,
      mutationId: "m1",
      expectedWorkspaceRevision: 0,
      mutation: {
        kind: "module_put" as const,
        moduleId: "mod-a",
        slug: "mech",
        displayName: "Mech",
      },
    },
  );
  const fileEvent = await apply(
    moduleEvent.state,
    filePut("f1", 1, {
      fileId: "file-rail",
      moduleId: "mod-a",
      logicalName: "rail.py",
      role: "script",
    }),
  );
  return {
    state: fileEvent.state,
    eventFromStart: [moduleEvent.event, fileEvent.event],
  };
}

async function apply(
  state: ProjectSourceWorkspaceState,
  command: unknown,
) {
  return await applyProjectSourceWorkspaceCommand(state, command);
}

function headAttachment(state: ProjectSourceWorkspaceState, attachmentId: string) {
  const attachment = state.attachments.get(attachmentId)!;
  const head = attachment.revisions.get(attachment.headRevision)!;
  if (head.kind !== "content") throw new Error("expected content");
  return head as ProjectSourceAttachmentRevision;
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

async function asV3Event(
  event: ProjectSourceWorkspaceEventV4,
): Promise<ProjectSourceWorkspaceEventV3> {
  const mutation = event.mutation;
  if (mutation.kind === "attachment_recross") {
    throw new Error("attachment_recross cannot be represented by V3.");
  }
  const { fingerprint: _ignored, ...body } = event;
  const legacyBody: ProjectSourceWorkspaceEventBodyV3 = {
    ...body,
    schemaVersion: PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA_V3,
    mutation,
  };
  return {
    ...legacyBody,
    fingerprint: await eventBodyFingerprint(legacyBody),
  };
}

async function assertCode(
  promise: Promise<unknown>,
  code: ProjectSourceWorkspaceError["code"],
) {
  const error = await assertRejects(() => promise, ProjectSourceWorkspaceError);
  assertEquals(error.code, code);
}
