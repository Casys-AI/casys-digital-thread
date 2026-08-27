/**
 * Provider-neutral join of current Thread requirements onto a capture target.
 *
 * A recrossed requirements-capture/3.0 names the exact PartDefinition and the
 * RequirementUsage sealed under it. This module never reads labels, rationale,
 * or Workbench graph edges, and it never invents a verdict.
 */

import {
  archivedRefKeys,
  type RequirementEvaluation,
  type ThreadSnapshot,
  type TracedRequirement,
} from "./thread-snapshot.ts";

export type ThreadRequirementEvidenceStatus = "pass" | "fail" | "unresolved";

/**
 * One current requirements-capture tip already recrossed against the inspect
 * architecture basis. The adapter reopens the capture; this module does not.
 */
export interface RecrossedRequirementsCaptureScope {
  readonly artifactId: string;
  readonly requirementUsageId: string;
  readonly targetElementId: string;
}

export interface ThreadRequirementDefinitionAttachment {
  readonly requirementId: string;
  readonly name: string;
  readonly sourceElementId: string;
  readonly artifactId: string;
  readonly targetElementId: string;
  readonly status: ThreadRequirementEvidenceStatus;
}

/**
 * Join current Thread requirements to recrossed capture scopes.
 *
 * A requirement appears only when its exact source artifact and
 * RequirementUsage match one scope. Conflicting targets for the same
 * requirement are omitted. Evaluation `error` and stale evaluations stay
 * `unresolved`.
 */
export function threadRequirementsByCaptureScope(
  snapshot: ThreadSnapshot,
  scopes: readonly RecrossedRequirementsCaptureScope[],
): readonly ThreadRequirementDefinitionAttachment[] {
  if (scopes.length === 0 || !Array.isArray(snapshot.requirements)) {
    return [];
  }
  const archived = snapshot.changeSet ? archivedRefKeys(snapshot) : new Set<string>();
  const evaluations = Array.isArray(snapshot.evaluations) ? snapshot.evaluations : [];
  const joined = new Map<string, ThreadRequirementDefinitionAttachment>();
  const conflicts = new Set<string>();
  for (const scope of scopes) {
    if (
      scope.artifactId.length === 0 ||
      scope.requirementUsageId.length === 0 ||
      scope.targetElementId.length === 0
    ) {
      continue;
    }
    for (const requirement of snapshot.requirements) {
      if (archived.has(`requirement:${requirement.id}`)) continue;
      if (requirement.trace.sourceArtifactId !== scope.artifactId) continue;
      if (requirement.trace.elementId !== scope.requirementUsageId) continue;
      const attachment = {
        requirementId: requirement.id,
        name: requirement.name,
        sourceElementId: requirement.trace.elementId,
        artifactId: scope.artifactId,
        targetElementId: scope.targetElementId,
        status: literalRequirementStatus(
          requirement,
          evaluations,
          archived,
        ),
      };
      const existing = joined.get(requirement.id);
      if (
        existing !== undefined &&
        existing.targetElementId !== attachment.targetElementId
      ) {
        conflicts.add(requirement.id);
        continue;
      }
      joined.set(requirement.id, attachment);
    }
  }
  for (const requirementId of conflicts) joined.delete(requirementId);
  return [...joined.values()].sort((left, right) =>
    left.requirementId.localeCompare(right.requirementId)
  );
}

function literalRequirementStatus(
  requirement: TracedRequirement,
  evaluations: readonly RequirementEvaluation[],
  archived: ReadonlySet<string>,
): ThreadRequirementEvidenceStatus {
  const latest = evaluations
    .filter((evaluation) =>
      evaluation.requirementId === requirement.id &&
      !archived.has(`evaluation:${evaluation.id}`)
    )
    .sort((left, right) =>
      right.evaluatedAt.localeCompare(left.evaluatedAt) ||
      right.id.localeCompare(left.id)
    )[0];
  if (!latest || latest.freshness.status !== "fresh") return "unresolved";
  return latest.status === "pass" || latest.status === "fail"
    ? latest.status
    : "unresolved";
}
