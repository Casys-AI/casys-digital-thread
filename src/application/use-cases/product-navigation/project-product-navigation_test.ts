import { assertEquals } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { OpenedProductStructure } from "../../ports/out/product-navigation/product-structure-traversal.ts";
import type { ProductNavigationNode } from "../../ports/in/product-navigation/product-navigation-read-model.ts";
import type { ProductNavigationAttachmentFacts } from "../../ports/out/product-navigation/product-navigation-attachment-reader.ts";
import type { ProjectSourceWorkspaceState } from "../../../domain/project-source-workspace/types.ts";
import { sampleAgentResourceReference } from "../../../testing/agent-resource-test-support.ts";
import { ProjectProductNavigation } from "./project-product-navigation.ts";

const PROJECT = "project.slider";
const SNAPSHOT = "thread:slider:r4";

Deno.test("product navigation roots publish the exact architecture basis", async () => {
  const navigation = service();
  const result = await navigation.roots({ projectId: PROJECT });
  assertEquals(result.status, "observed");
  assertEquals(result.basis, {
    projectId: PROJECT,
    threadSnapshotId: SNAPSHOT,
    threadRevision: 4,
    architectureArtifactId: "architecture-" + "1".repeat(64),
    architectureFingerprint: `sha256:${"1".repeat(64)}`,
    captureSchema: "architecture-capture/4.0",
  });
  assertEquals(result.roots[0]?.id, "def-system");
});

Deno.test("product navigation refuses latest and a missing architecture", async () => {
  const navigation = service();
  assertEquals(
    (await navigation.roots({ projectId: "latest" })).status,
    "unavailable",
  );
  const empty = service({
    traversal: { open: () => Promise.resolve(undefined) },
  });
  assertEquals(
    (await empty.roots({ projectId: PROJECT })).status,
    "unavailable",
  );
});

Deno.test("product navigation path recrosses an exact occurrence and refuses a foreign usage", async () => {
  const navigation = service();
  const result = await navigation.path({
    projectId: PROJECT,
    usagePath: ["usage-left"],
  });
  assertEquals(result.status, "observed");
  assertEquals(
    result.basis?.architectureArtifactId,
    "architecture-" + "1".repeat(64),
  );
  assertEquals(result.nodes.map((node) => node.id), [
    "def-system",
    "usage-left",
  ]);
  assertEquals(
    (await navigation.path({
      projectId: PROJECT,
      usagePath: ["usage-missing"],
    })).status,
    "unattached",
  );
});

Deno.test("product navigation children stay on the typed definition of an occurrence", async () => {
  const result = await service().children({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
  });
  assertEquals(result.status, "observed");
  assertEquals(
    result.basis?.architectureArtifactId,
    "architecture-" + "1".repeat(64),
  );
  assertEquals(result.children.map((node) => node.id), ["usage-pad"]);
  assertEquals(result.children[0]?.path, ["usage-left", "usage-pad"]);
});

Deno.test("product navigation context groups attachments from the exact definition", async () => {
  const result = await service().context({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
  });
  assertEquals(result.status, "observed");
  assertEquals(result.attachments.sources.map((item) => item.id), [
    "source.cad@1",
  ]);
  assertEquals(result.attachments.geometry.map((item) => item.id), [
    "step-rail",
  ]);
  assertEquals(result.attachments.physics.map((item) => item.id), [
    "fea-proof-rail",
  ]);
});

Deno.test("product navigation search locates reused definitions as distinct occurrences", async () => {
  const result = await service().search({ projectId: PROJECT, id: "def-rail" });
  assertEquals(result.status, "observed");
  assertEquals(result.matches.map((node) => node.id), ["usage-left"]);
  assertEquals(
    (await service().search({ projectId: PROJECT, id: "latest" })).status,
    "unattached",
  );
});

Deno.test("product navigation neighborhood stays on the typed occurrence path", async () => {
  const result = await service().neighborhood({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
  });
  assertEquals(result.status, "observed");
  assertEquals(result.parent?.id, "def-system");
  assertEquals(result.children.map((node) => node.id), ["usage-pad"]);
});

Deno.test("product navigation projection reuses roots, children and context", async () => {
  const result = await service().projection({ projectId: PROJECT });
  assertEquals(result.status, "observed");
  assertEquals(result.roots.map((node) => node.id), ["def-system"]);
  assertEquals(result.children.map((node) => node.id), ["usage-left"]);
  assertEquals(result.attachments.sources, []);
});

Deno.test("product navigation source closure keeps an exact historical dependency after a later revision", async () => {
  const result = await service({
    workspace: {
      load: () => Promise.reject(new Error("must not load head")),
      loadAtFresh: () => Promise.resolve(workspaceWithHistoricalDependency()),
    },
  }).sourceClosure({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
    fileId: "source.cad",
    fileRevision: 1,
  });
  assertEquals(result.status, "observed");
  assertEquals(
    result.files.map((file) => `${file.fileId}@${file.fileRevision}`),
    ["source.cad@1", "source.lib@1"],
  );
  assertEquals(result.edges, [{
    from: { fileId: "source.cad", fileRevision: 1 },
    to: { fileId: "source.lib", fileRevision: 1 },
  }]);
});

Deno.test("product navigation source closure refuses a file that is not attached to the node", async () => {
  const result = await service().sourceClosure({
    projectId: PROJECT,
    node: { kind: "part-usage", id: "usage-left", path: ["usage-left"] },
    fileId: "source.foreign",
    fileRevision: 1,
  });
  assertEquals(result.status, "unattached");
  assertEquals(result.files, []);
});

function service(
  overrides: {
    traversal?: { open: () => Promise<OpenedProductStructure | undefined> };
    workspace?: {
      load: () => Promise<never>;
      loadAtFresh: () => Promise<ProjectSourceWorkspaceState>;
    };
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
    attachments: { read: () => Promise.resolve(attachmentFacts()) },
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
  const pad: ProductNavigationNode = {
    kind: "part-usage",
    id: "usage-pad",
    label: "pad",
    definitionId: "def-pad",
    usageId: "usage-pad",
    path: ["usage-left", "usage-pad"],
    expandable: false,
  };
  return {
    architectureArtifactId: "architecture-" + "1".repeat(64),
    architectureFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    root: () => root,
    childrenOf: (node) => {
      if (node.id === "def-system" || node.path.length === 0) return [left];
      if (node.id === "usage-left") return [pad];
      return [];
    },
    path: (usageIds) => {
      if (usageIds.length === 1 && usageIds[0] === "usage-left") {
        return [root, left];
      }
      return undefined;
    },
    locate: (id) => {
      if (id === "def-system") return [root];
      if (id === "usage-left") return [left];
      if (id === "def-rail") return [left];
      return [];
    },
    neighborhood: (node) => {
      if (node.id === "def-system" || node.path.length === 0) {
        return { siblings: [], children: [left] };
      }
      if (node.id === "usage-left") {
        return { parent: root, siblings: [], children: [pad] };
      }
      return { siblings: [], children: [] };
    },
    hasDefinition: (id) => id === "def-system" || id === "def-rail",
    hasElement: (query) => {
      if (query.kind === "PartDefinition") {
        return query.id === "def-system" || query.id === "def-rail";
      }
      return query.id === "usage-left" || query.id === "usage-pad";
    },
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
    attachments: new Map(),
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

function attachmentFacts(): ProductNavigationAttachmentFacts {
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
