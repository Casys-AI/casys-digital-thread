/**
 * Pure read-model helpers for the Verification case axis.
 *
 * A case is selected by the opaque key projected by the BFF. Membership is
 * read from `engineeringCaseRefs`; labels, systems and graph connectivity are
 * never used to infer it. Filtering happens before version folding and local
 * neighbourhood traversal so a node outside the selected case cannot become
 * an invisible bridge.
 */

import type {
  EngineeringCase,
  EngineeringCaseCatalog,
  ThreadGraph,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";
import { unavailableEngineeringCaseCatalog } from "../../../presentation/workbench/thread/evidence.ts";

export type VerificationCaseFilter =
  | { kind: "all" }
  | { kind: "case"; caseKey: string };

export interface VerificationCaseLegendItem {
  case: EngineeringCase;
  nodeCount: number;
}

export interface VerificationCaseContextReconciliation {
  filter: VerificationCaseFilter;
  resetTransientState: boolean;
}

export const UNAVAILABLE_VERIFICATION_CASE_CATALOG: EngineeringCaseCatalog =
  unavailableEngineeringCaseCatalog();

export function buildVerificationCaseLegend(
  catalog: EngineeringCaseCatalog,
  nodes: readonly ThreadGraphNode[],
): VerificationCaseLegendItem[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const key of node.engineeringCaseRefs ?? []) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return catalog.cases.map((verificationCase) => ({
    case: verificationCase,
    nodeCount: counts.get(verificationCase.key) ?? 0,
  }));
}

export function verificationCaseFilterIsAvailable(
  catalog: EngineeringCaseCatalog,
  filter: VerificationCaseFilter,
): boolean {
  return filter.kind === "all" ||
    catalog.cases.some((candidate) => candidate.key === filter.caseKey);
}

export function filterGraphByVerificationCase(
  graph: ThreadGraph,
  filter: VerificationCaseFilter,
): ThreadGraph {
  if (filter.kind === "all") return graph;
  const nodes = graph.nodes.filter((node) =>
    node.engineeringCaseRefs?.includes(filter.caseKey) ?? false
  );
  const visibleRefs = new Set(nodes.map((node) => graphRefKey(node.ref)));
  return {
    nodes,
    edges: graph.edges.filter((edge) =>
      visibleRefs.has(`${edge.from.kind}:${edge.from.id}`) &&
      visibleRefs.has(`${edge.to.kind}:${edge.to.id}`)
    ),
  };
}

/**
 * Reconcile ephemeral canvas state after a live read-model update. A removed
 * case widens the filter to `all`, but never carries an old focus or version
 * into that wider view. Likewise, a node whose exact membership disappeared
 * cannot remain selected behind the filtered canvas.
 */
export function reconcileVerificationCaseContext(
  catalog: EngineeringCaseCatalog,
  graph: ThreadGraph,
  filter: VerificationCaseFilter,
  transientRefs: readonly ThreadGraphRef[],
): VerificationCaseContextReconciliation {
  if (!verificationCaseFilterIsAvailable(catalog, filter)) {
    // Keep the stale opaque key selected. `filterGraphByVerificationCase`
    // consequently returns an empty graph until the reviewer explicitly
    // chooses another case or All; a live omission must never widen scope.
    return { filter, resetTransientState: true };
  }
  const visibleRefs = new Set(
    filterGraphByVerificationCase(graph, filter).nodes.map((node) =>
      graphRefKey(node.ref)
    ),
  );
  return {
    filter,
    resetTransientState: transientRefs.some((ref) =>
      !visibleRefs.has(graphRefKey(ref))
    ),
  };
}

function graphRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
