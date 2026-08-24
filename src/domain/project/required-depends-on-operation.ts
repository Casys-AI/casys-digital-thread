/**
 * Planning rule for `requiresDependsOnOperation`.
 *
 * The planned item must name exactly one matching dependency. Historical
 * revisions of the same operation do not make that selection ambiguous. The
 * named revision must be the unique current leaf of its stable activity.
 * The planned item itself is not a competing leaf of that activity.
 */

import { leafRevisionIdsForActivity } from "./engineering-activity.ts";

export type RequiredDependsOnOperationIssueCode =
  | "unknown_dependency"
  | "missing_selected_match"
  | "multiple_selected_matches"
  | "stale_non_leaf_dependency"
  | "ambiguous_activity";

export interface RequiredDependsOnOperationIssue {
  readonly code: RequiredDependsOnOperationIssueCode;
  readonly message: string;
}

export interface RequiredDependsOnOperationRef {
  readonly id: string;
  readonly version: string;
}

export interface RequiredDependsOnOperationRevision {
  readonly id: string;
  readonly activityId: string;
  readonly predecessorRevisionId?: string;
  readonly operation?: RequiredDependsOnOperationRef;
}

export type RequiredDependsOnOperationResolution =
  | {
    readonly status: "resolved";
    readonly selected: RequiredDependsOnOperationRevision;
  }
  | {
    readonly status: "unresolved";
    readonly issue: RequiredDependsOnOperationIssue;
  };

/**
 * Exact selected `dependsOn` revision for `requiresDependsOnOperation`.
 *
 * Historical revisions of the same operation do not make that selection
 * ambiguous. The named revision must be the unique current leaf of its
 * stable activity. The planned item itself is not a competing leaf of
 * that activity. Siblings are never inferred.
 */
export function resolveRequiredDependsOnOperation(
  item: {
    readonly id: string;
    readonly dependsOnWorkItemIds: readonly string[];
  },
  operation: {
    readonly id: string;
    readonly version: string;
    readonly requiresDependsOnOperation?: RequiredDependsOnOperationRef;
  },
  revisions: readonly RequiredDependsOnOperationRevision[],
): RequiredDependsOnOperationResolution | undefined {
  const required = operation.requiresDependsOnOperation;
  if (!required) return undefined;

  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  const operationLabel = `${operation.id}@${operation.version}`;
  const requiredLabel = `${required.id}@${required.version}`;

  const unknownIds = [...new Set(item.dependsOnWorkItemIds)]
    .filter((dependencyId) => !byId.has(dependencyId))
    .toSorted((left, right) => left.localeCompare(right));
  if (unknownIds[0] !== undefined) {
    return unresolved({
      code: "unknown_dependency",
      message: `Operation ${operationLabel} depends on unknown work item ` +
        `${unknownIds[0]}.`,
    });
  }

  const selected = [...new Set(item.dependsOnWorkItemIds)]
    .map((dependencyId) => byId.get(dependencyId)!)
    .filter((candidate) =>
      candidate.operation?.id === required.id &&
      candidate.operation.version === required.version
    )
    .toSorted((left, right) => left.id.localeCompare(right.id));

  if (selected.length === 0) {
    return unresolved({
      code: "missing_selected_match",
      message: `Operation ${operationLabel} must depend on ${requiredLabel} ` +
        "work item named in dependsOnWorkItemIds.",
    });
  }
  if (selected.length !== 1) {
    return unresolved({
      code: "multiple_selected_matches",
      message: `Operation ${operationLabel} must depend on the unique ` +
        `${requiredLabel} work item. Found ${selected.length}: ` +
        `${selected.map((match) => match.id).join(", ")}.`,
    });
  }

  const match = selected[0]!;
  const members = revisions.filter((revision) =>
    revision.activityId === match.activityId && revision.id !== item.id
  );
  const leaves = leafRevisionIdsForActivity(members);
  if (!leaves.includes(match.id)) {
    return unresolved({
      code: "stale_non_leaf_dependency",
      message: `Operation ${operationLabel} must depend on the current leaf ` +
        `revision of ${requiredLabel} activity ${match.activityId}. ` +
        `Work item ${match.id} is not a leaf; current leaves: ` +
        `${leaves.join(", ")}.`,
    });
  }
  if (leaves.length !== 1) {
    return unresolved({
      code: "ambiguous_activity",
      message: `Operation ${operationLabel} cannot depend on ${requiredLabel} ` +
        `work item ${match.id} because activity ${match.activityId} has ` +
        `multiple current leaf revisions: ${leaves.join(", ")}.`,
    });
  }
  return { status: "resolved", selected: match };
}

export function collectRequiredDependsOnOperationIssues(
  item: {
    readonly id: string;
    readonly dependsOnWorkItemIds: readonly string[];
  },
  operation: {
    readonly id: string;
    readonly version: string;
    readonly requiresDependsOnOperation?: RequiredDependsOnOperationRef;
  },
  revisions: readonly RequiredDependsOnOperationRevision[],
): readonly RequiredDependsOnOperationIssue[] {
  const resolution = resolveRequiredDependsOnOperation(
    item,
    operation,
    revisions,
  );
  if (!resolution) return [];
  return resolution.status === "resolved" ? [] : [resolution.issue];
}

function unresolved(
  issue: RequiredDependsOnOperationIssue,
): RequiredDependsOnOperationResolution {
  return { status: "unresolved", issue };
}
