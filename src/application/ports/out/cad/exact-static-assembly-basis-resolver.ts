/**
 * Provider-free reopening of one exact static assembly basis.
 *
 * The port stops at immutable canonical geometry evidence: it does not select
 * a profile, provider, method, tolerance, verdict, or operation. Vertical
 * consumers compose it with their own closed policy and capability catalogue.
 */

import type { GeometryModuleCapture } from "../../../../domain/cad/canonical/geometry-module-capture.ts";
import type { GeometryModuleReference } from "../../../../domain/cad/canonical/geometry-module-reference.ts";
import type { ImmutableBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  deepFreeze,
  exactRecord,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";

export interface ExactStaticAssemblyThreadBasis {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}

/** Identity fields required before a snapshot may be recrossed as a basis. */
export interface ExactStaticAssemblySnapshotIdentity {
  readonly id: string;
  readonly revision: number;
  readonly subject: { readonly id: string };
}

export interface ExactStaticAssemblyBasisRequest {
  readonly basis: ExactStaticAssemblyThreadBasis;
  /** Already-selected persisted snapshot; never a moving project tip. */
  readonly snapshot: ThreadSnapshot;
  readonly geometryModule: GeometryModuleReference;
}

/** Fully recrossed canonical module and its sibling authoritative STEP. */
export interface ResolvedStaticAssemblyBasis {
  readonly basis: ExactStaticAssemblyThreadBasis;
  readonly geometryModule: GeometryModuleReference;
  readonly primary: ThreadArtifact;
  readonly assemblyStep: ThreadArtifact;
  readonly capture: GeometryModuleCapture;
  /** Immutable reread of the exact STEP bytes named by `assemblyStep`. */
  readonly assemblyStepBytes: ImmutableBytes;
}

export interface ExactStaticAssemblyBasisResolver {
  resolve(
    request: ExactStaticAssemblyBasisRequest,
  ): Promise<ResolvedStaticAssemblyBasis>;
}

export function parseExactStaticAssemblyThreadBasis(
  value: unknown,
  path = "$exactStaticAssemblyBasis.basis",
): ExactStaticAssemblyThreadBasis {
  const root = exactRecord(value, ["snapshotId", "revision", "subjectId"], path);
  return deepFreeze({
    snapshotId: safeId(root.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    subjectId: safeId(root.subjectId, `${path}.subjectId`),
  });
}

/**
 * Structural identity only. Full Thread snapshot validation stays with the
 * already-selected persisted snapshot; this keeps the port from walking the
 * whole graph before the named basis is even comparable.
 */
export function readExactStaticAssemblySnapshotIdentity(
  value: unknown,
): ExactStaticAssemblySnapshotIdentity | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const snapshot = value as Record<string, unknown>;
  const subject = snapshot.subject;
  if (
    typeof snapshot.id !== "string" ||
    typeof snapshot.revision !== "number" ||
    subject === null ||
    typeof subject !== "object" ||
    Array.isArray(subject)
  ) {
    return undefined;
  }
  const subjectId = (subject as { readonly id?: unknown }).id;
  if (typeof subjectId !== "string") {
    return undefined;
  }
  return { id: snapshot.id, revision: snapshot.revision, subject: { id: subjectId } };
}

export function sameExactStaticAssemblyThreadBasis(
  snapshot: ExactStaticAssemblySnapshotIdentity,
  basis: ExactStaticAssemblyThreadBasis,
): boolean {
  return snapshot.id === basis.snapshotId &&
    snapshot.revision === basis.revision &&
    snapshot.subject.id === basis.subjectId;
}
