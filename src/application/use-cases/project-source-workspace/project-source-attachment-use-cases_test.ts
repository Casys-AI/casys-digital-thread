import { assertEquals, assertRejects } from "@std/assert";
import {
  persistAgentResourceText,
  sampleAgentResourceReference,
} from "../../../testing/agent-resource-test-support.ts";
import { FileProjectSourceWorkspaceStore } from "../../../adapters/project-source-workspace/file-project-source-workspace-store.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import { FixedProjectSourceAttachmentRoleCatalog } from "../../../adapters/project-source-workspace/fixed-project-source-attachment-role-catalog.ts";
import {
  ProjectSourceWorkspaceApplicationError,
  ProjectSourceWorkspaceUseCases,
} from "./project-source-workspace-use-cases.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { OpenedProductStructure } from "../../ports/out/product-navigation/product-structure-traversal.ts";
import type { ProductStructureTraversal } from "../../ports/out/product-navigation/product-structure-traversal.ts";
import type { AgentResourceReference } from "../../../domain/resource/agent-resource-capture.ts";
import { ProjectSourceWorkspaceError } from "../../../domain/project-source-workspace/types.ts";

const PROJECT = "generic-project";
const SNAPSHOT_ID = "thread:p:r1";
const SUBJECT = "subject.p";
const ARCHITECTURE_ID = "architecture-" + "a".repeat(64);
const ARCHITECTURE_FP = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};
const LATER_SNAPSHOT_ID = "thread:p:r2";
const LATER_ARCHITECTURE_ID = "architecture-" + "b".repeat(64);
const LATER_ARCHITECTURE_FP = {
  algorithm: "sha256" as const,
  digest: "b".repeat(64),
};

Deno.test("attachment put recrosses tip, snapshot, V4 architecture, element and role", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-att-uc-" });
  try {
    const contacts = counters();
    const useCases = await seeded(root, contacts);
    const put = await useCases.putAttachment(attachmentPut(2));
    assertEquals(put.workspaceRevision, 3);
    assertEquals(put.activeAttachmentCount, 1);
    assertEquals(put.grants, "none");
    assertEquals(contacts.snapshots, 1);
    assertEquals(contacts.opens, 1);
    assertEquals(contacts.roles, 1);
    const read = await useCases.readAttachment({
      projectId: PROJECT,
      workspaceRevision: 3,
      attachmentId: "att-rail",
      attachmentRevision: 1,
    });
    assertEquals(read.sourceStatus, "active");
    assertEquals(read.record.kind, "content");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("accepted attachment mutationId replay skips every external recross", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-att-replay-" });
  try {
    const contacts = counters();
    const useCases = await seeded(root, contacts);
    await useCases.putAttachment(attachmentPut(2));
    assertEquals(contacts.opens, 1);
    const replay = await useCases.putAttachment(attachmentPut(2));
    assertEquals(replay.workspaceRevision, 3);
    assertEquals(contacts.opens, 1);
    assertEquals(contacts.snapshots, 1);
    assertEquals(contacts.roles, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("attachment recross atomically creates one batch event from persisted public intent and replays without external recross", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-att-recross-" });
  try {
    const persisted = await persistAgentResourceText(`${root}/cas`, {
      name: "rail.py",
      mimeType: "text/plain",
      text: "print(1)\n",
    });
    const workspace = new FileProjectSourceWorkspaceStore(`${root}/ws`);
    await seedWorkspace(workspace, persisted.reference);
    const original = attachmentCases(workspace, persisted.reference, counters());
    await original.putAttachment(attachmentPut(2));
    await original.putAttachment(attachmentPut(3, {
      mutationId: "a2",
      attachmentId: "att-usage",
      target: { elementId: "usage-rail", elementKind: "PartUsage" },
    }));
    const contacts = counters();
    const current = attachmentCases(workspace, persisted.reference, contacts, {
      project: projectSnapshot({
        threadSnapshots: [{
          snapshotId: LATER_SNAPSHOT_ID,
          revision: 2,
          subjectId: SUBJECT,
        }],
      }),
      snapshot: {
        id: LATER_SNAPSHOT_ID,
        revision: 2,
        subject: { id: SUBJECT },
      } as ThreadSnapshot,
      opened: {
        ...openedStructure(),
        architectureArtifactId: LATER_ARCHITECTURE_ID,
        architectureFingerprint: LATER_ARCHITECTURE_FP,
      },
    });
    const request = {
      projectId: PROJECT,
      mutationId: "recross-1",
      expectedWorkspaceRevision: 4,
      attachments: [
        { attachmentId: "att-usage", activeAttachmentRevision: 1 },
        { attachmentId: "att-rail", activeAttachmentRevision: 1 },
      ],
    };
    const recross = await current.recrossAttachments(request);
    assertEquals(recross.workspaceRevision, 5);
    assertEquals(recross.declaredAgainst.thread.snapshotId, LATER_SNAPSHOT_ID);
    assertEquals(
      recross.attachments.map((attachment) => attachment.attachmentId),
      ["att-rail", "att-usage"],
    );
    assertEquals(
      recross.attachments.map((attachment) => attachment.attachmentRevision),
      [2, 2],
    );
    const state = await workspace.load(PROJECT);
    assertEquals(state.workspaceRevision, 5);
    assertEquals(state.attachments.get("att-rail")?.headRevision, 2);
    assertEquals(state.attachments.get("att-usage")?.headRevision, 2);
    const accepted = state.mutations.get("recross-1")?.event;
    assertEquals(accepted?.mutation.kind, "attachment_recross");
    if (accepted?.mutation.kind !== "attachment_recross") {
      throw new Error("Expected the persisted recross event.");
    }
    assertEquals(accepted.mutation.intent, {
      expectedWorkspaceRevision: 4,
      attachments: [
        { attachmentId: "att-rail", activeAttachmentRevision: 1 },
        { attachmentId: "att-usage", activeAttachmentRevision: 1 },
      ],
    });
    assertEquals(accepted.mutation.successors.length, 2);
    assertEquals(contacts.snapshots, 1);
    assertEquals(contacts.opens, 1);
    assertEquals(contacts.roles, 2);
    const replay = await current.recrossAttachments(request);
    assertEquals(replay.workspaceRevision, 5);
    assertEquals(contacts.snapshots, 1);
    assertEquals(contacts.opens, 1);
    assertEquals(contacts.roles, 2);
    await assertApp(
      current.recrossAttachments({
        ...request,
        mutationId: "recross-exact",
        expectedWorkspaceRevision: 5,
        attachments: [{ attachmentId: "att-rail", activeAttachmentRevision: 2 }],
      }),
      "attachment_already_exact",
    );
    assertEquals((await workspace.load(PROJECT)).workspaceRevision, 5);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("attachment recross batch validates every target before persisting any successor", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-att-recross-atomic-" });
  try {
    const persisted = await persistAgentResourceText(`${root}/cas`, {
      name: "rail.py",
      mimeType: "text/plain",
      text: "print(1)\n",
    });
    const workspace = new FileProjectSourceWorkspaceStore(`${root}/ws`);
    await seedWorkspace(workspace, persisted.reference);
    const original = attachmentCases(workspace, persisted.reference, counters());
    await original.putAttachment(attachmentPut(2));
    await original.putAttachment(attachmentPut(3, {
      mutationId: "a2",
      attachmentId: "att-usage",
      target: { elementId: "usage-rail", elementKind: "PartUsage" },
    }));
    const current = attachmentCases(workspace, persisted.reference, counters(), {
      project: projectSnapshot({
        threadSnapshots: [{
          snapshotId: LATER_SNAPSHOT_ID,
          revision: 2,
          subjectId: SUBJECT,
        }],
      }),
      snapshot: {
        id: LATER_SNAPSHOT_ID,
        revision: 2,
        subject: { id: SUBJECT },
      } as ThreadSnapshot,
      opened: {
        ...openedStructure(),
        architectureArtifactId: LATER_ARCHITECTURE_ID,
        architectureFingerprint: LATER_ARCHITECTURE_FP,
        hasElement: (target) => target.elementId === "def-rail",
      },
    });
    await assertApp(
      current.recrossAttachments({
        projectId: PROJECT,
        mutationId: "recross-atomic",
        expectedWorkspaceRevision: 4,
        attachments: [
          { attachmentId: "att-rail", activeAttachmentRevision: 1 },
          { attachmentId: "att-usage", activeAttachmentRevision: 1 },
        ],
      }),
      "target_not_found",
    );
    const state = await workspace.load(PROJECT);
    assertEquals(state.workspaceRevision, 4);
    assertEquals(state.attachments.get("att-rail")?.headRevision, 1);
    assertEquals(state.attachments.get("att-usage")?.headRevision, 1);
    assertEquals(state.mutations.has("recross-atomic"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("attachment recross public parser rejects 33 ids before any external read", async () => {
  let projectReads = 0;
  let workspaceReads = 0;
  const workspace = rejectingWorkspace(() => workspaceReads += 1);
  const useCases = attachmentCases(
    workspace,
    sampleAgentResourceReference({ name: "unused.py" }),
    counters(),
    {
      projectReader: () => {
        projectReads += 1;
        return Promise.resolve(projectSnapshot());
      },
    },
  );
  const error = await assertRejects(
    () =>
      useCases.recrossAttachments({
        projectId: PROJECT,
        mutationId: "recross-too-many",
        expectedWorkspaceRevision: 0,
        attachments: Array.from({ length: 33 }, (_, index) => ({
          attachmentId: `att-${String(index).padStart(2, "0")}`,
          activeAttachmentRevision: 1,
        })),
      }),
    ProjectSourceWorkspaceError,
  );
  assertEquals(error.code, "bound_exceeded");
  assertEquals(projectReads, 0);
  assertEquals(workspaceReads, 0);
});

Deno.test("attachment recross rejects an orphan project before loading its workspace", async () => {
  let projectReads = 0;
  let workspaceReads = 0;
  const useCases = attachmentCases(
    rejectingWorkspace(() => workspaceReads += 1),
    sampleAgentResourceReference({ name: "unused.py" }),
    counters(),
    {
      projectReader: () => {
        projectReads += 1;
        return Promise.resolve(undefined);
      },
    },
  );
  const error = await assertRejects(
    () =>
      useCases.recrossAttachments({
        projectId: PROJECT,
        mutationId: "recross-orphan",
        expectedWorkspaceRevision: 0,
        attachments: [{ attachmentId: "att-rail", activeAttachmentRevision: 1 }],
      }),
    ProjectSourceWorkspaceApplicationError,
  );
  assertEquals(error.code, "project_not_found");
  assertEquals(projectReads, 1);
  assertEquals(workspaceReads, 0);
});

Deno.test("attachment detach never opens traversal or the role catalog", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-att-detach-" });
  try {
    const contacts = counters();
    const useCases = await seeded(root, contacts);
    await useCases.putAttachment(attachmentPut(2));
    contacts.opens = 0;
    contacts.snapshots = 0;
    contacts.roles = 0;
    const detached = await useCases.detachAttachment({
      projectId: PROJECT,
      mutationId: "d1",
      expectedWorkspaceRevision: 3,
      mutation: {
        kind: "attachment_detach",
        attachmentId: "att-rail",
        activeAttachmentRevision: 1,
      },
    });
    assertEquals(detached.activeAttachmentCount, 0);
    assertEquals(contacts.opens, 0);
    assertEquals(contacts.snapshots, 0);
    assertEquals(contacts.roles, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("attachment put fails closed on tip, declared, snapshot, architecture, target and role", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-att-fail-" });
  try {
    const persisted = await persistAgentResourceText(`${root}/cas`, {
      name: "rail.py",
      mimeType: "text/plain",
      text: "print(1)\n",
    });
    const workspace = new FileProjectSourceWorkspaceStore(`${root}/ws`);
    const contacts = counters();
    const base = await seedWorkspace(workspace, persisted.reference);
    await assertApp(
      attachmentCases(workspace, persisted.reference, contacts, {
        project: projectSnapshot({ threadSnapshots: [] }),
      }).putAttachment(attachmentPut(2)),
      "thread_tip_unresolved",
    );
    await assertApp(
      attachmentCases(workspace, persisted.reference, contacts).putAttachment(
        attachmentPut(2, {
          declaredAgainst: declaredAgainst({
            thread: {
              snapshotId: "thread:other",
              revision: 9,
              subjectId: SUBJECT,
            },
          }),
        }),
      ),
      "declared_against_mismatch",
    );
    await assertApp(
      attachmentCases(workspace, persisted.reference, contacts, {
        snapshot: undefined,
      }).putAttachment(attachmentPut(2)),
      "thread_snapshot_mismatch",
    );
    await assertApp(
      attachmentCases(workspace, persisted.reference, contacts, {
        opened: undefined,
      }).putAttachment(attachmentPut(2)),
      "architecture_mismatch",
    );
    await assertApp(
      attachmentCases(workspace, persisted.reference, contacts, {
        hasElement: false,
      }).putAttachment(attachmentPut(2)),
      "target_not_found",
    );
    await assertApp(
      attachmentCases(workspace, persisted.reference, contacts, {
        acceptRole: false,
      }).putAttachment(attachmentPut(2)),
      "role_not_accepted",
    );
    assertEquals(base.workspaceRevision, 2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("attachment list stays revision-anchored after a later mutation", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-att-list-" });
  try {
    const contacts = counters();
    const useCases = await seeded(root, contacts);
    await useCases.putAttachment(attachmentPut(2));
    await useCases.putModule({
      projectId: PROJECT,
      mutationId: "m2",
      expectedWorkspaceRevision: 3,
      mutation: {
        kind: "module_put",
        moduleId: "mod-b",
        slug: "drive",
        displayName: "Drive",
      },
    });
    const listed = await useCases.listAttachments({
      projectId: PROJECT,
      workspaceRevision: 3,
      fileId: "file-rail",
    });
    assertEquals(listed.workspaceRevision, 3);
    assertEquals(listed.entries.length, 1);
    assertEquals(listed.grants, "none");
    const unfiltered = await useCases.listAttachments({
      projectId: PROJECT,
      workspaceRevision: 3,
    });
    assertEquals(unfiltered.workspaceRevision, 3);
    assertEquals(unfiltered.entries.length, 1);
    assertEquals(unfiltered.entries[0]?.attachmentId, "att-rail");
    assertEquals(unfiltered.grants, "none");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function counters() {
  return { snapshots: 0, opens: 0, roles: 0 };
}

async function seeded(
  root: string,
  contacts: ReturnType<typeof counters>,
) {
  const persisted = await persistAgentResourceText(`${root}/cas`, {
    name: "rail.py",
    mimeType: "text/plain",
    text: "print(1)\n",
  });
  const workspace = new FileProjectSourceWorkspaceStore(`${root}/ws`);
  await seedWorkspace(workspace, persisted.reference);
  return attachmentCases(workspace, persisted.reference, contacts);
}

async function seedWorkspace(
  workspace: FileProjectSourceWorkspaceStore,
  resourceRef: AgentResourceReference,
) {
  const useCases = attachmentCases(workspace, resourceRef, counters());
  await useCases.putModule({
    projectId: PROJECT,
    mutationId: "m1",
    expectedWorkspaceRevision: 0,
    mutation: {
      kind: "module_put",
      moduleId: "mod-a",
      slug: "mech",
      displayName: "Mech",
    },
  });
  return await useCases.putFile({
    projectId: PROJECT,
    mutationId: "f1",
    expectedWorkspaceRevision: 1,
    mutation: {
      kind: "file_put",
      fileId: "file-rail",
      moduleId: "mod-a",
      logicalName: "rail.py",
      role: "script",
      dependencies: [],
      resourceRef,
    },
  });
}

function attachmentCases(
  workspace: ProjectSourceWorkspaceEventStore,
  resourceRef: AgentResourceReference,
  contacts: ReturnType<typeof counters>,
  overrides: {
    project?: EngineeringProjectSnapshot;
    projectReader?: () => Promise<unknown>;
    snapshot?: ThreadSnapshot | undefined;
    opened?: OpenedProductStructure | undefined;
    hasElement?: boolean;
    acceptRole?: boolean;
  } = {},
) {
  void resourceRef;
  const opened = "opened" in overrides
    ? overrides.opened
    : openedStructure(overrides.hasElement ?? true);
  const traversal: ProductStructureTraversal = {
    open: () => {
      contacts.opens += 1;
      return Promise.resolve(opened);
    },
  };
  return new ProjectSourceWorkspaceUseCases({
    projects: {
      get: () =>
        overrides.projectReader?.() ??
          Promise.resolve(overrides.project ?? projectSnapshot()),
    },
    workspace,
    resources: { reopenExact: () => Promise.resolve({}) },
    snapshots: {
      get: () => {
        contacts.snapshots += 1;
        return Promise.resolve(
          "snapshot" in overrides ? overrides.snapshot : threadSnapshot(),
        );
      },
    },
    traversal,
    roles: {
      accept: (role, target) => {
        contacts.roles += 1;
        if (overrides.acceptRole === false) return false;
        return new FixedProjectSourceAttachmentRoleCatalog().accept(
          role,
          target,
        );
      },
    },
  });
}

function rejectingWorkspace(
  onRead: () => void,
): ProjectSourceWorkspaceEventStore {
  return {
    load: () => {
      onRead();
      return Promise.reject(new Error("workspace must not be read"));
    },
    loadAt: () => {
      onRead();
      return Promise.reject(new Error("workspace must not be read"));
    },
    loadAtFresh: () => {
      onRead();
      return Promise.reject(new Error("workspace must not be read"));
    },
    append: () => Promise.reject(new Error("workspace must not be written")),
  };
}

function projectSnapshot(
  overrides: {
    threadSnapshots?: EngineeringProjectSnapshot["threadSnapshots"];
  } = {},
): EngineeringProjectSnapshot {
  return {
    project: { id: PROJECT, name: "P", subjectId: SUBJECT },
    threadSnapshots: overrides.threadSnapshots ?? [{
      snapshotId: SNAPSHOT_ID,
      revision: 1,
      subjectId: SUBJECT,
    }],
  } as EngineeringProjectSnapshot;
}

function threadSnapshot(): ThreadSnapshot {
  return {
    id: SNAPSHOT_ID,
    revision: 1,
    subject: { id: SUBJECT },
  } as ThreadSnapshot;
}

function openedStructure(hasElement = true): OpenedProductStructure {
  return {
    architectureArtifactId: ARCHITECTURE_ID,
    architectureFingerprint: ARCHITECTURE_FP,
    root: () => undefined,
    childrenOfRoot: () => [],
    childrenOf: () => [],
    path: () => undefined,
    neighborhood: () => ({ siblings: [], children: [] }),
    element: () => undefined,
    searchElements: () => [],
    pageOccurrences: () => ({ items: [], nextOffset: null }),
    hasDefinition: () => false,
    hasElement: () => hasElement,
    typedDefinition: () => undefined,
  };
}

function declaredAgainst(
  overrides: {
    thread?: { snapshotId: string; revision: number; subjectId: string };
  } = {},
) {
  return {
    thread: overrides.thread ?? {
      snapshotId: SNAPSHOT_ID,
      revision: 1,
      subjectId: SUBJECT,
    },
    architecture: {
      artifactId: ARCHITECTURE_ID,
      fingerprint: ARCHITECTURE_FP,
      captureSchema: "architecture-capture/4.0" as const,
    },
  };
}

function attachmentPut(
  expectedWorkspaceRevision: number,
  overrides: {
    declaredAgainst?: ReturnType<typeof declaredAgainst>;
    mutationId?: string;
    attachmentId?: string;
    target?: { elementId: string; elementKind: "PartDefinition" | "PartUsage" };
  } = {},
) {
  return {
    projectId: PROJECT,
    mutationId: overrides.mutationId ?? "a1",
    expectedWorkspaceRevision,
    mutation: {
      kind: "attachment_put" as const,
      attachmentId: overrides.attachmentId ?? "att-rail",
      fileId: "file-rail",
      role: { id: "design-source", version: 1 },
      target: overrides.target ?? {
        elementId: "def-rail",
        elementKind: "PartDefinition" as const,
      },
      declaredAgainst: overrides.declaredAgainst ?? declaredAgainst(),
    },
  };
}

async function assertApp(
  promise: Promise<unknown>,
  code: ProjectSourceWorkspaceApplicationError["code"],
) {
  const error = await assertRejects(
    () => promise,
    ProjectSourceWorkspaceApplicationError,
  );
  assertEquals(error.code, code);
}
