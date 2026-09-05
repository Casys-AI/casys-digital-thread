/**
 * Shared exact-scope checks for capability-runtime host sessions.
 *
 * These are deliberately limited to sealed runtime identity: they do not know
 * whether a caller is an execution run, a Compose preparation, or a disposable
 * Microsandbox preparation. Session-specific owner and recovery policy stays
 * with each coordinator.
 */

import {
  canonicalResolvedCapabilityRuntimeOperationText,
  type CapabilityRuntimeExecutionLeaseOwner,
  type CapabilityRuntimeHostLifecycle,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type ResolvedCapabilityRuntimeOperation,
  validateCapabilityRuntimeLease,
  validateResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { ProjectCapabilityRuntimeContext } from "../ports/out/capability/capability-runtime-supervisor.ts";

/** Read-only Microsandbox cache boundary. It never starts a sandbox. */
export interface CapabilityRuntimeMicrosandboxCache {
  ensureExactCached(input: {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly imageReference: string;
    readonly executionProfileFingerprint: ContentFingerprint;
  }): Promise<void>;
}

/**
 * Fixed server-owned invocation-profile attestation for one sealed microVM
 * material. It is keyed by the complete material identity so one profile
 * cannot lend its authority to another worker.
 */
export interface CapabilityRuntimeMicrosandboxProfileAttestation {
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly executionProfileFingerprint: ContentFingerprint;
}

export type CapabilityRuntimeSessionErrorFactory = (message: string) => Error;

/**
 * Checks a cold re-resolution against the exact sealed runtime operation.
 * Comparing canonical closed records catches a changed profile, material, or
 * lifecycle even if a caller happens to retain another matching field.
 */
export async function assertExactResolvedCapabilityRuntimeOperationRecheck(
  recheck: () => Promise<ResolvedCapabilityRuntimeOperation>,
  expected: ResolvedCapabilityRuntimeOperation,
  unavailable: CapabilityRuntimeSessionErrorFactory,
): Promise<void> {
  const current = validateResolvedCapabilityRuntimeOperation(await recheck());
  if (
    canonicalResolvedCapabilityRuntimeOperationText(current) !==
      canonicalResolvedCapabilityRuntimeOperationText(expected)
  ) {
    throw unavailable(
      "Operational capability changed after its sealed ROP recheck; requeue through a reviewed authorization amendment.",
    );
  }
}

/**
 * Normalizes exact lifecycle records by material identity and refuses a
 * contradictory second lifecycle rather than picking one implicitly.
 */
export function uniqueCapabilityRuntimeHostLifecycles(
  value: readonly CapabilityRuntimeHostLifecycle[],
  unavailable: CapabilityRuntimeSessionErrorFactory,
): readonly CapabilityRuntimeHostLifecycle[] {
  const result = new Map<string, CapabilityRuntimeHostLifecycle>();
  for (const lifecycle of value) {
    const key = capabilityRuntimeMaterialKey(lifecycle.material);
    const existing = result.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(lifecycle)) {
      throw unavailable(
        `Sealed operation has contradictory host lifecycle records for ${key}.`,
      );
    }
    result.set(key, structuredClone(lifecycle));
  }
  if (result.size === 0) {
    throw unavailable(
      "A demanded operational capability has no host lifecycle materials.",
    );
  }
  return [...result.values()].toSorted((left, right) =>
    capabilityRuntimeMaterialKey(left.material).localeCompare(
      capabilityRuntimeMaterialKey(right.material),
    )
  );
}

/**
 * Requires a one-to-one attestation between sealed disposable materials and
 * the fixed server profile list. The caller may not add, omit, or substitute a
 * profile for any material.
 */
export function exactMicrosandboxProfileAttestations(
  lifecycles: readonly CapabilityRuntimeHostLifecycle[],
  supplied: readonly CapabilityRuntimeMicrosandboxProfileAttestation[],
  unavailable: CapabilityRuntimeSessionErrorFactory,
): ReadonlyMap<string, ContentFingerprint> {
  const expected = lifecycles.filter((lifecycle) =>
    lifecycle.kind === "ephemeral-microsandbox"
  );
  const values = new Map<string, ContentFingerprint>();
  for (const profile of supplied) {
    const key = capabilityRuntimeMaterialKey(profile.material);
    if (values.has(key)) {
      throw unavailable(
        `Microsandbox execution-profile attestation is duplicated for ${key}.`,
      );
    }
    const lifecycle = expected.find((candidate) =>
      capabilityRuntimeMaterialKey(candidate.material) === key
    );
    if (!lifecycle) {
      throw unavailable(
        `Microsandbox execution-profile attestation is extra for ${key}.`,
      );
    }
    if (lifecycle.material.imageDigest !== profile.material.imageDigest) {
      throw unavailable(
        `Microsandbox execution-profile attestation digest does not match ${key}.`,
      );
    }
    values.set(key, profile.executionProfileFingerprint);
  }
  for (const lifecycle of expected) {
    const key = capabilityRuntimeMaterialKey(lifecycle.material);
    if (!values.has(key)) {
      throw unavailable(
        `Microsandbox execution-profile attestation is absent for ${key}.`,
      );
    }
  }
  return values;
}

/**
 * Resolves only the catalog reference whose digest is already sealed into the
 * material. Mutable tags and catalog rollovers cannot satisfy this lookup.
 */
export function exactCatalogImageReference(
  context: Pick<ProjectCapabilityRuntimeContext, "catalog">,
  identity: CapabilityRuntimeMaterialIdentity,
  unavailable: CapabilityRuntimeSessionErrorFactory,
): string {
  const unit = context.catalog.units.find((candidate) =>
    candidate.id === identity.unitId
  );
  const material = unit?.materials.find((candidate) =>
    candidate.id === identity.materialId
  );
  if (
    !material || !material.imageReference.endsWith(`@sha256:${identity.imageDigest}`)
  ) {
    throw unavailable(
      `Current runtime catalog no longer attests ${identity.unitId}/${identity.materialId} with the sealed digest.`,
    );
  }
  return material.imageReference;
}

/**
 * Validates the immutable lease scope shared by every host-session flavour.
 * Execution-only ownership provenance is intentionally checked separately by
 * the execution coordinator and, for queued pre-claim retries, by H1 under
 * its host lock.
 */
export function assertExactCapabilityRuntimeLeaseScope(
  storedValue: CapabilityRuntimeLease,
  candidateValue: CapabilityRuntimeLease,
  unavailable: CapabilityRuntimeSessionErrorFactory,
): CapabilityRuntimeLease {
  const stored = validateCapabilityRuntimeLease(storedValue);
  const candidate = validateCapabilityRuntimeLease(candidateValue);
  const sameScope = stored.id === candidate.id &&
    stored.projectId === candidate.projectId &&
    sameCapabilityRuntimeTokens(stored.bindingIds, candidate.bindingIds) &&
    sameCapabilityRuntimeTokens(stored.materialKeys, candidate.materialKeys) &&
    sameCapabilityRuntimeTokens(
      stored.launchGroups.map(capabilityRuntimeLaunchGroupToken),
      candidate.launchGroups.map(capabilityRuntimeLaunchGroupToken),
    );
  if (!sameScope) {
    throw unavailable(
      "The deterministic capability lease id is already held for another operational scope; recovery must resolve it.",
    );
  }
  return stored;
}

/**
 * Compares every immutable execution-run provenance fact.  Callers that need
 * an owner-bearing lease must reject an absent legacy owner rather than infer
 * one from the generic lease scope.
 */
export function sameExactCapabilityRuntimeExecutionLeaseOwner(
  left: CapabilityRuntimeExecutionLeaseOwner | undefined,
  right: CapabilityRuntimeExecutionLeaseOwner | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  return left.kind === right.kind && left.runId === right.runId &&
    left.operation.id === right.operation.id &&
    left.operation.version === right.operation.version &&
    left.basis.snapshotId === right.basis.snapshotId &&
    left.basis.revision === right.basis.revision &&
    left.basis.subjectId === right.basis.subjectId &&
    left.operationalCapabilityFingerprint.algorithm ===
      right.operationalCapabilityFingerprint.algorithm &&
    left.operationalCapabilityFingerprint.digest ===
      right.operationalCapabilityFingerprint.digest;
}

export function capabilityRuntimeLaunchGroupToken(
  group: CapabilityRuntimeLaunchGroupReference,
): string {
  return `${group.id}\u0000${group.version}\u0000${group.fingerprint.digest}`;
}

export function sameCapabilityRuntimeTokens(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const orderedLeft = [...left].toSorted();
  const orderedRight = [...right].toSorted();
  return orderedLeft.length === orderedRight.length &&
    orderedLeft.every((token, index) => token === orderedRight[index]);
}
