import type { OverviewHullContent, OverviewHullContentRow } from "./types.ts";

const PRESENTATION_ROW_PREFIX = "hull-row:";

export type OverviewHullHierarchyLinkState =
  | "default"
  | "outgoing"
  | "incoming"
  | "muted";

/**
 * Collision-safe presentation identity for one displayed hull row.
 * Server occurrence `row.key` stays canonical and may repeat across hulls.
 */
export function overviewHullPresentationRowKey(
  groupKey: string,
  rowKey: string,
): string {
  return `${PRESENTATION_ROW_PREFIX}${JSON.stringify([groupKey, rowKey])}`;
}

export function parseOverviewHullPresentationRowKey(
  value: string,
): { readonly groupKey: string; readonly rowKey: string } | undefined {
  if (!value.startsWith(PRESENTATION_ROW_PREFIX)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(PRESENTATION_ROW_PREFIX.length));
  } catch {
    return undefined;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string" ||
    parsed[0].length === 0 ||
    parsed[1].length === 0
  ) {
    return undefined;
  }
  const groupKey = parsed[0];
  const rowKey = parsed[1];
  if (overviewHullPresentationRowKey(groupKey, rowKey) !== value) {
    return undefined;
  }
  return { groupKey, rowKey };
}

export function nextOverviewHullPresentationRowKey(
  current: string | undefined,
  requested: string,
): string | undefined {
  return current === requested ? undefined : requested;
}

export function overviewHullGraphKeysByPresentationRow(
  hullContents:
    | ReadonlyMap<string, OverviewHullContent>
    | undefined,
  rowAnchors:
    | Readonly<Record<string, Readonly<Record<string, number>>>>
    | undefined,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  const add = (presentationKey: string, nodeKey: string) => {
    const current = result.get(presentationKey) ?? [];
    if (!current.includes(nodeKey)) {
      result.set(presentationKey, [...current, nodeKey]);
    }
  };
  for (const [groupKey, content] of hullContents ?? []) {
    for (const row of content.rows) {
      if (!row.nodeKey) continue;
      add(overviewHullPresentationRowKey(groupKey, row.key), row.nodeKey);
    }
  }
  for (const [groupKey, anchors] of Object.entries(rowAnchors ?? {})) {
    const rows = hullContents?.get(groupKey)?.rows;
    for (const [nodeKey, index] of Object.entries(anchors)) {
      const row = rows?.[index];
      if (!row) continue;
      add(overviewHullPresentationRowKey(groupKey, row.key), nodeKey);
    }
  }
  return result;
}

export function overviewHullMappedGraphKey(
  groupKey: string,
  row: Pick<OverviewHullContentRow, "key" | "nodeKey">,
  rowAnchors: Readonly<Record<string, Readonly<Record<string, number>>>>,
  rows: readonly OverviewHullContentRow[] | undefined,
  knownNodeKeys: { readonly has: (key: string) => boolean },
): string | undefined {
  if (row.nodeKey && knownNodeKeys.has(row.nodeKey)) return row.nodeKey;
  const anchors = rowAnchors[groupKey];
  if (!anchors || !rows) return undefined;
  for (const [nodeKey, index] of Object.entries(anchors)) {
    if (rows[index]?.key === row.key && knownNodeKeys.has(nodeKey)) {
      return nodeKey;
    }
  }
  return undefined;
}

export function overviewHullPresentationRowLookup(
  presentationRowKey: string,
  hullContents: ReadonlyMap<string, OverviewHullContent>,
): {
  readonly groupKey: string;
  readonly rowKey: string;
  readonly index: number;
} | undefined {
  const parsed = parseOverviewHullPresentationRowKey(presentationRowKey);
  if (!parsed) return undefined;
  const content = hullContents.get(parsed.groupKey);
  if (!content) return undefined;
  const index = content.rows.findIndex((row) => row.key === parsed.rowKey);
  if (index < 0) return undefined;
  return { groupKey: parsed.groupKey, rowKey: parsed.rowKey, index };
}

export function overviewHullHierarchyLinkState(
  groupKey: string,
  fromRowKey: string,
  toRowKey: string,
  litPresentationRowKey: string | undefined,
): OverviewHullHierarchyLinkState {
  if (!litPresentationRowKey) return "default";
  if (
    overviewHullPresentationRowKey(groupKey, fromRowKey) ===
      litPresentationRowKey
  ) {
    return "outgoing";
  }
  if (
    overviewHullPresentationRowKey(groupKey, toRowKey) ===
      litPresentationRowKey
  ) {
    return "incoming";
  }
  return "muted";
}

/**
 * Context/menu viewer opens name the opening row. A previously selected
 * unrelated row never becomes the presentation anchor.
 */
export function overviewContextActionPresentationRowKey(
  openingPresentationRowKey: string | undefined,
): string | undefined {
  return openingPresentationRowKey;
}
