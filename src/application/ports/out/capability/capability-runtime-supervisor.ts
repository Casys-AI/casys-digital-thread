/**
 * Ports for the local operational capability supervisor.
 *
 * They are intentionally separate from MCP/BFF/UI composition and from
 * engineering MRTR/result authorities. Concrete Docker or Microsandbox
 * adapters belong in a later lot.
 */

import type {
  ProjectCapabilityDemand,
} from "../../../../domain/capability/project-capability-demand.ts";
import type {
  AllowedEngineeringCapability,
} from "../../../../domain/capability/engineering-capability.ts";
import type {
  CapabilityRuntimeAdministrativeRemovalObservation,
  CapabilityRuntimeAdministrativeRemovalPlan,
  CapabilityRuntimeJournalEntry,
  CapabilityRuntimeJournalOutcome,
  CapabilityRuntimeLease,
  CapabilityRuntimeObservedState,
  ResolvedCapabilityRuntimeOperation,
} from "../../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimePlatform,
} from "../../../../domain/capability/runtime/capability-runtime-material.ts";
import type {
  CapabilityRuntimeLaunchGroup,
  CapabilityRuntimeLaunchGroupReference,
} from "../../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringBasisRef,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeCatalog,
  ProjectCapabilityPlan,
} from "../../../../domain/capability/runtime/capability-runtime-catalog.ts";

/**
 * Effective append-only project authorization reconstructed by the authority
 * ledger. Absent is a literal `not-authorized`; historical projects are not
 * implicitly grandfathered.
 */
export interface ProjectCapabilityRuntimeAuthorization {
  readonly projectId: string;
  readonly status: "authorized" | "revoked";
  readonly fingerprint: ContentFingerprint;
  readonly allowedCapabilities: readonly AllowedEngineeringCapability[];
  /** Exact atomic unit manifests approved with the envelope. */
  readonly allowedUnits: readonly {
    readonly id: string;
    readonly version: string;
    readonly manifestFingerprint: ContentFingerprint;
  }[];
  /** Exact selected operational material approved with the brief/amendment. */
  readonly allowedBindings: readonly ProjectCapabilityRuntimeAuthorizedBinding[];
}

/** An authorization permits this exact qualified binding, never a replacement. */
export interface ProjectCapabilityRuntimeAuthorizedBinding {
  readonly capability: {
    readonly id: string;
    readonly version: string;
    readonly use: "preparation" | "execution";
  };
  readonly binding: { readonly id: string; readonly version: string };
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
  readonly unitIds: readonly string[];
  readonly materials: readonly CapabilityRuntimeMaterialIdentity[];
}

/**
 * Server-owned read model compiled from the exact project and local runtime
 * authorities. It is not agent input and must not expose credentials.
 */
export interface ProjectCapabilityRuntimeContext {
  readonly demand: ProjectCapabilityDemand;
  readonly plan: ProjectCapabilityPlan;
  readonly catalog: CapabilityRuntimeCatalog;
  /** Exact local desired-state authority read with this context. */
  readonly lock: CapabilityRuntimeAdminLock;
  readonly authorization: ProjectCapabilityRuntimeAuthorization | undefined;
}

export interface ProjectCapabilityRuntimeContextReader {
  read(project: EngineeringProjectSnapshot): Promise<ProjectCapabilityRuntimeContext>;
}

/** Fresh host observation, never a health/verdict assertion. */
export interface CapabilityRuntimeStateObserver {
  observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>>;
}

/**
 * Read-only observation of the runtime daemon platform. This is deliberately
 * separate from the Deno process architecture: a runtime can be remote,
 * virtualized, or emulated while the control process is not.
 */
export interface CapabilityRuntimeHostPlatformObserver {
  observePlatform(): Promise<CapabilityRuntimePlatform>;
}

/** Append-only durable intent log. Entries are written before host mutation. */
export interface CapabilityRuntimeJournal {
  appendBeforeMutation(entry: CapabilityRuntimeJournalEntry): Promise<void>;
  appendOutcome(outcome: CapabilityRuntimeJournalOutcome): Promise<void>;
  list(): Promise<readonly CapabilityRuntimeJournalEntry[]>;
  listOutcomes(): Promise<readonly CapabilityRuntimeJournalOutcome[]>;
}

/** Shared leases make JIT activation reference-countable without project writes. */
export interface CapabilityRuntimeLeaseStore {
  /**
   * Atomically creates the immutable claim or returns the durable claim that
   * won the race.  Callers must validate scope, expiry and ownership from the
   * returned value; an existing id is never silently treated as success.
   */
  claim(lease: CapabilityRuntimeLease): Promise<CapabilityRuntimeLeaseClaim>;
  /** Reads the exact durable claim before an operation may release it. */
  read(leaseId: string): Promise<CapabilityRuntimeLease | undefined>;
  release(leaseId: string): Promise<void>;
  listActive(at: string): Promise<readonly CapabilityRuntimeLease[]>;
}

export interface CapabilityRuntimeLeaseClaim {
  readonly status: "created" | "existing";
  readonly lease: CapabilityRuntimeLease;
}

/**
 * Future host mutation boundary. This lot deliberately supplies no Docker
 * implementation. A mutator may only act after its journal entry is durable.
 */
export interface CapabilityRuntimeHostMutator {
  mutate(input: {
    readonly authorization: AuthorizedCapabilityRuntimeHostMutation;
    readonly removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan;
    /**
     * Ephemeral launch-secret generation for this one runtime start.  It is an
     * opaque capability, not a serializable secret or an environment map.
     * A host adapter may consume it only while constructing its in-memory
     * launch overlay.
     */
    readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
  }): Promise<CapabilityRuntimeJournalOutcome>;
}

/**
 * Local-only inspection for an administrative material-removal review. This
 * keeps Docker ownership proof beside the existing host mutator instead of
 * creating a project, MCP or Workbench authority.
 */
export interface CapabilityRuntimeAdministrativeRemovalInspector {
  inspectAdministrativeRemoval(input: {
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  }): Promise<CapabilityRuntimeAdministrativeRemovalObservation>;
}

/**
 * Opaque application capability minted only after an exact journal intent is
 * durable and has no terminal outcome.  Adapters consume it at most once.
 */
export interface AuthorizedCapabilityRuntimeHostMutation {
  readonly entry: CapabilityRuntimeJournalEntry;
}

/**
 * Server-owned registry for an exact Compose topology spanning one or more
 * atomic materials. It is intentionally a separate authority from atomic
 * unit selection: callers can only resolve a sealed group reference.
 */
export interface CapabilityRuntimeLaunchGroupRegistry {
  require(
    reference: CapabilityRuntimeLaunchGroupReference,
  ): Promise<CapabilityRuntimeLaunchGroup>;
  list(): Promise<readonly CapabilityRuntimeLaunchGroup[]>;
}

/** Secret availability only. Secret values never cross this port. */
export interface CapabilityRuntimeSecretSlotObserver {
  observe(
    slots: readonly string[],
  ): Promise<ReadonlyMap<string, "available" | "unavailable" | "unknown">>;
}

declare const capabilityRuntimeSecretSnapshotBrand: unique symbol;

/**
 * Opaque, process-local secret generation.  It carries neither a value nor a
 * slot name so it cannot become part of Thread, CAS, WAL, argv or logs.
 */
export interface CapabilityRuntimeSecretSnapshot {
  readonly [capabilityRuntimeSecretSnapshotBrand]: true;
}

/**
 * Closed server-only secret snapshot minting.  The caller can ask only for
 * the exact slots sealed on an exact launch group; it cannot provide values,
 * environment names or arbitrary bindings.
 */
export interface CapabilityRuntimeSecretSnapshotResolver
  extends CapabilityRuntimeSecretSlotObserver {
  beginSnapshot(input: {
    readonly group: CapabilityRuntimeLaunchGroupReference;
    readonly slots: readonly string[];
  }): Promise<CapabilityRuntimeSecretSnapshot>;
}

/**
 * Closed launch-overlay channel.  The returned bytes are passed directly to
 * Compose stdin for the one start mutation and are never fingerprinted or
 * persisted.  There is intentionally no caller-provided environment map.
 */
export interface CapabilityRuntimeLaunchSecretInjector {
  composeOverlay(input: {
    readonly group: CapabilityRuntimeLaunchGroup;
    readonly snapshot: CapabilityRuntimeSecretSnapshot;
  }): Promise<Uint8Array>;
}

/** Cross-process host mutation serialization, separate from project leases. */
export interface CapabilityRuntimeHostMutationLock {
  withLock<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Queue-time guard. It is compatible with EngineeringProjectQueueEligibility
 * but is declared here so the runtime stays independent of command-service
 * implementation details.
 */
export interface CapabilityRuntimeQueueEligibility {
  validate(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly workItem: EngineeringWorkItem;
    readonly operation: EngineeringOperationRef;
    readonly basis: EngineeringBasisRef;
  }): Promise<ResolvedCapabilityRuntimeOperation | undefined>;
}

/**
 * Execution-time recheck. The resolved runtime identity is server produced and
 * becomes the value a later ROP schema revision seals alongside the run.
 */
export interface CapabilityRuntimeExecutionEligibility {
  requireExecution(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly run: EngineeringAgentRun;
    readonly workItem: EngineeringWorkItem;
    readonly operation: EngineeringOperationRef;
  }): Promise<ResolvedCapabilityRuntimeOperation | undefined>;
}

/**
 * Cold authority for a server-owned preparation step which has no agent run,
 * work item, WAL, or provider envelope.  It is deliberately narrower than
 * execution eligibility: exactly one registered preparation requirement must
 * be selected by the server before a short host lease may be considered.
 */
export interface CapabilityRuntimePreparationEligibility {
  requirePreparation(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
  }): Promise<ResolvedCapabilityRuntimeOperation>;
}
