/**
 * Short cache-attested preparation session for one server-owned microVM
 * prerequisite.
 *
 * This is neither the persistent-Compose preparation coordinator nor an
 * execution session: it has no launch group, work item, agent run, provider
 * WAL, or caller-provided image/runtime envelope. It can only protect an exact
 * local cache preparation that the cold server authority has already resolved.
 */

import {
  type CapabilityRuntimeHostLifecycle,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  fingerprintResolvedCapabilityRuntimeOperation,
  type ResolvedCapabilityRuntimeOperation,
  validateCapabilityRuntimeLease,
  validateResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { safeId } from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
} from "../../domain/project/engineering-project.ts";
import type {
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimePreparationEligibility,
  ProjectCapabilityRuntimeContextReader,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import {
  assertExactCapabilityRuntimeLeaseScope,
  assertExactResolvedCapabilityRuntimeOperationRecheck,
  type CapabilityRuntimeMicrosandboxCache,
  type CapabilityRuntimeMicrosandboxProfileAttestation,
  exactCatalogImageReference,
  exactMicrosandboxProfileAttestations,
  uniqueCapabilityRuntimeHostLifecycles,
} from "./capability-runtime-session-primitives.ts";

/** A preparation cache lease protects one short server-owned session. */
const MICROSANDBOX_PREPARATION_LEASE_TTL_MS = 15 * 60 * 1_000;
const MAX_EXACT_LEASE_SUCCESSORS = 32;

export class CapabilityRuntimeMicrosandboxPreparationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeMicrosandboxPreparationUnavailableError";
  }
}

export interface CapabilityRuntimeMicrosandboxPreparationSession {
  readonly lease: CapabilityRuntimeLease;
  /** The prerequisite was durably captured and reread. */
  releaseSuccess(): Promise<void>;
  /** Cache/provider-side ambiguity leaves its exact durable lease recoverable. */
  retainForRecovery(): void;
}

export interface CapabilityRuntimeMicrosandboxPreparationSessionCoordinatorOptions {
  /** Cold server authority for a registered prerequisite-only operation. */
  readonly authorization: CapabilityRuntimePreparationEligibility;
  /** Server-owned context used only to reopen the catalogued digest reference. */
  readonly contexts: ProjectCapabilityRuntimeContextReader;
  readonly leases: CapabilityRuntimeLeaseStore;
  readonly microsandbox: CapabilityRuntimeMicrosandboxCache;
  readonly now?: () => string;
}

/**
 * Coordinates an exact, disposable microVM cache prerequisite. Callers supply
 * only project scope, the registered operation, a server session key, and the
 * fixed server profile attestations. They cannot select an image, provider,
 * command, arguments, work item, or agent run.
 */
export class CapabilityRuntimeMicrosandboxPreparationSessionCoordinator {
  readonly #now: () => string;

  constructor(
    private readonly options:
      CapabilityRuntimeMicrosandboxPreparationSessionCoordinatorOptions,
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async begin(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
    /** Opaque stable key minted by the server for this preparation attempt. */
    readonly sessionKey: string;
    /** Fixed server profile attestations, never supplied by an agent. */
    readonly microsandboxProfileAttestations:
      readonly CapabilityRuntimeMicrosandboxProfileAttestation[];
  }): Promise<CapabilityRuntimeMicrosandboxPreparationSession> {
    const sessionKey = requireServerSessionKey(input.sessionKey);
    const scope = await this.#scope(input);
    const profileFingerprints = exactMicrosandboxProfileAttestations(
      scope.lifecycles,
      input.microsandboxProfileAttestations,
      unavailable,
    );

    // Cache attestation is intentionally before every lease read/claim. A
    // cache miss creates no recovery record and cannot be mistaken for an
    // invocation that reached a microVM boundary.
    const context = await this.options.contexts.read(input.project);
    for (const lifecycle of scope.lifecycles) {
      await this.options.microsandbox.ensureExactCached({
        material: lifecycle.material,
        imageReference: exactCatalogImageReference(
          context,
          lifecycle.material,
          unavailable,
        ),
        executionProfileFingerprint: profileFingerprints.get(
          capabilityRuntimeMaterialKey(lifecycle.material),
        )!,
      });
    }

    // Re-resolve cold authority after the cache observation and immediately
    // before the first lease read/claim, closing the revoke race without
    // pretending that a cache observer is a host-mutation lock.
    await assertExactResolvedCapabilityRuntimeOperationRecheck(
      () =>
        this.options.authorization.requirePreparation({
          project: input.project,
          operation: input.operation,
        }),
      scope.resolved,
      unavailable,
    );

    const at = this.#now();
    const initial = await candidateLease({
      project: input.project,
      operation: input.operation,
      sessionKey,
      scope,
      at,
    });
    const lease = await claimFreshExactLease(initial, at, this.options.leases);
    return new ActiveCapabilityRuntimeMicrosandboxPreparationSession(
      lease,
      this.options.leases,
    );
  }

  /**
   * A replay has already captured and reread its prerequisite result. This
   * cleanup never re-attests cache or claims a lease. It releases only the
   * current exact lease for the same server session when one remains live.
   */
  async releaseRecorded(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
    readonly sessionKey: string;
    /** Exact historical server-resolved operation sealed with the session. */
    readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
  }): Promise<void> {
    const sessionKey = requireServerSessionKey(input.sessionKey);
    // Cleanup must never consult current preparation eligibility: a later
    // revoke or catalog rollover cannot turn a durable historical lease into a
    // new scope or strand its already-recorded prerequisite result.
    const scope = await microsandboxPreparationScope({
      project: input.project,
      operation: input.operation,
      resolved: validateResolvedCapabilityRuntimeOperation(
        input.operationalCapability,
      ),
    });
    const at = this.#now();
    const initial = await candidateLease({
      project: input.project,
      operation: input.operation,
      sessionKey,
      scope,
      at,
    });
    const lease = await findLiveExactLease(initial, at, this.options.leases);
    if (!lease) return;
    try {
      await this.options.leases.release(lease.id);
    } catch (error) {
      throw new CapabilityRuntimeMicrosandboxPreparationUnavailableError(
        error instanceof Error
          ? error.message
          : "Recorded Microsandbox preparation cleanup failed; its exact lease is retained.",
      );
    }
  }

  async #scope(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
  }): Promise<MicrosandboxPreparationScope> {
    return await microsandboxPreparationScope({
      ...input,
      resolved: validateResolvedCapabilityRuntimeOperation(
        await this.options.authorization.requirePreparation(input),
      ),
    });
  }
}

async function microsandboxPreparationScope(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly operation: EngineeringOperationRef;
  readonly resolved: ResolvedCapabilityRuntimeOperation;
}): Promise<MicrosandboxPreparationScope> {
  const resolved = input.resolved;
  if (
    resolved.projectId !== input.project.project.id ||
    resolved.operation.id !== input.operation.id ||
    resolved.operation.version !== input.operation.version
  ) {
    throw unavailable(
      "Microsandbox preparation authority does not match the exact current project operation.",
    );
  }
  if (
    resolved.bindings.length !== 1 ||
    resolved.bindings[0]?.capability.use !== "preparation"
  ) {
    throw unavailable(
      "Microsandbox preparation requires exactly one resolved preparation binding.",
    );
  }
  const lifecycles = uniqueCapabilityRuntimeHostLifecycles(
    resolved.bindings[0]!.hostLifecycles,
    unavailable,
  );
  if (lifecycles.some((lifecycle) => lifecycle.kind !== "ephemeral-microsandbox")) {
    throw unavailable(
      "Microsandbox preparation binding must have only exact ephemeral Microsandbox materials.",
    );
  }
  return {
    resolved,
    lifecycles: lifecycles as readonly Extract<CapabilityRuntimeHostLifecycle, {
      readonly kind: "ephemeral-microsandbox";
    }>[],
    fingerprint: await fingerprintResolvedCapabilityRuntimeOperation(resolved),
  };
}

interface MicrosandboxPreparationScope {
  readonly resolved: ResolvedCapabilityRuntimeOperation;
  readonly lifecycles: readonly Extract<CapabilityRuntimeHostLifecycle, {
    readonly kind: "ephemeral-microsandbox";
  }>[];
  readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
}

class ActiveCapabilityRuntimeMicrosandboxPreparationSession
  implements CapabilityRuntimeMicrosandboxPreparationSession {
  #retained = false;
  #released = false;

  constructor(
    readonly lease: CapabilityRuntimeLease,
    private readonly leases: CapabilityRuntimeLeaseStore,
  ) {}

  retainForRecovery(): void {
    this.#retained = true;
  }

  async releaseSuccess(): Promise<void> {
    if (this.#retained || this.#released) return;
    this.#released = true;
    try {
      await this.leases.release(this.lease.id);
    } catch {
      // The prerequisite capture is durable. Retaining the claim leaves host
      // recovery explicit instead of changing a successful engineering result.
      this.#retained = true;
    }
  }
}

async function candidateLease(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly operation: EngineeringOperationRef;
  readonly sessionKey: string;
  readonly scope: MicrosandboxPreparationScope;
  readonly at: string;
}): Promise<CapabilityRuntimeLease> {
  const materialKeys = input.scope.lifecycles.map((lifecycle) =>
    capabilityRuntimeMaterialKey(lifecycle.material)
  ).toSorted();
  const bindingIds = input.scope.resolved.bindings.map((binding) => binding.binding.id)
    .toSorted();
  const id = `capability-microsandbox-preparation-${
    (await sha256Fingerprint({
      schemaVersion: "capability-runtime-microsandbox-preparation-lease/1.0",
      projectId: input.project.project.id,
      projectSnapshotId: input.project.id,
      projectRevision: input.project.revision,
      operation: {
        id: input.operation.id,
        version: input.operation.version,
      },
      operationalCapabilityFingerprint: input.scope.fingerprint.digest,
      sessionKey: input.sessionKey,
      materialKeys,
    })).digest
  }`;
  return validateCapabilityRuntimeLease({
    id,
    projectId: input.project.project.id,
    bindingIds,
    materialKeys,
    launchGroups: [],
    acquiredAt: input.at,
    expiresAt: new Date(
      Date.parse(input.at) + MICROSANDBOX_PREPARATION_LEASE_TTL_MS,
    ).toISOString(),
  });
}

/**
 * A live lease for this exact server session is a concurrent attempt, not a
 * reusable host. An expired exact record may advance only through a bounded,
 * deterministic successor chain, retaining the old immutable evidence.
 */
async function claimFreshExactLease(
  initial: CapabilityRuntimeLease,
  at: string,
  leases: CapabilityRuntimeLeaseStore,
): Promise<CapabilityRuntimeLease> {
  let candidate = initial;
  for (let generation = 0; generation < MAX_EXACT_LEASE_SUCCESSORS; generation++) {
    const claim = await leases.claim(candidate);
    const lease = exactMicrosandboxPreparationLease(claim.lease, candidate);
    if (claim.status === "created") return lease;
    if (lease.expiresAt > at) {
      throw unavailable(
        "A live Microsandbox preparation lease already exists for this exact server session; recovery must not reuse it.",
      );
    }
    candidate = await successorLease(lease, at);
  }
  throw unavailable(
    "Microsandbox preparation lease recovery exceeded its bounded exact successor chain.",
  );
}

async function findLiveExactLease(
  initial: CapabilityRuntimeLease,
  at: string,
  leases: CapabilityRuntimeLeaseStore,
): Promise<CapabilityRuntimeLease | undefined> {
  let candidate = initial;
  for (let generation = 0; generation < MAX_EXACT_LEASE_SUCCESSORS; generation++) {
    const stored = await leases.read(candidate.id);
    if (!stored) return undefined;
    const lease = exactMicrosandboxPreparationLease(stored, candidate);
    if (lease.expiresAt > at) return lease;
    candidate = await successorLease(lease, at);
  }
  throw unavailable(
    "Microsandbox preparation recorded cleanup exceeded its bounded exact successor chain.",
  );
}

function exactMicrosandboxPreparationLease(
  storedValue: CapabilityRuntimeLease,
  candidate: CapabilityRuntimeLease,
): CapabilityRuntimeLease {
  const lease = assertExactCapabilityRuntimeLeaseScope(
    storedValue,
    candidate,
    unavailable,
  );
  if (lease.executionOwner !== undefined) {
    throw unavailable(
      "Microsandbox preparation lease unexpectedly carries execution-run ownership.",
    );
  }
  return lease;
}

async function successorLease(
  previous: CapabilityRuntimeLease,
  at: string,
): Promise<CapabilityRuntimeLease> {
  const suffix = (await sha256Fingerprint({
    schemaVersion: "capability-runtime-microsandbox-preparation-lease-successor/1.0",
    previousLeaseId: previous.id,
    previousExpiresAt: previous.expiresAt,
    projectId: previous.projectId,
    bindingIds: previous.bindingIds,
    materialKeys: previous.materialKeys,
  })).digest;
  return validateCapabilityRuntimeLease({
    ...previous,
    id: `capability-microsandbox-preparation-recovery-${suffix}`,
    acquiredAt: at,
    expiresAt: new Date(
      Date.parse(at) + MICROSANDBOX_PREPARATION_LEASE_TTL_MS,
    ).toISOString(),
  });
}

function requireServerSessionKey(value: string): string {
  try {
    return safeId(value, "$microsandboxPreparation.sessionKey");
  } catch {
    throw unavailable(
      "Microsandbox preparation requires one server-issued stable session key.",
    );
  }
}

function unavailable(
  message: string,
): CapabilityRuntimeMicrosandboxPreparationUnavailableError {
  return new CapabilityRuntimeMicrosandboxPreparationUnavailableError(message);
}
