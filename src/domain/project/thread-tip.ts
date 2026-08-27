/**
 * Unique current Thread tip from a project ledger.
 *
 * Omitting a named basis is not `latest`. Several snapshots at the same max
 * revision, or none, stay unresolved.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../kernel/case-validation.ts";
import type {
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "./engineering-project.ts";

export type ThreadTipDiagnosticCode = "basis-absent" | "basis-ambiguous";

export interface ThreadTipDiagnostic {
  readonly code: ThreadTipDiagnosticCode;
  readonly artifactId: null;
  readonly message: string;
}

export type ThreadTipSelection =
  | { readonly status: "ok"; readonly basis: EngineeringThreadSnapshotBasis }
  | { readonly status: "unresolved"; readonly diagnostic: ThreadTipDiagnostic };

export function isLatestSnapshotId(snapshotId: string): boolean {
  return snapshotId.toLowerCase() === "latest";
}

/**
 * Closed Thread basis shape. Callers that must refuse `latest` use
 * `parseExactThreadSnapshotBasis`; FEA keeps the alias so it can emit
 * `basis-latest` instead of a TypeError.
 */
export function parseThreadSnapshotBasis(
  value: unknown,
  path: string,
): EngineeringThreadSnapshotBasis {
  const basis = exactRecord(
    value,
    ["kind", "snapshotId", "revision", "subjectId"],
    path,
  );
  literalValue(basis.kind, "thread-snapshot", `${path}.kind`);
  return deepFreeze({
    kind: "thread-snapshot",
    snapshotId: safeId(basis.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(basis.revision, `${path}.revision`),
    subjectId: safeId(basis.subjectId, `${path}.subjectId`),
  });
}

/** Named command basis. `latest` is not an identity. */
export function parseExactThreadSnapshotBasis(
  value: unknown,
  path: string,
): EngineeringThreadSnapshotBasis {
  const basis = parseThreadSnapshotBasis(value, path);
  if (isLatestSnapshotId(basis.snapshotId)) {
    throw new TypeError(`${path}.snapshotId must not use a latest alias.`);
  }
  return basis;
}

export function selectCurrentThreadTip(
  refs: readonly EngineeringThreadSnapshotRef[],
): ThreadTipSelection {
  if (refs.length === 0) {
    return {
      status: "unresolved",
      diagnostic: {
        code: "basis-absent",
        artifactId: null,
        message:
          "The project has no Thread snapshot yet. Run the approved-brief baseline first, or name an exact basis.",
      },
    };
  }
  let maxRevision = 0;
  for (const ref of refs) {
    if (ref.revision > maxRevision) maxRevision = ref.revision;
  }
  const tips = refs.filter((ref) => ref.revision === maxRevision);
  if (tips.length !== 1) {
    return {
      status: "unresolved",
      diagnostic: {
        code: "basis-ambiguous",
        artifactId: null,
        message:
          `The project has ${tips.length} Thread snapshots at revision ${maxRevision}. Name the exact basis.`,
      },
    };
  }
  const tip = tips[0]!;
  return {
    status: "ok",
    basis: deepFreeze({
      kind: "thread-snapshot",
      snapshotId: tip.snapshotId,
      revision: tip.revision,
      subjectId: tip.subjectId,
    }),
  };
}
