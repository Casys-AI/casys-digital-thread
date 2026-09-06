import { deepFreeze } from "../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import {
  PROJECT_CAPABILITY_INTENT_SCHEMA_VERSION,
  type ProjectCapabilityIntent,
} from "./project-capability-intent.ts";
import {
  engineeringCapabilityRequirementKey,
  type RequiredEngineeringCapability,
} from "./engineering-capability.ts";
import {
  validateCapabilityRuntimeLaunchGroupReference,
} from "./runtime/capability-runtime-launch-group.ts";
import type {
  AtomicCapabilityRuntimeUnit,
  CapabilityRuntimeBindMount,
  CapabilityRuntimeLicence,
  CapabilityRuntimeRequirementsPlan,
  CapabilityRuntimeService,
  CapabilityRuntimeVolume,
  PlannedCapabilityRuntimeMaterial,
  PlannedProjectCapabilityBinding,
  ProjectCapabilityPlanEffects,
} from "./runtime/capability-runtime-catalog.ts";
import { fingerprintAtomicCapabilityRuntimeUnit } from "./runtime/capability-runtime-catalog.ts";

/** Separate host-operational authority; it is not an MRTR or result verdict. */
export const PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION =
  "project-capability-proposal/1.0" as const;
export const PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION =
  "project-capability-ledger/1.0" as const;

export interface ProjectCapabilityBriefBasis {
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
  readonly briefReviewFingerprint: ContentFingerprint;
}

/**
 * Exact server-owned candidate set presented with a pending brief. It retains
 * a selected candidate even when runtime qualification/activation is blocked.
 */
export interface ProjectCapabilityProposal {
  readonly schemaVersion: typeof PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION;
  readonly mutatesRuntime: false;
  readonly projectId: string;
  readonly source: "brief-intent" | "published-plan";
  readonly brief: ProjectCapabilityBriefBasis;
  /** Present only for a proposal made before project_plan_publish. */
  readonly intent: ProjectCapabilityIntent | null;
  /** Exact semantic ceiling from the source above; no provider selection. */
  readonly semanticRequirements: readonly RequiredEngineeringCapability[];
  readonly bindings: readonly PlannedProjectCapabilityBinding[];
  /** Exact installable units, versions, manifests and digest-pinned materials. */
  readonly units: readonly AtomicCapabilityRuntimeUnit[];
  /** Host modes are stable plan facts; cache presence/desired state are excluded. */
  readonly materials: readonly Pick<
    PlannedCapabilityRuntimeMaterial,
    | "unitId"
    | "materialId"
    | "imageReference"
    | "mode"
    | "downloadBytes"
    | "storageBytes"
  >[];
  readonly effects: ProjectCapabilityPlanEffects;
  readonly status: CapabilityRuntimeRequirementsPlan["status"];
  readonly activation: CapabilityRuntimeRequirementsPlan["activation"];
  readonly blockers: readonly string[];
  /** Exact approval scope, excluding transient cache image presence and lock state. */
  readonly capabilityProposalFingerprint: ContentFingerprint;
}

export interface ProjectCapabilityApprovalReceipt {
  readonly projectSnapshotId: string;
  readonly projectRevision: number;
  readonly approvedBriefFingerprint: ContentFingerprint;
}

export interface ProjectCapabilityAuthorizationEventBase {
  readonly eventFingerprint: ContentFingerprint;
  readonly recordedAt: string;
}

export interface ProjectCapabilityInitialPrepared
  extends ProjectCapabilityAuthorizationEventBase {
  readonly kind: "initial-prepared";
  readonly proposal: ProjectCapabilityProposal;
}

export interface ProjectCapabilityInitialAuthorized
  extends ProjectCapabilityAuthorizationEventBase {
  readonly kind: "initial-authorized";
  readonly proposalFingerprint: ContentFingerprint;
  readonly approval: ProjectCapabilityApprovalReceipt;
}

/** Delta only: all unchanged envelope material remains in the preceding revision. */
export interface ProjectCapabilityAmendment
  extends ProjectCapabilityAuthorizationEventBase {
  readonly kind: "amendment-authorized";
  readonly previousEnvelopeFingerprint: ContentFingerprint;
  /** The exact server-derived proposal being authorized, without duplicating it in the history. */
  readonly proposalFingerprint: ContentFingerprint;
  readonly delta: ProjectCapabilityEnvelopeDelta;
}

export interface ProjectCapabilityRevocation
  extends ProjectCapabilityAuthorizationEventBase {
  readonly kind: "revocation-recorded";
  /** V1 is deliberately all-or-nothing; partial revocation would need a precise remaining-envelope algebra. */
  readonly scope: "full-envelope";
  readonly reason: string;
}

export type ProjectCapabilityAuthorizationEvent =
  | ProjectCapabilityInitialPrepared
  | ProjectCapabilityInitialAuthorized
  | ProjectCapabilityAmendment
  | ProjectCapabilityRevocation;

/** Reconstructed local ceiling. No Docker lock or secret lives in this value. */
export interface ProjectCapabilityEffectiveEnvelope {
  readonly proposal: ProjectCapabilityProposal;
  readonly effectiveEnvelopeFingerprint: ContentFingerprint;
  readonly status: "authorized" | "revoked";
}

export interface ProjectCapabilityLedger {
  readonly schemaVersion: typeof PROJECT_CAPABILITY_LEDGER_SCHEMA_VERSION;
  readonly projectId: string;
  readonly revision: number;
  readonly previous: ContentFingerprint | null;
  readonly events: readonly ProjectCapabilityAuthorizationEvent[];
  /** Persisted projection, rebuilt from the append-only event history before write. */
  readonly effectiveEnvelope: ProjectCapabilityEffectiveEnvelope | null;
  readonly ledgerFingerprint: ContentFingerprint;
}

export interface ProjectCapabilityEnvelopeDelta {
  readonly addedRequirementKeys: readonly string[];
  readonly removedRequirementKeys: readonly string[];
  /** Full records only for requirements newly introduced by the amendment. */
  readonly addedRequirements: readonly RequiredEngineeringCapability[];
  /** Minimum-qualification changes retain their stable semantic key but are still material. */
  readonly requirementReplacements: readonly ProjectCapabilityRequirementReplacement[];
  readonly bindingReplacements: readonly ProjectCapabilityBindingReplacement[];
  readonly units: {
    readonly addedIds: readonly string[];
    readonly removedIds: readonly string[];
    readonly changedIds: readonly string[];
    readonly added: readonly AtomicCapabilityRuntimeUnit[];
    readonly changed: readonly ProjectCapabilityUnitReplacement[];
  };
  readonly materials: {
    readonly added: ReadonlyArray<ProjectCapabilityProposal["materials"][number]>;
    readonly removedKeys: readonly string[];
    readonly changed: readonly ProjectCapabilityMaterialReplacement[];
  };
  readonly effects: ProjectCapabilityHostEffectsDelta;
  /** Non-collection fields that become authoritative with this exact delta. */
  readonly next: {
    readonly source: ProjectCapabilityProposal["source"];
    readonly brief: ProjectCapabilityBriefBasis;
    readonly intent: ProjectCapabilityIntent | null;
    readonly status: ProjectCapabilityProposal["status"];
    readonly activation: ProjectCapabilityProposal["activation"];
    readonly blockers: readonly string[];
  };
}

export interface ProjectCapabilityBindingReplacement {
  readonly requirementKey: string;
  readonly previous: PlannedProjectCapabilityBinding | null;
  readonly next: PlannedProjectCapabilityBinding | null;
}

/**
 * Additions (`previous === null`) stay amendments. Published evidence is
 * scoped to the replaced requirement: unrelated Thread snapshots cannot
 * force a method transition.
 */
export function projectCapabilityBindingReplacementChangesMethod(
  replacement: ProjectCapabilityBindingReplacement,
): boolean {
  if (replacement.previous === null) return false;
  if (replacement.next === null) return true;
  return !sameVersionedMethodIdentity(replacement.previous, replacement.next);
}

/**
 * Additions (`previous === null`) stay amendments. Thread evidence binds a
 * project to a versioned method, not an adapter's internal source location.
 * Dropping a prior binding or changing that method identity needs a transition
 * only when that same requirement has published method evidence.
 */
export function projectCapabilityChangeRequiresMethodTransition(
  delta: ProjectCapabilityEnvelopeDelta,
  hasPublishedMethodEvidence: (requirementKey: string) => boolean,
): boolean {
  return delta.bindingReplacements.some((replacement) =>
    projectCapabilityBindingReplacementChangesMethod(replacement) &&
    hasPublishedMethodEvidence(replacement.requirementKey)
  );
}

/**
 * Unused-withdrawal may shrink only by dropping requirements the current plan
 * no longer names. Any addition, replacement, or remaining-binding/digest
 * change is a published-plan amendment or method transition instead.
 * Dropping the unused unit that made aggregate security or byte estimates
 * unknown may improve `unknown -> reviewed` and `null -> known`; those
 * reductions are not new host authority. `reviewed -> unknown` and a larger
 * known byte estimate remain widenings.
 */
export function isStrictUnusedWithdrawalDelta(
  delta: ProjectCapabilityEnvelopeDelta,
): boolean {
  if (
    delta.removedRequirementKeys.length === 0 ||
    delta.addedRequirementKeys.length > 0 ||
    delta.addedRequirements.length > 0 ||
    delta.requirementReplacements.length > 0 ||
    delta.units.addedIds.length > 0 ||
    delta.units.changedIds.length > 0 ||
    delta.units.added.length > 0 ||
    delta.units.changed.length > 0 ||
    delta.materials.added.length > 0 ||
    delta.materials.changed.length > 0
  ) {
    return false;
  }
  const removedRequirements = new Set(delta.removedRequirementKeys);
  if (
    delta.bindingReplacements.some((replacement) =>
      replacement.next !== null || replacement.previous === null ||
      !removedRequirements.has(replacement.requirementKey)
    )
  ) {
    return false;
  }
  return !unusedWithdrawalAddsHostEffects(delta.effects);
}

function unusedWithdrawalAddsHostEffects(
  effects: ProjectCapabilityHostEffectsDelta,
): boolean {
  const added = effects.added;
  if (
    added.services.length > 0 || added.volumes.length > 0 ||
    added.networks.length > 0 || added.loopbackPorts.length > 0 ||
    added.bindMounts.length > 0 || added.devices.length > 0 ||
    added.secretSlots.length > 0 || added.licences.length > 0 ||
    added.security === "unknown"
  ) {
    return true;
  }
  return bytesIncreaseHostAuthority(effects.downloadBytes) ||
    bytesIncreaseHostAuthority(effects.storageBytes);
}

/** Only a larger known estimate is a byte widening; `null -> known` is not. */
function bytesIncreaseHostAuthority(value: ProjectCapabilityBytesDelta): boolean {
  if (value.previous === null || value.next === null) return false;
  return value.next > value.previous;
}

/**
 * Adapter metadata remains visible in the amendment delta but cannot
 * reinterpret recorded evidence. Missing candidate identities remain a method
 * transition rather than being treated as equal by omission.
 */
function sameVersionedMethodIdentity(
  previous: PlannedProjectCapabilityBinding,
  next: PlannedProjectCapabilityBinding,
): boolean {
  if (previous.candidate === undefined || next.candidate === undefined) {
    return false;
  }
  return previous.candidate.id === next.candidate.id &&
    previous.candidate.version === next.candidate.version &&
    previous.candidate.adapter.id === next.candidate.adapter.id &&
    previous.candidate.adapter.version === next.candidate.adapter.version &&
    deterministicJson(previous.candidate.profile) ===
      deterministicJson(next.candidate.profile);
}

export interface ProjectCapabilityRequirementReplacement {
  readonly requirementKey: string;
  readonly previous: RequiredEngineeringCapability;
  readonly next: RequiredEngineeringCapability;
}

export interface ProjectCapabilityUnitReplacement {
  readonly id: string;
  readonly previous: AtomicCapabilityRuntimeUnit;
  readonly next: AtomicCapabilityRuntimeUnit;
}

export interface ProjectCapabilityMaterialReplacement {
  readonly key: string;
  readonly previous: ProjectCapabilityProposal["materials"][number];
  readonly next: ProjectCapabilityProposal["materials"][number];
}

export interface ProjectCapabilityHostEffectsDelta {
  readonly added: ProjectCapabilityHostEffectSet;
  readonly removed: ProjectCapabilityHostEffectSet;
  /** Null is literal when either side is unknown; it is never guessed. */
  readonly downloadBytes: ProjectCapabilityBytesDelta;
  readonly storageBytes: ProjectCapabilityBytesDelta;
}

export interface ProjectCapabilityBytesDelta {
  readonly previous: number | null;
  readonly next: number | null;
  readonly delta: number | null;
}

export interface ProjectCapabilityHostEffectSet {
  readonly services: readonly CapabilityRuntimeService[];
  readonly volumes: readonly CapabilityRuntimeVolume[];
  readonly networks: readonly ProjectCapabilityPlanEffects["networks"][number][];
  readonly loopbackPorts: readonly number[];
  readonly bindMounts: readonly CapabilityRuntimeBindMount[];
  readonly devices: readonly string[];
  readonly secretSlots: readonly string[];
  readonly licences: readonly CapabilityRuntimeLicence[];
  readonly security: "reviewed" | "unknown" | null;
}

/**
 * Fingerprints every operational fact that the human actually authorizes. It
 * deliberately excludes cache/image presence and the runtime-admin lock.
 */
export async function fingerprintProjectCapabilityProposal(
  proposal: Omit<ProjectCapabilityProposal, "capabilityProposalFingerprint">,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(projectCapabilityProposalFingerprintBody(proposal));
}

/**
 * The reusable operational ceiling, deliberately independent from the brief
 * snapshot/review basis and from editorial proposal provenance. It still binds
 * every semantic, exact candidate binding, unit/material and host-effect fact
 * that a human authorized. Current availability/mode and blockers are local
 * runtime observations, not an amendment-worthy human choice.
 */
export async function fingerprintProjectCapabilityCeiling(
  proposal:
    | ProjectCapabilityProposal
    | Omit<ProjectCapabilityProposal, "capabilityProposalFingerprint">,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(projectCapabilityProposalCeilingFingerprintBody(
    proposal,
  ));
}

/** Editorial brief revisions can reuse only an exactly identical ceiling. */
export async function projectCapabilityProposalsHaveEquivalentCeilings(
  left: ProjectCapabilityProposal,
  right: ProjectCapabilityProposal,
): Promise<boolean> {
  return fingerprintsEqual(
    await fingerprintProjectCapabilityCeiling(left),
    await fingerprintProjectCapabilityCeiling(right),
  );
}

export async function validateProjectCapabilityProposal(
  value: unknown,
): Promise<ProjectCapabilityProposal> {
  const proposal = exactRecord(value, [
    "schemaVersion",
    "mutatesRuntime",
    "projectId",
    "source",
    "brief",
    "intent",
    "semanticRequirements",
    "bindings",
    "units",
    "materials",
    "effects",
    "status",
    "activation",
    "blockers",
    "capabilityProposalFingerprint",
  ], "Capability proposal") as unknown as ProjectCapabilityProposal;
  if (
    proposal.schemaVersion !== PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION ||
    proposal.mutatesRuntime !== false ||
    !safeProjectId(proposal.projectId) ||
    (proposal.source !== "brief-intent" && proposal.source !== "published-plan") ||
    !Array.isArray(proposal.semanticRequirements) ||
    !Array.isArray(proposal.bindings) ||
    !Array.isArray(proposal.units) || !Array.isArray(proposal.materials) ||
    !Array.isArray(proposal.blockers) ||
    !fingerprint(proposal.capabilityProposalFingerprint)
  ) {
    throw new TypeError("Capability proposal has an invalid top-level shape.");
  }
  const brief = exactRecord(proposal.brief, [
    "briefSnapshotId",
    "briefRevision",
    "briefReviewFingerprint",
  ], "Capability proposal brief") as unknown as ProjectCapabilityBriefBasis;
  if (
    typeof brief.briefSnapshotId !== "string" ||
    !Number.isSafeInteger(brief.briefRevision) ||
    brief.briefRevision < 1 || !fingerprint(brief.briefReviewFingerprint) ||
    !proposal.effects || typeof proposal.effects !== "object" ||
    (proposal.intent !== null &&
      (typeof proposal.intent !== "object" || Array.isArray(proposal.intent)))
  ) {
    throw new TypeError(
      "Capability proposal contains an invalid brief, intent, or effects value.",
    );
  }
  if (proposal.intent !== null) await validateProjectCapabilityIntent(proposal.intent);
  for (const requirement of proposal.semanticRequirements) {
    validateRequirement(requirement);
  }
  for (const binding of proposal.bindings) validateBinding(binding);
  for (const unit of proposal.units) await validateUnit(unit);
  for (const material of proposal.materials) validatePlannedMaterial(material);
  validateEffects(proposal.effects);
  if (
    ![
      "ready",
      "changes-required",
      "blocked",
      "unresolved",
    ].includes(proposal.status) ||
    !["allowed", "blocked"].includes(proposal.activation) ||
    proposal.blockers.some((blocker) => typeof blocker !== "string")
  ) {
    throw new TypeError(
      "Capability proposal status, activation, or blockers are invalid.",
    );
  }
  const { capabilityProposalFingerprint: _fingerprint, ...proposalBody } = proposal;
  const expected = await fingerprintProjectCapabilityProposal(proposalBody);
  if (!fingerprintsEqual(expected, proposal.capabilityProposalFingerprint)) {
    throw new TypeError(
      "Capability proposal fingerprint does not match its exact authorization body.",
    );
  }
  return deepFreeze(structuredClone(proposal));
}

export async function fingerprintProjectCapabilityAuthorizationEvent(
  event: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(event);
}

/**
 * Rebuilds the effective authorization from all immutable events. The ledger
 * store calls this on every read and write, so a persisted projection can never
 * become an independent mutable authority.
 */
export async function reconstructProjectCapabilityEffectiveEnvelope(
  events: readonly ProjectCapabilityAuthorizationEvent[],
): Promise<ProjectCapabilityEffectiveEnvelope | null> {
  let prepared: ProjectCapabilityProposal | undefined;
  let effective: ProjectCapabilityProposal | undefined;
  let revoked = false;
  for (const event of events) {
    const { eventFingerprint: _fingerprint, ...eventBody } = event;
    const expectedEventFingerprint =
      await fingerprintProjectCapabilityAuthorizationEvent(eventBody);
    if (!fingerprintsEqual(expectedEventFingerprint, event.eventFingerprint)) {
      throw new TypeError(
        "Capability ledger event fingerprint does not match its exact event body.",
      );
    }
    if (event.kind === "initial-prepared") {
      if (prepared || effective || revoked) {
        throw new TypeError(
          "Capability ledger may contain only one initial-prepared event before its initial authorization.",
        );
      }
      prepared = await validateProjectCapabilityProposal(event.proposal);
      continue;
    }
    if (event.kind === "initial-authorized") {
      if (
        !prepared ||
        !fingerprintsEqual(
          prepared.capabilityProposalFingerprint,
          event.proposalFingerprint,
        )
      ) {
        throw new TypeError(
          "Initial capability authorization has no exact prepared proposal.",
        );
      }
      if (
        effective || !fingerprintsEqual(
          event.approval.approvedBriefFingerprint,
          prepared.brief.briefReviewFingerprint,
        )
      ) {
        throw new TypeError(
          "Initial capability authorization must be unique and match the prepared brief review fingerprint.",
        );
      }
      effective = prepared;
      continue;
    }
    if (event.kind === "amendment-authorized") {
      if (
        !effective || !fingerprintsEqual(
          await effectiveEnvelopeFingerprintFor(
            effective,
            revoked ? "revoked" : "authorized",
          ),
          event.previousEnvelopeFingerprint,
        )
      ) {
        throw new TypeError(
          "Capability amendment does not extend the exact prior effective envelope.",
        );
      }
      if (revoked) {
        throw new TypeError(
          "A revoked capability envelope cannot be amended without a new explicit authority.",
        );
      }
      effective = await validateProjectCapabilityProposal(
        await applyProjectCapabilityEnvelopeDelta(
          effective,
          event.delta,
          event.proposalFingerprint,
        ),
      );
      continue;
    }
    if (event.kind === "revocation-recorded") {
      if (!effective || event.scope !== "full-envelope" || !event.reason.trim()) {
        throw new TypeError(
          "Capability revocation must explicitly revoke one complete effective envelope.",
        );
      }
      if (revoked) {
        throw new TypeError("Capability envelope may be revoked only once.");
      }
      revoked = true;
    }
  }
  if (!effective) return null;
  return deepFreeze({
    proposal: effective,
    effectiveEnvelopeFingerprint: await effectiveEnvelopeFingerprintFor(
      effective,
      revoked ? "revoked" : "authorized",
    ),
    status: revoked ? "revoked" : "authorized",
  });
}

/** Strict validation of an intent persisted inside a brief-bound proposal. */
export async function validateProjectCapabilityIntent(
  value: unknown,
): Promise<ProjectCapabilityIntent> {
  const intent = exactRecord(value, [
    "schemaVersion",
    "mutatesRuntime",
    "status",
    "authorities",
    "capabilityRequirements",
    "capabilityIntentFingerprint",
  ], "Project capability intent") as unknown as ProjectCapabilityIntent;
  if (
    intent.schemaVersion !== PROJECT_CAPABILITY_INTENT_SCHEMA_VERSION ||
    intent.mutatesRuntime !== false ||
    (intent.status !== "resolved" && intent.status !== "unresolved") ||
    !Array.isArray(intent.authorities) ||
    !Array.isArray(intent.capabilityRequirements) ||
    !fingerprint(intent.capabilityIntentFingerprint)
  ) {
    throw new TypeError("Project capability intent has an invalid top-level shape.");
  }
  for (const requirement of intent.capabilityRequirements) {
    validateRequirement(requirement);
  }
  const requirementKeys = intent.capabilityRequirements.map(
    engineeringCapabilityRequirementKey,
  );
  if (
    new Set(requirementKeys).size !== requirementKeys.length ||
    !isSorted(requirementKeys)
  ) {
    throw new TypeError(
      "Project capability intent requirements must be unique and canonical.",
    );
  }
  const unresolvedAuthorities: unknown[] = [];
  const authorityKeys: string[] = [];
  for (const authority of intent.authorities) {
    const record = authorityIntentRecord(authority);
    const reference = exactRecord(
      record.authority,
      ["id", "version"],
      "Project capability intent authority",
    );
    if (typeof reference.id !== "string" || typeof reference.version !== "string") {
      throw new TypeError("Project capability intent authority reference is invalid.");
    }
    authorityKeys.push(`${reference.id}\u0000${reference.version}`);
    if (record.resolution === "resolved") {
      const operations = record.operations;
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new TypeError(
          "Resolved project capability intent authority requires operations.",
        );
      }
      validateOperations(operations);
      continue;
    }
    const reason = record.reason;
    if (
      reason !== "authority-unrouted" && reason !== "route-operation-missing" &&
      reason !== "operation-unregistered"
    ) {
      throw new TypeError("Project capability intent unresolved reason is invalid.");
    }
    const operations = record.operations;
    if (reason === "operation-unregistered") {
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new TypeError(
          "Unregistered project capability intent authority requires operations.",
        );
      }
      validateOperations(operations);
    } else if (operations !== undefined) {
      throw new TypeError(
        "This unresolved project capability intent authority must not name operations.",
      );
    }
    unresolvedAuthorities.push({
      authority: { id: reference.id, version: reference.version },
      reason,
      ...(operations === undefined ? {} : { operations }),
    });
  }
  if (
    new Set(authorityKeys).size !== authorityKeys.length || !isSorted(authorityKeys) ||
    (intent.status === "resolved") !== (unresolvedAuthorities.length === 0)
  ) {
    throw new TypeError(
      "Project capability intent authorities/status are not canonical.",
    );
  }
  const expected = await sha256Fingerprint({
    capabilityRequirements: intent.capabilityRequirements,
    unresolvedAuthorities,
  });
  if (!fingerprintsEqual(expected, intent.capabilityIntentFingerprint)) {
    throw new TypeError(
      "Project capability intent fingerprint does not match its authority ceiling.",
    );
  }
  return deepFreeze(structuredClone(intent));
}

function authorityIntentRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project capability intent authority must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.resolution === "resolved") {
    return exactRecord(
      record,
      ["authority", "resolution", "operations"],
      "Resolved project capability intent authority",
    );
  }
  if (record.resolution === "unresolved") {
    return optionalRecord(
      record,
      ["authority", "resolution", "reason"],
      ["operations"],
      "Unresolved project capability intent authority",
    );
  }
  throw new TypeError("Project capability intent authority resolution is invalid.");
}

function validateOperations(operations: readonly unknown[]): void {
  const keys: string[] = [];
  for (const operation of operations) {
    const record = exactRecord(
      operation,
      ["id", "version"],
      "Project capability intent operation",
    );
    if (typeof record.id !== "string" || typeof record.version !== "string") {
      throw new TypeError("Project capability intent operation is invalid.");
    }
    keys.push(`${record.id}\u0000${record.version}`);
  }
  if (new Set(keys).size !== keys.length || !isSorted(keys)) {
    throw new TypeError(
      "Project capability intent operations must be unique and canonical.",
    );
  }
}

function isSorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! <= value);
}

function projectCapabilityProposalFingerprintBody(
  proposal: Omit<ProjectCapabilityProposal, "capabilityProposalFingerprint">,
) {
  return {
    source: proposal.source,
    brief: proposal.brief,
    ...projectCapabilityProposalCeilingFingerprintBody(proposal),
  };
}

/**
 * Keep this body narrower than the full proposal fingerprint only in the two
 * editorial dimensions above. In particular, do not omit an unavailable
 * candidate: its binding/unit/digest facts are still part of the ceiling.
 */
function projectCapabilityProposalCeilingFingerprintBody(
  proposal:
    | ProjectCapabilityProposal
    | Omit<ProjectCapabilityProposal, "capabilityProposalFingerprint">,
) {
  return {
    schemaVersion: proposal.schemaVersion,
    mutatesRuntime: proposal.mutatesRuntime,
    projectId: proposal.projectId,
    ...(proposal.intent === null ? {} : {
      capabilityIntentFingerprint: proposal.intent.capabilityIntentFingerprint,
      intentStatus: proposal.intent.status,
      unresolvedAuthorities: proposal.intent.authorities.filter((authority) =>
        authority.resolution === "unresolved"
      ),
    }),
    semanticRequirements: proposal.semanticRequirements,
    bindings: proposal.bindings.map((binding) => ({
      requirement: binding.requirement,
      candidate: binding.candidate === undefined ? null : {
        id: binding.candidate.id,
        version: binding.candidate.version,
        adapter: binding.candidate.adapter,
        profile: binding.candidate.profile,
        unitIds: binding.candidate.unitIds,
      },
    })),
    units: proposal.units.map((unit) => ({
      id: unit.id,
      version: unit.version,
      manifestFingerprint: unit.manifestFingerprint,
      materials: unit.materials,
    })),
    materials: proposal.materials.map((material) => ({
      unitId: material.unitId,
      materialId: material.materialId,
      imageReference: material.imageReference,
      downloadBytes: material.downloadBytes,
      storageBytes: material.storageBytes,
    })),
    effects: proposal.effects,
  };
}

async function effectiveEnvelopeFingerprintFor(
  proposal: ProjectCapabilityProposal,
  status: ProjectCapabilityEffectiveEnvelope["status"],
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    proposalFingerprint: proposal.capabilityProposalFingerprint,
    status,
  });
}

/**
 * V1 does not persist an entire successor proposal in an amendment. It applies
 * only the requested delta to the prior envelope, then checks the resulting
 * exact fingerprint against the server-derived successor proposal fingerprint.
 */
async function applyProjectCapabilityEnvelopeDelta(
  previous: ProjectCapabilityProposal,
  delta: ProjectCapabilityEnvelopeDelta,
  expectedFingerprint: ContentFingerprint,
): Promise<ProjectCapabilityProposal> {
  const requirements = new Map(previous.semanticRequirements.map((item) => [
    engineeringCapabilityRequirementKey(item),
    item,
  ]));
  for (const key of delta.removedRequirementKeys) {
    if (!requirements.delete(key)) {
      throw new TypeError(`Capability amendment removes absent requirement ${key}.`);
    }
  }
  for (const replacement of delta.requirementReplacements) {
    const current = requirements.get(replacement.requirementKey);
    if (
      !current || deterministicJson(current) !== deterministicJson(replacement.previous)
    ) {
      throw new TypeError(
        `Capability amendment requirement replacement is not anchored at ${replacement.requirementKey}.`,
      );
    }
    if (
      engineeringCapabilityRequirementKey(replacement.next) !==
        replacement.requirementKey
    ) {
      throw new TypeError(
        "Capability amendment requirement replacement changes a stable key.",
      );
    }
    requirements.set(replacement.requirementKey, replacement.next);
  }
  for (const requirement of delta.addedRequirements) {
    const key = engineeringCapabilityRequirementKey(requirement);
    if (!delta.addedRequirementKeys.includes(key) || requirements.has(key)) {
      throw new TypeError(
        `Capability amendment added requirement ${key} is inconsistent.`,
      );
    }
    requirements.set(key, requirement);
  }
  if (
    new Set(delta.addedRequirementKeys).size !== delta.addedRequirementKeys.length ||
    new Set(delta.removedRequirementKeys).size !==
      delta.removedRequirementKeys.length ||
    delta.addedRequirementKeys.length !== delta.addedRequirements.length
  ) {
    throw new TypeError("Capability amendment requirement delta is not an exact set.");
  }

  const bindings = new Map(previous.bindings.map((binding) => [
    engineeringCapabilityRequirementKey(binding.requirement),
    binding,
  ]));
  for (const replacement of delta.bindingReplacements) {
    const current = bindings.get(replacement.requirementKey) ?? null;
    if (deterministicJson(current) !== deterministicJson(replacement.previous)) {
      throw new TypeError(
        `Capability amendment binding replacement is not anchored at ${replacement.requirementKey}.`,
      );
    }
    if (replacement.next === null) bindings.delete(replacement.requirementKey);
    else bindings.set(replacement.requirementKey, replacement.next);
  }
  if (
    [...requirements.keys()].some((key) => !bindings.has(key)) ||
    [...bindings.keys()].some((key) => !requirements.has(key))
  ) {
    throw new TypeError(
      "Capability amendment leaves requirements and bindings out of sync.",
    );
  }

  const units = patchById(
    previous.units,
    delta.units.removedIds,
    delta.units.added,
    delta.units.changed,
    (unit) => unit.id,
    "unit",
  );
  if (
    deterministicJson(units.addedIds) !== deterministicJson(delta.units.addedIds) ||
    deterministicJson(units.changedIds) !== deterministicJson(delta.units.changedIds)
  ) {
    throw new TypeError(
      "Capability amendment unit ids do not match its exact unit patch.",
    );
  }
  const materials = patchById(
    previous.materials,
    delta.materials.removedKeys,
    delta.materials.added,
    delta.materials.changed,
    materialKey,
    "material",
  );
  const effects = applyEffectDelta(previous.effects, delta.effects);
  const successor: Omit<ProjectCapabilityProposal, "capabilityProposalFingerprint"> = {
    schemaVersion: PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
    mutatesRuntime: false,
    projectId: previous.projectId,
    source: delta.next.source,
    brief: structuredClone(delta.next.brief),
    intent: delta.next.intent === null ? null : structuredClone(delta.next.intent),
    semanticRequirements: [...requirements.values()].toSorted(compareRequirement),
    bindings: [...bindings.values()].toSorted((left, right) =>
      compareText(
        engineeringCapabilityRequirementKey(left.requirement),
        engineeringCapabilityRequirementKey(right.requirement),
      )
    ),
    units: units.values.toSorted((left, right) => compareText(left.id, right.id)),
    materials: materials.values.toSorted((left, right) =>
      compareText(materialKey(left), materialKey(right))
    ),
    effects,
    status: delta.next.status,
    activation: delta.next.activation,
    blockers: [...delta.next.blockers].toSorted(compareText),
  };
  const actual = await fingerprintProjectCapabilityProposal(successor);
  if (!fingerprintsEqual(actual, expectedFingerprint)) {
    throw new TypeError(
      "Capability amendment delta does not reconstruct the exact server-derived successor.",
    );
  }
  return deepFreeze({ ...successor, capabilityProposalFingerprint: actual });
}

function patchById<T>(
  previous: readonly T[],
  removedIds: readonly string[],
  added: readonly T[],
  changed: readonly { readonly previous: T; readonly next: T }[],
  id: (value: T) => string,
  label: string,
): {
  readonly values: readonly T[];
  readonly addedIds: readonly string[];
  readonly changedIds: readonly string[];
} {
  const values = new Map(previous.map((value) => [id(value), value]));
  for (const removed of removedIds) {
    if (!values.delete(removed)) {
      throw new TypeError(`Capability amendment removes absent ${label} ${removed}.`);
    }
  }
  for (const replacement of changed) {
    const key = id(replacement.next);
    if (
      id(replacement.previous) !== key ||
      deterministicJson(values.get(key)) !== deterministicJson(replacement.previous)
    ) {
      throw new TypeError(
        `Capability amendment ${label} replacement is not anchored at ${key}.`,
      );
    }
    values.set(key, replacement.next);
  }
  for (const item of added) {
    const key = id(item);
    if (values.has(key)) {
      throw new TypeError(`Capability amendment adds duplicate ${label} ${key}.`);
    }
    values.set(key, item);
  }
  return {
    values: [...values.values()],
    addedIds: added.map(id).toSorted(compareText),
    changedIds: changed.map((item) => id(item.next)).toSorted(compareText),
  };
}

function applyEffectDelta(
  previous: ProjectCapabilityProposal["effects"],
  delta: ProjectCapabilityHostEffectsDelta,
): ProjectCapabilityProposal["effects"] {
  const patch = <T>(
    values: readonly T[],
    removed: readonly T[],
    added: readonly T[],
  ) => {
    const result = new Map(values.map((value) => [deterministicJson(value), value]));
    for (const value of removed) {
      if (!result.delete(deterministicJson(value))) {
        throw new TypeError("Capability host-effect removal is not anchored.");
      }
    }
    for (const value of added) result.set(deterministicJson(value), value);
    return [...result.values()].toSorted((left, right) =>
      compareText(deterministicJson(left), deterministicJson(right))
    );
  };
  const bytes = (current: number | null, value: ProjectCapabilityBytesDelta) => {
    if (
      current !== value.previous ||
      (current !== null && value.next !== null &&
        value.delta !== value.next - current) ||
      (current === null || value.next === null) && value.delta !== null
    ) {
      throw new TypeError("Capability host-effect byte delta is not exact.");
    }
    return value.next;
  };
  const security = delta.added.security ?? previous.security;
  if (delta.removed.security !== null && delta.removed.security !== previous.security) {
    throw new TypeError("Capability host-effect security removal is not anchored.");
  }
  return deepFreeze({
    downloadBytes: bytes(previous.downloadBytes, delta.downloadBytes),
    storageBytes: bytes(previous.storageBytes, delta.storageBytes),
    services: patch(previous.services, delta.removed.services, delta.added.services),
    volumes: patch(previous.volumes, delta.removed.volumes, delta.added.volumes),
    networks: patch(previous.networks, delta.removed.networks, delta.added.networks),
    loopbackPorts: patch(
      previous.loopbackPorts,
      delta.removed.loopbackPorts,
      delta.added.loopbackPorts,
    ),
    bindMounts: patch(
      previous.bindMounts,
      delta.removed.bindMounts,
      delta.added.bindMounts,
    ),
    privileged: false,
    dockerSocket: false,
    devices: patch(previous.devices, delta.removed.devices, delta.added.devices),
    secretSlots: patch(
      previous.secretSlots,
      delta.removed.secretSlots,
      delta.added.secretSlots,
    ),
    licences: patch(previous.licences, delta.removed.licences, delta.added.licences),
    security,
  });
}

function materialKey(value: ProjectCapabilityProposal["materials"][number]): string {
  return `${value.unitId}\u0000${value.materialId}`;
}

function compareRequirement(
  left: RequiredEngineeringCapability,
  right: RequiredEngineeringCapability,
): number {
  return compareText(
    engineeringCapabilityRequirementKey(left),
    engineeringCapabilityRequirementKey(right),
  ) ||
    compareText(left.minimumQualification, right.minimumQualification);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).toSorted();
  const expected = [...keys].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields.`);
  }
  return record;
}

function optionalRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).toSorted();
  const allowed = [...required, ...optional].toSorted();
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.includes(key))
  ) {
    throw new TypeError(`${label} has unknown or missing fields.`);
  }
  return record;
}

function validateRequirement(value: unknown): void {
  const requirement = exactRecord(value, [
    "id",
    "version",
    "minimumQualification",
    "use",
  ], "Capability requirement");
  if (
    typeof requirement.id !== "string" || typeof requirement.version !== "string" ||
    (requirement.minimumQualification !== "compatible" &&
      requirement.minimumQualification !== "qualified") ||
    (requirement.use !== "preparation" && requirement.use !== "execution")
  ) {
    throw new TypeError("Capability requirement is invalid.");
  }
}

function validateBinding(value: unknown): void {
  const binding = optionalRecord(
    value,
    ["requirement", "status", "binding", "unitIds", "reasons"],
    ["candidate"],
    "Capability binding",
  );
  validateRequirement(binding.requirement);
  if (
    ![
      "selected",
      "unavailable",
      "ambiguous",
      "disabled",
      "revoked",
      "incompatible",
    ].includes(binding.status as string) || !stringArray(binding.unitIds) ||
    !stringArray(binding.reasons)
  ) {
    throw new TypeError("Capability binding has an invalid status, units, or reasons.");
  }
  if (binding.binding !== null) {
    const selected = exactRecord(
      binding.binding,
      ["id", "version", "qualification"],
      "Capability selected binding",
    );
    if (
      typeof selected.id !== "string" || typeof selected.version !== "string" ||
      (selected.qualification !== "compatible" &&
        selected.qualification !== "qualified")
    ) {
      throw new TypeError("Capability selected binding is invalid.");
    }
  }
  if (binding.candidate !== undefined) validateCandidate(binding.candidate);
}

function validateCandidate(value: unknown): void {
  const candidate = exactRecord(value, [
    "id",
    "version",
    "qualification",
    "adapter",
    "profile",
    "unitIds",
  ], "Capability binding candidate");
  if (
    typeof candidate.id !== "string" || typeof candidate.version !== "string" ||
    !["compatible", "qualified", "unqualified", "revoked"].includes(
      candidate.qualification as string,
    ) ||
    !stringArray(candidate.unitIds)
  ) {
    throw new TypeError("Capability binding candidate is invalid.");
  }
  const adapter = exactRecord(
    candidate.adapter,
    ["id", "version", "source"],
    "Capability binding adapter",
  );
  if (
    typeof adapter.id !== "string" || typeof adapter.version !== "string" ||
    typeof adapter.source !== "string"
  ) {
    throw new TypeError("Capability binding adapter is invalid.");
  }
  if (candidate.profile !== null) {
    const profile = exactRecord(
      candidate.profile,
      ["id", "version", "fingerprint"],
      "Capability binding profile",
    );
    if (
      typeof profile.id !== "string" || typeof profile.version !== "string" ||
      (profile.fingerprint !== null && !fingerprint(profile.fingerprint))
    ) {
      throw new TypeError("Capability binding profile is invalid.");
    }
  }
}

async function validateUnit(value: unknown): Promise<void> {
  const unit = exactRecord(
    value,
    ["id", "version", "manifestFingerprint", "materials"],
    "Capability runtime unit",
  );
  if (
    typeof unit.id !== "string" || typeof unit.version !== "string" ||
    !fingerprint(unit.manifestFingerprint) ||
    !Array.isArray(unit.materials)
  ) {
    throw new TypeError("Capability runtime unit is invalid.");
  }
  for (const material of unit.materials) validateAtomicMaterial(material);
  const typed = unit as unknown as AtomicCapabilityRuntimeUnit;
  const expected = await fingerprintAtomicCapabilityRuntimeUnit(typed);
  if (!fingerprintsEqual(expected, typed.manifestFingerprint)) {
    throw new TypeError("Capability runtime unit manifest fingerprint is stale.");
  }
}

function validateAtomicMaterial(value: unknown): void {
  const material = exactRecord(value, [
    "id",
    "kind",
    "imageReference",
    "platforms",
    "lifecycle",
    "launchGroup",
    "effects",
  ], "Capability runtime material");
  if (
    typeof material.id !== "string" || typeof material.imageReference !== "string" ||
    !["compose-service", "microvm-image", "oci-image"].includes(
      material.kind as string,
    ) ||
    !["persistent", "ephemeral", "cache"].includes(material.lifecycle as string) ||
    !Array.isArray(material.platforms) ||
    material.platforms.some((platform) =>
      platform !== "linux/amd64" && platform !== "linux/arm64"
    )
  ) {
    throw new TypeError("Capability runtime material is invalid.");
  }
  if (material.launchGroup !== null) {
    validateCapabilityRuntimeLaunchGroupReference(
      material.launchGroup,
      "Capability runtime material launchGroup",
    );
  }
  validateAtomicEffects(material.effects);
}

function validateAtomicEffects(value: unknown): void {
  const effects = exactRecord(value, [
    "downloadBytes",
    "storageBytes",
    "services",
    "volumes",
    "network",
    "loopbackPorts",
    "bindMounts",
    "privileged",
    "dockerSocket",
    "devices",
    "secretSlots",
    "licence",
    "security",
  ], "Capability atomic host effects");
  if (
    !nullableBytes(effects.downloadBytes) || !nullableBytes(effects.storageBytes) ||
    !Array.isArray(effects.services) || !Array.isArray(effects.volumes) ||
    !Array.isArray(effects.loopbackPorts) || !Array.isArray(effects.bindMounts) ||
    !stringArray(effects.devices) ||
    !stringArray(effects.secretSlots) || effects.privileged !== false ||
    effects.dockerSocket !== false ||
    !["internal", "loopback-only", "deny-all"].includes(effects.network as string) ||
    (effects.security !== "reviewed" && effects.security !== "unknown")
  ) {
    throw new TypeError("Capability atomic host effects are invalid.");
  }
  validateEffectCollections(
    effects.services,
    effects.volumes,
    effects.loopbackPorts,
    effects.bindMounts,
  );
  const licence = exactRecord(
    effects.licence,
    ["status", "reference"],
    "Capability licence",
  );
  if (
    (licence.status !== "reviewed" && licence.status !== "unknown") ||
    (licence.reference !== null && typeof licence.reference !== "string")
  ) {
    throw new TypeError("Capability licence is invalid.");
  }
}

function validatePlannedMaterial(value: unknown): void {
  const material = exactRecord(value, [
    "unitId",
    "materialId",
    "imageReference",
    "mode",
    "downloadBytes",
    "storageBytes",
  ], "Capability planned material");
  if (
    typeof material.unitId !== "string" || typeof material.materialId !== "string" ||
    typeof material.imageReference !== "string" ||
    !["native", "emulated", "unavailable"].includes(material.mode as string) ||
    !nullableBytes(material.downloadBytes) || !nullableBytes(material.storageBytes)
  ) {
    throw new TypeError("Capability planned material is invalid.");
  }
}

function validateEffects(value: unknown): void {
  const effects = exactRecord(value, [
    "downloadBytes",
    "storageBytes",
    "services",
    "volumes",
    "networks",
    "loopbackPorts",
    "bindMounts",
    "privileged",
    "dockerSocket",
    "devices",
    "secretSlots",
    "licences",
    "security",
  ], "Capability host effects");
  if (
    !nullableBytes(effects.downloadBytes) || !nullableBytes(effects.storageBytes) ||
    !Array.isArray(effects.services) || !Array.isArray(effects.volumes) ||
    !Array.isArray(effects.networks) ||
    !Array.isArray(effects.loopbackPorts) || !Array.isArray(effects.bindMounts) ||
    !stringArray(effects.devices) ||
    !stringArray(effects.secretSlots) || !Array.isArray(effects.licences) ||
    effects.privileged !== false ||
    effects.dockerSocket !== false ||
    (effects.security !== "reviewed" && effects.security !== "unknown")
  ) {
    throw new TypeError("Capability host effects are invalid.");
  }
  validateEffectCollections(
    effects.services,
    effects.volumes,
    effects.loopbackPorts,
    effects.bindMounts,
  );
  for (const licence of effects.licences) {
    const record = exactRecord(licence, ["status", "reference"], "Capability licence");
    if (
      (record.status !== "reviewed" && record.status !== "unknown") ||
      (record.reference !== null && typeof record.reference !== "string")
    ) throw new TypeError("Capability licence is invalid.");
  }
}

function validateEffectCollections(
  services: readonly unknown[],
  volumes: readonly unknown[],
  loopbackPorts: readonly unknown[],
  bindMounts: readonly unknown[],
): void {
  for (const service of services) {
    const record = exactRecord(service, ["id", "lifecycle"], "Capability service");
    if (
      typeof record.id !== "string" ||
      !["persistent", "ephemeral", "cache"].includes(record.lifecycle as string)
    ) throw new TypeError("Capability service is invalid.");
  }
  for (const volume of volumes) {
    const record = exactRecord(
      volume,
      ["id", "access", "preservation"],
      "Capability volume",
    );
    if (
      typeof record.id !== "string" ||
      !["read-only", "read-write"].includes(record.access as string) ||
      !["preserve", "ephemeral"].includes(record.preservation as string)
    ) throw new TypeError("Capability volume is invalid.");
  }
  if (
    loopbackPorts.some((port) =>
      !Number.isSafeInteger(port) || (port as number) < 1 || (port as number) > 65535
    )
  ) {
    throw new TypeError("Capability host loopback effects are invalid.");
  }
  for (const mount of bindMounts) {
    const record = exactRecord(mount, ["target", "access"], "Capability bind mount");
    if (
      typeof record.target !== "string" ||
      !["read-only", "read-write"].includes(record.access as string)
    ) throw new TypeError("Capability bind mount is invalid.");
  }
}

function nullableBytes(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function fingerprint(value: unknown): value is ContentFingerprint {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as ContentFingerprint).algorithm === "sha256" &&
    /^[a-f0-9]{64}$/.test((value as ContentFingerprint).digest);
}

function safeProjectId(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}
