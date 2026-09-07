import type { ThreadViewerSession } from "../thread/viewer-sessions-client.ts";

/** Presentation metadata only; it never creates a viewer capability. */
export interface OverviewViewerHierarchy {
  readonly status: "available" | "unavailable";
  readonly nodes: readonly {
    readonly id: string;
    readonly parentId?: string;
    readonly sessionIds: readonly string[];
  }[];
}

/** Open top-level things to read/see, not every child of the same assembly. */
export function overviewDefaultViewerSessions(
  sessions: readonly ThreadViewerSession[],
  hierarchy?: OverviewViewerHierarchy,
): readonly ThreadViewerSession[] {
  const availableIds = new Set(sessions.map((session) => session.id));
  const nodes = hierarchy?.status === "available" ? hierarchy.nodes : [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const nested = new Set<string>();
  for (const node of nodes) {
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.sessionIds.some((id) => availableIds.has(id))) {
        node.sessionIds.forEach((id) => nested.add(id));
        break;
      }
      parentId = parent.parentId;
    }
  }
  // One default per record, in registration order. Other registered Apps
  // remain explicit alternatives in the menu rather than duplicate panels.
  const records = new Set<string>();
  return sessions.filter((session) => {
    if (nested.has(session.id) || session.anchor.kind === "project-review") {
      return false;
    }
    const key = `${session.anchor.kind}:${session.anchor.id}`;
    if (records.has(key)) return false;
    records.add(key);
    return true;
  });
}
