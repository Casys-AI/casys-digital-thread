import {
  applyCm01DripTrayHeight28To30Correction,
  type Cm01DripTrayHeight28To30CorrectionResult,
} from "../../domain/cm01/cm01-drip-tray-height-correction.ts";
import type {
  EngineeringOperationInputBinding,
  EngineeringThreadEntityRef,
} from "../../domain/project/engineering-project.ts";
import type {
  ProposedThreadAction,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "./coffee-machine-cm01-v3-engineering-kits.ts";
import {
  type RegisteredEngineeringOperation,
  type RegisteredEngineeringOperationInput,
  requireRegisteredEngineeringOperation,
  type ValidatedRegisteredEngineeringOperationInput,
  validateRegisteredEngineeringOperationInput,
} from "./registry.ts";

/**
 * Transport-neutral planner for the only CM-01 V3 feedback-loop correction.
 *
 * It creates and validates registry queue declarations, but never calls a
 * provider. A server-owned executor receives the returned CAD queue first;
 * it may only prepare the mechanical queue after materialising a fresh CAD
 * STEP that supersedes the one made stale by the correction.
 */
export interface Cm01DripTrayHeight28To30CorrectionPlan {
  /** Immutable revision with the code-owned correction record and stale V1 evidence. */
  readonly correction: Cm01DripTrayHeight28To30CorrectionResult;
  /** Registry authorization for the operation that records the correction. */
  readonly recordCorrection: Cm01DripTrayHeightCorrectionQueue;
  /** The only immediately dispatchable successor operation: CAD@2. */
  readonly cad: Cm01DripTrayHeightCadQueue;
  /** Mechanical@2 remains intentionally blocked until CAD successor evidence exists. */
  readonly mechanical: Cm01DripTrayHeightBlockedMechanicalQueue;
}

export interface Cm01DripTrayHeightCorrectionQueue {
  readonly queueInput: RegisteredEngineeringOperationInput;
  readonly validated: ValidatedRegisteredEngineeringOperationInput;
}

export interface Cm01DripTrayHeightCadQueue extends Cm01DripTrayHeightCorrectionQueue {
  readonly action: ProposedThreadAction;
  readonly correctionArtifact: EngineeringThreadEntityRef;
}

export interface Cm01DripTrayHeightBlockedMechanicalQueue {
  readonly action: ProposedThreadAction;
  readonly operation: RegisteredEngineeringOperation;
  /** Exact correction record, already present in the correction snapshot. */
  readonly correctionArtifact: EngineeringThreadEntityRef;
  /** CAD action that must complete before this operation may be queued. */
  readonly requiredCadActionId: string;
}

export interface Cm01DripTrayHeightMechanicalQueue
  extends Cm01DripTrayHeightCorrectionQueue {
  readonly action: ProposedThreadAction;
  readonly correctionArtifact: EngineeringThreadEntityRef;
  readonly revisedCadStep: EngineeringThreadEntityRef;
}

/**
 * Server entry point: apply the closed domain correction, then turn its two
 * proposed actions into checked operation-registry instructions.
 */
export async function planCm01DripTrayHeight28To30Correction(
  base: ThreadSnapshot,
  options: { readonly appliedAt: string },
): Promise<Cm01DripTrayHeight28To30CorrectionPlan> {
  return compileCm01DripTrayHeight28To30CorrectionPlan(
    await applyCm01DripTrayHeight28To30Correction(base, options),
  );
}

/**
 * Compile a result already created by the closed domain operation.
 *
 * This is useful when a server persists the correction snapshot before it
 * dispatches CAD. It deliberately accepts the domain result rather than a
 * free-form action or product parameter.
 */
export function compileCm01DripTrayHeight28To30CorrectionPlan(
  correction: Cm01DripTrayHeight28To30CorrectionResult,
): Cm01DripTrayHeight28To30CorrectionPlan {
  const snapshot = correction.snapshot;
  const correctionArtifact = artifactReference(
    snapshot,
    correction.correctionArtifactId,
  );
  const cadAction = requireAction(
    correction.cadRecomputation,
    "design.build-coffee-machine-cm01-cad",
    "2",
    "ready",
  );
  const mechanicalAction = requireAction(
    correction.mechanicalRecomputation,
    "verify.coffee-machine-cm01-drip-tray-mechanical",
    "2",
    "blocked",
  );
  if (
    mechanicalAction.dependsOnActionIds.length !== 1 ||
    mechanicalAction.dependsOnActionIds[0] !== cadAction.id
  ) {
    throw new Error(
      "The CM-01 30 mm mechanical recomputation must depend on the exact CAD@2 action.",
    );
  }

  const recordCorrection = validatedQueue(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.dripTrayHeightCorrection,
    [approvedBriefBinding()],
  );
  const cad = validatedQueue(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30,
    [
      approvedBriefBinding(),
      threadEntityBinding("dripTrayHeightCorrection", correctionArtifact),
    ],
  );
  const mechanicalOperation = requireTrustedOperation(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30,
  );

  return Object.freeze({
    correction,
    recordCorrection,
    cad: Object.freeze({
      ...cad,
      action: structuredClone(cadAction),
      correctionArtifact,
    }),
    mechanical: Object.freeze({
      action: structuredClone(mechanicalAction),
      operation: mechanicalOperation,
      correctionArtifact,
      requiredCadActionId: cadAction.id,
    }),
  });
}

/**
 * Prepare mechanical@2 only after a server-owned CAD executor has materialised
 * a successor snapshot. No provider call occurs here.
 *
 * The caller must provide the fresh replacement assembly STEP identifier in
 * that successor snapshot. The planner fails closed unless it supersedes the
 * exact stale CAD STEP targeted by CAD@2 and the correction document remains
 * byte-identical in the successor state.
 */
export function prepareCm01DripTrayHeight30MechanicalQueue(
  plan: Cm01DripTrayHeight28To30CorrectionPlan,
  cadSuccessorSnapshot: ThreadSnapshot,
  revisedCadStepArtifactId: string,
): Cm01DripTrayHeightMechanicalQueue {
  const correctionSnapshot = validateThreadSnapshot(plan.correction.snapshot);
  const successor = validateThreadSnapshot(cadSuccessorSnapshot);
  if (successor.subject.id !== correctionSnapshot.subject.id) {
    throw new Error("The CM-01 CAD successor belongs to a different project subject.");
  }
  if (successor.revision <= correctionSnapshot.revision) {
    throw new Error(
      "The CM-01 CAD successor must be a later snapshot than the recorded correction.",
    );
  }

  const correctionArtifact = artifactReference(
    successor,
    plan.correction.correctionArtifactId,
  );
  const originalCorrectionArtifact = artifact(
    correctionSnapshot,
    plan.correction.correctionArtifactId,
  );
  const retainedCorrectionArtifact = artifact(successor, correctionArtifact.id);
  if (
    retainedCorrectionArtifact.freshness.status !== "fresh" ||
    retainedCorrectionArtifact.fingerprint.algorithm !==
      originalCorrectionArtifact.fingerprint.algorithm ||
    retainedCorrectionArtifact.fingerprint.digest !==
      originalCorrectionArtifact.fingerprint.digest
  ) {
    throw new Error(
      "The CM-01 CAD successor must retain the exact fresh correction record.",
    );
  }

  const revisedCadStep = artifact(successor, revisedCadStepArtifactId);
  if (
    revisedCadStep.kind !== "step" ||
    revisedCadStep.freshness.status !== "fresh" ||
    revisedCadStep.producer.serverId !== "build123d" ||
    revisedCadStep.producer.tool !== "build123d_export"
  ) {
    throw new Error(
      "The CM-01 mechanical recomputation requires a fresh build123d replacement CAD STEP.",
    );
  }
  const staleCadStep = predecessorCadStep(plan.correction);
  const replacesStaleCadStep = successor.provenance.some((link) =>
    link.relation === "supersedes" && link.from.kind === "artifact" &&
    link.from.id === revisedCadStep.id && link.to.kind === "artifact" &&
    link.to.id === staleCadStep.id
  );
  if (!replacesStaleCadStep) {
    throw new Error(
      "The CM-01 replacement CAD STEP must supersede the exact stale CAD@1 STEP.",
    );
  }

  const queue = validatedQueue(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30,
    [
      approvedBriefBinding(),
      threadEntityBinding("dripTrayHeightCorrection", correctionArtifact),
      threadEntityBinding(
        "revisedCadStep",
        artifactReference(successor, revisedCadStep.id),
      ),
    ],
  );
  return Object.freeze({
    ...queue,
    action: structuredClone(plan.mechanical.action),
    correctionArtifact,
    revisedCadStep: artifactReference(successor, revisedCadStep.id),
  });
}

function validatedQueue(
  reference: { readonly id: string; readonly version: string },
  bindings: readonly EngineeringOperationInputBinding[],
): Cm01DripTrayHeightCorrectionQueue {
  const queueInput: RegisteredEngineeringOperationInput = {
    operation: {
      id: reference.id,
      version: reference.version,
      bindings: bindings.map((binding) => structuredClone(binding)),
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  };
  const validated = validateRegisteredEngineeringOperationInput(queueInput);
  if (validated.operation.execution !== "trusted") {
    throw new Error(
      `The CM-01 correction planner requires a trusted ${reference.id}@${reference.version} operation.`,
    );
  }
  return Object.freeze({ queueInput, validated });
}

function requireTrustedOperation(
  reference: { readonly id: string; readonly version: string },
): RegisteredEngineeringOperation {
  const operation = requireRegisteredEngineeringOperation(reference);
  if (operation.execution !== "trusted") {
    throw new Error(
      `The CM-01 correction planner requires a trusted ${reference.id}@${reference.version} operation.`,
    );
  }
  return operation;
}

function approvedBriefBinding(): EngineeringOperationInputBinding {
  return { name: "approvedBrief", source: { kind: "approved-brief" } };
}

function threadEntityBinding(
  name: string,
  reference: EngineeringThreadEntityRef,
): EngineeringOperationInputBinding {
  return { name, source: { kind: "thread-entity", reference } };
}

function requireAction(
  action: ProposedThreadAction,
  operationId: string,
  operationVersion: "2",
  readiness: "ready" | "blocked",
): ProposedThreadAction {
  if (
    action.operation?.id !== operationId ||
    action.operation.inputs.operationVersion !== operationVersion ||
    action.readiness !== readiness
  ) {
    throw new Error(
      `The CM-01 correction result does not expose the required ${operationId}@${operationVersion} ${readiness} action.`,
    );
  }
  return action;
}

function artifactReference(
  snapshot: Pick<ThreadSnapshot, "id" | "revision" | "artifacts">,
  artifactId: string,
): EngineeringThreadEntityRef {
  artifact(snapshot, artifactId);
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifactId,
  };
}

function artifact(
  snapshot: Pick<ThreadSnapshot, "artifacts">,
  artifactId: string,
): ThreadArtifact {
  const found = snapshot.artifacts.find((candidate) => candidate.id === artifactId);
  if (!found) {
    throw new Error(`The CM-01 correction snapshot lacks artifact ${artifactId}.`);
  }
  return found;
}

function predecessorCadStep(
  correction: Cm01DripTrayHeight28To30CorrectionResult,
): ThreadArtifact {
  const action = correction.cadRecomputation;
  const ids = action.operation?.inputs.supersedesArtifactIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error("The CM-01 CAD@2 action does not declare its stale predecessors.");
  }
  const predecessorIds = ids as string[];
  const steps = predecessorIds.map((id) => artifact(correction.snapshot, id)).filter((
    item,
  ) => item.kind === "step");
  if (steps.length !== 1 || steps[0]?.freshness.status !== "stale") {
    throw new Error(
      "The CM-01 CAD@2 action must identify exactly one stale assembly STEP.",
    );
  }
  return steps[0];
}
