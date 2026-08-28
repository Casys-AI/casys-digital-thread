/**
 * Provider-neutral runtime supervision vocabulary.
 *
 * This is operational state only. It neither admits an engineering method nor
 * interprets an engineering result. A future host adapter observes and mutates
 * Docker, Microsandbox, or another runtime through application ports; none of
 * those details belong in this domain contract.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeLaunchProfileReference,
} from "./capability-runtime-host.ts";
import { validateCapabilityRuntimeLaunchProfileReference } from "./capability-runtime-host.ts";

export type CapabilityRuntimeMaterialState =
  | "absent"
  | "acquiring"
  | "installed"
  | "failed";

export type CapabilityRuntimeProcessState =
  | "inactive"
  | "starting"
  | "active"
  | "stopping"
  | "degraded";

export type CapabilityRuntimeQualificationState =
  | "unqualified"
  | "compatible"
  | "qualified"
  | "revoked";

/** The three axes intentionally do not collapse into one health string. */
export interface CapabilityRuntimeObservedState {
  readonly material: CapabilityRuntimeMaterialState;
  readonly runtime: CapabilityRuntimeProcessState;
  readonly qualification: CapabilityRuntimeQualificationState;
}

/** Exact catalogue material identity, not an image tag or mutable alias. */
export interface CapabilityRuntimeMaterialIdentity {
  readonly unitId: string;
  readonly materialId: string;
  readonly imageDigest: string;
}

/**
 * A server-selected binding captured for a queued/executing operation. Agents
 * never create this object, choose its contents, or supply an image digest.
 */
export interface ResolvedCapabilityRuntimeBinding {
  readonly capability: {
    readonly id: string;
    readonly version: string;
    readonly use: "preparation" | "execution";
  };
  readonly binding: {
    readonly id: string;
    readonly version: string;
  };
  readonly adapter: {
    readonly id: string;
    readonly version: string;
    readonly source: string;
  };
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint | null;
  } | null;
  readonly materials: readonly CapabilityRuntimeMaterialIdentity[];
}

/**
 * Exact operational authority used by the queue and execution guards. This
 * belongs beside the resolved operation plan later; it is not a provider
 * request, a result verdict, or a project Thread entity.
 */
export interface ResolvedCapabilityRuntimeOperation {
  readonly schemaVersion: "resolved-capability-runtime-operation/1.0";
  readonly projectId: string;
  readonly operation: { readonly id: string; readonly version: string };
  readonly authorizationFingerprint: ContentFingerprint;
  readonly demandFingerprint: ContentFingerprint;
  readonly registryFingerprint: ContentFingerprint;
  readonly bindings: readonly ResolvedCapabilityRuntimeBinding[];
}

/** Strict validation before an operational binding is sealed into a ROP. */
export function validateResolvedCapabilityRuntimeOperation(
  value: unknown,
): ResolvedCapabilityRuntimeOperation {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "operation",
    "authorizationFingerprint",
    "demandFingerprint",
    "registryFingerprint",
    "bindings",
  ], "$operationalCapability");
  literalValue(
    root.schemaVersion,
    "resolved-capability-runtime-operation/1.0",
    "$operationalCapability.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$operationalCapability.operation",
  );
  const bindings = arrayOf(root.bindings, "$operationalCapability.bindings").map((
    binding,
    index,
  ) => parseResolvedBinding(binding, `$operationalCapability.bindings[${index}]`));
  rejectDuplicates(
    bindings.map((binding) =>
      `${binding.capability.id}\u0000${binding.capability.version}\u0000${binding.capability.use}`
    ),
    "$operationalCapability.bindings[]",
  );
  return deepFreeze({
    schemaVersion: "resolved-capability-runtime-operation/1.0",
    projectId: safeId(root.projectId, "$operationalCapability.projectId"),
    operation: {
      id: safeId(operation.id, "$operationalCapability.operation.id"),
      version: exactVersionToken(
        operation.version,
        "$operationalCapability.operation.version",
      ),
    },
    authorizationFingerprint: contentFingerprint(
      root.authorizationFingerprint,
      "$operationalCapability.authorizationFingerprint",
    ),
    demandFingerprint: contentFingerprint(
      root.demandFingerprint,
      "$operationalCapability.demandFingerprint",
    ),
    registryFingerprint: contentFingerprint(
      root.registryFingerprint,
      "$operationalCapability.registryFingerprint",
    ),
    bindings,
  });
}

export function canonicalResolvedCapabilityRuntimeOperationText(
  value: unknown,
): string {
  return deterministicJson(validateResolvedCapabilityRuntimeOperation(value));
}

export function fingerprintResolvedCapabilityRuntimeOperation(
  value: unknown,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validateResolvedCapabilityRuntimeOperation(value));
}

function parseResolvedBinding(
  value: unknown,
  path: string,
): ResolvedCapabilityRuntimeBinding {
  const root = exactRecord(value, [
    "capability",
    "binding",
    "adapter",
    "profile",
    "materials",
  ], path);
  const capability = exactRecord(
    root.capability,
    ["id", "version", "use"],
    `${path}.capability`,
  );
  const binding = exactRecord(root.binding, ["id", "version"], `${path}.binding`);
  const adapter = exactRecord(
    root.adapter,
    ["id", "version", "source"],
    `${path}.adapter`,
  );
  const profile = root.profile === null
    ? null
    : parseProfile(root.profile, `${path}.profile`);
  const materials = arrayOf(root.materials, `${path}.materials`).map((
    material,
    index,
  ) => parseMaterial(material, `${path}.materials[${index}]`));
  if (materials.length === 0) {
    throw new TypeError(`${path}.materials must not be empty for a runtime binding.`);
  }
  rejectDuplicates(materials.map(capabilityRuntimeMaterialKey), `${path}.materials`);
  return {
    capability: {
      id: safeId(capability.id, `${path}.capability.id`),
      version: exactVersionToken(capability.version, `${path}.capability.version`),
      use: capabilityUse(capability.use, `${path}.capability.use`),
    },
    binding: {
      id: safeId(binding.id, `${path}.binding.id`),
      version: exactVersionToken(binding.version, `${path}.binding.version`),
    },
    adapter: {
      id: safeId(adapter.id, `${path}.adapter.id`),
      version: exactVersionToken(adapter.version, `${path}.adapter.version`),
      source: nonEmptyText(adapter.source, `${path}.adapter.source`),
    },
    profile,
    materials,
  };
}

function parseProfile(
  value: unknown,
  path: string,
): NonNullable<ResolvedCapabilityRuntimeBinding["profile"]> {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return {
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: root.fingerprint === null
      ? null
      : contentFingerprint(root.fingerprint, `${path}.fingerprint`),
  };
}

function parseMaterial(
  value: unknown,
  path: string,
): CapabilityRuntimeMaterialIdentity {
  const root = exactRecord(value, ["unitId", "materialId", "imageDigest"], path);
  const imageDigest = nonEmptyText(root.imageDigest, `${path}.imageDigest`);
  if (!/^[a-f0-9]{64}$/.test(imageDigest)) {
    throw new TypeError(`${path}.imageDigest must be a lowercase sha256 digest.`);
  }
  return {
    unitId: safeId(root.unitId, `${path}.unitId`),
    materialId: safeId(root.materialId, `${path}.materialId`),
    imageDigest,
  };
}

function capabilityUse(value: unknown, path: string): "preparation" | "execution" {
  if (value === "preparation" || value === "execution") return value;
  throw new TypeError(`${path} must equal preparation or execution.`);
}

function contentFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(root.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase sha256 digest.`);
  }
  return { algorithm: "sha256", digest };
}

/** A shared, expiring claim that keeps selected runtime material in use. */
export interface CapabilityRuntimeLease {
  readonly id: string;
  readonly projectId: string;
  readonly bindingIds: readonly string[];
  /** Exact host materials protected by this lease; never a provider request. */
  readonly materialKeys: readonly string[];
  /** Immutable profiles authorized to use the protected host materials. */
  readonly launchProfiles: readonly CapabilityRuntimeLaunchProfileReference[];
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export type CapabilityRuntimeJournalAction =
  | "material-acquire"
  | "runtime-start"
  | "runtime-stop"
  | "material-remove";

/**
 * The journal is appended before a host action. `planned` never asserts that
 * Docker, a microVM, or an engineering provider actually changed state.
 */
export interface CapabilityRuntimeJournalEntry {
  readonly id: string;
  readonly action: CapabilityRuntimeJournalAction;
  readonly material: CapabilityRuntimeMaterialIdentity;
  /** Exact registry profile used by the host mutator. */
  readonly launchProfile: CapabilityRuntimeLaunchProfileReference;
  readonly projectId: string | null;
  readonly plannedAt: string;
  readonly previousObservation: CapabilityRuntimeObservedState | null;
  readonly administrativeRemovalPlanFingerprint: ContentFingerprint | null;
}

/** A terminal host record; it never becomes an engineering receipt or proof. */
export interface CapabilityRuntimeJournalOutcome {
  readonly schemaVersion: "capability-runtime-host-mutation-outcome/1.0";
  readonly journalEntryId: string;
  readonly recordedAt: string;
  readonly status: "succeeded" | "failed" | "uncertain";
  /** Fresh host observation when available. `null` remains literal uncertainty. */
  readonly observation: CapabilityRuntimeObservedState | null;
  /** Bounded diagnostic, with no command, secret or provider envelope. */
  readonly detail: string | null;
}

/**
 * Removal is administrative and has to name only material owned by this
 * capability runtime. It never grants deletion of Thread, CAS, WAL, project,
 * or retained volumes.
 */
export interface CapabilityRuntimeAdministrativeRemovalPlan {
  readonly schemaVersion: "capability-runtime-removal-plan/1.0";
  readonly fingerprint: ContentFingerprint;
  readonly ownedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
  readonly preserveThread: true;
  readonly preserveCas: true;
  readonly preserveWal: true;
  readonly preserveProjectState: true;
  readonly preserveRetainedVolumes: true;
}

export interface CapabilityRuntimeRecovery {
  readonly schemaVersion: "capability-runtime-recovery/1.0";
  /** The recovery result is a fresh observation, never a journal replay. */
  readonly observations: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly state: CapabilityRuntimeObservedState;
  }[];
  /** Incomplete planned mutations remain visible for human/operator handling. */
  readonly pendingJournalEntries: readonly CapabilityRuntimeJournalEntry[];
}

export function capabilityRuntimeMaterialKey(
  material: Pick<CapabilityRuntimeMaterialIdentity, "unitId" | "materialId">,
): string {
  return `${material.unitId}\u0000${material.materialId}`;
}

export function capabilityRuntimeBindingKey(
  binding: Pick<ResolvedCapabilityRuntimeBinding["binding"], "id" | "version">,
): string {
  return `${binding.id}\u0000${binding.version}`;
}

export function isCapabilityRuntimeUsable(
  state: CapabilityRuntimeObservedState,
): boolean {
  return state.material === "installed" && state.runtime === "active" &&
    state.qualification === "qualified";
}

/** Pure recovery projection: observe first, then report pending host intents. */
export function recoverCapabilityRuntime(
  observations: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly state: CapabilityRuntimeObservedState;
  }[],
  journal: readonly CapabilityRuntimeJournalEntry[],
  outcomes: readonly CapabilityRuntimeJournalOutcome[] = [],
): CapabilityRuntimeRecovery {
  const journalIds = new Set(journal.map((entry) => entry.id));
  if (journalIds.size !== journal.length) {
    throw new TypeError(
      "Capability runtime recovery journal has duplicate intent ids.",
    );
  }
  const outcomeIds = new Set<string>();
  for (const outcome of outcomes) {
    if (!journalIds.has(outcome.journalEntryId)) {
      throw new TypeError(
        "Capability runtime recovery outcome has no matching intent.",
      );
    }
    if (outcomeIds.has(outcome.journalEntryId)) {
      throw new TypeError(
        "Capability runtime recovery has duplicate terminal outcomes.",
      );
    }
    outcomeIds.add(outcome.journalEntryId);
  }
  const observationsByMaterial = new Map(observations.map((entry) => [
    capabilityRuntimeMaterialKey(entry.material),
    entry.state,
  ]));
  const outcomesByEntry = new Map(outcomes.map((outcome) => [
    outcome.journalEntryId,
    outcome,
  ]));
  const pendingJournalEntries = journal.filter((entry) => {
    const observed = observationsByMaterial.get(
      capabilityRuntimeMaterialKey(entry.material),
    );
    const outcome = outcomesByEntry.get(entry.id);
    return !outcome || outcome.status !== "succeeded" || !observed ||
      !observationSatisfiesJournalIntent(entry, observed);
  }).toSorted((left, right) => left.id.localeCompare(right.id));
  const pendingMaterialKeys = new Set(
    pendingJournalEntries.map((entry) => capabilityRuntimeMaterialKey(entry.material)),
  );
  return {
    schemaVersion: "capability-runtime-recovery/1.0",
    observations: observations.map((entry) => ({
      material: entry.material,
      // Recovery rereads the host but never replays. Any missing, failed or
      // uncertain terminal record stays visibly degraded for an operator.
      state: pendingMaterialKeys.has(capabilityRuntimeMaterialKey(entry.material))
        ? { ...entry.state, runtime: "degraded" as const }
        : entry.state,
    })).toSorted((left, right) =>
      capabilityRuntimeMaterialKey(left.material).localeCompare(
        capabilityRuntimeMaterialKey(right.material),
      )
    ),
    pendingJournalEntries,
  };
}

/** Strict parser used by the durable host journal and test fixtures. */
export function validateCapabilityRuntimeJournalEntry(
  value: unknown,
): CapabilityRuntimeJournalEntry {
  const root = exactRecord(value, [
    "id",
    "action",
    "material",
    "launchProfile",
    "projectId",
    "plannedAt",
    "previousObservation",
    "administrativeRemovalPlanFingerprint",
  ], "$runtimeJournalEntry");
  const launchProfile = exactRecord(
    root.launchProfile,
    ["id", "version", "fingerprint"],
    "$runtimeJournalEntry.launchProfile",
  );
  return deepFreeze({
    id: safeId(root.id, "$runtimeJournalEntry.id"),
    action: journalAction(root.action, "$runtimeJournalEntry.action"),
    material: parseMaterial(root.material, "$runtimeJournalEntry.material"),
    launchProfile: {
      id: safeId(launchProfile.id, "$runtimeJournalEntry.launchProfile.id"),
      version: exactVersionToken(
        launchProfile.version,
        "$runtimeJournalEntry.launchProfile.version",
      ),
      fingerprint: contentFingerprint(
        launchProfile.fingerprint,
        "$runtimeJournalEntry.launchProfile.fingerprint",
      ),
    },
    projectId: root.projectId === null
      ? null
      : safeId(root.projectId, "$runtimeJournalEntry.projectId"),
    plannedAt: isoDateTime(root.plannedAt, "$runtimeJournalEntry.plannedAt"),
    previousObservation: root.previousObservation === null ? null : observedState(
      root.previousObservation,
      "$runtimeJournalEntry.previousObservation",
    ),
    administrativeRemovalPlanFingerprint:
      root.administrativeRemovalPlanFingerprint === null ? null : contentFingerprint(
        root.administrativeRemovalPlanFingerprint,
        "$runtimeJournalEntry.administrativeRemovalPlanFingerprint",
      ),
  });
}

export function validateCapabilityRuntimeJournalOutcome(
  value: unknown,
): CapabilityRuntimeJournalOutcome {
  const root = exactRecord(value, [
    "schemaVersion",
    "journalEntryId",
    "recordedAt",
    "status",
    "observation",
    "detail",
  ], "$runtimeJournalOutcome");
  literalValue(
    root.schemaVersion,
    "capability-runtime-host-mutation-outcome/1.0",
    "$runtimeJournalOutcome.schemaVersion",
  );
  if (root.detail !== null && typeof root.detail !== "string") {
    throw new TypeError("$runtimeJournalOutcome.detail must be a string or null.");
  }
  if (
    typeof root.detail === "string" &&
    (root.detail.length === 0 || root.detail.length > 512)
  ) {
    throw new TypeError(
      "$runtimeJournalOutcome.detail must be 1 to 512 characters or null.",
    );
  }
  return deepFreeze({
    schemaVersion: "capability-runtime-host-mutation-outcome/1.0" as const,
    journalEntryId: safeId(
      root.journalEntryId,
      "$runtimeJournalOutcome.journalEntryId",
    ),
    recordedAt: isoDateTime(root.recordedAt, "$runtimeJournalOutcome.recordedAt"),
    status: oneOf(
      root.status,
      ["succeeded", "failed", "uncertain"] as const,
      "$runtimeJournalOutcome.status",
    ),
    observation: root.observation === null
      ? null
      : observedState(root.observation, "$runtimeJournalOutcome.observation"),
    detail: root.detail,
  });
}

export function validateCapabilityRuntimeLease(value: unknown): CapabilityRuntimeLease {
  const root = exactRecord(value, [
    "id",
    "projectId",
    "bindingIds",
    "materialKeys",
    "launchProfiles",
    "acquiredAt",
    "expiresAt",
  ], "$runtimeLease");
  const bindingIds = arrayOf(root.bindingIds, "$runtimeLease.bindingIds").map((
    id,
    index,
  ) => safeId(id, `$runtimeLease.bindingIds[${index}]`));
  const materialKeys = arrayOf(root.materialKeys, "$runtimeLease.materialKeys").map((
    key,
    index,
  ) => nonEmptyText(key, `$runtimeLease.materialKeys[${index}]`));
  const launchProfiles = arrayOf(root.launchProfiles, "$runtimeLease.launchProfiles")
    .map((
      profile,
      index,
    ) =>
      validateCapabilityRuntimeLaunchProfileReference(
        profile,
        `$runtimeLease.launchProfiles[${index}]`,
      )
    );
  if (
    bindingIds.length === 0 || materialKeys.length === 0 || launchProfiles.length === 0
  ) {
    throw new TypeError(
      "$runtimeLease.bindingIds, materialKeys and launchProfiles must not be empty.",
    );
  }
  rejectDuplicates(bindingIds, "$runtimeLease.bindingIds");
  rejectDuplicates(materialKeys, "$runtimeLease.materialKeys");
  rejectDuplicates(
    launchProfiles.map((profile) =>
      `${profile.id}\u0000${profile.version}\u0000${profile.fingerprint.digest}`
    ),
    "$runtimeLease.launchProfiles",
  );
  const acquiredAt = isoDateTime(root.acquiredAt, "$runtimeLease.acquiredAt");
  const expiresAt = isoDateTime(root.expiresAt, "$runtimeLease.expiresAt");
  if (expiresAt <= acquiredAt) {
    throw new TypeError("$runtimeLease.expiresAt must be after acquiredAt.");
  }
  return deepFreeze({
    id: safeId(root.id, "$runtimeLease.id"),
    projectId: safeId(root.projectId, "$runtimeLease.projectId"),
    bindingIds,
    materialKeys,
    launchProfiles,
    acquiredAt,
    expiresAt,
  });
}

/** A matching material identity alone never reconciles a mutation intent. */
function observationSatisfiesJournalIntent(
  entry: CapabilityRuntimeJournalEntry,
  observed: CapabilityRuntimeObservedState,
): boolean {
  switch (entry.action) {
    case "material-acquire":
      return observed.material === "installed";
    case "runtime-start":
      return observed.runtime === "active";
    case "runtime-stop":
      return observed.runtime === "inactive";
    case "material-remove":
      return observed.material === "absent";
  }
}

function observedState(value: unknown, path: string): CapabilityRuntimeObservedState {
  const root = exactRecord(value, ["material", "runtime", "qualification"], path);
  return deepFreeze({
    material: oneOf(
      root.material,
      ["absent", "acquiring", "installed", "failed"] as const,
      `${path}.material`,
    ),
    runtime: oneOf(
      root.runtime,
      ["inactive", "starting", "active", "stopping", "degraded"] as const,
      `${path}.runtime`,
    ),
    qualification: oneOf(
      root.qualification,
      ["unqualified", "compatible", "qualified", "revoked"] as const,
      `${path}.qualification`,
    ),
  });
}

function journalAction(value: unknown, path: string): CapabilityRuntimeJournalAction {
  return oneOf(
    value,
    ["material-acquire", "runtime-start", "runtime-stop", "material-remove"] as const,
    path,
  );
}

function isoDateTime(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) ||
    Number.isNaN(Date.parse(text))
  ) {
    throw new TypeError(`${path} must be one canonical UTC ISO date-time.`);
  }
  return text;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${path} must be one of: ${values.join(", ")}.`);
  }
  return value;
}
