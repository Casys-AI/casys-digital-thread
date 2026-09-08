/**
 * One effective inspection target. Hover overrides retained selection
 * visually; selection itself is unchanged until toggle, background, or close.
 * Selected A plus hovered B never unions A and B routes.
 *
 * `graphKeys` is the Thread route set. `presentationRowKey` is the structured
 * row target. `graphKey` is the exact legacy FlowNode target only.
 */
export type OverviewInspectionMode = "idle" | "hover" | "selected";

export interface OverviewInspectionTarget {
  readonly mode: OverviewInspectionMode;
  readonly presentationRowKey?: string;
  readonly graphKey?: string;
  readonly graphKeys: readonly string[];
}

export type OverviewInspectionVisualCandidate =
  | {
    readonly presentationRowKey: string;
    readonly graphKeys?: readonly string[];
  }
  | { readonly graphKey: string };

export function overviewEffectiveInspection(input: {
  readonly hoveredPresentationRowKey?: string;
  readonly selectedPresentationRowKey?: string;
  readonly hoveredGraphKey?: string;
  readonly selectedGraphKey?: string;
  readonly graphKeysByPresentationRow?: ReadonlyMap<
    string,
    readonly string[]
  >;
}): OverviewInspectionTarget {
  const mapped = (presentationRowKey: string | undefined) =>
    presentationRowKey
      ? [...(input.graphKeysByPresentationRow?.get(presentationRowKey) ?? [])]
      : [];
  if (input.hoveredPresentationRowKey) {
    return {
      mode: "hover",
      presentationRowKey: input.hoveredPresentationRowKey,
      graphKeys: mapped(input.hoveredPresentationRowKey),
    };
  }
  if (input.hoveredGraphKey) {
    return {
      mode: "hover",
      graphKey: input.hoveredGraphKey,
      graphKeys: [input.hoveredGraphKey],
    };
  }
  if (input.selectedPresentationRowKey) {
    return {
      mode: "selected",
      presentationRowKey: input.selectedPresentationRowKey,
      graphKeys: mapped(input.selectedPresentationRowKey),
    };
  }
  if (input.selectedGraphKey) {
    return {
      mode: "selected",
      graphKey: input.selectedGraphKey,
      graphKeys: [input.selectedGraphKey],
    };
  }
  return { mode: "idle", graphKeys: [] };
}

/** True only for the one effective visual target, never retained-but-overridden A. */
export function overviewInspectionIsVisualTarget(
  inspection: OverviewInspectionTarget,
  candidate: OverviewInspectionVisualCandidate,
): boolean {
  if (inspection.mode === "idle") return false;
  if ("presentationRowKey" in candidate) {
    if (inspection.presentationRowKey === candidate.presentationRowKey) {
      return true;
    }
    return Boolean(
      inspection.graphKey &&
        candidate.graphKeys?.includes(inspection.graphKey),
    );
  }
  return inspection.graphKey === candidate.graphKey;
}

/**
 * Presentation row that owns the effective inspection, including a graph-key
 * selection that later lands on a structured row.
 */
export function overviewInspectionPresentationRowKey(
  inspection: OverviewInspectionTarget,
  graphKeysByPresentationRow?: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  if (inspection.presentationRowKey) return inspection.presentationRowKey;
  if (!inspection.graphKey || !graphKeysByPresentationRow) return undefined;
  for (const [presentationKey, keys] of graphKeysByPresentationRow) {
    if (keys.includes(inspection.graphKey)) return presentationKey;
  }
  return undefined;
}

/** Illuminate a visible endpoint of the inspected routes, not a whole hull. */
export function overviewInspectionIsRelatedRow(
  inspection: OverviewInspectionTarget,
  presentationRowKey: string,
  rowGraphKeys: readonly string[],
  relatedGraphKeys: ReadonlySet<string>,
): boolean {
  if (inspection.mode === "idle") return false;
  if (
    overviewInspectionIsVisualTarget(inspection, {
      presentationRowKey,
      graphKeys: rowGraphKeys,
    })
  ) {
    return false;
  }
  return rowGraphKeys.some((key) => relatedGraphKeys.has(key));
}

/** The same incident routes used by cable highlighting, independent of order. */
export function overviewInspectionRelatedGraphKeys(
  routes: readonly { readonly fromKey: string; readonly toKey: string }[],
  activeKeys: readonly string[],
): ReadonlySet<string> {
  const active = new Set(activeKeys);
  const related = new Set(activeKeys);
  for (const route of routes) {
    if (active.has(route.fromKey) || active.has(route.toKey)) {
      related.add(route.fromKey);
      related.add(route.toKey);
    }
  }
  return related;
}
