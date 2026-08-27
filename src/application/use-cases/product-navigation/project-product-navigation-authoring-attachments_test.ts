import { assertEquals } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { OpenedProductStructure } from "../../ports/out/product-navigation/product-structure-traversal.ts";
import {
  type ProductNavigationBasis,
  productNavigationElementNode,
  productNavigationOccurrenceNode,
} from "../../ports/in/product-navigation/product-navigation-read-model.ts";
import { productStructureElementRef } from "../../../domain/architecture/product-structure-ref.ts";
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
const BASIS: ProductNavigationBasis = {
  projectId: PROJECT,
  threadSnapshotId: SNAPSHOT,
  threadRevision: 4,
  threadSubjectId: SUBJECT,
  architectureArtifactId: ARCHITECTURE_ID,
  architectureFingerprint: `sha256:${ARCHITECTURE_FP.digest}`,
  captureSchema: "architecture-capture/4.0",
};

const SYSTEM_ELEMENT = {
  kind: "element" as const,
  element: productStructureElementRef("PartDefinition", "def-system"),
};
const USAGE_OCCURRENCE = {
  kind: "occurrence" as const,
  occurrence: {
    element: productStructureElementRef("PartUsage", "usage-left"),
    path: ["usage-left"],
  },
};
const RAIL_ELEMENT = {
  kind: "element" as const,
  element: productStructureElementRef("PartDefinition", "def-rail"),
};

Deno.test("authoring attachments keep PartDefinition and PartUsage exact and never reduce usage to definition", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const definition = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
  });
  assertEquals(definition.status, "observed");
  assertEquals(definition.grants, "none");
  assertEquals(definition.authoringAttachments.attachments.map((item) => item.target), [
    { elementId: "def-system", elementKind: "PartDefinition" },
    { elementId: "def-system", elementKind: "PartDefinition" },
  ]);
  assertEquals(
    definition.authoringAttachments.attachments.some((item) =>
      item.target.elementId === "def-rail"
    ),
    false,
  );
  const usage = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: USAGE_OCCURRENCE,
  });
  assertEquals(
    usage.authoringAttachments.attachments.map((item) => item.attachmentId),
    ["att-usage"],
  );
  assertEquals(usage.authoringAttachments.attachments[0]?.target, {
    elementId: "usage-left",
    elementKind: "PartUsage",
  });
  const rail = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: RAIL_ELEMENT,
  });
  assertEquals(
    rail.authoringAttachments.attachments.map((item) => item.attachmentId),
    ["att-rail-def"],
  );
  assertEquals(rail.authoringAttachments.attachments[0]?.target, {
    elementId: "def-rail",
    elementKind: "PartDefinition",
  });
});

Deno.test("authoring attachments expose successor heads, omit detached, and keep source-removed", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const definition = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
  });
  const successor = definition.authoringAttachments.attachments.find((item) =>
    item.attachmentId === "att-a"
  );
  assertEquals(successor?.attachmentRevision, 2);
  assertEquals(successor?.role, { id: "behavior-source", version: 1 });
  assertEquals(
    definition.authoringAttachments.attachments.some((item) =>
      item.attachmentId === "att-detached"
    ),
    false,
  );
  const removed = definition.authoringAttachments.attachments.find((item) =>
    item.attachmentId === "att-removed"
  );
  assertEquals(removed?.sourceStatus, "source-removed");
  assertEquals(removed?.fileHeadRevision, 2);
});

Deno.test("authoring attachments publish exact-basis versus different-basis without repairing the capture", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const definition = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
  });
  const exact = definition.authoringAttachments.attachments.find((item) =>
    item.attachmentId === "att-a"
  );
  const different = definition.authoringAttachments.attachments.find((item) =>
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
  const first = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
  });
  assertEquals(
    first.authoringAttachments.workspaceRevision,
    seeded.head.workspaceRevision,
  );
  assertEquals(
    first.authoringAttachments.attachments.map((item) => item.attachmentId),
    ["att-a"],
  );
  assertEquals(first.authoringAttachments.nextCursor !== null, true);
  const advanced = await apply(
    seeded.head,
    modulePut("later", seeded.head.workspaceRevision, "mod-later", "later"),
  );
  spy.head = advanced.state;
  spy.revisions.set(advanced.state.workspaceRevision, advanced.state);
  const second = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
    cursor: first.authoringAttachments.nextCursor ?? undefined,
  });
  assertEquals(
    second.authoringAttachments.workspaceRevision,
    first.authoringAttachments.workspaceRevision,
  );
  assertEquals(
    second.authoringAttachments.attachments.map((item) => item.attachmentId),
    ["att-removed"],
  );
  assertEquals(
    spy.freshRevisions.includes(first.authoringAttachments.workspaceRevision ?? -1),
    true,
  );
  assertEquals(
    spy.freshRevisions.includes(advanced.state.workspaceRevision),
    false,
  );
});

Deno.test("authoring attachments refuse an old cursor under a later current Thread basis", async () => {
  const seeded = await seedAuthoringWorkspace();
  const laterSnapshot = "thread:slider:r5";
  const laterBasis: ProductNavigationBasis = {
    ...BASIS,
    threadSnapshotId: laterSnapshot,
    threadRevision: 5,
  };
  let tip: "current" | "later" = "current";
  const spy = spyWorkspace(seeded.head, seeded.revisions);
  const navigation = new ProjectProductNavigation({
    projects: {
      get: (projectId: string) =>
        Promise.resolve(
          projectId === PROJECT
            ? (tip === "current" ? project() : laterProject(laterSnapshot))
            : undefined,
        ),
    },
    snapshots: {
      get: (snapshotId: string) => {
        if (snapshotId === SNAPSHOT) return Promise.resolve(thread());
        if (snapshotId === laterSnapshot) {
          return Promise.resolve({
            id: laterSnapshot,
            revision: 5,
            subject: { id: SUBJECT },
          } as ThreadSnapshot);
        }
        return Promise.resolve(undefined);
      },
    },
    traversal: { open: () => Promise.resolve(opened()) },
    workspace: spy.store,
    evidenceAttachments: { read: () => Promise.resolve(attachmentFacts()) },
    authoringAttachments: new ProjectSourceWorkspaceAuthoringAttachmentReader(
      spy.store,
    ),
  });
  const first = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
  });
  assertEquals(first.status, "observed");
  assertEquals(first.authoringAttachments.nextCursor !== null, true);
  const afterFirst = spy.freshRevisions.length;
  tip = "later";
  const replayed = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: laterBasis,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
    cursor: first.authoringAttachments.nextCursor ?? undefined,
  });
  assertEquals(replayed.status, "unresolved");
  assertEquals(replayed.diagnostics[0]?.code, "cursor.mismatch");
  assertEquals(replayed.authoringAttachments.attachments, []);
  const omittedBasis = await navigation.inspect({
    projectId: PROJECT,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
    cursor: first.authoringAttachments.nextCursor ?? undefined,
  });
  assertEquals(omittedBasis.status, "unresolved");
  assertEquals(omittedBasis.diagnostics[0]?.code, "cursor.mismatch");
  assertEquals(omittedBasis.authoringAttachments.attachments, []);
  const wrapped = btoa(JSON.stringify({
    basis: laterBasis,
    inner: first.authoringAttachments.nextCursor,
  })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const rewrittenWrapper = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: laterBasis,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
    cursor: wrapped,
  });
  assertEquals(rewrittenWrapper.status, "unresolved");
  assertEquals(rewrittenWrapper.diagnostics[0]?.code, "cursor.mismatch");
  assertEquals(rewrittenWrapper.authoringAttachments.attachments, []);
  assertEquals(spy.freshRevisions.length, afterFirst);
});

Deno.test("authoring attachments refuse a cursor reused on another inspect selection", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const first = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
  });
  assertEquals(first.authoringAttachments.nextCursor !== null, true);
  const otherElement = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: RAIL_ELEMENT,
    pageSize: 1,
    cursor: first.authoringAttachments.nextCursor ?? undefined,
  });
  assertEquals(otherElement.status, "unresolved");
  assertEquals(otherElement.diagnostics[0]?.code, "cursor.mismatch");
  assertEquals(otherElement.authoringAttachments.attachments, []);
  const otherOccurrence = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: USAGE_OCCURRENCE,
    pageSize: 1,
    cursor: first.authoringAttachments.nextCursor ?? undefined,
  });
  assertEquals(otherOccurrence.status, "unresolved");
  assertEquals(otherOccurrence.diagnostics[0]?.code, "cursor.mismatch");
  assertEquals(otherOccurrence.authoringAttachments.attachments, []);
});

Deno.test("authoring attachments refuse a tampered or foreign-filter cursor", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const first = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
  });
  const sealed = first.authoringAttachments.nextCursor!;
  const [prefix, payload, mac] = sealed.split(".");
  const flipped = mac![0] === "A" ? "B" : "A";
  const tampered = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
    cursor: `${prefix}.${payload}.${flipped}${mac!.slice(1)}`,
  });
  assertEquals(tampered.status, "unresolved");
  assertEquals(tampered.diagnostics[0]?.code, "cursor.mismatch");
  const domainCursor = btoa(JSON.stringify({
    kind: "attachment-list",
    workspaceRevision: first.authoringAttachments.workspaceRevision,
    filter: {
      target: { elementId: "def-system", elementKind: "PartDefinition" },
    },
  }));
  const domain = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
    pageSize: 1,
    cursor: domainCursor,
  });
  assertEquals(domain.status, "unresolved");
  const invalid = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: SYSTEM_ELEMENT,
    cursor: "not-a-cursor",
  });
  assertEquals(invalid.status, "unresolved");
});

Deno.test("authoring attachments stay out of evidence and admission; an exact attachment exposes a read-only closure", async () => {
  const seeded = await seedAuthoringWorkspace();
  const navigation = navigationWith(seeded.head, seeded.revisions);
  const authoring = await navigation.inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: USAGE_OCCURRENCE,
  });
  assertEquals(authoring.grants, "none");
  assertEquals(
    authoring.authoringAttachments.attachments.map((item) => item.fileId),
    ["file-usage"],
  );
  assertEquals(
    authoring.definitionScopedEvidence?.attachments.sources.map((item) => item.id),
    ["source.cad@1"],
  );
  assertEquals(
    authoring.definitionScopedEvidence?.attachments.sources.some((item) =>
      item.id.includes("file-usage")
    ),
    false,
  );
  const closure = await navigation.sourceClosure({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: USAGE_OCCURRENCE,
    workspaceRevision: authoring.authoringAttachments.workspaceRevision ??
      seeded.head.workspaceRevision,
    attachmentId: "att-usage",
    attachmentRevision: 1,
  });
  assertEquals(closure.status, "observed");
  assertEquals(
    closure.entries.filter((entry) => entry.kind === "file").map((entry) =>
      `${entry.fileId}@${entry.fileRevision}`
    ),
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

function laterProject(laterSnapshotId: string): EngineeringProjectSnapshot {
  return {
    project: { id: PROJECT, name: "Slider", subjectId: SUBJECT },
    threadSnapshots: [
      {
        snapshotId: SNAPSHOT,
        revision: 4,
        subjectId: SUBJECT,
      },
      {
        snapshotId: laterSnapshotId,
        revision: 5,
        subjectId: SUBJECT,
      },
    ],
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
  const root = productNavigationElementNode({
    element: productStructureElementRef("PartDefinition", "def-system"),
    label: "Slider",
    expandable: true,
  });
  const left = productNavigationOccurrenceNode({
    element: productStructureElementRef("PartUsage", "usage-left"),
    path: ["usage-left"],
    label: "left_rail",
    typedDefinition: productStructureElementRef("PartDefinition", "def-rail"),
    expandable: true,
  });
  const rail = productStructureElementRef("PartDefinition", "def-rail");
  return {
    architectureArtifactId: ARCHITECTURE_ID,
    architectureFingerprint: ARCHITECTURE_FP,
    root: () => root,
    childrenOfRoot: () => [left],
    childrenOf: () => [left],
    path: (usageIds) => {
      if (usageIds.length === 0) return [root];
      if (usageIds.length === 1 && usageIds[0] === "usage-left") {
        return [root, left];
      }
      return undefined;
    },
    neighborhood: () => ({ siblings: [], children: [] }),
    element: (id) => {
      if (id === "def-system") {
        return { element: root.element, label: root.label, expandable: true };
      }
      if (id === "def-rail") {
        return { element: rail, label: "Rail", expandable: true };
      }
      if (id === "usage-left") {
        return { element: left.element, label: left.label, expandable: true };
      }
      return undefined;
    },
    searchElements: () => [],
    pageOccurrences: (element, offset, limit) => {
      const all = element.elementId === "def-rail" || element.elementId === "usage-left"
        ? [left]
        : [];
      const items = all.slice(offset, offset + limit);
      return {
        items,
        nextOffset: offset + items.length < all.length ? offset + items.length : null,
      };
    },
    hasDefinition: (id) => id === "def-system" || id === "def-rail",
    hasElement: (query) => {
      if (query.elementKind === "PartDefinition") {
        return query.elementId === "def-system" || query.elementId === "def-rail";
      }
      return query.elementId === "usage-left";
    },
    typedDefinition: (usageId) =>
      usageId === "usage-left" ? { element: rail, label: "Rail" } : undefined,
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
