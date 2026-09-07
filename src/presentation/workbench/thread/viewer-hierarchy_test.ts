import { assertEquals, assertThrows } from "@std/assert";
import {
  isThreadViewerHierarchyProjection,
  THREAD_VIEWER_HIERARCHY_SCHEMA,
  validateThreadViewerHierarchyProjection,
} from "./viewer-hierarchy.ts";

const SESSION = `mcp-app:${"a".repeat(64)}`;
const OTHER = `mcp-app:${"b".repeat(64)}`;

function available(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
    status: "available",
    nodes: [{
      id: "subject:system",
      label: "Airframe",
      partDefinitionElementId: "airframe-def",
      geometryArtifactId: "geometry-root",
      sessionIds: [SESSION],
    }, {
      id: "subject:usage:wing-left",
      parentId: "subject:system",
      label: "WingModule",
      partDefinitionElementId: "wing-def",
      usageId: "wing-left",
      geometryArtifactId: "geometry-wing",
      sessionIds: [OTHER],
    }],
    rootIds: ["subject:system"],
    ...overrides,
  };
}

Deno.test("hierarchy validator admits a parent-first closed graph with exact session ids", () => {
  const projection = validateThreadViewerHierarchyProjection(
    available(),
    new Set([SESSION, OTHER]),
  );
  assertEquals(projection.status, "available");
  assertEquals(projection.rootIds, ["subject:system"]);
  assertEquals(projection.nodes[1]?.parentId, "subject:system");
  assertEquals(
    isThreadViewerHierarchyProjection(projection, new Set([SESSION, OTHER])),
    true,
  );
});

Deno.test("hierarchy validator rejects unknown session ids and Apps without geometry", () => {
  assertThrows(
    () => validateThreadViewerHierarchyProjection(available(), new Set()),
    TypeError,
    "exact current sessions",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection(
        available(),
        new Set([SESSION]),
      ),
    TypeError,
    "exact current sessions",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [{
          id: "subject:system",
          label: "Airframe",
          partDefinitionElementId: "airframe-def",
          sessionIds: [SESSION],
        }],
        rootIds: ["subject:system"],
      }, new Set([SESSION])),
    TypeError,
    "without a validated geometry primary",
  );
});

Deno.test("hierarchy validator rejects duplicate ids, open parents, and cycles", () => {
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [
          available().nodes[0],
          { ...available().nodes[0], sessionIds: [] },
        ],
        rootIds: ["subject:system"],
      }),
    TypeError,
    "repeats id",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [{
          ...available().nodes[1],
          parentId: "missing-parent",
        }],
        rootIds: [],
      }),
    TypeError,
    "not in the graph",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
        status: "available",
        nodes: [{
          id: "a",
          parentId: "b",
          label: "A",
          partDefinitionElementId: "a-def",
          sessionIds: [],
        }, {
          id: "b",
          parentId: "a",
          label: "B",
          partDefinitionElementId: "b-def",
          sessionIds: [],
        }],
        rootIds: [],
      }),
    TypeError,
    "parent-first",
  );
});

Deno.test("unavailable hierarchy requires a reason and no invented nodes", () => {
  const projection = validateThreadViewerHierarchyProjection({
    schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
    status: "unavailable",
    reason: "The architecture capture is not readable for this snapshot revision.",
    nodes: [],
    rootIds: [],
  });
  assertEquals(projection.status, "unavailable");
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
        status: "unavailable",
        nodes: [],
        rootIds: [],
      }),
    TypeError,
    "must name a reason",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
        status: "unavailable",
        reason: "closed",
        nodes: available().nodes,
        rootIds: ["subject:system"],
      }),
    TypeError,
    "must not invent nodes",
  );
});

Deno.test("hierarchy validator admits optional navigation anchors with a closed key set", () => {
  const projection = validateThreadViewerHierarchyProjection({
    ...available(),
    architectureArtifactId: "architecture-current",
    nodes: [{
      ...available().nodes[0],
      artifactIds: ["geometry-root", "cad-asset-root-step"],
    }, {
      ...available().nodes[1],
      usageLabel: "wingLeft",
      artifactIds: ["geometry-wing"],
    }],
  }, new Set([SESSION, OTHER]));
  assertEquals(projection.architectureArtifactId, "architecture-current");
  assertEquals(projection.nodes[0]?.artifactIds, [
    "geometry-root",
    "cad-asset-root-step",
  ]);
  assertEquals(projection.nodes[1]?.usageLabel, "wingLeft");
});

Deno.test("hierarchy validator rejects unknown keys, malformed arrays, and usage mismatch", () => {
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        hullId: "syson",
      }),
    TypeError,
    "unsupported fields",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [{
          ...available().nodes[0],
          resourceId: "ui://example",
        }],
      }),
    TypeError,
    "unsupported fields",
  );
  const duplicateAssets = ["geometry-root", "geometry-root"];
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [{
          ...available().nodes[0],
          artifactIds: duplicateAssets,
        }],
      }),
    TypeError,
    "artifactIds must be unique strings",
  );
  const sparse = ["geometry-root", "cad-asset-root-step"];
  delete sparse[1];
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [{
          ...available().nodes[0],
          artifactIds: sparse,
        }],
      }),
    TypeError,
    "artifactIds must be dense",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [{
          id: "subject:system",
          label: "Airframe",
          partDefinitionElementId: "airframe-def",
          usageLabel: "system",
          sessionIds: [],
        }],
        rootIds: ["subject:system"],
      }),
    TypeError,
    "usageLabel requires usageId",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [{
          id: "subject:system",
          label: "Airframe",
          partDefinitionElementId: "airframe-def",
          artifactIds: ["geometry-root"],
          sessionIds: [],
        }],
        rootIds: ["subject:system"],
      }),
    TypeError,
    "artifactIds require a validated geometry primary",
  );
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        ...available(),
        nodes: [{
          ...available().nodes[0],
          artifactIds: ["cad-asset-root-step"],
        }],
      }),
    TypeError,
    "artifactIds must include the geometry primary",
  );
});

Deno.test("unavailable hierarchy cannot carry an architecture anchor", () => {
  assertThrows(
    () =>
      validateThreadViewerHierarchyProjection({
        schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
        status: "unavailable",
        reason: "The architecture capture is not readable for this snapshot revision.",
        architectureArtifactId: "architecture-current",
        nodes: [],
        rootIds: [],
      }),
    TypeError,
    "cannot carry an architecture anchor",
  );
});
