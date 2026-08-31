/**
 * Closed, server-owned definition of the one H1 SysON node repack rollover.
 *
 * This module owns identities and comparison rules only.  It does not review
 * host state, mutate Docker, or construct a project-capability amendment.
 */

import type { CapabilityRuntimeRolloverIdentity } from "../../domain/capability/runtime/capability-runtime-rollover-saga.ts";
import {
  type CapabilityRuntimeLaunchGroup,
  capabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { ProjectCapabilityLedger } from "./project-capability-authorization.ts";
import type {
  AtomicCapabilityRuntimeUnit,
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeCatalog,
} from "./read-model/capability-runtime-catalog.ts";

export const SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID =
  "casys-syson-node-repack-v1" as const;

export class CapabilityRuntimeSysonRolloverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeSysonRolloverError";
  }
}

export interface CapabilityRuntimeSysonRolloverDefinition {
  /** Current, ordinary catalogue: it exposes the successor only. */
  readonly catalog: CapabilityRuntimeCatalog;
  /** Private, code-owned historic descriptor; never supplied by a caller. */
  readonly predecessor: {
    readonly unit: AtomicCapabilityRuntimeUnit;
    readonly launchGroup: CapabilityRuntimeLaunchGroup;
  };
  /** Current, code-owned SysON topology enrolled in the normal registry. */
  readonly successor: {
    readonly unit: AtomicCapabilityRuntimeUnit;
    readonly launchGroup: CapabilityRuntimeLaunchGroup;
  };
}

export function assertClosedSysonRolloverDefinition(
  definition: CapabilityRuntimeSysonRolloverDefinition,
): void {
  const { predecessor, successor, catalog } = definition;
  if (
    predecessor.unit.id !== "casys.syson-stack" ||
    predecessor.unit.version !== "1.0.0" ||
    successor.unit.id !== "casys.syson-stack" || successor.unit.version !== "1.0.1" ||
    predecessor.launchGroup.id !== "casys-syson" ||
    predecessor.launchGroup.version !== "1.0.0" ||
    successor.launchGroup.id !== "casys-syson" ||
    successor.launchGroup.version !== "1.0.1" ||
    !catalog.units.some((unit) => sameUnit(unit, successor.unit))
  ) {
    throw new CapabilityRuntimeSysonRolloverError(
      "SysON rollover definition no longer matches the exact server-owned predecessor and successor identities.",
    );
  }
  if (
    deterministicJson(predecessor.launchGroup.acquisition) !==
      deterministicJson(successor.launchGroup.acquisition) ||
    predecessor.launchGroup.acquisition.kind !== "compose" ||
    predecessor.launchGroup.acquisition.projectName !== "casys-syson" ||
    deterministicJson(predecessor.launchGroup.retention) !==
      deterministicJson(successor.launchGroup.retention) ||
    predecessor.launchGroup.retention.volumes !== "preserve" ||
    deterministicJson(predecessor.launchGroup.secretSlots) !==
      deterministicJson(successor.launchGroup.secretSlots) ||
    deterministicJson(composeWithoutSysonAppImage(predecessor.launchGroup)) !==
      deterministicJson(composeWithoutSysonAppImage(successor.launchGroup))
  ) {
    throw new CapabilityRuntimeSysonRolloverError(
      "SysON rollover definition changes a project, service, port, secret, mount or volume outside syson-app image identity.",
    );
  }
}

export function assertSysonRolloverIdentityMatchesDefinition(
  identity: CapabilityRuntimeRolloverIdentity,
  definition: CapabilityRuntimeSysonRolloverDefinition,
): void {
  if (
    identity.transitionId !== SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID ||
    !sameCapabilityRuntimeLaunchGroupReference(
      identity.predecessor.launchGroup,
      capabilityRuntimeLaunchGroupReference(definition.predecessor.launchGroup),
    ) ||
    !sameCapabilityRuntimeLaunchGroupReference(
      identity.successor.launchGroup,
      capabilityRuntimeLaunchGroupReference(definition.successor.launchGroup),
    ) ||
    !sameUnitReference(identity.predecessor.unit, definition.predecessor.unit) ||
    !sameUnitReference(identity.successor.unit, definition.successor.unit) ||
    identity.preserved.thread !== "preserve" ||
    identity.preserved.cas !== "preserve" ||
    identity.preserved.wal !== "preserve" ||
    identity.preserved.project !== "preserve" ||
    deterministicJson(identity.preserved.volumes) !==
      deterministicJson([{ id: "syson-db-data", action: "preserve" }])
  ) {
    throw new CapabilityRuntimeSysonRolloverError(
      "SysON rollover durable identity differs from the one closed server-owned transition.",
    );
  }
}

export function sysonRolloverIdentityFor(
  definition: CapabilityRuntimeSysonRolloverDefinition,
  affected: readonly ProjectCapabilityLedger[],
  authorizedAt: string,
): CapabilityRuntimeRolloverIdentity {
  return {
    transitionId: SYSON_NODE_REPACK_ROLLOVER_TRANSITION_ID,
    authorizedAt,
    predecessor: {
      launchGroup: capabilityRuntimeLaunchGroupReference(
        definition.predecessor.launchGroup,
      ),
      unit: unitReference(definition.predecessor.unit),
    },
    successor: {
      launchGroup: capabilityRuntimeLaunchGroupReference(
        definition.successor.launchGroup,
      ),
      unit: unitReference(definition.successor.unit),
    },
    affectedProjects: affected.map((ledger) => ({
      projectId: ledger.projectId,
      ledgerRevision: ledger.revision,
      ledgerFingerprint: structuredClone(ledger.ledgerFingerprint),
      proposalFingerprint: structuredClone(
        ledger.effectiveEnvelope!.proposal.capabilityProposalFingerprint,
      ),
    })).toSorted((left, right) => left.projectId.localeCompare(right.projectId)),
    preserved: {
      thread: "preserve",
      cas: "preserve",
      wal: "preserve",
      project: "preserve",
      volumes: [{ id: "syson-db-data", action: "preserve" }],
    },
  };
}

/** Used only to inspect pre-saga host state; it has no affected projects. */
export function emptySysonRolloverIdentity(
  definition: CapabilityRuntimeSysonRolloverDefinition,
  authorizedAt: string,
): CapabilityRuntimeRolloverIdentity {
  return sysonRolloverIdentityFor(definition, [], authorizedAt);
}

export function sameUnit(
  left: Pick<
    AtomicCapabilityRuntimeUnit,
    "id" | "version" | "manifestFingerprint" | "materials"
  >,
  right: Pick<
    AtomicCapabilityRuntimeUnit,
    "id" | "version" | "manifestFingerprint" | "materials"
  >,
): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

export function sameLockedUnit(
  locked: CapabilityRuntimeAdminLock["units"][number],
  unit: AtomicCapabilityRuntimeUnit,
): boolean {
  return locked.id === unit.id && locked.version === unit.version &&
    fingerprintsEqual(locked.manifestFingerprint, unit.manifestFingerprint);
}

export function isSuccessorLock(
  lock: CapabilityRuntimeAdminLock,
  successor: AtomicCapabilityRuntimeUnit,
): boolean {
  const units = lock.units.filter((unit) => unit.id === successor.id);
  return units.length === 1 && sameLockedUnit(units[0]!, successor);
}

export function unitReference(unit: AtomicCapabilityRuntimeUnit) {
  return {
    id: unit.id,
    version: unit.version,
    manifestFingerprint: structuredClone(unit.manifestFingerprint),
  };
}

export function sameUnitReference(
  reference: {
    readonly id: string;
    readonly version: string;
    readonly manifestFingerprint: ContentFingerprint;
  },
  unit: AtomicCapabilityRuntimeUnit,
): boolean {
  return reference.id === unit.id && reference.version === unit.version &&
    fingerprintsEqual(reference.manifestFingerprint, unit.manifestFingerprint);
}

export function composeWithoutSysonAppImage(
  group: CapabilityRuntimeLaunchGroup,
): unknown {
  const parsed = JSON.parse(group.compose.content) as {
    services?: Record<string, Record<string, unknown>>;
  };
  const services = parsed.services;
  if (
    !services || !services["syson-app"] || typeof services["syson-app"] !== "object"
  ) {
    throw new CapabilityRuntimeSysonRolloverError(
      "SysON rollover Compose descriptor has no syson-app service.",
    );
  }
  const copy = structuredClone(parsed);
  delete copy.services!["syson-app"]!.image;
  return copy;
}

export function rolloverReviewBasis(
  identity: CapabilityRuntimeRolloverIdentity,
): unknown {
  // `authorizedAt` is persisted only by `prepare` after the review-state
  // fingerprint has been accepted.  Excluding it here lets an operator apply
  // a still-exact review across a new clock tick while all state-bearing
  // identities remain closed and fingerprinted.
  const { authorizedAt: _authorizedAt, ...basis } = identity;
  return basis;
}
