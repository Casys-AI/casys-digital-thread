/**
 * JIT host session for one sealed resolved-operation-plan capability.
 *
 * Queueing and the ROP recheck stay cold. This class is called only after the
 * final executor recheck and before a run claims its WAL/provider boundary.
 * It owns disposable-cache leases; H1 remains the only owner of Compose lease
 * acquisition and lifecycle mutation.
 */

import {
  type CapabilityRuntimeExecutionLeaseOwner,
  type CapabilityRuntimeHostLifecycle,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  deriveEffectiveCapabilityRuntimeLaunchProjection,
  fingerprintResolvedCapabilityRuntimeOperation,
  type ResolvedCapabilityRuntimeOperation,
  validateCapabilityRuntimeLease,
  validateResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
} from "../../domain/project/engineering-project.ts";
import {
  assertApprovedUncertainWriterReconciliation,
} from "../../domain/record/reconcile-uncertain-writer-proposal.ts";
import type {
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimeSecretSnapshot,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeLaunchGroupSupervisor } from "./capability-runtime-launch-group-supervisor.ts";
import type { CapabilityRuntimeGlobalJitDemandReader } from "./capability-runtime-jit-demand.ts";
import {
  assertExactCapabilityRuntimeLeaseScope,
  assertExactResolvedCapabilityRuntimeOperationRecheck,
  type CapabilityRuntimeMicrosandboxCache,
  type CapabilityRuntimeMicrosandboxProfileAttestation,
  exactCatalogImageReference,
  exactMicrosandboxProfileAttestations,
  sameExactCapabilityRuntimeExecutionLeaseOwner,
  uniqueCapabilityRuntimeHostLifecycles,
} from "./capability-runtime-session-primitives.ts";

export type { CapabilityRuntimeMicrosandboxCache } from "./capability-runtime-session-primitives.ts";

// The isolated FEA profile is bounded in minutes. Six hours leaves recovery
// room without treating an old queue claim as a permanent host reservation.
const LEASE_TTL_MS = 6 * 60 * 60 * 1_000;

export class CapabilityRuntimeSessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeSessionUnavailableError";
  }
}

/**
 * Exact fixed-executor invocation profile for one sealed microVM material.
 * It is intentionally keyed by the complete material identity so a future
 * multi-worker operation cannot lend one profile's authority to another.
 */
export type CapabilityRuntimeMicrosandboxExecutionProfile =
  CapabilityRuntimeMicrosandboxProfileAttestation;

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
  /** Closed server-owned multi-service Compose group authority. */
  readonly groups?: CapabilityRuntimeLaunchGroupSupervisor;
  /** Exact local cache observation for disposable Microsandbox workers. */
  readonly microsandbox?: CapabilityRuntimeMicrosandboxCache;
  /** Other cache materials (for example a source OCI cache) must opt in to a
   * distinct exact observer; they are never assumed to be Microsandbox. */
  readonly cache?: CapabilityRuntimeMaterialCache;
  /**
   * Host-wide, not releasing-project-scoped, demand query for a shared launch
   * group. Omission is deliberately fail-closed: the lease may release, but
   * the persistent group remains active until composition supplies this
   * reader. Server wiring: `ProjectCapabilityJitDemandReader` with the local
   * ledger census, passed as `hasAnyRemainingJitDemand`.
   */
  readonly hasAnyRemainingJitDemand?: CapabilityRuntimeGlobalJitDemandReader;
  /**
   * Transitional composition field. It is intentionally not consulted for
   * shared-group stopping because a single project's negative demand cannot
   * establish host-wide idleness.
   */
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
    /** Fixed-executor profile attestations, never supplied by an agent. */
    readonly microsandboxExecutionProfiles:
      readonly CapabilityRuntimeMicrosandboxExecutionProfile[];
    /**
     * The exact process-local secret generation shared by the sealed Compose
     * start and the provider client for this session. It is never persisted.
     */
    readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
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
    // A claimed run may resume its durable execution lease. A queued run is
    // different: it may reach H1 before the agent-run claim, so it may resume
    // only the exact owner-bearing lease left by that same pre-claim attempt.
    // In particular, this is not a generic queued-lease reuse path.
    const canReuseRunningOrPublishingLease = run.status === "running" ||
      run.status === "publishing";
    const assertFreshOperationalCapability = () =>
      assertExactResolvedCapabilityRuntimeOperationRecheck(
        input.recheck,
        operationalCapability,
        (message) => new CapabilityRuntimeSessionUnavailableError(message),
      );

    // This is intentionally inside the session seam, not merely the caller's
    // earlier prepare. It closes the TOCTOU window before the first host action.
    await assertFreshOperationalCapability();
    const lifecycles = uniqueCapabilityRuntimeHostLifecycles(
      operationalCapability.bindings.flatMap((binding) => binding.hostLifecycles),
      (message) => new CapabilityRuntimeSessionUnavailableError(message),
    );
    const microsandboxExecutionProfiles = exactMicrosandboxProfileAttestations(
      lifecycles,
      input.microsandboxExecutionProfiles,
      (message) => new CapabilityRuntimeSessionUnavailableError(message),
    );
    const persistent = lifecycles.filter((lifecycle) =>
      lifecycle.kind === "persistent-compose"
    );
    if (persistent.some((lifecycle) => lifecycle.launchGroup === null)) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "A required persistent capability has no enrolled exact launch group; activation is unavailable.",
      );
    }
    const groups = uniqueLaunchGroups(
      persistent.map((lifecycle) => lifecycle.launchGroup!),
    );
    const effectiveProjections = new Map(
      await Promise.all(groups.map(async (group) =>
        [
          groupToken(group),
          await deriveEffectiveCapabilityRuntimeLaunchProjection({
            launchGroup: group,
            operation: operationalCapability,
          }),
        ] as const
      )),
    );
    if (groups.length > 0 && !this.options.groups) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "A required persistent capability has no configured launch-group supervisor.",
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

    const leaseId = await executionLeaseId({
      projectId: input.project.project.id,
      runId: input.runId,
      operationalCapability,
    });
    const candidate = candidateLease({
      id: leaseId,
      projectId: input.project.project.id,
      operationalCapability,
      lifecycles,
      executionOwner: await executionLeaseOwnerFor(run, operationalCapability),
      at: this.#now(),
    });
    const lease = candidate;
    const queuedPreclaimResumeOwner = run.status === "queued" && groups.length > 0
      ? await queuedPreclaimResumeOwnerFor(
        this.options.leases,
        lease,
        this.#now(),
      )
      : undefined;

    // One deterministic lease covers all persistent launch groups. The first
    // group can create it; later groups may reuse only that just-created claim.
    let directLeaseAcquired = false;
    let hostMutationAttempted = false;
    let groupLeaseCreated = false;
    try {
      // Exact local image/profile attestation is a read-only prerequisite. It
      // deliberately happens before a direct microVM/cache lease claim, so a
      // cache miss cannot create a misleading JIT recovery record.
      const context = await this.options.contexts.read(input.project);
      for (const lifecycle of lifecycles) {
        if (lifecycle.kind === "ephemeral-microsandbox") {
          await ensureExactCachePrerequisite(
            lifecycle.material,
            "Microsandbox",
            () =>
              this.options.microsandbox!.ensureExactCached({
                material: lifecycle.material,
                imageReference: exactCatalogImageReference(
                  context,
                  lifecycle.material,
                  (message) => new CapabilityRuntimeSessionUnavailableError(message),
                ),
                executionProfileFingerprint: microsandboxExecutionProfiles.get(
                  capabilityRuntimeMaterialKey(lifecycle.material),
                )!,
              }),
          );
        }
        if (lifecycle.kind === "cache-only") {
          await ensureExactCachePrerequisite(
            lifecycle.material,
            "cache-only",
            () =>
              this.options.cache!.ensureExactCached({
                material: lifecycle.material,
                imageReference: exactCatalogImageReference(
                  context,
                  lifecycle.material,
                  (message) => new CapabilityRuntimeSessionUnavailableError(message),
                ),
              }),
          );
        }
      }
      if (groups.length === 0) {
        await assertFreshOperationalCapability();
        const acquired = await acquireOrReuseExactScope(
          this.options.leases,
          lease,
          this.#now(),
          canReuseRunningOrPublishingLease,
        );
        directLeaseAcquired = acquired.created;
      }
      for (const group of groups) {
        const expectedMaterials = persistent.filter((lifecycle) =>
          lifecycle.launchGroup !== null &&
          groupToken(lifecycle.launchGroup) === groupToken(group)
        ).map((lifecycle) => lifecycle.material);
        hostMutationAttempted = true;
        const result = await this.options.groups!.ensureActive({
          group,
          expectedMaterials,
          effectiveRuntimeProjection: effectiveProjections.get(groupToken(group))!,
          resolvedOperation: operationalCapability,
          projectId: input.project.project.id,
          at: this.#now(),
          lease,
          reuseExistingLease: groupLeaseCreated || canReuseRunningOrPublishingLease ||
              queuedPreclaimResumeOwner !== undefined
            ? "allow"
            : "reject",
          ...(queuedPreclaimResumeOwner === undefined
            ? {}
            : { queuedPreclaimResumeOwner }),
          // The outer recheck above protects cache observation. This second
          // recheck runs *inside* H1 immediately before a lease or host
          // mutation, closing the revocation/deactivation race.
          guard: async () => {
            try {
              await assertFreshOperationalCapability();
              return true;
            } catch (error) {
              if (error instanceof CapabilityRuntimeSessionUnavailableError) {
                return false;
              }
              throw error;
            }
          },
          secretSnapshot: input.secretSnapshot,
        });
        groupLeaseCreated ||= result.leaseDisposition === "created";
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
    if (!acquired) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "Capability runtime session completed activation without its durable lease; recovery must not infer an unpersisted claim.",
      );
    }
    return new ActiveCapabilityRuntimeExecutionSession(
      assertEquivalentLease(acquired, lease),
      groups,
      operationalCapability.bindings.flatMap((binding) => binding.materials).map(
        capabilityRuntimeMaterialKey,
      ).toSorted(),
      this.options,
    );
  }

  /**
   * A recorded replay has already captured its provider result. This recovery
   * path never calls ensureActive: it only releases the exact extant execution
   * lease, and the group supervisor preserves sibling leases and remaining JIT
   * demand before deciding whether a stop is safe.
   */
  async releaseRecorded(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly runId: string;
    readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
  }): Promise<void> {
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
        "Capability JIT recorded cleanup requires the exact current agent run.",
      );
    }
    if (!isTerminalAgentRunStatus(run.status)) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "Capability JIT recorded cleanup requires a durable terminal run.",
      );
    }
    const lifecycles = uniqueCapabilityRuntimeHostLifecycles(
      operationalCapability.bindings.flatMap((binding) => binding.hostLifecycles),
      (message) => new CapabilityRuntimeSessionUnavailableError(message),
    );
    const groups = uniqueLaunchGroups(
      lifecycles
        .filter((lifecycle) => lifecycle.kind === "persistent-compose")
        .map((lifecycle) => {
          if (lifecycle.launchGroup === null) {
            throw new CapabilityRuntimeSessionUnavailableError(
              "A required persistent capability has no enrolled exact launch group; activation is unavailable.",
            );
          }
          return lifecycle.launchGroup;
        }),
    );
    if (groups.length > 0 && !this.options.groups) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "A required persistent capability has no configured launch-group supervisor.",
      );
    }
    const leaseId = await executionLeaseId({
      projectId: input.project.project.id,
      runId: input.runId,
      operationalCapability,
    });
    const candidate = candidateLease({
      id: leaseId,
      projectId: input.project.project.id,
      operationalCapability,
      lifecycles,
      executionOwner: await executionLeaseOwnerFor(run, operationalCapability),
      at: this.#now(),
    });
    const stored = await this.options.leases.read(leaseId);
    if (!stored) return;
    const lease = assertEquivalentLease(stored, candidate);
    const at = this.#now();
    try {
      if (groups.length > 0 && this.options.groups) {
        await this.options.groups.releaseTerminal({
          groups,
          leaseId: lease.id,
          projectId: lease.projectId,
          at,
          hasRemainingJitDemand: async (materialKeys) =>
            this.options.hasAnyRemainingJitDemand === undefined
              ? true
              : await this.options.hasAnyRemainingJitDemand
                .hasAnyRemainingDemand({
                  materialKeys,
                }),
        });
        return;
      }
      await this.options.leases.release(lease.id);
    } catch (error) {
      throw new CapabilityRuntimeSessionUnavailableError(
        error instanceof Error
          ? error.message
          : "Capability JIT recorded cleanup failed; the exact lease is retained.",
      );
    }
  }

  /**
   * Releases a retained execution lease only after the persisted
   * `provider-did-not-write` ceremony has proven that the same failed run and
   * Thread basis are now clean.  Unlike `releaseRecorded`, this path never
   * reconstructs a historical binding from the current capability catalogue:
   * it selects the exact lease through provenance sealed when that lease was
   * first claimed.
   */
  async releaseReconciledUncertainWriterLease(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly failedRunId: string;
    readonly reconciliationRunId: string;
  }): Promise<void> {
    const failedRun = input.project.agentRuns.find((candidate) =>
      candidate.id === input.failedRunId
    );
    if (
      !failedRun || failedRun.status !== "failed" || !failedRun.failure ||
      failedRun.basis?.kind !== "thread-snapshot" ||
      failedRun.uncertainWriterReconciliation?.outcome !==
        "provider-did-not-write"
    ) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "Capability JIT reconciliation cleanup requires one failed provider-did-not-write run with an exact ThreadSnapshot basis.",
      );
    }
    const reconciliationRun = input.project.agentRuns.find((candidate) =>
      candidate.id === input.reconciliationRunId
    );
    const failedWorkItem = input.project.workItems.find((candidate) =>
      candidate.id === failedRun.workItemId
    );
    const failedOperation = failedWorkItem?.operation;
    const reconciliationWorkItem = reconciliationRun === undefined
      ? undefined
      : input.project.workItems.find((candidate) =>
        candidate.id === reconciliationRun.workItemId
      );
    if (
      !reconciliationRun || reconciliationRun.status !== "completed" ||
      reconciliationRun.annotationOnly !== true ||
      !failedOperation ||
      reconciliationRun.basis?.kind !== "thread-snapshot" ||
      !sameThreadBasis(reconciliationRun.basis, failedRun.basis) ||
      reconciliationWorkItem?.operation?.id !==
        "record.reconcile-uncertain-writer" ||
      reconciliationWorkItem.operation.version !== "1" ||
      !reconciliationWorkItem.decisionIds.includes(
        failedRun.uncertainWriterReconciliation.decisionId,
      )
    ) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "Capability JIT reconciliation cleanup is not linked to the exact completed reconciliation run and failed-run basis.",
      );
    }
    try {
      await assertApprovedUncertainWriterReconciliation(input.project, failedRun);
    } catch (error) {
      throw new CapabilityRuntimeSessionUnavailableError(
        `Capability JIT reconciliation cleanup has no exact approved human ceremony: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const at = this.#now();
    const matches = (await this.options.leases.listActive(at)).filter((lease) =>
      lease.projectId === input.project.project.id && sameExecutionLeaseOwner(
        lease.executionOwner,
        failedRun,
        failedOperation,
      )
    );
    if (matches.length === 0) return;
    if (matches.length !== 1) {
      throw new CapabilityRuntimeSessionUnavailableError(
        "Capability JIT reconciliation cleanup found multiple exact retained leases for one failed run.",
      );
    }
    await this.#releaseReconciledLease(matches[0]!, at);
  }

  async #releaseReconciledLease(
    lease: CapabilityRuntimeLease,
    at: string,
  ): Promise<void> {
    try {
      if (lease.launchGroups.length > 0) {
        if (!this.options.groups) {
          throw new CapabilityRuntimeSessionUnavailableError(
            "Capability JIT reconciliation cleanup has no configured launch-group supervisor.",
          );
        }
        await this.options.groups.releaseTerminal({
          groups: lease.launchGroups,
          leaseId: lease.id,
          projectId: lease.projectId,
          at,
          hasRemainingJitDemand: async (materialKeys) =>
            this.options.hasAnyRemainingJitDemand === undefined
              ? true
              : await this.options.hasAnyRemainingJitDemand
                .hasAnyRemainingDemand({
                  materialKeys,
                }),
        });
        return;
      }
      await this.options.leases.release(lease.id);
    } catch (error) {
      throw new CapabilityRuntimeSessionUnavailableError(
        error instanceof Error
          ? error.message
          : "Capability JIT reconciliation cleanup failed; the exact lease is retained.",
      );
    }
  }
}

class ActiveCapabilityRuntimeExecutionSession
  implements CapabilityRuntimeExecutionSession {
  #retained = false;
  #releaseAttempted = false;

  constructor(
    readonly lease: CapabilityRuntimeLease,
    private readonly launchGroups: readonly CapabilityRuntimeLaunchGroupReference[],
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
      if (this.launchGroups.length > 0 && this.options.groups) {
        await this.options.groups.releaseTerminal({
          groups: this.launchGroups,
          leaseId: this.lease.id,
          projectId: this.lease.projectId,
          at,
          hasRemainingJitDemand: async (materialKeys) =>
            this.options.hasAnyRemainingJitDemand === undefined
              ? true
              : await this.options.hasAnyRemainingJitDemand
                .hasAnyRemainingDemand({
                  materialKeys,
                }),
        });
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

async function executionLeaseId(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
}): Promise<string> {
  const fingerprint = await fingerprintResolvedCapabilityRuntimeOperation(
    input.operationalCapability,
  );
  return `capability-jit-${
    (await sha256Fingerprint({
      schemaVersion: "capability-runtime-jit-lease/1.0",
      projectId: input.projectId,
      runId: input.runId,
      operationalCapabilityFingerprint: fingerprint.digest,
    })).digest
  }`;
}

function isTerminalAgentRunStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function candidateLease(input: {
  readonly id: string;
  readonly projectId: string;
  readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
  readonly lifecycles: readonly CapabilityRuntimeHostLifecycle[];
  readonly executionOwner: CapabilityRuntimeExecutionLeaseOwner | undefined;
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
    launchGroups: uniqueLaunchGroups(
      input.lifecycles
        .filter((lifecycle) => lifecycle.kind === "persistent-compose")
        .map((lifecycle) => lifecycle.launchGroup!),
    ),
    acquiredAt: input.at,
    expiresAt: new Date(Date.parse(input.at) + LEASE_TTL_MS).toISOString(),
    ...(input.executionOwner === undefined
      ? {}
      : { executionOwner: input.executionOwner }),
  });
}

async function executionLeaseOwnerFor(
  run: EngineeringAgentRun,
  operationalCapability: ResolvedCapabilityRuntimeOperation,
): Promise<CapabilityRuntimeExecutionLeaseOwner | undefined> {
  if (run.basis?.kind !== "thread-snapshot") return undefined;
  return {
    kind: "execution-run",
    runId: run.id,
    operation: {
      id: operationalCapability.operation.id,
      version: operationalCapability.operation.version,
    },
    basis: {
      snapshotId: run.basis.snapshotId,
      revision: run.basis.revision,
      subjectId: run.basis.subjectId,
    },
    operationalCapabilityFingerprint:
      await fingerprintResolvedCapabilityRuntimeOperation(operationalCapability),
  };
}

/**
 * Cache observation is the last cold prerequisite before a direct lease claim
 * or any H1 activation.  Cache adapters deliberately expose no acquisition
 * API; every failure is therefore an unavailable session, never a recovery
 * claim or a provider attempt.
 */
async function ensureExactCachePrerequisite(
  material: CapabilityRuntimeMaterialIdentity,
  kind: "Microsandbox" | "cache-only",
  observe: () => Promise<void>,
): Promise<void> {
  try {
    await observe();
  } catch (error) {
    if (error instanceof CapabilityRuntimeSessionUnavailableError) throw error;
    throw new CapabilityRuntimeSessionUnavailableError(
      `The exact ${kind} cache prerequisite is unavailable for ${material.unitId}/${material.materialId}; no lease or provider dispatch was attempted.`,
    );
  }
}

function sameExecutionLeaseOwner(
  owner: CapabilityRuntimeExecutionLeaseOwner | undefined,
  failedRun: EngineeringAgentRun,
  operation: { readonly id: string; readonly version: string },
): boolean {
  if (
    !owner || owner.kind !== "execution-run" ||
    failedRun.basis?.kind !== "thread-snapshot"
  ) return false;
  return owner.runId === failedRun.id &&
    owner.operation.id === operation.id &&
    owner.operation.version === operation.version &&
    owner.basis.snapshotId === failedRun.basis.snapshotId &&
    owner.basis.revision === failedRun.basis.revision &&
    owner.basis.subjectId === failedRun.basis.subjectId;
}

function sameThreadBasis(
  left: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
  right: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
): boolean {
  return left.snapshotId === right.snapshotId && left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

function assertEquivalentLease(
  existingValue: CapabilityRuntimeLease,
  candidate: CapabilityRuntimeLease,
): CapabilityRuntimeLease {
  const existing = assertExactCapabilityRuntimeLeaseScope(
    existingValue,
    candidate,
    (message) => new CapabilityRuntimeSessionUnavailableError(message),
  );
  if (
    !sameOptionalExecutionLeaseOwner(
      existing.executionOwner,
      candidate.executionOwner,
    )
  ) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "The deterministic capability lease id is already held for another operational scope; recovery must resolve it.",
    );
  }
  return existing;
}

function sameOptionalExecutionLeaseOwner(
  left: CapabilityRuntimeExecutionLeaseOwner | undefined,
  right: CapabilityRuntimeExecutionLeaseOwner | undefined,
): boolean {
  // A missing owner is not inferred from materials or groups. Equality is
  // only enforced when both sides already carry an owner.
  if (left === undefined || right === undefined) return true;
  return sameExactCapabilityRuntimeExecutionLeaseOwner(left, right);
}

/**
 * A queued run has not yet crossed its agent claim boundary.  The one narrow
 * exception is a retry of that same queued run after H1 retained its durable
 * lease during persistent-group activation.  The coordinator proves the
 * immutable owner before telling H1 that reuse is allowed; H1 still owns the
 * journal and fresh-observation convergence under its host lock.
 */
async function queuedPreclaimResumeOwnerFor(
  store: CapabilityRuntimeLeaseStore,
  candidate: CapabilityRuntimeLease,
  at: string,
): Promise<CapabilityRuntimeExecutionLeaseOwner | undefined> {
  const stored = await store.read(candidate.id);
  if (!stored) return undefined;
  const lease = assertExactCapabilityRuntimeLeaseScope(
    stored,
    candidate,
    (message) => new CapabilityRuntimeSessionUnavailableError(message),
  );
  if (lease.expiresAt <= at) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "The deterministic capability lease is expired; recovery must reconcile it before a new host session.",
    );
  }
  const owner = candidate.executionOwner;
  if (
    !owner || !sameExactCapabilityRuntimeExecutionLeaseOwner(
      lease.executionOwner,
      owner,
    )
  ) {
    throw new CapabilityRuntimeSessionUnavailableError(
      "A queued capability run may resume only its exact owner-bearing pre-claim lease; recovery must not reuse a foreign or legacy lease.",
    );
  }
  return owner;
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

function groupToken(group: CapabilityRuntimeLaunchGroupReference): string {
  return `${group.id}\u0000${group.version}\u0000${group.fingerprint.digest}`;
}

function uniqueLaunchGroups(
  groups: readonly CapabilityRuntimeLaunchGroupReference[],
): readonly CapabilityRuntimeLaunchGroupReference[] {
  const result = new Map<string, CapabilityRuntimeLaunchGroupReference>();
  for (const group of groups) result.set(groupToken(group), group);
  return [...result.values()].toSorted((left, right) =>
    groupToken(left).localeCompare(groupToken(right))
  );
}
