/**
 * Provider-neutral runtime supervision vocabulary.
 *
 * This is operational state only. It neither admits an engineering method nor
 * interprets an engineering result. Concrete Docker Compose and Microsandbox
 * adapters observe and mutate the host through application ports; none of
 * those details belong in this domain contract.
 */

import {
  arrayOf,
  closedRecord,
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
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimeMaterialRuntimeMode,
} from "./capability-runtime-material.ts";

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

/** Physical host state only; qualification is a separate server projection. */
export interface CapabilityRuntimeObservedState {
  readonly material: CapabilityRuntimeMaterialState;
  readonly runtime: CapabilityRuntimeProcessState;
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
  /** Server-evaluated qualification of this exact binding on this host. */
  readonly effectiveQualification: "compatible" | "qualified";
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
  readonly schemaVersion: "resolved-capability-runtime-operation/2.0";
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
    "resolved-capability-runtime-operation/2.0",
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
    schemaVersion: "resolved-capability-runtime-operation/2.0",
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
    "effectiveQualification",
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
  const minimumQualification = capabilityQualification(
    capability.minimumQualification,
    `${path}.capability.minimumQualification`,
  );
  const effectiveQualification = capabilityQualification(
    root.effectiveQualification,
    `${path}.effectiveQualification`,
  );
  if (!qualificationCoversMinimum(effectiveQualification, minimumQualification)) {
    throw new TypeError(
      `${path}.effectiveQualification does not meet the required capability qualification.`,
    );
  }
  return {
    capability: {
      id: safeId(capability.id, `${path}.capability.id`),
      version: exactVersionToken(capability.version, `${path}.capability.version`),
      use: capabilityUse(capability.use, `${path}.capability.use`),
      minimumQualification,
    },
    binding: {
      id: safeId(binding.id, `${path}.binding.id`),
      version: exactVersionToken(binding.version, `${path}.binding.version`),
    },
    effectiveQualification,
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

/**
 * Exact operational authority for one persistent Compose group. This is
 * server-derived from a rechecked resolved operation, never Docker state or
 * caller input. It deliberately records qualification beside the sealed
 * runtime mode instead of embedding it in an immutable topology descriptor.
 */
export const EFFECTIVE_CAPABILITY_RUNTIME_LAUNCH_PROJECTION_SCHEMA_VERSION =
  "effective-capability-runtime-launch-projection/1.0" as const;

export interface EffectiveCapabilityRuntimeLaunchProjection {
  readonly schemaVersion:
    typeof EFFECTIVE_CAPABILITY_RUNTIME_LAUNCH_PROJECTION_SCHEMA_VERSION;
  readonly fingerprint: ContentFingerprint;
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly materials: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly binding: { readonly id: string; readonly version: string };
    readonly effectiveQualification: "compatible" | "qualified";
    readonly minimumQualification: "compatible" | "qualified";
    readonly runtimeMode: CapabilityRuntimeMaterialRuntimeMode;
  }[];
}

export async function deriveEffectiveCapabilityRuntimeLaunchProjection(input: {
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly operation: ResolvedCapabilityRuntimeOperation;
}): Promise<EffectiveCapabilityRuntimeLaunchProjection> {
  const operation = validateResolvedCapabilityRuntimeOperation(input.operation);
  const launchGroup = validateCapabilityRuntimeLaunchGroupReference(
    input.launchGroup,
    "$effectiveRuntimeProjection.launchGroup",
  );
  const materials = operation.bindings.flatMap((binding) =>
    binding.hostLifecycles.filter((lifecycle) =>
      lifecycle.kind === "persistent-compose" && lifecycle.launchGroup !== null &&
      sameLaunchGroupReference(lifecycle.launchGroup, launchGroup)
    ).map((lifecycle) => {
      const material = binding.materials.filter((candidate) =>
        sameMaterial(candidate, lifecycle.material)
      );
      const runtimeMode = binding.runtimeModes.filter((candidate) =>
        sameMaterial(candidate.material, lifecycle.material)
      );
      if (material.length !== 1 || runtimeMode.length !== 1) {
        throw new TypeError(
          "Resolved persistent runtime lifecycle lacks one exact material and runtime mode.",
        );
      }
      return {
        material: material[0]!,
        binding: { ...binding.binding },
        effectiveQualification: binding.effectiveQualification,
        minimumQualification: binding.capability.minimumQualification,
        runtimeMode: structuredClone(runtimeMode[0]!),
      };
    })
  );
  if (materials.length === 0) {
    throw new TypeError(
      "Resolved operation has no persistent material for the requested launch group.",
    );
  }
  return await createEffectiveCapabilityRuntimeLaunchProjection({
    launchGroup,
    materials,
  });
}

export async function createEffectiveCapabilityRuntimeLaunchProjection(input: {
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly materials: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly binding: { readonly id: string; readonly version: string };
    readonly effectiveQualification: "compatible" | "qualified";
    readonly minimumQualification: "compatible" | "qualified";
    readonly runtimeMode: CapabilityRuntimeMaterialRuntimeMode;
  }[];
}): Promise<EffectiveCapabilityRuntimeLaunchProjection> {
  const body = effectiveRuntimeProjectionBody(input, "$effectiveRuntimeProjection");
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validateEffectiveCapabilityRuntimeLaunchProjection(
  value: unknown,
): Promise<EffectiveCapabilityRuntimeLaunchProjection> {
  const root = exactRecord(value, [
    "schemaVersion",
    "fingerprint",
    "launchGroup",
    "materials",
  ], "$effectiveRuntimeProjection");
  literalValue(
    root.schemaVersion,
    EFFECTIVE_CAPABILITY_RUNTIME_LAUNCH_PROJECTION_SCHEMA_VERSION,
    "$effectiveRuntimeProjection.schemaVersion",
  );
  const body = effectiveRuntimeProjectionBody({
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(
      root.launchGroup,
      "$effectiveRuntimeProjection.launchGroup",
    ),
    materials: arrayOf(root.materials, "$effectiveRuntimeProjection.materials").map(
      (entry, index) =>
        parseEffectiveRuntimeProjectionMaterial(
          entry,
          `$effectiveRuntimeProjection.materials[${index}]`,
        ),
    ),
  }, "$effectiveRuntimeProjection");
  const fingerprint = contentFingerprint(
    root.fingerprint,
    "$effectiveRuntimeProjection.fingerprint",
  );
  const expected = await sha256Fingerprint(body);
  if (!sameFingerprint(fingerprint, expected)) {
    throw new TypeError(
      "$effectiveRuntimeProjection.fingerprint does not match its canonical body.",
    );
  }
  return deepFreeze({ ...body, fingerprint });
}

function effectiveRuntimeProjectionBody(input: {
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly materials: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly binding: { readonly id: string; readonly version: string };
    readonly effectiveQualification: "compatible" | "qualified";
    readonly minimumQualification: "compatible" | "qualified";
    readonly runtimeMode: CapabilityRuntimeMaterialRuntimeMode;
  }[];
}, path: string): Omit<EffectiveCapabilityRuntimeLaunchProjection, "fingerprint"> {
  const materials = input.materials.map((entry, index) =>
    parseEffectiveRuntimeProjectionMaterial(entry, `${path}.materials[${index}]`)
  ).toSorted((left, right) =>
    capabilityRuntimeMaterialKey(left.material).localeCompare(
      capabilityRuntimeMaterialKey(right.material),
    )
  );
  if (materials.length === 0) {
    throw new TypeError(`${path}.materials must not be empty.`);
  }
  rejectDuplicates(
    materials.map((entry) => capabilityRuntimeMaterialKey(entry.material)),
    `${path}.materials`,
  );
  for (const entry of materials) {
    if (
      !qualificationCoversMinimum(
        entry.effectiveQualification,
        entry.minimumQualification,
      )
    ) {
      throw new TypeError(
        `${path}.materials effective qualification does not meet its minimum.`,
      );
    }
    if (!sameMaterial(entry.material, entry.runtimeMode.material)) {
      throw new TypeError(`${path}.materials runtime mode does not match material.`);
    }
  }
  return {
    schemaVersion: EFFECTIVE_CAPABILITY_RUNTIME_LAUNCH_PROJECTION_SCHEMA_VERSION,
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(
      input.launchGroup,
      `${path}.launchGroup`,
    ),
    materials: deepFreeze(materials),
  };
}

function parseEffectiveRuntimeProjectionMaterial(
  value: unknown,
  path: string,
): EffectiveCapabilityRuntimeLaunchProjection["materials"][number] {
  const root = exactRecord(value, [
    "material",
    "binding",
    "effectiveQualification",
    "minimumQualification",
    "runtimeMode",
  ], path);
  const binding = exactRecord(root.binding, ["id", "version"], `${path}.binding`);
  return deepFreeze({
    material: parseMaterial(root.material, `${path}.material`),
    binding: {
      id: safeId(binding.id, `${path}.binding.id`),
      version: exactVersionToken(binding.version, `${path}.binding.version`),
    },
    effectiveQualification: capabilityQualification(
      root.effectiveQualification,
      `${path}.effectiveQualification`,
    ),
    minimumQualification: capabilityQualification(
      root.minimumQualification,
      `${path}.minimumQualification`,
    ),
    runtimeMode: parseRuntimeMode(root.runtimeMode, `${path}.runtimeMode`),
  });
}

function qualificationCoversMinimum(
  effective: "compatible" | "qualified",
  minimum: "compatible" | "qualified",
): boolean {
  return effective === "qualified" || minimum === "compatible";
}

function sameLaunchGroupReference(
  left: CapabilityRuntimeLaunchGroupReference,
  right: CapabilityRuntimeLaunchGroupReference,
): boolean {
  return left.id === right.id && left.version === right.version &&
    sameFingerprint(left.fingerprint, right.fingerprint);
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
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
  /**
   * Present on execution leases created after retained-lease recovery was
   * introduced.  It binds an otherwise host-only claim to the one project run
   * that may later release it through a human uncertain-writer reconciliation.
   *
   * Older immutable lease files deliberately omit this field. They remain
   * readable, but cannot be selected by the new owner-based recovery path.
   */
  readonly executionOwner?: CapabilityRuntimeExecutionLeaseOwner;
}

/** Immutable execution provenance for a JIT lease; never agent-supplied. */
export interface CapabilityRuntimeExecutionLeaseOwner {
  readonly kind: "execution-run";
  readonly runId: string;
  readonly operation: { readonly id: string; readonly version: string };
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
  readonly operationalCapabilityFingerprint: ContentFingerprint;
}

export type CapabilityRuntimeJournalAction =
  | "material-acquire"
  | "runtime-start"
  /** A private, host-local candidate qualification probe; never an operation run. */
  | "runtime-qualification-start"
  | "runtime-stop"
  | "material-remove";

/**
 * The reserved local lease owner for a private runtime qualification probe.
 * It deliberately cannot name an engineering project or a caller-selected
 * engine. Candidate selection and review recomposition stay in the private
 * qualification service; this durable record carries only exact opaque ids.
 */
export const CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID =
  "system-capability-qualification";

/**
 * Exact code-owned authority carried by a durable private qualification-start
 * intent. It is operational host evidence only: it does not admit a method,
 * create a project operation, or certify an engineering result.
 */
export interface CapabilityRuntimeQualificationStartAuthority {
  readonly candidate: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly reviewFingerprint: ContentFingerprint;
}

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
  /**
   * Exact server-only authority used for a normal runtime start. It is kept
   * in the durable intent so recovery can prove what was authorized without
   * reading a later catalogue or Docker observation. Every other action is
   * literally null.
   */
  readonly effectiveRuntimeProjection:
    | EffectiveCapabilityRuntimeLaunchProjection
    | null;
  /** Present only on the private qualification-start action. */
  readonly qualificationStartAuthority:
    | CapabilityRuntimeQualificationStartAuthority
    | null;
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
  /** The one sealed persistent topology this plan may remove as a whole. */
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly ownedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
  /** Exact pre-mutation image observation for every owned material. */
  readonly observedMaterials: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly state: "owned" | "absent";
  }[];
  /**
   * Exact owned container identities observed for this review. They are not
   * service names: an apply refuses a changed or foreign container rather
   * than resolving a name again during deletion.
   */
  readonly ownedContainerIds: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly containerId: string;
  }[];
  readonly preserveThread: true;
  readonly preserveCas: true;
  readonly preserveWal: true;
  readonly preserveProjectState: true;
  readonly preserveRetainedVolumes: true;
}

/**
 * A redacted, exact Docker observation used only to construct an
 * administrative removal plan. Repository references, argv, ports, mounts,
 * secret names and provider details deliberately do not cross this boundary.
 */
export interface CapabilityRuntimeAdministrativeRemovalObservation {
  readonly schemaVersion: "capability-runtime-removal-observation/1.0";
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly materials: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly state: "owned" | "absent";
  }[];
  readonly ownedContainerIds: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly containerId: string;
  }[];
  /** Any non-exact observation is a literal blocker, never a removal hint. */
  readonly safety: "exact" | "foreign" | "unknown";
}

/** Creates the exact, closed administrative plan from a trusted observation. */
export async function createCapabilityRuntimeAdministrativeRemovalPlan(input: {
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly ownedMaterials: readonly CapabilityRuntimeMaterialIdentity[];
  readonly observedMaterials: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly state: "owned" | "absent";
  }[];
  readonly ownedContainerIds: readonly {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly containerId: string;
  }[];
}): Promise<CapabilityRuntimeAdministrativeRemovalPlan> {
  const body = {
    schemaVersion: "capability-runtime-removal-plan/1.0" as const,
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(input.launchGroup),
    ownedMaterials: parseRemovalMaterials(input.ownedMaterials),
    observedMaterials: parseRemovalObservation(input.observedMaterials),
    ownedContainerIds: parseRemovalContainers(input.ownedContainerIds),
    preserveThread: true as const,
    preserveCas: true as const,
    preserveWal: true as const,
    preserveProjectState: true as const,
    preserveRetainedVolumes: true as const,
  };
  assertRemovalPlanCoverage(body);
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

/** Strict parser for persisted plans and host-mutator inputs. */
export async function validateCapabilityRuntimeAdministrativeRemovalPlan(
  value: unknown,
): Promise<CapabilityRuntimeAdministrativeRemovalPlan> {
  const root = exactRecord(value, [
    "schemaVersion",
    "fingerprint",
    "launchGroup",
    "ownedMaterials",
    "observedMaterials",
    "ownedContainerIds",
    "preserveThread",
    "preserveCas",
    "preserveWal",
    "preserveProjectState",
    "preserveRetainedVolumes",
  ], "$administrativeRemovalPlan");
  literalValue(
    root.schemaVersion,
    "capability-runtime-removal-plan/1.0",
    "$administrativeRemovalPlan.schemaVersion",
  );
  literalValue(root.preserveThread, true, "$administrativeRemovalPlan.preserveThread");
  literalValue(root.preserveCas, true, "$administrativeRemovalPlan.preserveCas");
  literalValue(root.preserveWal, true, "$administrativeRemovalPlan.preserveWal");
  literalValue(
    root.preserveProjectState,
    true,
    "$administrativeRemovalPlan.preserveProjectState",
  );
  literalValue(
    root.preserveRetainedVolumes,
    true,
    "$administrativeRemovalPlan.preserveRetainedVolumes",
  );
  const body = {
    schemaVersion: "capability-runtime-removal-plan/1.0" as const,
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(
      root.launchGroup,
      "$administrativeRemovalPlan.launchGroup",
    ),
    ownedMaterials: parseRemovalMaterials(root.ownedMaterials),
    observedMaterials: parseRemovalObservation(root.observedMaterials),
    ownedContainerIds: parseRemovalContainers(root.ownedContainerIds),
    preserveThread: true as const,
    preserveCas: true as const,
    preserveWal: true as const,
    preserveProjectState: true as const,
    preserveRetainedVolumes: true as const,
  };
  assertRemovalPlanCoverage(body);
  const fingerprint = contentFingerprint(
    root.fingerprint,
    "$administrativeRemovalPlan.fingerprint",
  );
  const expected = await sha256Fingerprint(body);
  if (
    expected.algorithm !== fingerprint.algorithm ||
    expected.digest !== fingerprint.digest
  ) {
    throw new TypeError(
      "$administrativeRemovalPlan.fingerprint does not match the exact plan body.",
    );
  }
  return deepFreeze({ ...body, fingerprint });
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

/** Strict parser for the opaque, private qualification authority in a host intent. */
export function validateCapabilityRuntimeQualificationStartAuthority(
  value: unknown,
): CapabilityRuntimeQualificationStartAuthority {
  const root = exactRecord(
    value,
    ["candidate", "reviewFingerprint"],
    "$qualificationStart",
  );
  const candidate = exactRecord(
    root.candidate,
    ["id", "fingerprint"],
    "$qualificationStart.candidate",
  );
  return deepFreeze({
    candidate: {
      id: safeId(candidate.id, "$qualificationStart.candidate.id"),
      fingerprint: contentFingerprint(
        candidate.fingerprint,
        "$qualificationStart.candidate.fingerprint",
      ),
    },
    reviewFingerprint: contentFingerprint(
      root.reviewFingerprint,
      "$qualificationStart.reviewFingerprint",
    ),
  });
}

/** Strict parser used by the durable host journal and test fixtures. */
export async function validateCapabilityRuntimeJournalEntry(
  value: unknown,
): Promise<CapabilityRuntimeJournalEntry> {
  const root = exactRecord(value, [
    "id",
    "action",
    "materials",
    "launchGroup",
    "projectId",
    "plannedAt",
    "previousObservations",
    "effectiveRuntimeProjection",
    "qualificationStartAuthority",
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
  const action = journalAction(root.action, "$runtimeJournalEntry.action");
  const effectiveRuntimeProjection = root.effectiveRuntimeProjection === null
    ? null
    : await validateEffectiveCapabilityRuntimeLaunchProjection(
      root.effectiveRuntimeProjection,
    );
  const qualificationStartAuthority = root.qualificationStartAuthority === null
    ? null
    : validateCapabilityRuntimeQualificationStartAuthority(
      root.qualificationStartAuthority,
    );
  const administrativeRemovalPlanFingerprint =
    root.administrativeRemovalPlanFingerprint === null ? null : contentFingerprint(
      root.administrativeRemovalPlanFingerprint,
      "$runtimeJournalEntry.administrativeRemovalPlanFingerprint",
    );
  const launchGroup = validateCapabilityRuntimeLaunchGroupReference(
    root.launchGroup,
    "$runtimeJournalEntry.launchGroup",
  );
  if (action === "runtime-start") {
    if (effectiveRuntimeProjection === null) {
      throw new TypeError(
        "$runtimeJournalEntry.runtime-start requires an exact effective runtime projection.",
      );
    }
    if (
      !sameLaunchGroupReference(effectiveRuntimeProjection.launchGroup, launchGroup)
    ) {
      throw new TypeError(
        "$runtimeJournalEntry.effectiveRuntimeProjection names another launch group.",
      );
    }
    if (
      effectiveRuntimeProjection.materials.length !== materials.length ||
      effectiveRuntimeProjection.materials.some((entry) =>
        !materials.some((material) => sameMaterial(material, entry.material))
      )
    ) {
      throw new TypeError(
        "$runtimeJournalEntry.effectiveRuntimeProjection must cover exactly the group materials.",
      );
    }
    if (qualificationStartAuthority !== null) {
      throw new TypeError(
        "$runtimeJournalEntry.runtime-start must not carry a qualification start authority.",
      );
    }
    if (administrativeRemovalPlanFingerprint !== null || root.projectId === null) {
      throw new TypeError(
        "$runtimeJournalEntry.runtime-start must be project-owned and not administrative.",
      );
    }
  } else if (action === "runtime-qualification-start") {
    if (effectiveRuntimeProjection !== null || qualificationStartAuthority === null) {
      throw new TypeError(
        "$runtimeJournalEntry.runtime-qualification-start requires only its exact private qualification authority.",
      );
    }
    if (
      administrativeRemovalPlanFingerprint !== null ||
      root.projectId !== CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID
    ) {
      throw new TypeError(
        "$runtimeJournalEntry.runtime-qualification-start requires the reserved local qualification project owner.",
      );
    }
  } else if (
    effectiveRuntimeProjection !== null || qualificationStartAuthority !== null
  ) {
    throw new TypeError(
      "$runtimeJournalEntry start authority is only allowed for its matching start action.",
    );
  }
  if (
    action === "material-remove"
      ? administrativeRemovalPlanFingerprint === null || root.projectId !== null
      : administrativeRemovalPlanFingerprint !== null
  ) {
    throw new TypeError(
      "$runtimeJournalEntry administrative removal authority does not match its action.",
    );
  }
  return deepFreeze({
    id: safeId(root.id, "$runtimeJournalEntry.id"),
    action,
    materials,
    launchGroup,
    projectId: root.projectId === null
      ? null
      : safeId(root.projectId, "$runtimeJournalEntry.projectId"),
    plannedAt: isoDateTime(root.plannedAt, "$runtimeJournalEntry.plannedAt"),
    previousObservations,
    effectiveRuntimeProjection,
    qualificationStartAuthority,
    administrativeRemovalPlanFingerprint,
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
  // Historical on-disk leases may omit `executionOwner`. Current execution
  // always writes an exact owner and never reconstructs an ownerless lease.
  const root = closedRecord(value, [
    "id",
    "projectId",
    "bindingIds",
    "materialKeys",
    "launchGroups",
    "acquiredAt",
    "expiresAt",
    "executionOwner",
  ], [
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
    ...(root.executionOwner === undefined ? {} : {
      executionOwner: validateCapabilityRuntimeExecutionLeaseOwner(
        root.executionOwner,
      ),
    }),
  });
}

export function validateCapabilityRuntimeExecutionLeaseOwner(
  value: unknown,
): CapabilityRuntimeExecutionLeaseOwner {
  const root = exactRecord(value, [
    "kind",
    "runId",
    "operation",
    "basis",
    "operationalCapabilityFingerprint",
  ], "$runtimeLease.executionOwner");
  literalValue(root.kind, "execution-run", "$runtimeLease.executionOwner.kind");
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$runtimeLease.executionOwner.operation",
  );
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "subjectId"],
    "$runtimeLease.executionOwner.basis",
  );
  if (
    typeof basis.revision !== "number" ||
    !Number.isSafeInteger(basis.revision) || basis.revision < 0
  ) {
    throw new TypeError(
      "$runtimeLease.executionOwner.basis.revision must be a non-negative safe integer.",
    );
  }
  return deepFreeze({
    kind: "execution-run",
    runId: safeId(root.runId, "$runtimeLease.executionOwner.runId"),
    operation: {
      id: safeId(operation.id, "$runtimeLease.executionOwner.operation.id"),
      version: exactVersionToken(
        operation.version,
        "$runtimeLease.executionOwner.operation.version",
      ),
    },
    basis: {
      snapshotId: safeId(
        basis.snapshotId,
        "$runtimeLease.executionOwner.basis.snapshotId",
      ),
      revision: basis.revision as number,
      subjectId: safeId(
        basis.subjectId,
        "$runtimeLease.executionOwner.basis.subjectId",
      ),
    },
    operationalCapabilityFingerprint: contentFingerprint(
      root.operationalCapabilityFingerprint,
      "$runtimeLease.executionOwner.operationalCapabilityFingerprint",
    ),
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
    case "runtime-qualification-start":
      return observed.runtime === "active";
    case "runtime-stop":
      return observed.runtime === "inactive";
    case "material-remove":
      return observed.material === "absent";
  }
}

function observedState(value: unknown, path: string): CapabilityRuntimeObservedState {
  const root = exactRecord(value, ["material", "runtime"], path);
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
  });
}

function parseRemovalMaterials(
  value: unknown,
): readonly CapabilityRuntimeMaterialIdentity[] {
  const materials = arrayOf(value, "$administrativeRemovalPlan.ownedMaterials").map(
    (material, index) =>
      parseMaterial(material, `$administrativeRemovalPlan.ownedMaterials[${index}]`),
  );
  if (materials.length === 0) {
    throw new TypeError(
      "$administrativeRemovalPlan.ownedMaterials must not be empty.",
    );
  }
  rejectDuplicates(
    materials.map(capabilityRuntimeMaterialKey),
    "$administrativeRemovalPlan.ownedMaterials",
  );
  return deepFreeze(materials);
}

function parseRemovalContainers(
  value: unknown,
): CapabilityRuntimeAdministrativeRemovalPlan["ownedContainerIds"] {
  const containers = arrayOf(
    value,
    "$administrativeRemovalPlan.ownedContainerIds",
  ).map((container, index) => {
    const path = `$administrativeRemovalPlan.ownedContainerIds[${index}]`;
    const root = exactRecord(container, ["material", "containerId"], path);
    return deepFreeze({
      material: parseMaterial(root.material, `${path}.material`),
      containerId: nonEmptyText(root.containerId, `${path}.containerId`),
    });
  });
  rejectDuplicates(
    containers.map((container) => capabilityRuntimeMaterialKey(container.material)),
    "$administrativeRemovalPlan.ownedContainerIds",
  );
  return deepFreeze(containers);
}

function parseRemovalObservation(
  value: unknown,
): CapabilityRuntimeAdministrativeRemovalPlan["observedMaterials"] {
  const observations = arrayOf(
    value,
    "$administrativeRemovalPlan.observedMaterials",
  ).map((observation, index) => {
    const path = `$administrativeRemovalPlan.observedMaterials[${index}]`;
    const root = exactRecord(observation, ["material", "state"], path);
    return deepFreeze({
      material: parseMaterial(root.material, `${path}.material`),
      state: oneOf(root.state, ["owned", "absent"] as const, `${path}.state`),
    });
  });
  if (observations.length === 0) {
    throw new TypeError(
      "$administrativeRemovalPlan.observedMaterials must not be empty.",
    );
  }
  rejectDuplicates(
    observations.map((observation) =>
      capabilityRuntimeMaterialKey(observation.material)
    ),
    "$administrativeRemovalPlan.observedMaterials",
  );
  return deepFreeze(observations);
}

function assertRemovalPlanCoverage(
  plan: Pick<
    CapabilityRuntimeAdministrativeRemovalPlan,
    "ownedMaterials" | "observedMaterials" | "ownedContainerIds"
  >,
): void {
  if (
    plan.ownedMaterials.length !== plan.observedMaterials.length ||
    plan.ownedMaterials.some((material, index) =>
      !sameMaterial(material, plan.observedMaterials[index]!.material)
    )
  ) {
    throw new TypeError(
      "$administrativeRemovalPlan.observedMaterials must cover ordered owned materials exactly.",
    );
  }
  if (
    plan.ownedContainerIds.some((container) =>
      !plan.ownedMaterials.some((material) =>
        sameMaterial(material, container.material)
      )
    )
  ) {
    throw new TypeError(
      "$administrativeRemovalPlan.ownedContainerIds must name owned materials only.",
    );
  }
}

function journalAction(value: unknown, path: string): CapabilityRuntimeJournalAction {
  return oneOf(
    value,
    [
      "material-acquire",
      "runtime-start",
      "runtime-qualification-start",
      "runtime-stop",
      "material-remove",
    ] as const,
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
