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
  | { readonly presentationRowKey: string }
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
    return inspection.presentationRowKey === candidate.presentationRowKey;
  }
  return inspection.graphKey === candidate.graphKey;
}
