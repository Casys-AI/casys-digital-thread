import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { OpenedProductStructure } from "../../ports/out/product-navigation/product-structure-traversal.ts";
import type { ProductNavigationNode } from "../../ports/in/product-navigation/product-navigation-read-model.ts";
import type { ProductNavigationEvidenceAttachmentFacts } from "../../ports/out/product-navigation/product-navigation-evidence-attachment-reader.ts";
import { sampleAgentResourceReference } from "../../../testing/agent-resource-test-support.ts";
import { ProjectSourceWorkspaceAuthoringAttachmentReader } from "../../../adapters/project-source-workspace/product-navigation-authoring-attachment-reader.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../../domain/project-source-workspace/transitions.ts";
import {
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceState,
} from "../../../domain/project-source-workspace/types.ts";
import { ProjectProductNavigation } from "./project-product-navigation.ts";

const PROJECT = "project.slider";
const SNAPSHOT = "thread:slider:r4";
const SUBJECT = "subject.slider";
const ARCHITECTURE_ID = "architecture-" + "1".repeat(64);
const ARCHITECTURE_FP = { algorithm: "sha256" as const, digest: "1".repeat(64) };

Deno.test("authoring attachments keep PartDefinition and PartUsage exact and never reduce usage to definition", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const definition = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-definition", id: "def-system" },
  });
  assertEquals(definition.status, "observed");
  assertEquals(definition.grants, "none");
  assertEquals(definition.attachments.map((item) => item.target), [
    { elementId: "def-system", elementKind: "PartDefinition" },
    { elementId: "def-system", elementKind: "PartDefinition" },
  ]);
  assertEquals(
    definition.attachments.some((item) => item.target.elementId === "def-rail"),
    false,
  );
  const usage = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
  });
  assertEquals(usage.attachments.map((item) => item.attachmentId), ["att-usage"]);
  assertEquals(usage.attachments[0]?.target, {
    elementId: "usage-left",
    elementKind: "PartUsage",
  });
  const rail = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-definition", id: "def-rail" },
  });
  assertEquals(rail.attachments.map((item) => item.attachmentId), ["att-rail-def"]);
  assertEquals(rail.attachments[0]?.target, {
    elementId: "def-rail",
    elementKind: "PartDefinition",
  });
});

Deno.test("authoring attachments expose successor heads, omit detached, and keep source-removed", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const definition = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-definition", id: "def-system" },
  });
  const successor = definition.attachments.find((item) =>
    item.attachmentId === "att-a"
  );
  assertEquals(successor?.attachmentRevision, 2);
  assertEquals(successor?.role, { id: "behavior-source", version: 1 });
  assertEquals(
    definition.attachments.some((item) => item.attachmentId === "att-detached"),
    false,
  );
  const removed = definition.attachments.find((item) =>
    item.attachmentId === "att-removed"
  );
  assertEquals(removed?.sourceStatus, "source-removed");
  assertEquals(removed?.fileHeadRevision, 2);
});

Deno.test("authoring attachments publish exact-basis versus different-basis without repairing the capture", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const definition = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-definition", id: "def-system" },
  });
  const exact = definition.attachments.find((item) => item.attachmentId === "att-a");
  const different = definition.attachments.find((item) =>
    item.attachmentId === "att-removed"
  );
  assertEquals(exact?.basisStatus, "exact-basis");
  assertEquals(different?.basisStatus, "different-basis");
  assertEquals(different?.declaredAgainst.thread.snapshotId, "thread:other");
});

Deno.test("authoring attachments pin pagination to the first-call workspace revision", async () => {
  const seeded = await seedAuthoringWorkspace();
  const spy = spyWorkspace(seeded.head, seeded.revisions);
  const navigation = navigationWith(seeded.head, seeded.revisions, spy.store);
  const first = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-definition", id: "def-system" },
    pageSize: 1,
  });
  assertEquals(first.workspaceRevision, seeded.head.workspaceRevision);
  assertEquals(first.attachments.map((item) => item.attachmentId), ["att-a"]);
  assertEquals(first.nextCursor !== null, true);
  const advanced = await apply(
    seeded.head,
    modulePut("later", seeded.head.workspaceRevision, "mod-later", "later"),
  );
  spy.head = advanced.state;
  spy.revisions.set(advanced.state.workspaceRevision, advanced.state);
  const second = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-definition", id: "def-system" },
    pageSize: 1,
    cursor: first.nextCursor ?? undefined,
  });
  assertEquals(second.workspaceRevision, first.workspaceRevision);
  assertEquals(second.attachments.map((item) => item.attachmentId), [
    "att-removed",
  ]);
  assertEquals(
    spy.freshRevisions.includes(first.workspaceRevision ?? -1),
    true,
  );
  assertEquals(
    spy.freshRevisions.includes(advanced.state.workspaceRevision),
    false,
  );
});

Deno.test("authoring attachments refuse a tampered or foreign-filter cursor", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const first = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-definition", id: "def-system" },
    pageSize: 1,
  });
  const sealed = first.nextCursor!;
  const [prefix, payload, mac] = sealed.split(".");
  const flipped = mac![0] === "A" ? "B" : "A";
  await assertRejects(
    () =>
      navigation.authoringAttachments({
        projectId: PROJECT,
        node: { kind: "part-definition", id: "def-system" },
        pageSize: 1,
        cursor: `${prefix}.${payload}.${flipped}${mac!.slice(1)}`,
      }),
    ProjectSourceWorkspaceError,
    "not a valid opaque cursor",
  );
  const domainCursor = btoa(JSON.stringify({
    kind: "attachment-list",
    workspaceRevision: first.workspaceRevision,
    filter: {
      target: { elementId: "def-system", elementKind: "PartDefinition" },
    },
  }));
  await assertRejects(
    () =>
      navigation.authoringAttachments({
        projectId: PROJECT,
        node: { kind: "part-definition", id: "def-system" },
        pageSize: 1,
        cursor: domainCursor,
      }),
    ProjectSourceWorkspaceError,
    "not a valid opaque cursor",
  );
  await assertRejects(
    () =>
      navigation.authoringAttachments({
        projectId: PROJECT,
        node: { kind: "part-definition", id: "def-system" },
        cursor: "not-a-cursor",
      }),
    ProjectSourceWorkspaceError,
    "not a valid opaque cursor",
  );
});

Deno.test("authoring attachments stay out of evidence and admission; an exact attachment exposes a read-only closure", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const authoring = await navigation.authoringAttachments({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
  });
  assertEquals(authoring.grants, "none");
  assertEquals(authoring.attachments.map((item) => item.fileId), ["file-usage"]);
  const context = await navigation.context({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
  });
  assertEquals(context.attachments.sources.map((item) => item.id), [
    "source.cad@1",
  ]);
  assertEquals(
    context.attachments.sources.some((item) => item.id.includes("file-usage")),
    false,
  );
  const closure = await navigation.sourceClosure({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
    workspaceRevision: authoring.workspaceRevision ?? seeded.head.workspaceRevision,
    attachmentId: "att-usage",
    attachmentRevision: 1,
  });
  assertEquals(closure.status, "observed");
  assertEquals(
    closure.files.map((file) => `${file.fileId}@${file.fileRevision}`),
    ["file-usage@1"],
  );
  assertEquals(closure.attachmentId, "att-usage");
  assertEquals(closure.attachmentRevision, 1);
});

function navigationWith(
  head: ProjectSourceWorkspaceState,
  revisions: Map<number, ProjectSourceWorkspaceState>,
  store?: ReturnType<typeof spyWorkspace>["store"],
) {
  const workspace = store ?? spyWorkspace(head, revisions).store;
  return new ProjectProductNavigation({
    projects: {
      get: (projectId: string) =>
        Promise.resolve(projectId === PROJECT ? project() : undefined),
    },
    snapshots: {
      get: (snapshotId: string) =>
        Promise.resolve(snapshotId === SNAPSHOT ? thread() : undefined),
    },
    traversal: { open: () => Promise.resolve(opened()) },
    workspace,
    evidenceAttachments: { read: () => Promise.resolve(attachmentFacts()) },
    authoringAttachments: new ProjectSourceWorkspaceAuthoringAttachmentReader(
      workspace,
    ),
  });
}

function spyWorkspace(
  head: ProjectSourceWorkspaceState,
  revisions: Map<number, ProjectSourceWorkspaceState>,
) {
  const freshRevisions: number[] = [];
  const handle = {
    head,
    revisions,
    freshRevisions,
    store: {
      load: (_projectId: string) => Promise.resolve(handle.head),
      loadAtFresh: (_projectId: string, workspaceRevision: number) => {
        freshRevisions.push(workspaceRevision);
        const named = handle.revisions.get(workspaceRevision);
        if (!named) {
          throw new ProjectSourceWorkspaceError(
            "revision_not_found",
            `Workspace revision ${workspaceRevision} is not present.`,
          );
        }
        return Promise.resolve(named);
      },
    },
  };
  return handle;
}

async function seedAuthoringWorkspace() {
  const revisions = new Map<number, ProjectSourceWorkspaceState>();
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = record(
    revisions,
    await apply(state, modulePut("m1", 0, "mod-a", "mech")),
  );
  state = record(
    revisions,
    await apply(state, filePut("f-a", 1, "file-a", "a.py")),
  );
  state = record(
    revisions,
    await apply(state, filePut("f-removed", 2, "file-removed", "gone.py")),
  );
  state = record(
    revisions,
    await apply(state, filePut("f-usage", 3, "file-usage", "usage.py")),
  );
  state = record(
    revisions,
    await apply(state, filePut("f-rail", 4, "file-rail", "rail.py")),
  );
  state = record(
    revisions,
    await apply(
      state,
      attachmentPut("a1", 5, {
        attachmentId: "att-a",
        fileId: "file-a",
        target: { elementId: "def-system", elementKind: "PartDefinition" },
      }),
    ),
  );
  state = record(
    revisions,
    await apply(
      state,
      attachmentPut("a-removed", 6, {
        attachmentId: "att-removed",
        fileId: "file-removed",
        target: { elementId: "def-system", elementKind: "PartDefinition" },
        declaredAgainst: declaredAgainst({
          thread: { snapshotId: "thread:other", revision: 9, subjectId: SUBJECT },
        }),
      }),
    ),
  );
  state = record(
    revisions,
    await apply(
      state,
      attachmentPut("a-usage", 7, {
        attachmentId: "att-usage",
        fileId: "file-usage",
        target: { elementId: "usage-left", elementKind: "PartUsage" },
      }),
    ),
  );
  state = record(
    revisions,
    await apply(
      state,
      attachmentPut("a-rail", 8, {
        attachmentId: "att-rail-def",
        fileId: "file-rail",
        target: { elementId: "def-rail", elementKind: "PartDefinition" },
      }),
    ),
  );
  state = record(
    revisions,
    await apply(
      state,
      attachmentPut("a-succ", 9, {
        attachmentId: "att-a",
        fileId: "file-a",
        predecessorAttachmentRevision: 1,
        role: { id: "behavior-source", version: 1 },
        target: { elementId: "def-system", elementKind: "PartDefinition" },
      }),
    ),
  );
  state = record(
    revisions,
    await apply(
      state,
      attachmentPut("a-detached", 10, {
        attachmentId: "att-detached",
        fileId: "file-a",
        target: { elementId: "def-system", elementKind: "PartDefinition" },
      }),
    ),
  );
  state = record(
    revisions,
    await apply(state, {
      projectId: PROJECT,
      mutationId: "detach",
      expectedWorkspaceRevision: 11,
      mutation: {
        kind: "attachment_detach",
        attachmentId: "att-detached",
        activeAttachmentRevision: 1,
      },
    }),
  );
  state = record(
    revisions,
    await apply(state, {
      projectId: PROJECT,
      mutationId: "rm",
      expectedWorkspaceRevision: 12,
      mutation: {
        kind: "file_remove",
        fileId: "file-removed",
        activeFileRevision: 1,
      },
    }),
  );
  return { head: state, revisions };
}

function record(
  revisions: Map<number, ProjectSourceWorkspaceState>,
  transition: { state: ProjectSourceWorkspaceState },
) {
  revisions.set(transition.state.workspaceRevision, transition.state);
  return transition.state;
}

function declaredAgainst(
  overrides: {
    thread?: { snapshotId: string; revision: number; subjectId: string };
  } = {},
) {
  return {
    thread: overrides.thread ?? {
      snapshotId: SNAPSHOT,
      revision: 4,
      subjectId: SUBJECT,
    },
    architecture: {
      artifactId: ARCHITECTURE_ID,
      fingerprint: ARCHITECTURE_FP,
      captureSchema: "architecture-capture/4.0" as const,
    },
  };
}

function modulePut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  moduleId: string,
  slug: string,
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "module_put" as const,
      moduleId,
      slug,
      displayName: slug,
    },
  };
}

function filePut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  fileId: string,
  logicalName: string,
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "file_put" as const,
      fileId,
      moduleId: "mod-a",
      logicalName,
      role: "script",
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: logicalName,
        mimeType: "text/plain",
        byteCount: 1,
      }),
    },
  };
}

function attachmentPut(
  mutationId: string,
  expectedWorkspaceRevision: number,
  overrides: {
    attachmentId: string;
    fileId: string;
    predecessorAttachmentRevision?: number;
    role?: { id: string; version: number };
    target: { elementId: string; elementKind: "PartDefinition" | "PartUsage" };
    declaredAgainst?: ReturnType<typeof declaredAgainst>;
  },
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision,
    mutation: {
      kind: "attachment_put" as const,
      attachmentId: overrides.attachmentId,
      fileId: overrides.fileId,
      role: overrides.role ?? { id: "design-source", version: 1 },
      target: overrides.target,
      declaredAgainst: overrides.declaredAgainst ?? declaredAgainst(),
      ...(overrides.predecessorAttachmentRevision === undefined ? {} : {
        predecessorAttachmentRevision: overrides.predecessorAttachmentRevision,
      }),
    },
  };
}

function apply(
  state: ProjectSourceWorkspaceState,
  command: unknown,
) {
  return applyProjectSourceWorkspaceCommand(state, command);
}

function project(): EngineeringProjectSnapshot {
  return {
    project: { id: PROJECT, name: "Slider", subjectId: SUBJECT },
    threadSnapshots: [{
      snapshotId: SNAPSHOT,
      revision: 4,
      subjectId: SUBJECT,
    }],
  } as unknown as EngineeringProjectSnapshot;
}

function thread(): ThreadSnapshot {
  return {
    id: SNAPSHOT,
    revision: 4,
    subject: { id: SUBJECT },
  } as ThreadSnapshot;
}

function opened(): OpenedProductStructure {
  const root: ProductNavigationNode = {
    kind: "part-definition",
    id: "def-system",
    label: "Slider",
    definitionId: "def-system",
    path: [],
    expandable: true,
  };
  const left: ProductNavigationNode = {
    kind: "part-usage",
    id: "usage-left",
    label: "left_rail",
    definitionId: "def-rail",
    usageId: "usage-left",
    path: ["usage-left"],
    expandable: true,
  };
  return {
    architectureArtifactId: ARCHITECTURE_ID,
    architectureFingerprint: ARCHITECTURE_FP,
    root: () => root,
    childrenOf: () => [left],
    path: (usageIds) =>
      usageIds.length === 1 && usageIds[0] === "usage-left" ? [root, left] : undefined,
    locate: (id) => {
      if (id === "def-system") return [root];
      if (id === "usage-left" || id === "def-rail") return [left];
      return [];
    },
    neighborhood: () => ({ siblings: [], children: [] }),
    hasDefinition: (id) => id === "def-system" || id === "def-rail",
    hasElement: (query) => {
      if (query.kind === "PartDefinition") {
        return query.id === "def-system" || query.id === "def-rail";
      }
      return query.id === "usage-left";
    },
  };
}

function attachmentFacts(): ProductNavigationEvidenceAttachmentFacts {
  return {
    nodes: [
      { ref: { kind: "part-definition", id: "def-rail" }, label: "Rail" },
      { ref: { kind: "source-file", id: "source.cad@1" }, label: "rail.py" },
    ],
    edges: [{
      relation: "represented_by",
      from: { kind: "part-definition", id: "def-rail" },
      to: { kind: "source-file", id: "source.cad@1" },
    }],
    sourceFileIds: ["source.cad@1"],
    sourceFiles: [{
      fileId: "source.cad",
      fileRevision: 1,
      workspaceRevision: 2,
    }],
  };
}
