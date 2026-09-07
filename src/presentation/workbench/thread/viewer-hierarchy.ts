/**
 * Read-only assembly navigation for already-projected Thread viewer sessions.
 *
 * This model is not engineering evidence, authorization, or a catalog override.
 * Nodes without a registered App stay plain structure.
 */

import { isDenseUnadornedArray } from "./dense-unadorned-array.ts";

export const THREAD_VIEWER_HIERARCHY_SCHEMA = "thread-viewer-hierarchy/1.0" as const;

export type ThreadViewerHierarchyStatus = "available" | "unavailable";

export interface ThreadViewerHierarchyNode {
  readonly id: string;
  readonly parentId?: string;
  readonly label: string;
  readonly partDefinitionElementId: string;
  readonly usageId?: string;
  readonly usageLabel?: string;
  readonly geometryArtifactId?: string;
  readonly artifactIds?: readonly string[];
  readonly sessionIds: readonly string[];
}

export interface ThreadViewerHierarchyProjection {
  readonly schemaVersion: typeof THREAD_VIEWER_HIERARCHY_SCHEMA;
  readonly status: ThreadViewerHierarchyStatus;
  readonly reason?: string;
  readonly architectureArtifactId?: string;
  readonly nodes: readonly ThreadViewerHierarchyNode[];
  readonly rootIds: readonly string[];
}

const SESSION_ID = /^mcp-app:[a-f0-9]{64}$/;
const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const LABEL = /^[\P{C}]{1,256}$/u;
const MAX_REASON = 1024;

/**
 * Strict validator for the owned hierarchy projection.
 *
 * Unique node ids, a closed acyclic parent graph in parent-first order,
 * rootIds exactly the parentless nodes, and sessionIds drawn only from the
 * exact current viewer-session identities when that set is supplied.
 */
export function validateThreadViewerHierarchyProjection(
  value: unknown,
  currentSessionIds?: ReadonlySet<string>,
): ThreadViewerHierarchyProjection {
  if (!isRecord(value)) {
    throw new TypeError("Thread viewer hierarchy must be an object.");
  }
  const keys = Object.keys(value);
  const allowed = new Set([
    "schemaVersion",
    "status",
    "reason",
    "architectureArtifactId",
    "nodes",
    "rootIds",
  ]);
  if (keys.some((key) => !allowed.has(key))) {
    throw new TypeError("Thread viewer hierarchy has unsupported fields.");
  }
  if (
    value.schemaVersion !== THREAD_VIEWER_HIERARCHY_SCHEMA ||
    (value.status !== "available" && value.status !== "unavailable")
  ) {
    throw new TypeError("Thread viewer hierarchy schema or status is not exact.");
  }
  if (value.reason !== undefined) {
    if (typeof value.reason !== "string" || value.reason.trim() === "") {
      throw new TypeError("Thread viewer hierarchy reason must be a non-empty string.");
    }
    if (value.reason.length > MAX_REASON) {
      throw new TypeError("Thread viewer hierarchy reason exceeds its ceiling.");
    }
  }
  if (
    value.architectureArtifactId !== undefined &&
    !isNodeId(value.architectureArtifactId)
  ) {
    throw new TypeError(
      "Thread viewer hierarchy architectureArtifactId is not exact.",
    );
  }
  if (!isDenseUnadornedArray(value.nodes) || !isDenseUnadornedArray(value.rootIds)) {
    throw new TypeError("Thread viewer hierarchy arrays must be dense and unadorned.");
  }

  const nodes = value.nodes.map((node, index) => parseNode(node, index));
  const ids = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (ids.has(node.id)) {
      throw new TypeError(
        `Thread viewer hierarchy node ${index} repeats id ${node.id}.`,
      );
    }
    ids.add(node.id);
  }
  for (const [index, node] of nodes.entries()) {
    if (node.parentId === undefined) continue;
    if (!ids.has(node.parentId)) {
      throw new TypeError(
        `Thread viewer hierarchy node ${index} parentId is not in the graph.`,
      );
    }
    if (node.parentId === node.id) {
      throw new TypeError(
        `Thread viewer hierarchy node ${index} cannot parent itself.`,
      );
    }
    const parentIndex = nodes.findIndex((candidate) => candidate.id === node.parentId);
    if (parentIndex === -1 || parentIndex >= index) {
      throw new TypeError(
        `Thread viewer hierarchy node ${index} is not parent-first.`,
      );
    }
  }
  rejectParentCycles(nodes);

  const expectedRoots = nodes.filter((node) => node.parentId === undefined).map(
    (node) => node.id,
  );
  if (
    value.rootIds.length !== expectedRoots.length ||
    value.rootIds.some((id, index) =>
      typeof id !== "string" || id !== expectedRoots[index]
    )
  ) {
    throw new TypeError(
      "Thread viewer hierarchy rootIds must list parentless nodes in parent-first order.",
    );
  }

  for (const node of nodes) {
    for (const sessionId of node.sessionIds) {
      if (!SESSION_ID.test(sessionId)) {
        throw new TypeError(
          "Thread viewer hierarchy sessionIds must be exact App ids.",
        );
      }
      if (currentSessionIds !== undefined && !currentSessionIds.has(sessionId)) {
        throw new TypeError(
          "Thread viewer hierarchy sessionIds must name exact current sessions.",
        );
      }
    }
    if (node.sessionIds.length > 0 && node.geometryArtifactId === undefined) {
      throw new TypeError(
        "Thread viewer hierarchy cannot attach an App without a validated geometry primary.",
      );
    }
  }

  if (value.status === "unavailable") {
    if (nodes.length !== 0 || value.rootIds.length !== 0) {
      throw new TypeError("Unavailable hierarchy must not invent nodes.");
    }
    if (value.reason === undefined) {
      throw new TypeError("Unavailable hierarchy must name a reason.");
    }
    if (value.architectureArtifactId !== undefined) {
      throw new TypeError(
        "Unavailable hierarchy cannot carry an architecture anchor.",
      );
    }
  }

  return {
    schemaVersion: THREAD_VIEWER_HIERARCHY_SCHEMA,
    status: value.status,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
    ...(value.architectureArtifactId === undefined
      ? {}
      : { architectureArtifactId: value.architectureArtifactId }),
    nodes,
    rootIds: expectedRoots,
  };
}

export function isThreadViewerHierarchyProjection(
  value: unknown,
  currentSessionIds?: ReadonlySet<string>,
): value is ThreadViewerHierarchyProjection {
  try {
    validateThreadViewerHierarchyProjection(value, currentSessionIds);
    return true;
  } catch {
    return false;
  }
}

function parseNode(value: unknown, index: number): ThreadViewerHierarchyNode {
  if (!isRecord(value)) {
    throw new TypeError(`Thread viewer hierarchy node ${index} must be an object.`);
  }
  const keys = Object.keys(value);
  const allowed = new Set([
    "id",
    "parentId",
    "label",
    "partDefinitionElementId",
    "usageId",
    "usageLabel",
    "geometryArtifactId",
    "artifactIds",
    "sessionIds",
  ]);
  if (keys.some((key) => !allowed.has(key))) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} has unsupported fields.`,
    );
  }
  if (
    !isNodeId(value.id) || !isLabel(value.label) ||
    !isNodeId(value.partDefinitionElementId)
  ) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} identities are not exact.`,
    );
  }
  if (value.parentId !== undefined && !isNodeId(value.parentId)) {
    throw new TypeError(`Thread viewer hierarchy node ${index} parentId is not exact.`);
  }
  if (value.usageId !== undefined && !isNodeId(value.usageId)) {
    throw new TypeError(`Thread viewer hierarchy node ${index} usageId is not exact.`);
  }
  if (value.usageLabel !== undefined && !isLabel(value.usageLabel)) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} usageLabel is not exact.`,
    );
  }
  if (value.usageLabel !== undefined && value.usageId === undefined) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} usageLabel requires usageId.`,
    );
  }
  if (value.geometryArtifactId !== undefined && !isNodeId(value.geometryArtifactId)) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} geometryArtifactId is not exact.`,
    );
  }
  if (!isDenseUnadornedArray(value.sessionIds)) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} sessionIds must be dense.`,
    );
  }
  const sessionIds: string[] = [];
  const seen = new Set<string>();
  for (const sessionId of value.sessionIds) {
    if (typeof sessionId !== "string" || seen.has(sessionId)) {
      throw new TypeError(
        `Thread viewer hierarchy node ${index} sessionIds must be unique strings.`,
      );
    }
    seen.add(sessionId);
    sessionIds.push(sessionId);
  }
  const artifactIds = parseArtifactIds(value.artifactIds, index);
  if (artifactIds.length > 0 && value.geometryArtifactId === undefined) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} artifactIds require a validated geometry primary.`,
    );
  }
  if (
    artifactIds.length > 0 &&
    (typeof value.geometryArtifactId !== "string" ||
      !artifactIds.includes(value.geometryArtifactId))
  ) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} artifactIds must include the geometry primary.`,
    );
  }
  return {
    id: value.id,
    ...(value.parentId === undefined ? {} : { parentId: value.parentId }),
    label: value.label,
    partDefinitionElementId: value.partDefinitionElementId,
    ...(value.usageId === undefined ? {} : { usageId: value.usageId }),
    ...(value.usageLabel === undefined ? {} : { usageLabel: value.usageLabel }),
    ...(value.geometryArtifactId === undefined
      ? {}
      : { geometryArtifactId: value.geometryArtifactId }),
    ...(value.artifactIds === undefined ? {} : { artifactIds }),
    sessionIds,
  };
}

function parseArtifactIds(value: unknown, index: number): string[] {
  if (value === undefined) return [];
  if (!isDenseUnadornedArray(value)) {
    throw new TypeError(
      `Thread viewer hierarchy node ${index} artifactIds must be dense.`,
    );
  }
  const artifactIds: string[] = [];
  const seen = new Set<string>();
  for (const artifactId of value) {
    if (
      typeof artifactId !== "string" || !isNodeId(artifactId) || seen.has(artifactId)
    ) {
      throw new TypeError(
        `Thread viewer hierarchy node ${index} artifactIds must be unique strings.`,
      );
    }
    seen.add(artifactId);
    artifactIds.push(artifactId);
  }
  return artifactIds;
}

function rejectParentCycles(nodes: readonly ThreadViewerHierarchyNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const seen = new Set<string>();
    let current: ThreadViewerHierarchyNode | undefined = node;
    while (current?.parentId) {
      if (seen.has(current.id)) {
        throw new TypeError("Thread viewer hierarchy parent graph contains a cycle.");
      }
      seen.add(current.id);
      current = byId.get(current.parentId);
    }
  }
}

function isNodeId(value: unknown): value is string {
  return typeof value === "string" && NODE_ID.test(value);
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && LABEL.test(value) && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
