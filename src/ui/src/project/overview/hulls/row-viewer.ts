import type { OverviewViewerOpenTarget } from "../../overview-thread-viewer-discovery.ts";

/**
 * Bind a hull row to an exact registered App. Direct sessions win; aliases
 * stay the fail-closed fallback. Never invents a viewer or capture identity.
 */
export function overviewHullBoundRowViewer(
  nodeKey: string,
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
): {
  readonly sessionIds: readonly string[];
  readonly viewerNodeKey?: string;
} {
  const direct = sessionsByRecord.get(nodeKey) ?? [];
  if (direct.length > 0) {
    return { sessionIds: direct, viewerNodeKey: nodeKey };
  }
  const aliased = viewerAliases.get(nodeKey);
  if (aliased !== undefined && aliased.length > 0) {
    return {
      sessionIds: aliased.map((item) => item.sessionId),
      viewerNodeKey: aliased[0]!.nodeKey,
    };
  }
  return { sessionIds: [] };
}
