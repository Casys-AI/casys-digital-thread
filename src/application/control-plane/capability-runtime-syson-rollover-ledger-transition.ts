/**
 * Exact project-ledger transition for the one closed H1 SysON rollover.
 *
 * The service owns storage and saga ordering.  This module only recognizes
 * the predecessor, derives the one permissible successor, and compares their
 * capability-material boundaries.
 */

import type { CapabilityRuntimeRolloverIdentity } from "../../domain/capability/runtime/capability-runtime-rollover-saga.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { projectCapabilityEnvelopeDelta } from "./plan-project-capability-intent.ts";
import {
  fingerprintProjectCapabilityAuthorizationEvent,
  fingerprintProjectCapabilityProposal,
  PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
  type ProjectCapabilityAuthorizationEvent,
  type ProjectCapabilityLedger,
  type ProjectCapabilityProposal,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "./project-capability-authorization.ts";
import {
  CapabilityRuntimeSysonRolloverError,
  sameUnit,
} from "./capability-runtime-syson-rollover-definition.ts";
import type { AtomicCapabilityRuntimeUnit } from "./read-model/capability-runtime-catalog.ts";

export async function predecessorSysonRolloverLedgerFor(
  current: ProjectCapabilityLedger,
  target: CapabilityRuntimeRolloverIdentity["affectedProjects"][number],
  predecessorUnit: AtomicCapabilityRuntimeUnit,
): Promise<ProjectCapabilityLedger> {
  if (current.revision === target.ledgerRevision) {
    if (!fingerprintsEqual(current.ledgerFingerprint, target.ledgerFingerprint)) {
      throw new CapabilityRuntimeSysonRolloverError(
        `SysON rollover ledger ${current.projectId} no longer has its exact predecessor fingerprint.`,
      );
    }
    assertPredecessorSysonRolloverLedger(current, target, predecessorUnit);
    return current;
  }
  if (current.revision !== target.ledgerRevision + 1) {
    throw new CapabilityRuntimeSysonRolloverError(
      `SysON rollover ledger ${current.projectId} has an unexpected revision.`,
    );
  }
  if (!fingerprintsEqual(current.previous ?? undefined, target.ledgerFingerprint)) {
    throw new CapabilityRuntimeSysonRolloverError(
      `SysON rollover ledger ${current.projectId} successor does not extend the exact predecessor fingerprint.`,
    );
  }
  const events = current.events.slice(0, -1);
  const effectiveEnvelope = await reconstructProjectCapabilityEffectiveEnvelope(events);
  // The ledger port exposes only its tip. The durable transition identity
  // carries the predecessor fingerprint, so reconstruct only the event
  // prefix needed to derive the successor; do not invent an older link.
  const predecessor = {
    schemaVersion: PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
    projectId: current.projectId,
    revision: target.ledgerRevision,
    previous: null,
    events,
    effectiveEnvelope,
    ledgerFingerprint: structuredClone(target.ledgerFingerprint),
  };
  assertPredecessorSysonRolloverLedger(predecessor, target, predecessorUnit);
  return predecessor;
}

export function assertPredecessorSysonRolloverLedger(
  ledger: ProjectCapabilityLedger,
  target: CapabilityRuntimeRolloverIdentity["affectedProjects"][number],
  predecessorUnit: AtomicCapabilityRuntimeUnit,
): void {
  const proposal = ledger.effectiveEnvelope?.proposal;
  if (
    !proposal || ledger.effectiveEnvelope?.status !== "authorized" ||
    !fingerprintsEqual(
      proposal.capabilityProposalFingerprint,
      target.proposalFingerprint,
    )
  ) {
    throw new CapabilityRuntimeSysonRolloverError(
      `SysON rollover ledger ${ledger.projectId} does not retain the reviewed predecessor proposal.`,
    );
  }
  const unit = proposal.units.find((candidate) => candidate.id === "casys.syson-stack");
  if (
    !unit || !sameUnit(unit, predecessorUnit) ||
    !proposalHasExactUnitMaterials(proposal, predecessorUnit)
  ) {
    throw new CapabilityRuntimeSysonRolloverError(
      `SysON rollover ledger ${ledger.projectId} does not retain exact predecessor SysON material identity.`,
    );
  }
}

export async function successorSysonRolloverLedger(
  predecessor: ProjectCapabilityLedger,
  identity: CapabilityRuntimeRolloverIdentity,
  predecessorUnit: AtomicCapabilityRuntimeUnit,
  successorUnit: AtomicCapabilityRuntimeUnit,
): Promise<ProjectCapabilityLedger> {
  const proposal = predecessor.effectiveEnvelope?.proposal;
  if (!proposal) {
    throw new CapabilityRuntimeSysonRolloverError(
      "SysON predecessor ledger has no effective proposal.",
    );
  }
  const successorProposal = await successorProposalFor(
    proposal,
    predecessorUnit,
    successorUnit,
  );
  const delta = projectCapabilityEnvelopeDelta(proposal, successorProposal);
  assertSysonOnlyDelta(delta);
  const previousEnvelopeFingerprint = predecessor.effectiveEnvelope!
    .effectiveEnvelopeFingerprint;
  const eventBody = {
    kind: "amendment-authorized" as const,
    // The server chose this instant before durable intent preparation and
    // the identity carries it through every retry.  Never reuse a prior
    // authorization event's timestamp: that would falsify the amendment.
    recordedAt: identity.authorizedAt,
    previousEnvelopeFingerprint,
    proposalFingerprint: successorProposal.capabilityProposalFingerprint,
    delta,
  };
  const event: ProjectCapabilityAuthorizationEvent = {
    ...eventBody,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(eventBody),
  };
  const events = [...predecessor.events, event];
  const effectiveEnvelope = await reconstructProjectCapabilityEffectiveEnvelope(events);
  const body = {
    schemaVersion: PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION,
    projectId: predecessor.projectId,
    revision: predecessor.revision + 1,
    previous: predecessor.ledgerFingerprint,
    events,
    effectiveEnvelope,
  } as const;
  return { ...body, ledgerFingerprint: await sha256Fingerprint(body) };
}

export async function successorProposalFor(
  predecessor: ProjectCapabilityProposal,
  predecessorUnit: AtomicCapabilityRuntimeUnit,
  successorUnit: AtomicCapabilityRuntimeUnit,
): Promise<ProjectCapabilityProposal> {
  const successorMaterials = new Map(
    successorUnit.materials.map((material) => [material.id, material]),
  );
  const materials = predecessor.materials.map((material) => {
    if (material.unitId !== predecessorUnit.id) return structuredClone(material);
    const successor = successorMaterials.get(material.materialId);
    if (!successor) {
      throw new CapabilityRuntimeSysonRolloverError(
        "SysON successor unit is missing one predecessor material id.",
      );
    }
    return {
      ...structuredClone(material),
      imageReference: successor.imageReference,
      downloadBytes: successor.effects.downloadBytes,
      storageBytes: successor.effects.storageBytes,
    };
  }).toSorted((left, right) =>
    `${left.unitId}\u0000${left.materialId}`.localeCompare(
      `${right.unitId}\u0000${right.materialId}`,
    )
  );
  const body = {
    schemaVersion: predecessor.schemaVersion,
    mutatesRuntime: predecessor.mutatesRuntime,
    projectId: predecessor.projectId,
    source: predecessor.source,
    brief: structuredClone(predecessor.brief),
    intent: predecessor.intent === null ? null : structuredClone(predecessor.intent),
    semanticRequirements: structuredClone(predecessor.semanticRequirements),
    bindings: structuredClone(predecessor.bindings),
    units: predecessor.units.map((unit) =>
      unit.id === predecessorUnit.id
        ? structuredClone(successorUnit)
        : structuredClone(unit)
    ).toSorted((left, right) => left.id.localeCompare(right.id)),
    materials,
    effects: structuredClone(predecessor.effects),
    status: predecessor.status,
    activation: predecessor.activation,
    blockers: [...predecessor.blockers].toSorted((left, right) =>
      left.localeCompare(right)
    ),
  } as const;
  return {
    ...body,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(body),
  };
}

export function proposalHasExactUnitMaterials(
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
  // Proposal material mode is a separately attested host fact, not part of
  // the atomic OCI identity being rolled over. Keep the exact identity fields
  // and deliberately exclude `mode` rather than making every real ledger
  // impossible to recognize.
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

function assertSysonOnlyDelta(
  delta: ReturnType<typeof projectCapabilityEnvelopeDelta>,
): void {
  if (
    delta.addedRequirementKeys.length !== 0 ||
    delta.removedRequirementKeys.length !== 0 ||
    delta.addedRequirements.length !== 0 ||
    delta.requirementReplacements.length !== 0 ||
    delta.bindingReplacements.length !== 0 || delta.units.addedIds.length !== 0 ||
    delta.units.removedIds.length !== 0 ||
    deterministicJson(delta.units.changedIds) !==
      deterministicJson(["casys.syson-stack"]) ||
    delta.materials.added.length !== 0 || delta.materials.removedKeys.length !== 0 ||
    delta.materials.changed.some((change) =>
      !change.key.startsWith("casys.syson-stack\u0000")
    ) ||
    hasOperationalEffectsDelta(delta)
  ) {
    throw new CapabilityRuntimeSysonRolloverError(
      "SysON rollover proposal amendment changes authority outside the exact SysON unit/material boundary.",
    );
  }
}

function hasOperationalEffectsDelta(
  delta: ReturnType<typeof projectCapabilityEnvelopeDelta>,
): boolean {
  const effects = delta.effects;
  return effects.added.services.length !== 0 || effects.removed.services.length !== 0 ||
    effects.added.volumes.length !== 0 || effects.removed.volumes.length !== 0 ||
    effects.added.networks.length !== 0 || effects.removed.networks.length !== 0 ||
    effects.added.loopbackPorts.length !== 0 ||
    effects.removed.loopbackPorts.length !== 0 ||
    effects.added.bindMounts.length !== 0 || effects.removed.bindMounts.length !== 0 ||
    effects.added.devices.length !== 0 || effects.removed.devices.length !== 0 ||
    effects.added.secretSlots.length !== 0 ||
    effects.removed.secretSlots.length !== 0 ||
    effects.added.licences.length !== 0 || effects.removed.licences.length !== 0 ||
    effects.added.security !== null || effects.removed.security !== null ||
    effects.downloadBytes.delta !== 0 || effects.storageBytes.delta !== 0;
}

function compareMaterialIdentity(
  left: { readonly unitId: string; readonly materialId: string },
  right: { readonly unitId: string; readonly materialId: string },
): number {
  return `${left.unitId}\u0000${left.materialId}`.localeCompare(
    `${right.unitId}\u0000${right.materialId}`,
  );
}
