/**
 * Stable engineering lifecycle: activity, revision, attempt.
 *
 * An activity is the intent that survives revisions. A work item is one
 * immutable revision of that activity. An agent run is one attempt of one
 * revision. Thread/CAS provenance may corroborate a link; it never creates one.
 */

export const ENGINEERING_ACTIVITY_ID_PREFIX = "activity:" as const;

/** Server-derived stable activity identity from the root revision id. */
export function engineeringActivityIdFromRootRevision(
  revisionId: string,
): string {
  return `${ENGINEERING_ACTIVITY_ID_PREFIX}${revisionId}`;
}

/** One persisted revision's explicit lifecycle fields. */
export interface EngineeringActivityRevisionRecord {
  readonly id: string;
  readonly activityId: string;
  readonly predecessorRevisionId?: string;
}

export interface EngineeringActivity {
  readonly id: string;
  readonly rootRevisionId: string;
  /** Deterministic topological order; branches are ordered by revision id. */
  readonly revisionIds: readonly string[];
}

export interface EngineeringActivityLifecycleIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/**
 * Group revisions by their explicit activity identity. Array order, titles
 * and timestamps never change grouping or branch order.
 */
export function collectEngineeringActivities(
  revisions: readonly EngineeringActivityRevisionRecord[],
): readonly EngineeringActivity[] {
  const byActivity = new Map<string, EngineeringActivityRevisionRecord[]>();
  for (
    const revision of [...revisions].toSorted((left, right) =>
      left.id.localeCompare(right.id)
    )
  ) {
    const existing = byActivity.get(revision.activityId) ?? [];
    existing.push(revision);
    byActivity.set(revision.activityId, existing);
  }
  return [...byActivity.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([id, members]) => {
      const root = members.find((item) => item.predecessorRevisionId === undefined);
      const rootRevisionId = root?.id ?? members[0]!.id;
      return {
        id,
        rootRevisionId,
        revisionIds: orderActivityRevisions(members, rootRevisionId),
      };
    });
}

/**
 * Explicit tips of one activity. A revision is a leaf when no other given
 * revision names it as predecessor. Several successors stay several leaves;
 * array order never invents a current winner.
 */
export function leafRevisionIdsForActivity(
  revisions: readonly EngineeringActivityRevisionRecord[],
): readonly string[] {
  const predecessorIds = new Set(
    revisions.flatMap((item) =>
      item.predecessorRevisionId === undefined ? [] : [item.predecessorRevisionId]
    ),
  );
  return revisions
    .filter((item) => !predecessorIds.has(item.id))
    .map((item) => item.id)
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * Stamp server-owned activity identity for newly declared revisions.
 * Callers may name a predecessor; they cannot choose or re-parent activity IDs.
 */
export function stampEngineeringActivityIdentity(
  existing: readonly EngineeringActivityRevisionRecord[],
  declared: readonly {
    readonly id: string;
    readonly predecessorRevisionId?: string;
  }[],
): {
  readonly stamped: ReadonlyMap<
    string,
    { readonly activityId: string; readonly predecessorRevisionId?: string }
  >;
  readonly issues: readonly EngineeringActivityLifecycleIssue[];
} {
  const known = new Map(existing.map((item) => [item.id, item]));
  const pending = new Map(declared.map((item) => [item.id, item]));
  const stamped = new Map<
    string,
    { readonly activityId: string; readonly predecessorRevisionId?: string }
  >();
  const issues: EngineeringActivityLifecycleIssue[] = [];
  const visiting = new Set<string>();

  const resolve = (revisionId: string): string | undefined => {
    const already = stamped.get(revisionId);
    if (already) return already.activityId;
    const persisted = known.get(revisionId);
    if (persisted) return persisted.activityId;
    const declaredItem = pending.get(revisionId);
    if (!declaredItem) {
      issues.push({
        code: "unknown_predecessor",
        path: `workItems.${revisionId}.predecessorRevisionId`,
        message: "predecessor revision does not exist in this project",
      });
      return undefined;
    }
    if (visiting.has(revisionId)) {
      issues.push({
        code: "forward_predecessor",
        path: `workItems.${revisionId}.predecessorRevisionId`,
        message: "predecessor relation participates in a cycle",
      });
      return undefined;
    }
    visiting.add(revisionId);
    const predecessorId = declaredItem.predecessorRevisionId;
    if (predecessorId === undefined) {
      const activityId = engineeringActivityIdFromRootRevision(revisionId);
      stamped.set(revisionId, { activityId });
      visiting.delete(revisionId);
      return activityId;
    }
    if (predecessorId === revisionId) {
      issues.push({
        code: "self_predecessor",
        path: `workItems.${revisionId}.predecessorRevisionId`,
        message: "a revision cannot precede itself",
      });
      visiting.delete(revisionId);
      return undefined;
    }
    const activityId = resolve(predecessorId);
    visiting.delete(revisionId);
    if (!activityId) return undefined;
    stamped.set(revisionId, {
      activityId,
      predecessorRevisionId: predecessorId,
    });
    return activityId;
  };

  for (
    const item of [...declared].toSorted((left, right) =>
      left.id.localeCompare(right.id)
    )
  ) {
    resolve(item.id);
  }
  return { stamped, issues };
}

/** Exact attempts of one revision: agent runs bound to that work-item id. */
export function attemptIdsForRevision(
  runs: readonly { readonly id: string; readonly workItemId: string }[],
  revisionId: string,
): readonly string[] {
  return runs
    .filter((run) => run.workItemId === revisionId)
    .map((run) => run.id)
    .toSorted((left, right) => left.localeCompare(right));
}

export function collectEngineeringActivityLifecycleIssues(
  revisions: readonly EngineeringActivityRevisionRecord[],
  pathPrefix = "$.workItems",
): readonly EngineeringActivityLifecycleIssue[] {
  const issues: EngineeringActivityLifecycleIssue[] = [];
  const byId = new Map(revisions.map((item) => [item.id, item]));
  const indexById = new Map(revisions.map((item, index) => [item.id, index]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  revisions.forEach((item, index) => {
    const path = `${pathPrefix}[${index}]`;
    if (!item.activityId.trim()) {
      issues.push({
        code: "missing_activity_identity",
        path: `${path}.activityId`,
        message: "must name the stable activity identity",
      });
      return;
    }
    const predecessorId = item.predecessorRevisionId;
    if (predecessorId === undefined) {
      const expected = engineeringActivityIdFromRootRevision(item.id);
      if (item.activityId !== expected) {
        issues.push({
          code: "activity_identity_mismatch",
          path: `${path}.activityId`,
          message: "a root revision must use the server-derived activity identity",
        });
      }
      return;
    }
    if (predecessorId === item.id) {
      issues.push({
        code: "self_predecessor",
        path: `${path}.predecessorRevisionId`,
        message: "a revision cannot precede itself",
      });
      return;
    }
    const predecessor = byId.get(predecessorId);
    if (!predecessor) {
      issues.push({
        code: "unknown_predecessor",
        path: `${path}.predecessorRevisionId`,
        message: "predecessor revision does not exist in this project",
      });
      return;
    }
    if (predecessor.activityId !== item.activityId) {
      issues.push({
        code: "cross_activity_predecessor",
        path: `${path}.predecessorRevisionId`,
        message: "predecessor must belong to the same stable activity",
      });
    }
  });

  const visit = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const predecessorId = byId.get(id)?.predecessorRevisionId;
    const cycle = predecessorId !== undefined && byId.has(predecessorId) &&
      visit(predecessorId);
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };

  for (const item of revisions) {
    if (item.predecessorRevisionId === undefined) continue;
    if (visit(item.id)) {
      const index = indexById.get(item.id) ?? 0;
      if (
        !issues.some((issue) =>
          issue.code === "forward_predecessor" &&
          issue.path === `${pathPrefix}[${index}].predecessorRevisionId`
        )
      ) {
        issues.push({
          code: "forward_predecessor",
          path: `${pathPrefix}[${index}].predecessorRevisionId`,
          message: "predecessor relation participates in a cycle",
        });
      }
    }
  }
  return issues;
}

function orderActivityRevisions(
  members: readonly EngineeringActivityRevisionRecord[],
  rootRevisionId: string,
): readonly string[] {
  const children = new Map<string, string[]>();
  for (const member of members) {
    const parent = member.predecessorRevisionId;
    if (parent === undefined) continue;
    const existing = children.get(parent) ?? [];
    existing.push(member.id);
    children.set(parent, existing);
  }
  for (const [parent, ids] of children) {
    children.set(parent, ids.toSorted((left, right) => left.localeCompare(right)));
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
    for (const child of children.get(id) ?? []) walk(child);
  };
  walk(rootRevisionId);
  for (const member of members) {
    if (!seen.has(member.id)) ordered.push(member.id);
  }
  return ordered;
}
