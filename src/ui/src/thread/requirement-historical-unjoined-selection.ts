/**
 * Read-only lookup of recaptured requirement history from an Overview
 * selection. Evaluation nodes resolve through their recorded requirement
 * selection; this never invents a graph edge or current join.
 */

import type {
  ThreadGraphRef,
  ThreadRequirementHistoricalChain,
  ThreadRequirementHistoricalEvaluation,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

export const HISTORICAL_UNJOINED_SELECTION_KIND = "historical-unjoined" as const;

export interface OverviewHistoricalUnjoinedSelection {
  readonly kind: typeof HISTORICAL_UNJOINED_SELECTION_KIND;
  readonly requirementId: string;
  readonly evaluations: readonly ThreadRequirementHistoricalEvaluation[];
  readonly chain?: ThreadRequirementHistoricalChain;
}

export function selectOverviewHistoricalUnjoined(
  thread: ThreadWorkbenchSnapshot,
  reference: ThreadGraphRef,
): OverviewHistoricalUnjoinedSelection | undefined {
  const requirementId = requirementIdForHistoricalLookup(thread, reference);
  if (!requirementId) return undefined;
  const requirement = thread.requirements.find((item) => item.id === requirementId);
  if (!requirement) return undefined;
  const evaluations = requirement.historicalEvaluations;
  const chain = requirement.historicalChain;
  if (evaluations === undefined && chain === undefined) return undefined;
  if (
    (evaluations === undefined || evaluations.length === 0) &&
    chain?.status !== "partial"
  ) {
    return undefined;
  }
  return {
    kind: HISTORICAL_UNJOINED_SELECTION_KIND,
    requirementId: requirement.id,
    evaluations: evaluations ?? [],
    ...(chain ? { chain } : {}),
  };
}

function requirementIdForHistoricalLookup(
  thread: ThreadWorkbenchSnapshot,
  reference: ThreadGraphRef,
): string | undefined {
  if (reference.kind === "requirement") return reference.id;
  if (reference.kind !== "evaluation") return undefined;
  const matches = thread.graph.nodes.filter((node) =>
    node.ref.kind === "evaluation" && node.ref.id === reference.id
  );
  if (matches.length !== 1) return undefined;
  const selection = matches[0]?.selection;
  return selection?.kind === "requirement" ? selection.id : undefined;
}
