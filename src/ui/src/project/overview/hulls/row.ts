import type { OverviewHullContentRow } from "./content.ts";

export type OverviewHullRowAction =
  | {
    readonly kind: "open-session";
    readonly sessionId: string;
    readonly nodeKey: string;
  }
  | {
    readonly kind: "select-node";
    readonly nodeKey: string;
  };

export interface OverviewHullRowPresentation {
  readonly label: string;
  readonly detail?: string;
  readonly caption: string;
  readonly ariaLabel: string;
  readonly hasViewer: boolean;
}

/** Source-independent actions for one hull row, shared by canvas and menu. */
export function overviewHullRowActions(
  row: OverviewHullContentRow,
): readonly OverviewHullRowAction[] {
  if (row.sessionIds.length > 0 && row.viewerNodeKey) {
    return row.sessionIds.map((sessionId) => ({
      kind: "open-session" as const,
      sessionId,
      nodeKey: row.viewerNodeKey!,
    }));
  }
  if (row.endpoint && row.nodeKey) {
    return [{ kind: "select-node", nodeKey: row.nodeKey }];
  }
  return [];
}

export function overviewHullRowPresentation(
  row: OverviewHullContentRow,
): OverviewHullRowPresentation {
  const actions = overviewHullRowActions(row);
  const hasViewer = actions.length === 1 && actions[0]?.kind === "open-session";
  const caption = hasViewer
    ? "Open viewer"
    : actions.some((action) => action.kind === "open-session")
    ? "Registered viewers"
    : row.kind === "navigation"
    ? "Navigation · not a Thread record"
    : row.kind === "source"
    ? "Source clause"
    : row.detail ?? row.key;
  const ariaSuffix = hasViewer
    ? "Open viewer"
    : actions[0]?.kind === "select-node"
    ? "Show on whiteboard"
    : "Navigation, contextual menu available";
  return {
    label: row.label,
    ...(row.detail ? { detail: row.detail } : {}),
    caption,
    ariaLabel: `${row.label}${
      row.detail ? ` · ${row.detail}` : ""
    } · ${ariaSuffix}`,
    hasViewer,
  };
}

export function activateOverviewHullRow(
  row: OverviewHullContentRow,
  handlers: {
    readonly selectNode: (key: string) => void;
    readonly openSession: (sessionId: string, nodeKey: string) => void;
  },
): void {
  const actions = overviewHullRowActions(row);
  if (actions.length !== 1) return;
  const action = actions[0]!;
  if (action.kind === "open-session") {
    handlers.openSession(action.sessionId, action.nodeKey);
    return;
  }
  handlers.selectNode(action.nodeKey);
}
