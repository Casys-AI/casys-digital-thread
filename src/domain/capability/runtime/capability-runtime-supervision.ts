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
  CapabilityRuntimeLaunchGroupReference,
} from "./capability-runtime-launch-group.ts";
import {
  validateCapabilityRuntimeLaunchGroupReference,
} from "./capability-runtime-launch-group.ts";
import type {
  CapabilityRuntimeMaterialRuntimeMode,
} from "./capability-runtime-binding-qualification-attestation.ts";

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
 * The sealed host behaviour of one exact material.  This is operational
 * lifecycle information, not a provider envelope.  Only a persistent Compose
 * service can carry a launch-group reference; an ephemeral microVM and an
 * OCI cache are deliberately never represented as an "active" service. A
 * persistent material points to its whole indivisible launch group: no member
 * may be started, stopped or recovered separately.
 */
export type CapabilityRuntimeHostLifecycle =
  | {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly kind: "persistent-compose";
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference | null;
  }
  | {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly kind: "ephemeral-microsandbox";
    readonly launchGroup: null;
  }
  | {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly kind: "cache-only";
    readonly launchGroup: null;
  };

/**
 * A server-selected binding captured for a queued/executing operation. Agents
 * never create this object, choose its contents, or supply an image digest.
 */
export interface ResolvedCapabilityRuntimeBinding {
  readonly capability: {
    readonly id: string;
    readonly version: string;
    readonly use: "preparation" | "execution";
    /** Exact operation demand sealed into the ROP for host-state admission. */
    readonly minimumQualification: "compatible" | "qualified";
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
  /** Exact host mode for every material, resolved before the ROP is sealed. */
  readonly runtimeModes: readonly CapabilityRuntimeMaterialRuntimeMode[];
  /** Exactly one lifecycle for every sealed material, keyed by exact digest. */
  readonly hostLifecycles: readonly CapabilityRuntimeHostLifecycle[];
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
    "runtimeModes",
    "hostLifecycles",
  ], path);
  const capability = exactRecord(
    root.capability,
    ["id", "version", "use", "minimumQualification"],
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
  const runtimeModes = arrayOf(root.runtimeModes, `${path}.runtimeModes`).map((
    mode,
    index,
  ) => parseRuntimeMode(mode, `${path}.runtimeModes[${index}]`));
  rejectDuplicates(
    runtimeModes.map((mode) => capabilityRuntimeMaterialKey(mode.material)),
    `${path}.runtimeModes`,
  );
  if (
    runtimeModes.length !== materials.length ||
    runtimeModes.some((mode) =>
      !materials.some((material) => sameMaterial(material, mode.material))
    )
  ) {
    throw new TypeError(`${path}.runtimeModes must cover exactly its materials.`);
  }
  const hostLifecycles = arrayOf(
    root.hostLifecycles,
    `${path}.hostLifecycles`,
  ).map((lifecycle, index) =>
    parseHostLifecycle(lifecycle, `${path}.hostLifecycles[${index}]`)
  );
  rejectDuplicates(
    hostLifecycles.map((lifecycle) => capabilityRuntimeMaterialKey(lifecycle.material)),
    `${path}.hostLifecycles`,
  );
  if (
    hostLifecycles.length !== materials.length ||
    hostLifecycles.some((lifecycle) =>
      !materials.some((material) => sameMaterial(material, lifecycle.material))
    )
  ) {
    throw new TypeError(`${path}.hostLifecycles must cover exactly its materials.`);
  }
  return {
    capability: {
      id: safeId(capability.id, `${path}.capability.id`),
      version: exactVersionToken(capability.version, `${path}.capability.version`),
      use: capabilityUse(capability.use, `${path}.capability.use`),
      minimumQualification: capabilityQualification(
        capability.minimumQualification,
        `${path}.capability.minimumQualification`,
      ),
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
    runtimeModes,
    hostLifecycles,
  };
}

function parseRuntimeMode(
  value: unknown,
  path: string,
): CapabilityRuntimeMaterialRuntimeMode {
  const root = exactRecord(value, [
    "material",
    "targetPlatform",
    "mode",
    "qualificationAttestationFingerprint",
  ], path);
  const targetPlatform = root.targetPlatform === "linux/amd64" ||
      root.targetPlatform === "linux/arm64"
    ? root.targetPlatform
    : (() => {
      throw new TypeError(`${path}.targetPlatform is unsupported.`);
    })();
  const mode = root.mode === "native" || root.mode === "emulated" ? root.mode : (() => {
    throw new TypeError(`${path}.mode is unsupported.`);
  })();
  const qualificationAttestationFingerprint =
    root.qualificationAttestationFingerprint === null ? null : contentFingerprint(
      root.qualificationAttestationFingerprint,
      `${path}.qualificationAttestationFingerprint`,
    );
  if (mode === "emulated" && qualificationAttestationFingerprint === null) {
    throw new TypeError(
      `${path}.emulated mode requires its exact qualification attestation.`,
    );
  }
  return {
    material: parseMaterial(root.material, `${path}.material`),
    targetPlatform,
    mode,
    qualificationAttestationFingerprint,
  };
}

function parseHostLifecycle(
  value: unknown,
  path: string,
): CapabilityRuntimeHostLifecycle {
  const root = exactRecord(value, ["material", "kind", "launchGroup"], path);
  const material = parseMaterial(root.material, `${path}.material`);
  if (root.kind === "persistent-compose") {
    return {
      material,
      kind: "persistent-compose",
      launchGroup: root.launchGroup === null
        ? null
        : validateCapabilityRuntimeLaunchGroupReference(
          root.launchGroup,
          `${path}.launchGroup`,
        ),
    };
  }
  if (root.kind === "ephemeral-microsandbox" || root.kind === "cache-only") {
    if (root.launchGroup !== null) {
      throw new TypeError(`${path}.launchGroup must be null for ${root.kind}.`);
    }
    return { material, kind: root.kind, launchGroup: null };
  }
  throw new TypeError(`${path}.kind is unsupported.`);
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

function sameMaterial(
  left: CapabilityRuntimeMaterialIdentity,
  right: CapabilityRuntimeMaterialIdentity,
): boolean {
  return left.unitId === right.unitId && left.materialId === right.materialId &&
    left.imageDigest === right.imageDigest;
}

function capabilityUse(value: unknown, path: string): "preparation" | "execution" {
  if (value === "preparation" || value === "execution") return value;
  throw new TypeError(`${path} must equal preparation or execution.`);
}

function capabilityQualification(
  value: unknown,
  path: string,
): "compatible" | "qualified" {
  if (value === "compatible" || value === "qualified") return value;
  throw new TypeError(`${path} must equal compatible or qualified.`);
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
  /** Immutable group plans authorized to use the protected host materials. */
  readonly launchGroups: readonly CapabilityRuntimeLaunchGroupReference[];
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
  /**
   * The complete, ordered group membership. A journal intent is atomic at the
   * group boundary even though Docker executes several service transitions.
   */
  readonly materials: readonly CapabilityRuntimeMaterialIdentity[];
  /** Exact registry group used by the host mutator. */
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly projectId: string | null;
  readonly plannedAt: string;
  readonly previousObservations: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly state: CapabilityRuntimeObservedState | null;
  }[];
  readonly administrativeRemovalPlanFingerprint: ContentFingerprint | null;
}

/** A terminal host record; it never becomes an engineering receipt or proof. */
export interface CapabilityRuntimeJournalOutcome {
  readonly schemaVersion: "capability-runtime-host-mutation-outcome/1.0";
  readonly journalEntryId: string;
  readonly recordedAt: string;
  readonly status: "succeeded" | "failed" | "uncertain";
  /** Fresh observations when available. `null` remains literal uncertainty. */
  readonly observations: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly state: CapabilityRuntimeObservedState | null;
  }[];
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
    const outcome = outcomesByEntry.get(entry.id);
    return !outcome || outcome.status !== "succeeded" ||
      !entry.materials.every((material) => {
        const observed = observationsByMaterial.get(
          capabilityRuntimeMaterialKey(material),
        );
        const recorded = outcome.observations.find((value) =>
          sameMaterial(value.material, material)
        );
        return observed !== undefined && recorded !== undefined &&
          recorded.state !== null &&
          observationSatisfiesJournalIntent(entry.action, observed);
      });
  }).toSorted((left, right) => left.id.localeCompare(right.id));
  const pendingMaterialKeys = new Set(
    pendingJournalEntries.flatMap((entry) =>
      entry.materials.map(capabilityRuntimeMaterialKey)
    ),
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
    "materials",
    "launchGroup",
    "projectId",
    "plannedAt",
    "previousObservations",
    "administrativeRemovalPlanFingerprint",
  ], "$runtimeJournalEntry");
  const materials = arrayOf(root.materials, "$runtimeJournalEntry.materials").map(
    (material, index) =>
      parseMaterial(material, `$runtimeJournalEntry.materials[${index}]`),
  );
  if (materials.length === 0) {
    throw new TypeError("$runtimeJournalEntry.materials must not be empty.");
  }
  rejectDuplicates(
    materials.map(capabilityRuntimeMaterialKey),
    "$runtimeJournalEntry.materials",
  );
  const previousObservations = arrayOf(
    root.previousObservations,
    "$runtimeJournalEntry.previousObservations",
  ).map((value, index) => {
    const path = `$runtimeJournalEntry.previousObservations[${index}]`;
    const observation = exactRecord(value, ["material", "state"], path);
    return deepFreeze({
      material: parseMaterial(observation.material, `${path}.material`),
      state: observation.state === null
        ? null
        : observedState(observation.state, `${path}.state`),
    });
  });
  if (
    previousObservations.length !== materials.length ||
    previousObservations.some((value) =>
      !materials.some((material) => sameMaterial(material, value.material))
    )
  ) {
    throw new TypeError(
      "$runtimeJournalEntry.previousObservations must cover exactly its group materials.",
    );
  }
  return deepFreeze({
    id: safeId(root.id, "$runtimeJournalEntry.id"),
    action: journalAction(root.action, "$runtimeJournalEntry.action"),
    materials,
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(
      root.launchGroup,
      "$runtimeJournalEntry.launchGroup",
    ),
    projectId: root.projectId === null
      ? null
      : safeId(root.projectId, "$runtimeJournalEntry.projectId"),
    plannedAt: isoDateTime(root.plannedAt, "$runtimeJournalEntry.plannedAt"),
    previousObservations,
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
    "observations",
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
    observations: arrayOf(root.observations, "$runtimeJournalOutcome.observations")
      .map((value, index) => {
        const path = `$runtimeJournalOutcome.observations[${index}]`;
        const observation = exactRecord(value, ["material", "state"], path);
        return deepFreeze({
          material: parseMaterial(observation.material, `${path}.material`),
          state: observation.state === null
            ? null
            : observedState(observation.state, `${path}.state`),
        });
      }),
    detail: root.detail,
  });
}

export function validateCapabilityRuntimeLease(value: unknown): CapabilityRuntimeLease {
  const root = exactRecord(value, [
    "id",
    "projectId",
    "bindingIds",
    "materialKeys",
    "launchGroups",
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
  const launchGroups = arrayOf(root.launchGroups, "$runtimeLease.launchGroups")
    .map((
      group,
      index,
    ) =>
      validateCapabilityRuntimeLaunchGroupReference(
        group,
        `$runtimeLease.launchGroups[${index}]`,
      )
    );
  if (bindingIds.length === 0 || materialKeys.length === 0) {
    throw new TypeError(
      "$runtimeLease.bindingIds and materialKeys must not be empty.",
    );
  }
  rejectDuplicates(bindingIds, "$runtimeLease.bindingIds");
  rejectDuplicates(materialKeys, "$runtimeLease.materialKeys");
  rejectDuplicates(
    launchGroups.map((group) =>
      `${group.id}\u0000${group.version}\u0000${group.fingerprint.digest}`
    ),
    "$runtimeLease.launchGroups",
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
    launchGroups,
    acquiredAt,
    expiresAt,
  });
}

/** A matching material identity alone never reconciles a mutation intent. */
function observationSatisfiesJournalIntent(
  action: CapabilityRuntimeJournalAction,
  observed: CapabilityRuntimeObservedState,
): boolean {
  switch (action) {
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
