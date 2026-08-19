/**
 * Shared occurrence and accessibility semantics for both graph renderers.
 *
 * This is deliberately React-free so the keyed selection contract can be
 * regression-tested without mounting Sigma or SVG.
 */

import {
  stubEdgeOccurrenceKey,
  versionedEdgeOccurrenceKey,
} from "./versioned-provenance-model.ts";
import type { ThreadGraphEdge, ThreadGraphRef } from "./types.ts";

export type GraphEdgeSelectionLike = {
  readonly kind: "edge";
  readonly id: string;
  readonly occurrence?: {
    readonly key: string;
    readonly edge: ThreadGraphEdge;
  };
};

/**
 * Stable occurrence key painted by both Sigma and SVG for a visible edge.
 * Versioned representatives already have a canonical group key. Stubs use a
 * distinct structured record key because their object is reconstructed when a
 * canvas projection changes.
 */
export function displayedGraphEdgeOccurrenceKey(edge: ThreadGraphEdge): string {
  return edge.id.startsWith("stub:")
    ? stubEdgeOccurrenceKey(edge)
    : versionedEdgeOccurrenceKey(edge);
}

/**
 * Object identity is not stable across a fold, renderer switch or live SSE
 * snapshot. A keyed selection therefore highlights by occurrence key only.
 * The id path remains solely for a true pre-occurrence legacy selection.
 */
export function graphEdgeSelectionMatches(
  selection: GraphEdgeSelectionLike | undefined,
  edge: ThreadGraphEdge,
): boolean {
  if (!selection) return false;
  return selection.occurrence
    ? selection.occurrence.key === displayedGraphEdgeOccurrenceKey(edge)
    : selection.id === edge.id;
}

/**
 * A relation button needs more than a relation type: repeated “evidences”
 * handoffs are independently inspectable. Include endpoint labels and stable
 * refs, then rationale and a deterministic ordinal.
 */
export function graphRelationAccessibleLabel(
  edge: ThreadGraphEdge,
  sourceLabel: string,
  targetLabel: string,
  ordinal: number,
): string {
  const relation = edge.relation.replaceAll("_", " ").replaceAll("-", " ");
  const rationale = edge.rationale.trim() || "No recorded rationale.";
  return `${relation}: ${sourceLabel} (${
    graphRefLabel(edge.from)
  }) to ${targetLabel} (${graphRefLabel(edge.to)}). ${rationale} Relation ${
    ordinal + 1
  }.`;
}

function graphRefLabel(reference: ThreadGraphRef): string {
  return `${reference.kind}:${reference.id}`;
}
