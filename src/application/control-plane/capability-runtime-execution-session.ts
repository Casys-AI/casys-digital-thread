/**
 * JIT host session for one sealed resolved-operation-plan capability.
 *
 * Queueing and the ROP recheck stay cold. This class is called only after the
 * final executor recheck and before a run claims its WAL/provider boundary.
 * It owns disposable-cache leases; H1 remains the only owner of Compose lease
 * acquisition and lifecycle mutation.
 */

import {
  canonicalResolvedCapabilityRuntimeOperationText,
  type CapabilityRuntimeHostLifecycle,
  type CapabilityRuntimeLease,
  type CapabilityRuntimeMaterialIdentity,
  capabilityRuntimeMaterialKey,
  fingerprintResolvedCapabilityRuntimeOperation,
  type ResolvedCapabilityRuntimeOperation,
  validateCapabilityRuntimeLease,
  validateResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeLaunchProfileReference } from "../../domain/capability/runtime/capability-runtime-host.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  CapabilityRuntimeLeaseStore,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeHostSupervisor } from "./capability-runtime-host-supervisor.ts";

// The isolated FEA profile is bounded in minutes. Six hours leaves recovery
// room without treating an old queue claim as a permanent host reservation.
const LEASE_TTL_MS = 6 * 60 * 60 * 1_000;

export class CapabilityRuntimeSessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeSessionUnavailableError";
  }
}

/** Read-only Microsandbox cache boundary. It never pulls or starts a sandbox. */
export interface CapabilityRuntimeMicrosandboxCache {
  ensureExactCached(input: {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly imageReference: string;
    readonly executionProfileFingerprint: ContentFingerprint;
  }): Promise<void>;
}

export interface CapabilityRuntimeExecutionSession {
  readonly lease: CapabilityRuntimeLease;
  /** Only a terminal run outcome may release the shared lease. */
  releaseTerminal(): Promise<void>;
  /** Preserve the durable lease after an ambiguous provider/WAL outcome. */
  retainForRecovery(): void;
}

export interface CapabilityRuntimeExecutionSessionCoordinatorOptions {
  readonly contexts: ProjectCapabilityRuntimeContextReader;
  readonly leases: CapabilityRuntimeLeaseStore;
  /** H1 Compose-only authority, deliberately absent when no profile is enrolled. */
  readonly compose?: CapabilityRuntimeHostSupervisor;
  /** Exact local cache observation for disposable Microsandbox workers. */
  readonly microsandbox?: CapabilityRuntimeMicrosandboxCache;
  /** Other cache materials (for example a source OCI cache) must opt in to a
   * distinct exact observer; they are never assumed to be Microsandbox. */
  readonly cache?: CapabilityRuntimeMaterialCache;
  /** Omitted means keep a persistent service running; stopping on unknown
   * future JIT demand would be an unsafe host decision. */
  readonly hasRemainingJitDemand?: (input: {
    readonly projectId: string;
    readonly materialKeys: readonly string[];
  }) => Promise<boolean>;
  readonly now?: () => string;
}

/** Exact observation/acquisition boundary for a non-Microsandbox cache. */
export interface CapabilityRuntimeMaterialCache {
  ensureExactCached(input: {
    readonly material: CapabilityRuntimeMaterialIdentity;
    readonly imageReference: string;
  }): Promise<void>;
}

/**
 * A final cold recheck is injected by the fixed executor immediately before
 * this class may observe or mutate a host. Keeping it a callback avoids
 * teaching this host-oriented seam about runs, work items or providers.
 */
export type CapabilityRuntimeSessionRecheck = () => Promise<
  ResolvedCapabilityRuntimeOperation
>;

/**
 * Keeps one deterministic lease id per (project, run, sealed ROP capability).
 * A later caller reuses an equivalent durable lease. A host mutation that may
 * have started but did not reach a verified active state retains its lease so
 * recovery, rather than a duplicate dispatch, decides the next action.
 */
export class CapabilityRuntimeExecutionSessionCoordinator {
  readonly #now: () => string;

  constructor(
    private readonly options: CapabilityRuntimeExecutionSessionCoordinatorOptions,
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async begin(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly runId: string;
    readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
    /** The fixed domain executor's sealed execution profile, never agent input. */
    readonly executionProfileFingerprint?: ContentFingerprint;
    readonly recheck: CapabilityRuntimeSessionRecheck;
  }): Promise<CapabilityRuntimeExecutionSession> {
    const operationalCapability = validateResolvedCapabilityRuntimeOperation(
      input.operationalCapability,
    );
    if (operationalCapability.projectId !== input.project.project.id) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "Sealed operational capability belongs to another project.",
      );
    }
    const run = input.project.agentRuns.find((candidate) =>
      candidate.id === input.runId
    );
    if (!run) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "Capability JIT session requires the exact current agent run.",
      );
    }
    const canReuseLease = run.status === "running" || run.status === "publishing";

    // This is intentionally inside the session seam, not merely the caller's
    // earlier prepare. It closes the TOCTOU window before the first host action.
    const current = validateResolvedCapabilityRuntimeOperation(await input.recheck());
    if (
      canonicalResolvedCapabilityRuntimeOperationText(current) !==
        canonicalResolvedCapabilityRuntimeOperationText(operationalCapability)
    ) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "Operational capability changed after its sealed ROP recheck; requeue through a reviewed authorization amendment.",
      );
    }
    const lifecycles = uniqueLifecycles(
      operationalCapability.bindings.flatMap((binding) => binding.hostLifecycles),
    );
    if (
      lifecycles.some((lifecycle) => lifecycle.kind === "ephemeral-microsandbox") &&
      input.executionProfileFingerprint === undefined
    ) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "An ephemeral Microsandbox capability requires the fixed executor's sealed execution-profile fingerprint.",
      );
    }
    const persistent = lifecycles.filter((lifecycle) =>
      lifecycle.kind === "persistent-compose"
    );
    if (persistent.some((lifecycle) => lifecycle.launchProfile === null)) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "A required persistent capability has no enrolled exact launch profile; activation is unavailable.",
      );
    }
    // H1's durable stop protocol is deliberately one exact profile per lease.
    // Refusing a broader topology is safer than silently stopping only part of
    // an execution session until profile-group ownership exists.
    if (persistent.length > 1) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "A JIT run requires multiple persistent profiles, but this host supervisor admits one exact profile per session.",
      );
    }
    if (persistent.length > 0 && !this.options.compose) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "A required persistent capability has no configured host supervisor.",
      );
    }
    if (
      lifecycles.some((lifecycle) => lifecycle.kind === "ephemeral-microsandbox") &&
      !this.options.microsandbox
    ) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "An exact Microsandbox cache observer is not configured for this host.",
      );
    }
    if (
      lifecycles.some((lifecycle) => lifecycle.kind === "cache-only") &&
      !this.options.cache
    ) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "A cache-only material has no exact provider-specific cache observer on this host.",
      );
    }

    const fingerprint = await fingerprintResolvedCapabilityRuntimeOperation(
      operationalCapability,
    );
    const leaseId = `capability-jit-${
      (await sha256Fingerprint({
        schemaVersion: "capability-runtime-jit-lease/1.0",
        projectId: input.project.project.id,
        runId: input.runId,
        operationalCapabilityFingerprint: fingerprint.digest,
      })).digest
    }`;
    const candidate = candidateLease({
      id: leaseId,
      projectId: input.project.project.id,
      operationalCapability,
      lifecycles,
      at: this.#now(),
    });
    const lease = candidate;

    const compose = persistent[0];
    // H1 owns acquisition for a persistent Compose service. A microVM/cache
    // only session owns its own harmless local claim. This prevents a second
    // acquire for the same Compose lease.
    let directLeaseAcquired = false;
    let hostMutationAttempted = false;
    try {
      // Exact local image/profile attestation is a read-only prerequisite. It
      // deliberately happens before a direct microVM/cache lease claim, so a
      // cache miss cannot create a misleading JIT recovery record.
      const context = await this.options.contexts.read(input.project);
      for (const lifecycle of lifecycles) {
        if (lifecycle.kind === "ephemeral-microsandbox") {
          await this.options.microsandbox!.ensureExactCached({
            material: lifecycle.material,
            imageReference: exactCatalogImageReference(context, lifecycle.material),
            executionProfileFingerprint: input.executionProfileFingerprint!,
          });
        }
        if (lifecycle.kind === "cache-only") {
          await this.options.cache!.ensureExactCached({
            material: lifecycle.material,
            imageReference: exactCatalogImageReference(context, lifecycle.material),
          });
        }
      }
      if (!compose) {
        const acquired = await acquireOrReuseExactScope(
          this.options.leases,
          lease,
          this.#now(),
          canReuseLease,
        );
        directLeaseAcquired = acquired.created;
      }
      if (compose) {
        // No independent ensureMaterial/acquire: H1 performs the journalled
        // material check, exact profile validation and single lease acquire.
        hostMutationAttempted = true;
        const result = await this.options.compose!.ensureActive({
          profile: compose.launchProfile!,
          projectId: input.project.project.id,
          at: this.#now(),
          lease,
          reuseExistingLease: canReuseLease ? "allow" : "reject",
        });
        assertComposeActive(
          result.state,
          requiredQualification(operationalCapability, compose),
        );
      }
    } catch (error) {
      // A cache miss and a pre-mutation rejection are known safe failures; an
      // H1 path may have journalled/intended a host mutation, so preserve its
      // lease for recovery rather than allowing a blind repeat.
      if (!hostMutationAttempted && directLeaseAcquired) {
        await this.options.leases.release(lease.id);
      }
      throw error;
    }
    const acquired = await this.options.leases.read(lease.id);
    return new ActiveCapabilityRuntimeExecutionSession(
      acquired === undefined ? lease : assertEquivalentLease(acquired, lease),
      compose?.launchProfile ?? null,
      operationalCapability.bindings.flatMap((binding) => binding.materials).map(
        capabilityRuntimeMaterialKey,
      ).toSorted(),
      this.options,
    );
  }
}

class ActiveCapabilityRuntimeExecutionSession
  implements CapabilityRuntimeExecutionSession {
  #retained = false;
  #releaseAttempted = false;

  constructor(
    readonly lease: CapabilityRuntimeLease,
    private readonly launchProfile: CapabilityRuntimeLaunchProfileReference | null,
    private readonly materialKeys: readonly string[],
    private readonly options: CapabilityRuntimeExecutionSessionCoordinatorOptions,
  ) {}

  retainForRecovery(): void {
    this.#retained = true;
  }

  async releaseTerminal(): Promise<void> {
    if (this.#retained || this.#releaseAttempted) return;
    this.#releaseAttempted = true;
    const at = this.options.now?.() ?? new Date().toISOString();
    try {
      if (this.launchProfile && this.options.compose) {
        const released = await this.options.compose.releaseLease({
          profile: this.launchProfile,
          leaseId: this.lease.id,
          projectId: this.lease.projectId,
          at,
          jitDemand: this.options.hasRemainingJitDemand === undefined
            ? true
            : await this.options.hasRemainingJitDemand({
              projectId: this.lease.projectId,
              materialKeys: this.materialKeys,
            }),
        });
        if (
          released.deactivation?.status !== undefined &&
          released.deactivation.status !== "succeeded"
        ) {
          this.#retained = true;
        }
        return;
      }
      await this.options.leases.release(this.lease.id);
    } catch {
      // The run's terminal proof is already durable. A failed host cleanup is
      // represented by the still-present lease/journal and must be reconciled
      // later, not rewritten into a failed engineering result.
      this.#retained = true;
    }
  }
}

function candidateLease(input: {
  readonly id: string;
  readonly projectId: string;
  readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
  readonly lifecycles: readonly CapabilityRuntimeHostLifecycle[];
  readonly at: string;
}): CapabilityRuntimeLease {
  return validateCapabilityRuntimeLease({
    id: input.id,
    projectId: input.projectId,
    bindingIds: input.operationalCapability.bindings.map((binding) =>
      binding.binding.id
    )
      .toSorted(),
    materialKeys: input.lifecycles.map((lifecycle) =>
      capabilityRuntimeMaterialKey(lifecycle.material)
    ).toSorted(),
    launchProfiles: input.lifecycles
      .filter((lifecycle) => lifecycle.kind === "persistent-compose")
      .map((lifecycle) => lifecycle.launchProfile!),
    acquiredAt: input.at,
    expiresAt: new Date(Date.parse(input.at) + LEASE_TTL_MS).toISOString(),
  });
}

function assertEquivalentLease(
  existingValue: CapabilityRuntimeLease,
  candidate: CapabilityRuntimeLease,
): CapabilityRuntimeLease {
  const existing = validateCapabilityRuntimeLease(existingValue);
  const sameScope = existing.id === candidate.id &&
    existing.projectId === candidate.projectId &&
    sameTokens(existing.bindingIds, candidate.bindingIds) &&
    sameTokens(existing.materialKeys, candidate.materialKeys) &&
    sameTokens(
      existing.launchProfiles.map(profileToken),
      candidate.launchProfiles.map(profileToken),
    );
  if (!sameScope) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "The deterministic capability lease id is already held for another operational scope; recovery must resolve it.",
    );
  }
  return existing;
}

function assertUsableEquivalentLease(
  existing: CapabilityRuntimeLease,
  candidate: CapabilityRuntimeLease,
  at: string,
): CapabilityRuntimeLease {
  const lease = assertEquivalentLease(existing, candidate);
  if (lease.expiresAt <= at) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "The deterministic capability lease is expired; recovery must reconcile it before a new host session.",
    );
  }
  return lease;
}

async function acquireOrReuseExactScope(
  store: CapabilityRuntimeLeaseStore,
  candidate: CapabilityRuntimeLease,
  at: string,
  allowReuse: boolean,
): Promise<{ readonly lease: CapabilityRuntimeLease; readonly created: boolean }> {
  const claim = await store.claim(candidate);
  if (claim.status === "created") {
    return { lease: candidate, created: true };
  }
  if (!allowReuse) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "A queued capability run already has a deterministic session lease; recovery must not duplicate its host session.",
    );
  }
  return {
    lease: assertUsableEquivalentLease(claim.lease, candidate, at),
    created: false,
  };
}

function profileToken(profile: CapabilityRuntimeLaunchProfileReference): string {
  return `${profile.id}\u0000${profile.version}\u0000${profile.fingerprint.digest}`;
}

function sameTokens(left: readonly string[], right: readonly string[]): boolean {
  const orderedLeft = [...left].toSorted();
  const orderedRight = [...right].toSorted();
  return orderedLeft.length === orderedRight.length &&
    orderedLeft.every((token, index) => token === orderedRight[index]);
}

function assertComposeActive(
  state: {
    readonly material: string;
    readonly runtime: string;
    readonly qualification: string;
  } | undefined,
  required: "compatible" | "qualified",
): void {
  if (
    !state || state.material !== "installed" || state.runtime !== "active" ||
    state.qualification !== required && state.qualification !== "qualified"
  ) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "Persistent capability host did not reach an installed, active and sufficiently qualified observed state.",
    );
  }
}

function requiredQualification(
  operation: ResolvedCapabilityRuntimeOperation,
  lifecycle: Extract<CapabilityRuntimeHostLifecycle, {
    readonly kind: "persistent-compose";
  }>,
): "compatible" | "qualified" {
  const candidates = operation.bindings.filter((binding) =>
    binding.hostLifecycles.some((candidate) =>
      candidate.kind === "persistent-compose" &&
      capabilityRuntimeMaterialKey(candidate.material) ===
        capabilityRuntimeMaterialKey(lifecycle.material) &&
      candidate.material.imageDigest === lifecycle.material.imageDigest
    )
  );
  if (candidates.length === 0) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "Persistent material has no sealed operation qualification requirement.",
    );
  }
  return candidates.some((binding) =>
      binding.capability.minimumQualification === "qualified"
    )
    ? "qualified"
    : "compatible";
}

function uniqueLifecycles(
  value: readonly CapabilityRuntimeHostLifecycle[],
): readonly CapabilityRuntimeHostLifecycle[] {
  const result = new Map<string, CapabilityRuntimeHostLifecycle>();
  for (const lifecycle of value) {
    const key = capabilityRuntimeMaterialKey(lifecycle.material);
    const existing = result.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(lifecycle)) {
      throw new CapabilityRuntimeSessionUnavailableError(
        `Sealed operation has contradictory host lifecycle records for ${key}.`,
      );
    }
    result.set(key, structuredClone(lifecycle));
  }
  if (result.size === 0) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "A demanded operational capability has no host lifecycle materials.",
    );
  }
  return [...result.values()].toSorted((left, right) =>
    capabilityRuntimeMaterialKey(left.material).localeCompare(
      capabilityRuntimeMaterialKey(right.material),
    )
  );
}

function exactCatalogImageReference(
  context: Awaited<ReturnType<ProjectCapabilityRuntimeContextReader["read"]>>,
  identity: CapabilityRuntimeMaterialIdentity,
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
    throw new CapabilityRuntimeSessionUnavailableError(
      `Current runtime catalog no longer attests ${identity.unitId}/${identity.materialId} with the sealed digest.`,
    );
  }
  return material.imageReference;
}
