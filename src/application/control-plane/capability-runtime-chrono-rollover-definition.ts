/**
 * Closed, server-owned definition of the one host-only Chrono 0.3.1 → 0.3.2
 * rollover.
 *
 * This module owns identities and comparison rules only. It does not review
 * host state, mutate Docker, append a project ledger, or write the lock.
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
import type { ProjectCapabilityProposal } from "./project-capability-authorization.ts";
import type {
  AtomicCapabilityRuntimeUnit,
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeCatalog,
} from "./read-model/capability-runtime-catalog.ts";

export const CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID =
  "casys-chrono-031-to-032-v1" as const;

const CHRONO_UNIT_ID = "casys.mcp-chrono" as const;
const CHRONO_GROUP_ID = "casys-chrono" as const;
const CHRONO_SERVICE = "mcp-chrono" as const;
const CHRONO_VOLUME = "chrono-data" as const;
const CHRONO_SECRET_SLOT = "chrono-mcp-bearer-token" as const;
const CHRONO_LOOPBACK_PORT = "127.0.0.1:3025:3025" as const;

export class CapabilityRuntimeChronoRolloverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeChronoRolloverError";
  }
}

export interface CapabilityRuntimeChronoRolloverDefinition {
  /** Current, ordinary catalogue: it exposes the successor only. */
  readonly catalog: CapabilityRuntimeCatalog;
  /** Private, code-owned historic descriptor; never supplied by a caller. */
  readonly predecessor: {
    readonly unit: AtomicCapabilityRuntimeUnit;
    readonly launchGroup: CapabilityRuntimeLaunchGroup;
  };
  /** Current, code-owned Chrono topology enrolled in the normal registry. */
  readonly successor: {
    readonly unit: AtomicCapabilityRuntimeUnit;
    readonly launchGroup: CapabilityRuntimeLaunchGroup;
  };
}

export function assertClosedChronoRolloverDefinition(
  definition: CapabilityRuntimeChronoRolloverDefinition,
): void {
  const { predecessor, successor, catalog } = definition;
  const catalogued = catalog.units.filter((unit) => unit.id === CHRONO_UNIT_ID);
  if (
    predecessor.unit.id !== CHRONO_UNIT_ID ||
    predecessor.unit.version !== "0.3.1" ||
    successor.unit.id !== CHRONO_UNIT_ID || successor.unit.version !== "0.3.2" ||
    predecessor.launchGroup.id !== CHRONO_GROUP_ID ||
    predecessor.launchGroup.version !== "1.0.0" ||
    successor.launchGroup.id !== CHRONO_GROUP_ID ||
    successor.launchGroup.version !== "1.0.0" ||
    catalogued.length !== 1 || !sameUnit(catalogued[0]!, successor.unit)
  ) {
    throw new CapabilityRuntimeChronoRolloverError(
      "Chrono rollover definition no longer matches the exact server-owned predecessor and successor identities.",
    );
  }
  if (
    chronoImageReference(predecessor.unit) !==
      chronoImageReference(predecessor.launchGroup) ||
    chronoImageReference(successor.unit) !==
      chronoImageReference(successor.launchGroup) ||
    chronoImageReference(predecessor.unit) === chronoImageReference(successor.unit)
  ) {
    throw new CapabilityRuntimeChronoRolloverError(
      "Chrono rollover unit and launch-group image identities do not match.",
    );
  }
  if (
    deterministicJson(predecessor.launchGroup.acquisition) !==
      deterministicJson(successor.launchGroup.acquisition) ||
    predecessor.launchGroup.acquisition.kind !== "compose" ||
    predecessor.launchGroup.acquisition.projectName !== CHRONO_GROUP_ID ||
    deterministicJson(predecessor.launchGroup.retention) !==
      deterministicJson(successor.launchGroup.retention) ||
    predecessor.launchGroup.retention.volumes !== "preserve" ||
    predecessor.launchGroup.retention.containers !== "stop-only" ||
    predecessor.launchGroup.retention.images !== "preserve" ||
    deterministicJson(predecessor.launchGroup.secretSlots) !==
      deterministicJson(successor.launchGroup.secretSlots) ||
    deterministicJson(predecessor.launchGroup.secretSlots) !==
      deterministicJson([CHRONO_SECRET_SLOT]) ||
    predecessor.launchGroup.security !== successor.launchGroup.security ||
    predecessor.launchGroup.security !== "reviewed" ||
    deterministicJson(composeWithoutChronoImage(predecessor.launchGroup)) !==
      deterministicJson(composeWithoutChronoImage(successor.launchGroup)) ||
    deterministicJson(chronoTopologyWithoutImage(predecessor.launchGroup)) !==
      deterministicJson(chronoTopologyWithoutImage(successor.launchGroup)) ||
    !exactChronoComposeTopology(predecessor.launchGroup)
  ) {
    throw new CapabilityRuntimeChronoRolloverError(
      "Chrono rollover definition changes a project, service, port, secret, mount or volume outside mcp-chrono image identity.",
    );
  }
}

export function assertChronoRolloverIdentityMatchesDefinition(
  identity: CapabilityRuntimeRolloverIdentity,
  definition: CapabilityRuntimeChronoRolloverDefinition,
): void {
  if (
    identity.transitionId !== CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID ||
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
    identity.affectedProjects.length !== 0 ||
    identity.preserved.thread !== "preserve" ||
    identity.preserved.cas !== "preserve" ||
    identity.preserved.wal !== "preserve" ||
    identity.preserved.project !== "preserve" ||
    deterministicJson(identity.preserved.volumes) !==
      deterministicJson([{ id: CHRONO_VOLUME, action: "preserve" }])
  ) {
    throw new CapabilityRuntimeChronoRolloverError(
      "Chrono rollover durable identity differs from the one closed host-only transition.",
    );
  }
}

/** Host-only identity: project amendment and lock writes stay outside this saga. */
export function chronoRolloverIdentityFor(
  definition: CapabilityRuntimeChronoRolloverDefinition,
  authorizedAt: string,
): CapabilityRuntimeRolloverIdentity {
  return {
    transitionId: CHRONO_031_TO_032_ROLLOVER_TRANSITION_ID,
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
    affectedProjects: [],
    preserved: {
      thread: "preserve",
      cas: "preserve",
      wal: "preserve",
      project: "preserve",
      volumes: [{ id: CHRONO_VOLUME, action: "preserve" }],
    },
  };
}

/** Used only to inspect pre-saga host state; it has no affected projects. */
export function emptyChronoRolloverIdentity(
  definition: CapabilityRuntimeChronoRolloverDefinition,
  authorizedAt: string,
): CapabilityRuntimeRolloverIdentity {
  return chronoRolloverIdentityFor(definition, authorizedAt);
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

export function successorLockDesiredAllowsAuthorizedUse(
  lock: CapabilityRuntimeAdminLock,
  successor: AtomicCapabilityRuntimeUnit,
  authorizedChronoProjects: number,
): boolean {
  const units = lock.units.filter((unit) => unit.id === successor.id);
  if (units.length !== 1 || !sameLockedUnit(units[0]!, successor)) return false;
  return authorizedChronoProjects === 0 || units[0]!.desired === "active";
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

export function proposalHasExactChronoUnitMaterials(
  proposal: ProjectCapabilityProposal,
  unit: AtomicCapabilityRuntimeUnit,
): boolean {
  const expected = unit.materials.map((material) => ({
    unitId: unit.id,
    materialId: material.id,
    imageReference: material.imageReference,
    downloadBytes: material.effects.downloadBytes,
    storageBytes: material.effects.storageBytes,
  })).toSorted(compareMaterialIdentity);
  const actual = proposal.materials.filter((material) => material.unitId === unit.id)
    .map((material) => ({
      unitId: material.unitId,
      materialId: material.materialId,
      imageReference: material.imageReference,
      downloadBytes: material.downloadBytes,
      storageBytes: material.storageBytes,
    })).toSorted(compareMaterialIdentity);
  return deterministicJson(actual) === deterministicJson(expected);
}

export function composeWithoutChronoImage(
  group: CapabilityRuntimeLaunchGroup,
): unknown {
  const parsed = JSON.parse(group.compose.content) as {
    services?: Record<string, Record<string, unknown>>;
  };
  const services = parsed.services;
  if (
    !services || !services[CHRONO_SERVICE] ||
    typeof services[CHRONO_SERVICE] !== "object"
  ) {
    throw new CapabilityRuntimeChronoRolloverError(
      "Chrono rollover Compose descriptor has no mcp-chrono service.",
    );
  }
  const copy = structuredClone(parsed);
  delete copy.services![CHRONO_SERVICE]!.image;
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

function chronoImageReference(
  value: AtomicCapabilityRuntimeUnit | CapabilityRuntimeLaunchGroup,
): string {
  if (
    "materials" in value && value.materials.length > 0 && "id" in value.materials[0]!
  ) {
    const material = (value as AtomicCapabilityRuntimeUnit).materials.find(
      (item) => item.id === "mcp-chrono-image",
    );
    if (!material) {
      throw new CapabilityRuntimeChronoRolloverError(
        "Chrono rollover unit has no mcp-chrono-image material.",
      );
    }
    return material.imageReference;
  }
  const material = (value as CapabilityRuntimeLaunchGroup).materials.find(
    (item) => item.material.materialId === "mcp-chrono-image",
  );
  if (!material) {
    throw new CapabilityRuntimeChronoRolloverError(
      "Chrono rollover launch group has no mcp-chrono-image material.",
    );
  }
  return material.imageReference;
}

function chronoTopologyWithoutImage(group: CapabilityRuntimeLaunchGroup): unknown {
  return group.materials.map((member) => ({
    material: {
      unitId: member.material.unitId,
      materialId: member.material.materialId,
    },
    serviceName: member.serviceName,
    ownership: member.ownership,
  }));
}

function exactChronoComposeTopology(group: CapabilityRuntimeLaunchGroup): boolean {
  const compose = composeWithoutChronoImage(group) as {
    services?: Record<string, { ports?: unknown; volumes?: unknown }>;
    volumes?: unknown;
  };
  const service = compose.services?.[CHRONO_SERVICE];
  return deterministicJson(service?.ports) ===
      deterministicJson([CHRONO_LOOPBACK_PORT]) &&
    deterministicJson(service?.volumes) ===
      deterministicJson([`${CHRONO_VOLUME}:/data`]) &&
    deterministicJson(compose.volumes) ===
      deterministicJson({ [CHRONO_VOLUME]: {} });
}

function compareMaterialIdentity(
  left: { readonly materialId: string },
  right: { readonly materialId: string },
): number {
  return left.materialId.localeCompare(right.materialId);
}
