import { assertEquals } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { OpenedProductStructure } from "../../ports/out/product-navigation/product-structure-traversal.ts";
import {
  type ProductNavigationBasis,
  productNavigationElementNode,
  productNavigationOccurrenceNode,
} from "../../ports/in/product-navigation/product-navigation-read-model.ts";
import type { ProductNavigationEvidenceAttachmentFacts } from "../../ports/out/product-navigation/product-navigation-evidence-attachment-reader.ts";
import type {
  ProjectSourceAttachmentRecord,
  ProjectSourceAttachmentTarget,
  ProjectSourceWorkspaceState,
} from "../../../domain/project-source-workspace/types.ts";
import { productStructureElementRef } from "../../../domain/architecture/product-structure-ref.ts";
import { sampleAgentResourceReference } from "../../../testing/agent-resource-test-support.ts";
import { ProjectProductNavigation } from "./project-product-navigation.ts";

const PROJECT = "project.slider";
const SNAPSHOT = "thread:slider:r4";
const ARCHITECTURE_ID = "architecture-" + "1".repeat(64);
const ARCHITECTURE_FP = `sha256:${"1".repeat(64)}`;
const BASIS: ProductNavigationBasis = {
  projectId: PROJECT,
  threadSnapshotId: SNAPSHOT,
  threadRevision: 4,
  threadSubjectId: "subject.slider",
  architectureArtifactId: ARCHITECTURE_ID,
  architectureFingerprint: ARCHITECTURE_FP,
  captureSchema: "architecture-capture/4.0",
};

Deno.test("product explore starts from projectId and publishes the exact architecture basis", async () => {
  const result = await service().explore({ projectId: PROJECT });
  assertEquals(result.status, "observed");
  assertEquals(result.basis, BASIS);
  assertEquals(result.focus?.element, {
    elementKind: "PartDefinition",
    elementId: "def-system",
  });
  assertEquals(result.focus?.occurrence, undefined);
  assertEquals(result.selections?.focus, {
    kind: "element",
    element: { elementKind: "PartDefinition", elementId: "def-system" },
  });
  assertEquals(
    result.children.map((node) => node.element.elementId),
    ["usage-left"],
  );
  assertEquals(result.grants, "none");
});

Deno.test("product explore refuses latest and a missing architecture", async () => {
  assertEquals(
    (await service().explore({ projectId: "latest" })).status,
    "unavailable",
  );
  const empty = service({
    traversal: { open: () => Promise.resolve(undefined) },
  });
  assertEquals(
    (await empty.explore({ projectId: PROJECT })).status,
    "unavailable",
  );
});

Deno.test("product explore continues from an exact occurrence and stays on the typed usage", async () => {
  const result = await service().explore({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      element: productStructureElementRef("PartUsage", "usage-left"),
      path: ["usage-left"],
    },
  });
  assertEquals(result.status, "observed");
  assertEquals(result.focus?.element.elementKind, "PartUsage");
  assertEquals(result.focus?.element.elementId, "usage-left");
  assertEquals(result.parent?.element.elementId, "def-system");
  assertEquals(
    result.children.map((node) => node.element.elementId),
    ["usage-pad"],
  );
  assertEquals(result.children[0]?.occurrence?.path, [
    "usage-left",
    "usage-pad",
  ]);
});

Deno.test("product explore fails unavailable on a stale expected basis and republishes the current basis", async () => {
  const result = await service().explore({
    projectId: PROJECT,
    expectedBasis: { ...BASIS, threadRevision: 99 },
    selection: {
      element: productStructureElementRef("PartUsage", "usage-left"),
      path: ["usage-left"],
    },
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.basis, BASIS);
  assertEquals(result.diagnostics[0]?.code, "basis.stale");
  assertEquals(result.children, []);
});

Deno.test("product explore fails unavailable when expectedBasis threadSubjectId drifts", async () => {
  const result = await service().explore({
    projectId: PROJECT,
    expectedBasis: { ...BASIS, threadSubjectId: "subject.other" },
    selection: {
      element: productStructureElementRef("PartUsage", "usage-left"),
      path: ["usage-left"],
    },
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.basis?.threadSubjectId, "subject.slider");
  assertEquals(result.diagnostics[0]?.code, "basis.stale");
});

Deno.test("product search returns exact element refs for exact-id and text discovery", async () => {
  const exact = await service().search({
    projectId: PROJECT,
    query: { kind: "exact-id", elementId: "def-rail" },
  });
  assertEquals(exact.status, "observed");
  assertEquals(exact.matches, [{
    element: { elementKind: "PartDefinition", elementId: "def-rail" },
    label: "Rail",
    match: "exact-id",
  }]);
  const text = await service().search({
    projectId: PROJECT,
    query: { kind: "text", text: "rail" },
  });
  assertEquals(
    text.matches.map((hit) => hit.element.elementId),
    ["def-rail", "usage-left"],
  );
  assertEquals(
    (await service().search({
      projectId: PROJECT,
      query: { kind: "exact-id", elementId: "latest" },
    })).status,
    "unattached",
  );
});

Deno.test("product search paginates exact element hits", async () => {
  const first = await service().search({
    projectId: PROJECT,
    query: { kind: "text", text: "rail" },
    pageSize: 1,
  });
  assertEquals(first.matches.length, 1);
  assertEquals(first.matches[0]?.element.elementId, "def-rail");
  assertEquals(typeof first.nextCursor, "string");
  const second = await service().search({
    projectId: PROJECT,
    expectedBasis: BASIS,
    query: { kind: "text", text: "rail" },
    pageSize: 1,
    cursor: first.nextCursor ?? undefined,
  });
  assertEquals(second.matches[0]?.element.elementId, "usage-left");
  assertEquals(second.nextCursor, null);
});

Deno.test("product search cursor cannot continue a different query", async () => {
  const first = await service().search({
    projectId: PROJECT,
    query: { kind: "text", text: "rail" },
    pageSize: 1,
  });
  const hijacked = await service().search({
    projectId: PROJECT,
    expectedBasis: BASIS,
    query: { kind: "text", text: "pad" },
    pageSize: 1,
    cursor: first.nextCursor ?? undefined,
  });
  assertEquals(hijacked.status, "unresolved");
  assertEquals(hijacked.diagnostics[0]?.code, "cursor.mismatch");
});

Deno.test("product search cursor cannot continue a later Thread revision that reuses the architecture fingerprint", async () => {
  const laterCursor = encodeTestCursor({
    schemaVersion: "product-search-cursor/1.0",
    basis: {
      ...BASIS,
      threadSnapshotId: "thread:later",
      threadRevision: 5,
    },
    query: { kind: "text", text: "rail" },
    offset: 1,
  });
  const hijacked = await service().search({
    projectId: PROJECT,
    query: { kind: "text", text: "rail" },
    pageSize: 1,
    cursor: laterCursor,
  });
  assertEquals(hijacked.status, "unresolved");
  assertEquals(hijacked.diagnostics[0]?.code, "cursor.mismatch");
});

Deno.test("product explore cursor cannot continue a later Thread revision that reuses the architecture fingerprint", async () => {
  const laterCursor = encodeTestCursor({
    schemaVersion: "product-explore-cursor/1.0",
    basis: {
      ...BASIS,
      threadSnapshotId: "thread:later",
      threadRevision: 5,
    },
    focus: {
      kind: "element",
      elementKind: "PartDefinition",
      elementId: "def-system",
      path: [],
    },
    offset: 1,
  });
  const hijacked = await service().explore({
    projectId: PROJECT,
    cursor: laterCursor,
  });
  assertEquals(hijacked.status, "unresolved");
  assertEquals(hijacked.diagnostics[0]?.code, "cursor.mismatch");
});

Deno.test("product navigation refuses an untrusted cursor payload", async () => {
  const missingSubject = encodeTestCursor({
    schemaVersion: "product-search-cursor/1.0",
    basis: {
      projectId: BASIS.projectId,
      threadSnapshotId: BASIS.threadSnapshotId,
      threadRevision: BASIS.threadRevision,
      architectureArtifactId: BASIS.architectureArtifactId,
      architectureFingerprint: BASIS.architectureFingerprint,
      captureSchema: BASIS.captureSchema,
    },
    query: { kind: "text", text: "rail" },
    offset: 1,
  });
  const extraField = encodeTestCursor({
    schemaVersion: "product-search-cursor/1.0",
    basis: BASIS,
    query: { kind: "text", text: "rail" },
    offset: 1,
    extra: "no",
  });
  for (const cursor of [missingSubject, extraField, "latest"]) {
    const hijacked = await service().search({
      projectId: PROJECT,
      query: { kind: "text", text: "rail" },
      pageSize: 1,
      cursor,
    });
    assertEquals(hijacked.status, "unresolved");
    assertEquals(hijacked.diagnostics[0]?.code, "cursor.mismatch");
  }
});

Deno.test("product inspect occurrence cursor cannot continue a later Thread revision", async () => {
  const laterCursor = encodeTestCursor({
    schemaVersion: "product-occurrence-cursor/1.0",
    basis: {
      ...BASIS,
      threadSnapshotId: "thread:later",
      threadRevision: 5,
    },
    elementKind: "PartDefinition",
    elementId: "def-rail",
    offset: 1,
  });
  const hijacked = await service().inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "element",
      element: productStructureElementRef("PartDefinition", "def-rail"),
    },
    occurrencesCursor: laterCursor,
  });
  assertEquals(hijacked.status, "unresolved");
  assertEquals(hijacked.diagnostics[0]?.code, "cursor.mismatch");
});

Deno.test("authoring recross treats threadSubjectId drift as different-basis", async () => {
  const result = await service({
    authoring: [{
      ...attachmentHead(
        "att-subject",
        { elementId: "usage-left", elementKind: "PartUsage" },
        "exact-basis",
        "active",
      ),
      declaredAgainst: {
        thread: {
          snapshotId: SNAPSHOT,
          revision: 4,
          subjectId: "subject.other",
        },
        architecture: {
          artifactId: ARCHITECTURE_ID,
          fingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
          captureSchema: "architecture-capture/4.0" as const,
        },
      },
    }],
  }).inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
  });
  assertEquals(
    result.authoringAttachments.attachments[0]?.basisStatus,
    "different-basis",
  );
  assertEquals(
    result.applicableActions.some((action) =>
      action.status === "blocked" && action.code === "action.different-basis"
    ),
    true,
  );
});

Deno.test("product inspect keeps a PartUsage occurrence and scopes Thread evidence to the typed definition", async () => {
  const result = await service().inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
  });
  assertEquals(result.status, "observed");
  assertEquals(result.selectedElement, {
    elementKind: "PartUsage",
    elementId: "usage-left",
  });
  assertEquals(result.selectedOccurrence?.path, ["usage-left"]);
  assertEquals(result.typedDefinition, {
    relation: "typed_by",
    element: { elementKind: "PartDefinition", elementId: "def-rail" },
    label: "Rail",
  });
  assertEquals(result.definitionScopedEvidence?.relation, "typed_by");
  assertEquals(result.definitionScopedEvidence?.definition.elementId, "def-rail");
  assertEquals(
    result.definitionScopedEvidence?.attachments.sources.map((item) => item.id),
    ["source.cad@1"],
  );
  assertEquals(
    result.applicableActions.some((action) =>
      action.status === "ready" && action.kind === "inspect-selection" &&
      action.arguments.selection.kind === "element" &&
      action.arguments.selection.element.elementId === "def-rail"
    ),
    true,
  );
});

Deno.test("product inspect of the unique root PartDefinition is an element, never an empty-path occurrence", async () => {
  const result = await service().inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "element",
      element: productStructureElementRef("PartDefinition", "def-system"),
    },
  });
  assertEquals(result.status, "observed");
  assertEquals(result.selectedElement, {
    elementKind: "PartDefinition",
    elementId: "def-system",
  });
  assertEquals(result.selectedOccurrence, undefined);
  assertEquals(result.occurrences.occurrences, []);
  assertEquals(result.definitionScopedEvidence?.relation, "selected-element");
});

Deno.test("product inspect of a non-root PartDefinition is an element, not a fabricated occurrence", async () => {
  const result = await service().inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "element",
      element: productStructureElementRef("PartDefinition", "def-rail"),
    },
  });
  assertEquals(result.status, "observed");
  assertEquals(result.selectedElement, {
    elementKind: "PartDefinition",
    elementId: "def-rail",
  });
  assertEquals(result.selectedOccurrence, undefined);
  assertEquals(
    result.occurrences.occurrences.map((node) => node.occurrence?.path),
    [["usage-left"]],
  );
  assertEquals(result.definitionScopedEvidence?.relation, "selected-element");
});

Deno.test("product inspect offers exact-basis capture and blocks different-basis and source-removed actions", async () => {
  const result = await service({
    authoring: [
      attachmentHead(
        "att-active",
        {
          elementId: "usage-left",
          elementKind: "PartUsage",
        },
        "exact-basis",
        "active",
      ),
      attachmentHead(
        "att-stale",
        {
          elementId: "usage-left",
          elementKind: "PartUsage",
        },
        "different-basis",
        "active",
      ),
      attachmentHead(
        "att-removed",
        {
          elementId: "usage-left",
          elementKind: "PartUsage",
        },
        "exact-basis",
        "source-removed",
      ),
    ],
  }).inspect({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
  });
  const readyCapture = result.applicableActions.filter((action) =>
    action.status === "ready" && action.kind === "capture-technical-source"
  );
  assertEquals(readyCapture.length, 1);
  assertEquals(
    readyCapture[0]?.status === "ready"
      ? readyCapture[0].arguments.attachmentId
      : undefined,
    "att-active",
  );
  const readyClosure = result.applicableActions.filter((action) =>
    action.status === "ready" && action.kind === "read-source-closure"
  );
  assertEquals(readyClosure.length, 1);
  const blocked = result.applicableActions.filter((action) =>
    action.status === "blocked"
  );
  assertEquals(
    blocked.map((action) => [action.kind, action.code]),
    [
      ["capture-technical-source", "action.different-basis"],
      ["read-source-closure", "action.different-basis"],
      ["capture-technical-source", "action.source-removed"],
      ["read-source-closure", "action.source-removed"],
    ],
  );
  assertEquals(
    blocked.every((action) => action.status === "blocked" && !("arguments" in action)),
    true,
  );
  const differentBasisRecoveryActions = blocked.flatMap((action) =>
    action.code === "action.different-basis" ? [action.recoveryAction] : []
  );
  assertEquals(differentBasisRecoveryActions, [
    {
      tool: "project_source_attachment_recross",
      arguments: {
        projectId: "project.slider",
        expectedWorkspaceRevision: 2,
        attachments: [{ attachmentId: "att-stale", activeAttachmentRevision: 1 }],
      },
      callerSupplied: ["mutationId"],
    },
    {
      tool: "project_source_attachment_recross",
      arguments: {
        projectId: "project.slider",
        expectedWorkspaceRevision: 2,
        attachments: [{ attachmentId: "att-stale", activeAttachmentRevision: 1 }],
      },
      callerSupplied: ["mutationId"],
    },
  ]);
  assertEquals(
    blocked.filter((action) => action.code !== "action.different-basis").every(
      (action) => !("recoveryAction" in action),
    ),
    true,
  );
  const differentBasisRecovery = blocked.filter((action) =>
    action.status === "blocked" && action.code === "action.different-basis"
  ).map((action) => action.recovery);
  assertEquals(differentBasisRecovery, [
    "Call project_source_attachment_recross with " +
    '{"projectId":"project.slider","expectedWorkspaceRevision":2,"attachments":[{"attachmentId":"att-stale","activeAttachmentRevision":1}]} and a new mutationId. The server recrosses this existing attachment against the published current architecture basis before capture or closure.',
    "Call project_source_attachment_recross with " +
    '{"projectId":"project.slider","expectedWorkspaceRevision":2,"attachments":[{"attachmentId":"att-stale","activeAttachmentRevision":1}]} and a new mutationId. The server recrosses this existing attachment against the published current architecture basis before capture or closure.',
  ]);
});

Deno.test("product navigation projection reuses the unique-root neighborhood", async () => {
  const result = await service().projection({ projectId: PROJECT });
  assertEquals(result.status, "observed");
  assertEquals(
    result.roots.map((node) => node.element.elementId),
    ["def-system"],
  );
  assertEquals(
    result.children.map((node) => node.element.elementId),
    ["usage-left"],
  );
});

Deno.test("product source closure keeps an exact historical dependency after a later revision", async () => {
  const result = await service({
    workspace: {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.resolve(workspaceWithHistoricalDependency()),
    },
  }).sourceClosure({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
    workspaceRevision: 2,
    attachmentId: "att-rail",
    attachmentRevision: 1,
  });
  assertEquals(result.status, "observed");
  assertEquals(
    result.entries.filter((entry) => entry.kind === "file").map((entry) =>
      `${entry.fileId}@${entry.fileRevision}`
    ),
    ["source.lib@1", "source.cad@1"],
  );
  assertEquals(result.fileCount, 2);
  assertEquals(result.edgeCount, 1);
  assertEquals(
    result.entries.filter((entry) => entry.kind === "edge"),
    [{
      kind: "edge",
      from: { fileId: "source.cad", fileRevision: 1 },
      to: { fileId: "source.lib", fileRevision: 1 },
    }],
  );
  assertEquals(result.nextCursor, null);
});

Deno.test("product source closure pages every file and every edge as one entries stream", async () => {
  const navigation = service({
    workspace: {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.resolve(workspaceWithHistoricalDependency()),
    },
  });
  const query = {
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence" as const,
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
    workspaceRevision: 2,
    attachmentId: "att-rail",
    attachmentRevision: 1,
    pageSize: 1,
  };
  const pages = [];
  let cursor: string | undefined;
  for (let index = 0; index < 8; index += 1) {
    const page = await navigation.sourceClosure({
      ...query,
      ...(cursor ? { cursor } : {}),
    });
    assertEquals(page.status, "observed");
    assertEquals(page.fileCount, 2);
    assertEquals(page.edgeCount, 1);
    pages.push(...page.entries);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  assertEquals(pages.map((entry) => entry.kind), ["file", "file", "edge"]);
  assertEquals(pages.length, 3);
});

Deno.test("product source closure cursor binds basis, selection, workspace, attachment and fingerprint", async () => {
  const navigation = service({
    workspace: {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.resolve(workspaceWithHistoricalDependency()),
    },
  });
  const query = {
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence" as const,
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
    workspaceRevision: 2,
    attachmentId: "att-rail",
    attachmentRevision: 1,
    pageSize: 1,
  };
  const first = await navigation.sourceClosure(query);
  assertEquals(first.status, "observed");
  assertEquals(typeof first.nextCursor, "string");
  const laterThread = await navigation.sourceClosure({
    ...query,
    cursor: encodeTestCursor({
      schemaVersion: "product-source-closure-cursor/1.0",
      basis: {
        ...BASIS,
        threadSnapshotId: "thread:later",
        threadRevision: 5,
      },
      workspaceRevision: 2,
      attachmentId: "att-rail",
      attachmentRevision: 1,
      closureFingerprint: first.closureFingerprint,
      selection: query.selection,
      offset: 1,
    }),
  });
  assertEquals(laterThread.status, "unresolved");
  assertEquals(laterThread.diagnostics[0]?.code, "cursor.mismatch");
  const otherAttachment = await navigation.sourceClosure({
    ...query,
    cursor: encodeTestCursor({
      schemaVersion: "product-source-closure-cursor/1.0",
      basis: BASIS,
      workspaceRevision: 2,
      attachmentId: "att-stale",
      attachmentRevision: 1,
      closureFingerprint: first.closureFingerprint,
      selection: query.selection,
      offset: 1,
    }),
  });
  assertEquals(otherAttachment.status, "unresolved");
  const otherFingerprint = await navigation.sourceClosure({
    ...query,
    cursor: encodeTestCursor({
      schemaVersion: "product-source-closure-cursor/1.0",
      basis: BASIS,
      workspaceRevision: 2,
      attachmentId: "att-rail",
      attachmentRevision: 1,
      closureFingerprint: `sha256:${"9".repeat(64)}`,
      selection: query.selection,
      offset: 1,
    }),
  });
  assertEquals(otherFingerprint.status, "unresolved");
  const otherSelection = await navigation.sourceClosure({
    ...query,
    cursor: encodeTestCursor({
      schemaVersion: "product-source-closure-cursor/1.0",
      basis: BASIS,
      workspaceRevision: 2,
      attachmentId: "att-rail",
      attachmentRevision: 1,
      closureFingerprint: first.closureFingerprint,
      selection: {
        kind: "element",
        element: productStructureElementRef("PartDefinition", "def-system"),
      },
      offset: 1,
    }),
  });
  assertEquals(otherSelection.status, "unresolved");
});

Deno.test("product source closure refuses a dangling dependency without reporting observed", async () => {
  const result = await service({
    workspace: {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.resolve(workspaceWithDanglingDependency()),
    },
  }).sourceClosure({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
    workspaceRevision: 2,
    attachmentId: "att-rail",
    attachmentRevision: 1,
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.entries, []);
});

Deno.test("product source closure refuses threadSubjectId drift as a different basis", async () => {
  const result = await service({
    workspace: {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.resolve(workspaceWithHistoricalDependency()),
    },
  }).sourceClosure({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
    workspaceRevision: 2,
    attachmentId: "att-subject",
    attachmentRevision: 1,
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.entries, []);
});

Deno.test("product source closure refuses a different-basis attachment without carried-forward inference", async () => {
  const result = await service({
    workspace: {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.resolve(workspaceWithHistoricalDependency()),
    },
  }).sourceClosure({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
    workspaceRevision: 2,
    attachmentId: "att-stale",
    attachmentRevision: 1,
  });
  assertEquals(result.status, "unavailable");
  assertEquals(result.entries, []);
});

Deno.test("product source closure refuses an attachment that is not attached to the selected element", async () => {
  const result = await service({
    workspace: {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.resolve(workspaceWithHistoricalDependency()),
    },
  }).sourceClosure({
    projectId: PROJECT,
    expectedBasis: BASIS,
    selection: {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", "usage-left"),
        path: ["usage-left"],
      },
    },
    workspaceRevision: 2,
    attachmentId: "att-foreign",
    attachmentRevision: 1,
  });
  assertEquals(result.status, "unattached");
  assertEquals(result.entries, []);
});

function encodeTestCursor(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function service(
  overrides: {
    traversal?: { open: () => Promise<OpenedProductStructure | undefined> };
    workspace?: {
      load: () => Promise<never>;
      loadAtFresh: () => Promise<ProjectSourceWorkspaceState>;
    };
    authoring?: ReturnType<typeof attachmentHead>[];
  } = {},
) {
  return new ProjectProductNavigation({
    projects: {
      get: (projectId: string) =>
        Promise.resolve(projectId === PROJECT ? project() : undefined),
    },
    snapshots: {
      get: (snapshotId: string) =>
        Promise.resolve(snapshotId === SNAPSHOT ? thread() : undefined),
    },
    traversal: overrides.traversal ?? { open: () => Promise.resolve(opened()) },
    workspace: overrides.workspace ?? {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.reject(new Error("must not load workspace")),
    },
    evidenceAttachments: { read: () => Promise.resolve(attachmentFacts()) },
    authoringAttachments: overrides.authoring
      ? {
        listActiveHeads: () =>
          Promise.resolve({
            workspaceRevision: 2,
            workspaceEventFingerprint: `sha256:${"e".repeat(64)}`,
            attachments: overrides.authoring!,
            nextCursor: null,
          }),
      }
      : undefined,
  });
}

function project(): EngineeringProjectSnapshot {
  return {
    project: { id: PROJECT, name: "Slider", subjectId: "subject.slider" },
    threadSnapshots: [{
      snapshotId: SNAPSHOT,
      revision: 4,
      subjectId: "subject.slider",
    }],
  } as unknown as EngineeringProjectSnapshot;
}

function thread(): ThreadSnapshot {
  return {
    id: SNAPSHOT,
    revision: 4,
    subject: { id: "subject.slider" },
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
  const pad = productNavigationOccurrenceNode({
    element: productStructureElementRef("PartUsage", "usage-pad"),
    path: ["usage-left", "usage-pad"],
    label: "pad",
    typedDefinition: productStructureElementRef("PartDefinition", "def-pad"),
    expandable: false,
  });
  const rail = productStructureElementRef("PartDefinition", "def-rail");
  return {
    architectureArtifactId: ARCHITECTURE_ID,
    architectureFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    root: () => root,
    childrenOfRoot: () => [left],
    childrenOf: (occurrence) => {
      if (occurrence.element.elementId === "usage-left") return [pad];
      return [];
    },
    path: (usageIds) => {
      if (usageIds.length === 0) return [root];
      if (usageIds.length === 1 && usageIds[0] === "usage-left") {
        return [root, left];
      }
      return undefined;
    },
    neighborhood: (occurrence) => {
      if (occurrence.element.elementId === "usage-left") {
        return { parent: root, siblings: [], children: [pad] };
      }
      return { siblings: [], children: [] };
    },
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
    searchElements: (query) => {
      if (query.kind === "exact-id") {
        if (query.elementId === "latest") return [];
        const found = query.elementId === "def-rail"
          ? { element: rail, label: "Rail" as const }
          : query.elementId === "usage-left"
          ? { element: left.element, label: left.label }
          : query.elementId === "def-system"
          ? { element: root.element, label: root.label }
          : undefined;
        return found ? [{ ...found, match: "exact-id" as const }] : [];
      }
      if (query.text.toLowerCase() === "rail") {
        return [
          { element: rail, label: "Rail", match: "id-token" },
          { element: left.element, label: left.label, match: "label-token" },
        ];
      }
      return [];
    },
    pageOccurrences: (element, offset, limit) => {
      const all = element.elementId === "def-rail" ||
          element.elementId === "usage-left"
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
      return query.elementId === "usage-left" || query.elementId === "usage-pad";
    },
    typedDefinition: (usageId) => {
      if (usageId === "usage-left") {
        return { element: rail, label: "Rail" };
      }
      if (usageId === "usage-pad") {
        return {
          element: productStructureElementRef("PartDefinition", "def-pad"),
          label: "Pad",
        };
      }
      return undefined;
    },
  };
}

function attachmentHead(
  attachmentId: string,
  target: ProjectSourceAttachmentTarget,
  basisStatus: "exact-basis" | "different-basis",
  sourceStatus: "active" | "source-removed",
) {
  return {
    attachmentId,
    attachmentRevision: 1,
    fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    fileId: "source.cad",
    fileHeadRevision: 1,
    sourceStatus,
    role: { id: "design-source", version: 1 },
    target,
    declaredAgainst: {
      thread: {
        snapshotId: basisStatus === "exact-basis" ? SNAPSHOT : "thread:other",
        revision: basisStatus === "exact-basis" ? 4 : 9,
        subjectId: "subject.slider",
      },
      architecture: {
        artifactId: ARCHITECTURE_ID,
        fingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
        captureSchema: "architecture-capture/4.0" as const,
      },
    },
    basisStatus,
  };
}

function workspaceWithHistoricalDependency(): ProjectSourceWorkspaceState {
  const resource = sampleAgentResourceReference({
    name: "lib.py",
    mimeType: "text/x-python",
  });
  return {
    projectId: PROJECT,
    workspaceRevision: 2,
    lastEventFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
    modules: new Map(),
    mutations: new Map(),
    attachments: new Map([
      [
        "att-rail",
        attachmentRecord("att-rail", {
          elementId: "usage-left",
          elementKind: "PartUsage",
        }),
      ],
      [
        "att-foreign",
        attachmentRecord("att-foreign", {
          elementId: "def-system",
          elementKind: "PartDefinition",
        }),
      ],
      [
        "att-stale",
        attachmentRecord("att-stale", {
          elementId: "usage-left",
          elementKind: "PartUsage",
        }, {
          snapshotId: "thread:other",
          revision: 9,
          subjectId: "subject.slider",
        }),
      ],
      [
        "att-subject",
        attachmentRecord("att-subject", {
          elementId: "usage-left",
          elementKind: "PartUsage",
        }, {
          snapshotId: SNAPSHOT,
          revision: 4,
          subjectId: "subject.other",
        }),
      ],
    ]),
    files: new Map([
      ["source.cad", {
        fileId: "source.cad",
        headRevision: 1,
        status: "active",
        revisions: new Map([[1, {
          kind: "content",
          fileId: "source.cad",
          fileRevision: 1,
          resourceRef: sampleAgentResourceReference({ name: "rail.py" }),
          moduleId: "mod-rail",
          logicalName: "rail.py",
          role: "cad-script",
          dependencies: [{ fileId: "source.lib", fileRevision: 1 }],
          fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
        }]]),
      }],
      ["source.lib", {
        fileId: "source.lib",
        headRevision: 2,
        status: "active",
        revisions: new Map([
          [1, {
            kind: "content",
            fileId: "source.lib",
            fileRevision: 1,
            resourceRef: resource,
            moduleId: "mod-rail",
            logicalName: "lib.py",
            role: "cad-script",
            dependencies: [],
            fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          }],
          [2, {
            kind: "content",
            fileId: "source.lib",
            fileRevision: 2,
            predecessorFileRevision: 1,
            resourceRef: sampleAgentResourceReference({
              name: "lib.py",
              fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
            }),
            moduleId: "mod-rail",
            logicalName: "lib.py",
            role: "cad-script",
            dependencies: [],
            fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
          }],
        ]),
      }],
    ]),
  };
}

function workspaceWithDanglingDependency(): ProjectSourceWorkspaceState {
  const named = workspaceWithHistoricalDependency();
  const cad = named.files.get("source.cad");
  const revision = cad?.revisions.get(1);
  if (!cad || !revision || revision.kind !== "content") {
    throw new Error("historical CAD revision fixture is missing");
  }
  return {
    ...named,
    files: new Map([
      ...named.files,
      ["source.cad", {
        ...cad,
        revisions: new Map([[1, {
          ...revision,
          dependencies: [{ fileId: "source.missing", fileRevision: 1 }],
        }]]),
      }],
    ]),
  };
}

function attachmentRecord(
  attachmentId: string,
  target: ProjectSourceAttachmentTarget,
  thread: {
    snapshotId: string;
    revision: number;
    subjectId: string;
  } = {
    snapshotId: SNAPSHOT,
    revision: 4,
    subjectId: "subject.slider",
  },
): ProjectSourceAttachmentRecord {
  return {
    attachmentId,
    fileId: "source.cad",
    headRevision: 1,
    status: "active",
    revisions: new Map([[1, {
      kind: "content",
      attachmentId,
      attachmentRevision: 1,
      fileId: "source.cad",
      role: { id: "design-source", version: 1 },
      target,
      declaredAgainst: {
        thread,
        architecture: {
          artifactId: ARCHITECTURE_ID,
          fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
          captureSchema: "architecture-capture/4.0",
        },
      },
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    }]]),
  };
}

function attachmentFacts(): ProductNavigationEvidenceAttachmentFacts {
  return {
    nodes: [
      { ref: { kind: "part-definition", id: "def-rail" }, label: "Rail" },
      { ref: { kind: "source-file", id: "source.cad@1" }, label: "rail.py" },
      { ref: { kind: "artifact", id: "step-rail" }, label: "Rail STEP" },
      { ref: { kind: "artifact", id: "fea-proof-rail" }, label: "Rail proof" },
    ],
    edges: [
      {
        relation: "represented_by",
        from: { kind: "part-definition", id: "def-rail" },
        to: { kind: "source-file", id: "source.cad@1" },
      },
      {
        relation: "represented_by",
        from: { kind: "part-definition", id: "def-rail" },
        to: { kind: "artifact", id: "step-rail" },
      },
      {
        relation: "verified_by",
        from: { kind: "part-definition", id: "def-rail" },
        to: { kind: "artifact", id: "fea-proof-rail" },
      },
    ],
    sourceFileIds: ["source.cad@1"],
    sourceFiles: [{
      fileId: "source.cad",
      fileRevision: 1,
      workspaceRevision: 2,
    }],
  };
}
