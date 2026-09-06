import type {
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectStartingPoint,
  EngineeringWorkItemKind,
} from "../../domain/project/engineering-project.ts";
import type { ThreadEntityKind } from "../../domain/thread/thread-snapshot.ts";
import type {
  RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

/** Provider-free contract shared by operation descriptors and the registry. */
export type EngineeringOperationBasisKind =
  | "approved-brief"
  | "thread-snapshot";

/** The registry validates a descriptor at plan publication and its basis at queueing. */
export type EngineeringOperationValidationStage = "planning" | "queue";

export type EngineeringOperationRiskClass = "low" | "consequential";

export type EngineeringOperationExecution = "trusted" | "planning-only";

/** Exact code-owned operation reference used only for runtime preparation. */
export interface EngineeringOperationRuntimePreparationPrerequisite {
  readonly id: string;
  readonly version: string;
}

/** Explicit semantic runtime ceiling of one registered operation. */
export type EngineeringOperationRuntimeDemand =
  | { readonly kind: "none" }
  | {
    readonly kind: "required";
    readonly capabilities: readonly RequiredEngineeringCapability[];
  };

export type EngineeringOperationBindingSourceKind =
  EngineeringOperationInputBinding["source"]["kind"];

/** One named state-reference input accepted by a reviewed operation. */
export interface RegisteredEngineeringOperationBinding {
  readonly name: string;
  readonly allowedSourceKinds: readonly EngineeringOperationBindingSourceKind[];
  readonly cardinality?: "one" | "one-or-more";
  readonly allowedThreadEntityKinds?: readonly ThreadEntityKind[];
  readonly uniqueThreadEntityReferences?: true;
}

/** Safe descriptor suitable for a project plan and a human-facing UI. */
export interface RegisteredEngineeringOperation {
  readonly id: string;
  readonly version: string;
  readonly startingPoint: EngineeringProjectStartingPoint;
  readonly allowedBasisKinds: readonly EngineeringOperationBasisKind[];
  readonly title: string;
  readonly description: string;
  readonly workItemKind: EngineeringWorkItemKind;
  readonly riskClass: EngineeringOperationRiskClass;
  readonly execution: EngineeringOperationExecution;
  /**
   * Provider-neutral, code-owned semantic ceiling. It cannot choose a
   * provider, package, image, endpoint, tool, argument, port, or secret.
   */
  readonly runtimeDemand: EngineeringOperationRuntimeDemand;
  /**
   * Closed, server-owned preparation closure. Every target must be a
   * planning-only prerequisite operation with exactly one preparation demand.
   * It is never an agent-plan or queue dependency.
   */
  readonly runtimePreparationPrerequisites?:
    readonly EngineeringOperationRuntimePreparationPrerequisite[];
  /** Excludes this descriptor from caller-visible planning and queueing. */
  readonly prerequisiteOnly?: true;
  readonly resolvedOperationPlan?: "2.0";
  readonly decisionEvidenceScope?: "thread-entity-bindings";
  /**
   * Every thread-entity input must name the exact project-change / run basis.
   * This keeps a state-bearing operation from carrying an older snapshot into
   * a later append or queue.
   */
  readonly threadEntityBindingsMustMatchBasis?: true;
  readonly requiresAdditiveChange?: true;
  /**
   * When set, every work item for this operation must `dependsOn` exactly one
   * current leaf revision of that registered operation. Superseded revisions
   * do not make the named leaf ambiguous. Enforced at `project_change_append`,
   * before MRTR or queue.
   */
  readonly requiresDependsOnOperation?: {
    readonly id: string;
    readonly version: string;
  };
  readonly mustOrigin?: "human";
  readonly bindings: readonly RegisteredEngineeringOperationBinding[];
}

/** Input resolved against the code-owned registry. */
export type RegisteredEngineeringOperationInput =
  | {
    readonly operation: EngineeringOperationRef;
    readonly stage: "planning";
  }
  | {
    readonly operation: EngineeringOperationRef;
    readonly stage: "queue";
    readonly basisKind: EngineeringOperationBasisKind;
  };

export interface ValidatedRegisteredEngineeringOperationInput {
  readonly operation: RegisteredEngineeringOperation;
  readonly stage: EngineeringOperationValidationStage;
  readonly basisKind?: EngineeringOperationBasisKind;
  readonly bindings: readonly EngineeringOperationInputBinding[];
}

/** Code-owned planning boundary; it exposes no provider tool or arguments. */
export interface EngineeringOperationRegistry {
  get(
    reference: Pick<EngineeringOperationRef, "id" | "version">,
  ): RegisteredEngineeringOperation | undefined;
  require(
    reference: Pick<EngineeringOperationRef, "id" | "version">,
  ): RegisteredEngineeringOperation;
  getIntake(
    startingPoint: EngineeringProjectStartingPoint,
  ): RegisteredEngineeringOperation | undefined;
  /** Immutable copies of every exact registered operation. */
  list(): readonly RegisteredEngineeringOperation[];
  /** Deterministic fingerprint of exact demand entries and preparation edges. */
  fingerprint(): Promise<ContentFingerprint>;
  validate(input: unknown): ValidatedRegisteredEngineeringOperationInput;
}

export type EngineeringOperationRegistryErrorCode =
  | "invalid_input"
  | "unknown_operation"
  | "prerequisite_only"
  | "unsupported_basis"
  | "invalid_bindings";

/** Stable fail-closed error contract returned by registry validation. */
export class EngineeringOperationRegistryError extends Error {
  constructor(
    readonly code: EngineeringOperationRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineeringOperationRegistryError";
  }
}
