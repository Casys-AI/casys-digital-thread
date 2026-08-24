import type {
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectStartingPoint,
  EngineeringWorkItemKind,
} from "../../domain/project/engineering-project.ts";
import type { ThreadEntityKind } from "../../domain/thread/thread-snapshot.ts";

/** Provider-free contract shared by operation descriptors and the registry. */
export type EngineeringOperationBasisKind =
  | "approved-brief"
  | "thread-snapshot";

/** The registry validates a descriptor at plan publication and its basis at queueing. */
export type EngineeringOperationValidationStage = "planning" | "queue";

export type EngineeringOperationRiskClass = "low" | "consequential";

export type EngineeringOperationExecution = "trusted" | "planning-only";

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
  readonly resolvedOperationPlan?: "2.0";
  readonly decisionEvidenceScope?: "thread-entity-bindings";
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
  validate(input: unknown): ValidatedRegisteredEngineeringOperationInput;
}

export type EngineeringOperationRegistryErrorCode =
  | "invalid_input"
  | "unknown_operation"
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
