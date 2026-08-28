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
  CapabilityRuntimeAdministrativeRemovalPlan,
  CapabilityRuntimeJournalEntry,
  CapabilityRuntimeLease,
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimeObservedState,
  ResolvedCapabilityRuntimeOperation,
} from "../../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringBasisRef,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import type {
  CapabilityRuntimeCatalog,
  ProjectCapabilityPlan,
} from "../../../control-plane/read-model/capability-runtime-catalog.ts";

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

/** Append-only durable intent log. Entries are written before host mutation. */
export interface CapabilityRuntimeJournal {
  appendBeforeMutation(entry: CapabilityRuntimeJournalEntry): Promise<void>;
  list(): Promise<readonly CapabilityRuntimeJournalEntry[]>;
}

/** Shared leases make JIT activation reference-countable without project writes. */
export interface CapabilityRuntimeLeaseStore {
  acquire(lease: CapabilityRuntimeLease): Promise<void>;
  release(leaseId: string): Promise<void>;
  listActive(at: string): Promise<readonly CapabilityRuntimeLease[]>;
}

/**
 * Future host mutation boundary. This lot deliberately supplies no Docker
 * implementation. A mutator may only act after its journal entry is durable.
 */
export interface CapabilityRuntimeHostMutator {
  mutate(input: {
    readonly entry: CapabilityRuntimeJournalEntry;
    readonly removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan;
  }): Promise<void>;
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
