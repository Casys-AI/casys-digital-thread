import type {
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectStartingPoint,
  EngineeringThreadEntityRef,
  EngineeringWorkItemKind,
} from "../../domain/project/engineering-project.ts";
import type { ThreadEntityKind } from "../../domain/thread/thread-snapshot.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/platform/syson-model-seed.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/platform/architecture-proposal.ts";
import {
  DESIGN_PREVIEW_GEOMETRY_OPERATION,
  DESIGN_WRITE_GEOMETRY_OPERATION,
} from "../../domain/platform/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../domain/platform/requirements-proposal.ts";
import { listCoffeeMachineCm01V3OperationDescriptors } from "./coffee-machine-cm01-v3-engineering-kits.ts";
import { listInspectionDroneV4OperationDescriptors } from "./inspection-drone-v4.ts";
import { RECONCILE_UNCERTAIN_WRITER_OPERATION } from "../../domain/project/reconcile-uncertain-writer-proposal.ts";

/**
 * Reviewed, code-owned engineering operations.
 *
 * This registry intentionally describes only the safe planning boundary.  It
 * does not reveal provider selection, tool names, or provider arguments.
 */

export type EngineeringOperationBasisKind =
  | "approved-brief"
  | "thread-snapshot";

/**
 * Publishing a plan checks the reviewed descriptor and its declared state
 * bindings. Queueing additionally checks the concrete immutable basis that
 * the run will consume. Keeping those two moments explicit prevents a later
 * operation from inheriting the discovery basis merely because its plan was
 * authored from discovery.
 */
export type EngineeringOperationValidationStage = "planning" | "queue";

export type EngineeringOperationRiskClass = "low" | "consequential";

/**
 * Whether this reviewed descriptor is backed by a trusted server-owned
 * executor. Planning-only operations may appear in a reviewed plan, but they
 * must never become an agent run until a concrete executor is added and the
 * descriptor is promoted deliberately.
 */
export type EngineeringOperationExecution = "trusted" | "planning-only";

export type EngineeringOperationBindingSourceKind =
  EngineeringOperationInputBinding["source"]["kind"];

/** One named input the reviewed operation permits in an agent plan. */
export interface RegisteredEngineeringOperationBinding {
  readonly name: string;
  readonly allowedSourceKinds: readonly EngineeringOperationBindingSourceKind[];
  /** Default is one exact binding; one-or-more is an explicit reviewed variadic slot. */
  readonly cardinality?: "one" | "one-or-more";
  /** Optional safe subtype restriction when the source is a thread entity. */
  readonly allowedThreadEntityKinds?: readonly ThreadEntityKind[];
  /** Prevents an N-target operation from accepting the same exact entity twice. */
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
  /** Human-facing work classification derived from the reviewed operation. */
  readonly workItemKind: EngineeringWorkItemKind;
  readonly riskClass: EngineeringOperationRiskClass;
  readonly execution: EngineeringOperationExecution;
  /** Makes a consequential decision bind the exact thread-entity targets. */
  readonly decisionEvidenceScope?: "thread-entity-bindings";
  /**
   * This operation must be introduced by an additive project change
   * (project_change_append), not in the initial plan.  The executor enforces
   * this at runtime; the flag lets publishPlan catch it early — before any run
   * has completed and locked the plan against republication.
   *
   * Only needed when the executor requires exactly one planChange lineage (e.g.
   * architecture.seed-syson-model@2, which must follow the approved-brief
   * baseline).  All other generic operations leave this absent.
   */
  readonly requiresAdditiveChange?: true;
  /**
   * Execution demands a human origin; an agent-originated call must be refused.
   *
   * The executor gate is still the authority — this flag does not replace it.
   * What it adds is *reachability*: without a declarative marker, the surface
   * that dispatches runs has no way to know it should offer the human its
   * elicitation, so a human-only operation becomes unexecutable by anyone and
   * the state it was meant to unlock stays locked forever. That is not
   * hypothetical — it stranded two projects on a quarantined provider write.
   */
  readonly mustOrigin?: "human";
  readonly bindings: readonly RegisteredEngineeringOperationBinding[];
}

/** Input which a plan publisher or queue gate resolves against the registry. */
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
  /** Present only when a concrete run is being queued. */
  readonly basisKind?: EngineeringOperationBasisKind;
  readonly bindings: readonly EngineeringOperationInputBinding[];
}

/**
 * Code-owned boundary used by planning and, later, a trusted executor.
 * Implementations never expose provider selection or provider arguments.
 */
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

export class EngineeringOperationRegistryError extends Error {
  constructor(
    readonly code: EngineeringOperationRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineeringOperationRegistryError";
  }
}

const THREAD_ENTITY_KINDS = [
  "artifact",
  "consumption",
  "observation",
  "requirement",
  "evaluation",
  "violation",
  "change",
  "action",
] as const satisfies readonly ThreadEntityKind[];

const OPERATIONS = [
  {
    id: "baseline.from-approved-brief",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["approved-brief"],
    title: "Create the engineering baseline",
    description:
      "Create the first reviewable engineering baseline from the canonical human-approved project brief.",
    workItemKind: "define",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  {
    id: SYSON_MODEL_SEED_OPERATION.id,
    version: SYSON_MODEL_SEED_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Create the first editable system model",
    description:
      "Create a traceable SysML system-model container after the canonical project brief has been recorded as an exact documentary baseline.",
    workItemKind: "architect",
    riskClass: "consequential",
    execution: "trusted",
    // The executor verifies that this work item arrived via exactly one
    // planChange (assertChangeCanAppend requires a completed baseline first).
    // Publishing it in the initial plan silently passes planning but fails at
    // execution, after the baseline has locked the plan against republication.
    // requiresAdditiveChange lets publishPlan catch this before any run runs.
    requiresAdditiveChange: true,
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Generic architecture authoring — inserts the reviewed SysML package from
   * an MRTR-approved decision into a SysON model container. The proposal
   * parameters live in an EngineeringDecisionProposal (flat key/value grammar
   * reviewed and signed by the operator); the SysML text is server-rendered,
   * never agent-supplied.
   *
   * A required decision whose `decidedByOrigin === "human"` is the MRTR gate.
   * The work item must declare that decision in its `decisionIds` list.
   */
  {
    id: MODEL_WRITE_ARCHITECTURE_OPERATION.id,
    version: MODEL_WRITE_ARCHITECTURE_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Author the reviewed system architecture",
    description:
      "Insert the human-approved SysML architecture package into the existing SysON model container. " +
      "The exact package structure is derived from the MRTR-approved decision parameters — " +
      "no raw SysML or code-owned product template is supplied by the agent.",
    workItemKind: "architect",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Generic model-driven correction.  Planning-only until a server-owned
   * executor is promoted here.
   *
   * The operation takes two state-reference bindings from the current thread:
   *   - failingEvaluation  — the RequirementEvaluation entity whose status is
   *     "fail"; locates the comparison (actual, limit, normalizedUnit).
   *   - sensitivityEdges   — the artifact entity that carries the
   *     SensitivityEdge set for the relevant metric and driver.
   *
   * The server reads those references, calls proposeVectorCorrection, and
   * presents the resulting CorrectionProposal as an EngineeringDecisionProposal
   * for human MRTR consent.  No provider I/O is dispatched at this stage.
   */
  /**
   * Generic requirements authoring — inserts a native RequirementUsage from
   * an MRTR-approved decision below an exact SysON PartDefinition. The server
   * derives the RequirementUsage name from containerComponent, renders all
   * SysML, and verifies the subject typing and constraints by re-extraction.
   * The agent proposes reviewed integer scalar values, but never supplies SysML text.
   *
   * WHAT THE HUMAN ACTUALLY SIGNS — the canonical decision fingerprint over
   * {baseSnapshot, inputEvidenceRefs, proposal}, computed by the command
   * service and by it alone. There is no separate "envelope" fingerprint to
   * sign, and no tool could produce one: the resolved target (PartDefinition
   * label and elementId), the architecture basis and the server-derived
   * RequirementUsage name are
   * DERIVED deterministically from those signed inputs. The executor proves
   * both halves before any SysON write — that the decision carries the
   * service's own fingerprint, and that its derivation matches — so the
   * signature commits the exact target and architecture without ever asking a
   * human to sign a value no interface can show them.
   */
  {
    id: MODEL_WRITE_REQUIREMENTS_OPERATION.id,
    version: MODEL_WRITE_REQUIREMENTS_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Author reviewed requirements in the system model",
    description:
      "Insert a human-approved native SysML RequirementUsage below the exact target " +
      "PartDefinition, anchor each integer metric threshold as a typed attribute and required constraint, " +
      "then verify subject typing and the full set by re-extraction. The RequirementUsage " +
      "name is server-derived from containerComponent; no SysML text is supplied by the agent.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  {
    id: "design.apply-vector-correction",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Propose a linearized design-variable correction",
    description:
      "Read a failing requirement evaluation and the associated sensitivity edges from the thread, compute the first-order correction delta (z* = z + (limit − actual) / k), and present a bounded correction proposal for human MRTR consent before any provider run.",
    workItemKind: "design",
    riskClass: "low",
    execution: "planning-only",
    bindings: [
      {
        name: "failingEvaluation",
        allowedSourceKinds: ["thread-entity"],
      },
      {
        name: "sensitivityEdges",
        allowedSourceKinds: ["thread-entity"],
      },
    ],
  },
  /**
   * Geometry preview — planning-only until `project_geometry_preview` MCP tool
   * is wired as its executor.  The tool is a pure draft builder; it must NOT
   * publish to the ThreadSnapshot (D2 decision).
   */
  {
    id: DESIGN_PREVIEW_GEOMETRY_OPERATION.id,
    version: DESIGN_PREVIEW_GEOMETRY_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Preview the proposed geometry bundle",
    description:
      "Execute the reviewed assembly source and one independent build123d source per exact SysML PartDefinition " +
      "in the isolated preview sandbox against the current architecture basis, materialize a draft with " +
      "identity-bound binary assets and occurrence placements, and propose a geometry MRTR for human review. " +
      "Does not publish to the ThreadSnapshot — the draft is a workspace artefact only.",
    workItemKind: "design",
    riskClass: "low",
    execution: "planning-only",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Geometry seal — trusted executor `design.write-geometry@1`.
   *
   * Promotes exact draft bytes (verified against operator-signed SHA-256 hashes)
   * into the canonical ThreadSnapshot.  No provider re-execution; idempotent CAS
   * writes only.  Requires a human-approved MRTR decision (D1 gate).
   */
  {
    id: DESIGN_WRITE_GEOMETRY_OPERATION.id,
    version: DESIGN_WRITE_GEOMETRY_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the human-approved geometry into the evidence thread",
    description:
      "Verify the draft binary assets against the operator-signed hashes, promote them to " +
      "the canonical geometry capture, and extend the ThreadSnapshot with the assembly plus " +
      "independent PartDefinition CAD artifacts linked by exact SysML identities. " +
      "The exact bytes are sealed by SHA-256; no provider re-execution occurs (D1).",
    workItemKind: "design",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * FEA proof-case seal — trusted executor `verify.seal-proof-case@1`.
   *
   * Turns a reviewed authoring JSON (mechanical-proof-case/1.0, resolved through
   * the server-owned FEA_PROOF_CASE_SOURCES catalog — the agent never supplies a
   * path) into a content-addressed Thread artifact: the execution authority for
   * any later FEA run. The signed MRTR parameters spell out every consequential
   * input in clear text; the executor recrosses each one against the canonical
   * proof bytes. No provider is called.
   */
  {
    id: "verify.seal-proof-case",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed FEA proof case into the evidence thread",
    description:
      "Resolve the reviewed proof-case JSON through the server-owned catalog, verify the " +
      "operator-signed digest and every clear-text parameter against the canonical bytes, " +
      "prove the geometry, STEP and requirements-tip links against the basis snapshot, and " +
      "publish the content-addressed proof-case artifact. No provider is called.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Generic FEA static proof run — trusted executor
   * `verify.run-fea-static-proof@1`.
   *
   * Consumes exclusively the sealed proof-case artifact and the sealed geometry
   * artifact (both bound as exact thread entities, propagated into the approval's
   * inputEvidenceRefs via decisionEvidenceScope). The server stages the exact
   * STEP bytes, dispatches CalculiX with cross-attestation, evaluates through the
   * SysON oracle, and publishes a fail-closed verdict — a `fail` is publishable
   * with named violations and proposed actions.
   */
  {
    id: "verify.run-fea-static-proof",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Run the sealed FEA static proof and publish the oracle verdict",
    description:
      "Re-read and re-validate the sealed proof case, re-verify the requirements tip and " +
      "oracle fidelity on the execution basis, stage the exact STEP bytes into the solver " +
      "volume, dispatch CalculiX with SHA-256 cross-attestation, evaluate the metrics " +
      "through the SysON constraint oracle, and publish observations, evaluations and any " +
      "named violations with proposed actions.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [
      {
        name: "proofCase",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["artifact"],
      },
      {
        name: "geometry",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["artifact"],
      },
    ],
  },
  /**
   * Simulation-case seal — trusted executor `simulate.seal-simulation-case@1`.
   *
   * Same seal discipline as the FEA proof case, for OpenModelica scenario
   * simulation: the reviewed case (kit, scenario, explicit parameter overrides,
   * expected metrics) becomes a content-addressed Thread artifact. The kit lives
   * outside the thread, so the sealed {modelSha256, scenarioSha256} pair is the
   * honest external boundary — no inputArtifactIds are claimed.
   */
  {
    id: "simulate.seal-simulation-case",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed simulation case into the evidence thread",
    description:
      "Resolve the reviewed simulation-case JSON through the server-owned catalog, verify " +
      "the operator-signed digest and every clear-text parameter against the canonical " +
      "bytes, and publish the content-addressed simulation-case artifact. The kit and " +
      "scenario are bound by their sealed SHA-256 identities. No provider is called.",
    workItemKind: "simulate",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Generic Modelica scenario run — trusted executor
   * `simulate.run-modelica-scenario@1`.
   *
   * Observation only, never a verdict: a successful simulation publishes unit-
   * carrying observations and hashed artifacts with verdictStatus
   * "not_evaluated"; evaluation belongs to SysON. riskClass "low" matches the
   * reviewed CM-01 thermal kit — the run adds isolated evidence without touching
   * any model. The WAL records the provider run_id durably before readback, so
   * recovery only ever re-reads (`modelica_run_get`), never re-simulates.
   */
  {
    id: "simulate.run-modelica-scenario",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Run the sealed Modelica scenario and publish its observations",
    description:
      "Re-read and re-validate the sealed simulation case, verify kit availability and " +
      "parameter bounds through modelica_kit_list, dispatch modelica_simulate with the " +
      "sealed explicit overrides, re-read the run through modelica_run_get with double " +
      "attestation, and publish unit-carrying observations and hashed artifacts. The " +
      "provider never returns a verdict and none is derived.",
    workItemKind: "simulate",
    riskClass: "low",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: "simulationCase",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * Human-only recovery gate for a terminal failed provider run whose outcome
   * was uncertain (the executor crashed after the provider acknowledged a write,
   * before the ThreadSnapshot was published).
   *
   * The operation adds `uncertainWriterReconciliation` to the target run and
   * directly completes the reconciliation run as an annotation (no ThreadSnapshot,
   * no evidence refs).  Requires a human-approved MRTR decision whose proposal
   * names the exact `runId`, `failureCode`, `basisSnapshotId`, `outcome`, and
   * `providerInspectionAttestation`.
   *
   * WHY HUMAN-ONLY — an agent cannot inspect a provider. A did-not-write outcome
   * releases the basis; an accepted write creates a separate server-fixed release
   * decision whose exact basis contract needs its own later human approval.
   * `mustOrigin: "human"` is enforced at the executor gate; this descriptor
   * documents the intent for the planning layer.
   */
  {
    id: RECONCILE_UNCERTAIN_WRITER_OPERATION.id,
    version: RECONCILE_UNCERTAIN_WRITER_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Reconcile a terminal uncertain provider write",
    description:
      "Resolve the write-uncertainty on a terminal failed run after a human operator " +
      "has inspected the provider.  Adds the reconciliation annotation to the failed run " +
      "and, for an accepted write, opens a separate governed basis-release decision.  " +
      "No provider is called.  " +
      "Requires a human-approved MRTR decision naming the exact run, failure code, " +
      "basis snapshot, outcome, and provider inspection attestation.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    mustOrigin: "human",
    bindings: [
      {
        name: "approvedBrief",
        allowedSourceKinds: ["approved-brief"],
      },
    ],
  },
  /**
   * Generic governed lineage retirement. Records the retirement of any named
   * set of thread entities and their downstream production closure (artifacts →
   * observations → evaluations → violations, never traces_to) as an append-only
   * "archived" change in a new snapshot revision. No provider is called; no
   * SysML is modified. Requires a human-approved MRTR decision (decidedByOrigin
   * === "human") bound to the exact thread-entity targets and run basis.
   *
   * The decision evidence scope "thread-entity-bindings" makes the registry
   * validation propagate the archiveTarget bindings into the decision's
   * inputEvidenceRefs — which the executor re-checks in requireArchiveMrtrApproval.
   */
  {
    id: "record.archive-lineage",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Archive the lineage of a named entity set",
    description:
      "Retire the named thread entities and their downstream production closure " +
      "(artifacts → observations → evaluations → violations, never traces_to) as an " +
      'append-only "archived" change in a new snapshot revision. No provider is called.',
    workItemKind: "architect",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [
      {
        name: "approvedBrief",
        allowedSourceKinds: ["approved-brief"],
      },
      {
        name: "archiveTarget",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one-or-more",
        allowedThreadEntityKinds: [
          "artifact",
          "requirement",
          "observation",
          "evaluation",
          "violation",
        ],
        uniqueThreadEntityReferences: true,
      },
    ],
  },
  // CM-01 is the static golden-path reference for future oracle onboarding.
  // These descriptors are reviewed planning data only until a server-owned
  // executor is explicitly registered for each one.
  ...listCoffeeMachineCm01V3OperationDescriptors(),
  ...listInspectionDroneV4OperationDescriptors(),
] as const satisfies readonly RegisteredEngineeringOperation[];

const OPERATION_BY_KEY = new Map(
  OPERATIONS.map((operation) => [operationKey(operation), operation]),
);

/**
 * Look up an exact reviewed operation revision. Unknown IDs and versions are
 * intentionally indistinguishable from an absent entry.
 */
export function getRegisteredEngineeringOperation(
  reference: Pick<EngineeringOperationRef, "id" | "version">,
): RegisteredEngineeringOperation | undefined {
  const operation = OPERATION_BY_KEY.get(operationKey(reference));
  return operation === undefined ? undefined : copyOperation(operation);
}

/**
 * Resolve an exact reviewed operation revision or fail closed.
 *
 * The error deliberately contains no provider implementation detail.
 */
export function requireRegisteredEngineeringOperation(
  reference: Pick<EngineeringOperationRef, "id" | "version">,
): RegisteredEngineeringOperation {
  const operation = getRegisteredEngineeringOperation(reference);
  if (operation !== undefined) return operation;
  throw new EngineeringOperationRegistryError(
    "unknown_operation",
    `Unknown registered engineering operation: ${operationLabel(reference)}`,
  );
}

/**
 * Enumerate the exact `id@version` keys of every reviewed operation.
 *
 * This exists so executable documentation — tests that pin the operation
 * identifiers cited by skills and references to the live registry — can fail
 * on doc drift instead of letting an agent propose an identifier the server
 * must refuse. It reveals nothing `get` does not already serve.
 */
export function listRegisteredEngineeringOperationKeys(): readonly string[] {
  return OPERATIONS.map((operation) => operationKey(operation));
}

/** Return the one bounded V1 intake operation for a product starting point. */
export function getRegisteredIntakeOperation(
  startingPoint: EngineeringProjectStartingPoint,
): RegisteredEngineeringOperation | undefined {
  const operation = OPERATIONS.find((item) => item.startingPoint === startingPoint);
  return operation === undefined ? undefined : copyOperation(operation);
}

/**
 * Resolve and validate a plan's safe operation declaration.
 *
 * It validates only the reviewed operation contract: exact operation version,
 * basis kind, and declared state-reference bindings. It does not execute an
 * operation or resolve a discovery answer.
 */
export function validateRegisteredEngineeringOperationInput(
  value: unknown,
): ValidatedRegisteredEngineeringOperationInput {
  const rawInput = object(value, "operation input");
  const stage = validationStageValue(rawInput.stage, "operation input.stage");
  const input = exactRecord(
    rawInput,
    stage === "planning" ? ["operation", "stage"] : ["operation", "stage", "basisKind"],
    "operation input",
  );
  const referenceRecord = exactRecord(
    input.operation,
    ["id", "version", "bindings"],
    "operation input.operation",
  );
  const reference: Pick<EngineeringOperationRef, "id" | "version"> = {
    id: nonEmptyString(referenceRecord.id, "operation input.operation.id"),
    version: nonEmptyString(
      referenceRecord.version,
      "operation input.operation.version",
    ),
  };
  const bindings = bindingsValue(referenceRecord.bindings);
  const operation = requireRegisteredEngineeringOperation(reference);
  const basisKind = stage === "queue"
    ? basisKindValue(input.basisKind, "operation input.basisKind")
    : undefined;

  if (basisKind && !operation.allowedBasisKinds.includes(basisKind)) {
    throw new EngineeringOperationRegistryError(
      "unsupported_basis",
      `${operationLabel(reference)} does not accept a ${basisKind} basis`,
    );
  }
  validateBindings(operation, bindings);

  return {
    operation,
    stage,
    ...(basisKind ? { basisKind } : {}),
    bindings: bindings.map(copyInputBinding),
  };
}

/** The only V1 registry instance; its entries are intentionally code-owned. */
export const engineeringOperationRegistry: EngineeringOperationRegistry = Object.freeze(
  {
    get: getRegisteredEngineeringOperation,
    require: requireRegisteredEngineeringOperation,
    getIntake: getRegisteredIntakeOperation,
    validate: validateRegisteredEngineeringOperationInput,
  },
);

function validateBindings(
  operation: RegisteredEngineeringOperation,
  bindings: readonly EngineeringOperationInputBinding[],
): void {
  const suppliedByName = new Map<string, EngineeringOperationInputBinding[]>();
  for (const binding of bindings) {
    const declared = operation.bindings.find((candidate) =>
      candidate.name === binding.name
    );
    if (suppliedByName.has(binding.name) && declared?.cardinality !== "one-or-more") {
      invalidBindings(`binding ${binding.name} is supplied more than once`);
    }
    const supplied = suppliedByName.get(binding.name) ?? [];
    supplied.push(binding);
    suppliedByName.set(binding.name, supplied);
  }

  const declaredNames = new Set(operation.bindings.map((binding) => binding.name));
  for (const binding of bindings) {
    if (!declaredNames.has(binding.name)) {
      invalidBindings(`binding ${binding.name} is not declared for this operation`);
    }
  }

  for (const declaration of operation.bindings) {
    const supplied = suppliedByName.get(declaration.name) ?? [];
    if (supplied.length === 0) {
      invalidBindings(`required binding ${declaration.name} is missing`);
    }
    const seenThreadEntityReferences = new Set<string>();
    for (const binding of supplied) {
      if (!declaration.allowedSourceKinds.includes(binding.source.kind)) {
        invalidBindings(
          `binding ${binding.name} does not accept a ${binding.source.kind} source`,
        );
      }
      if (
        declaration.allowedThreadEntityKinds &&
        binding.source.kind === "thread-entity" &&
        !declaration.allowedThreadEntityKinds.includes(binding.source.reference.kind)
      ) {
        invalidBindings(
          `binding ${binding.name} does not accept a ${binding.source.reference.kind} thread entity`,
        );
      }
      if (
        declaration.uniqueThreadEntityReferences &&
        binding.source.kind === "thread-entity"
      ) {
        const ref = binding.source.reference;
        const key =
          `${ref.snapshotId}\u0000${ref.snapshotRevision}\u0000${ref.kind}\u0000${ref.id}`;
        if (seenThreadEntityReferences.has(key)) {
          invalidBindings(
            `binding ${binding.name} repeats the same thread entity reference`,
          );
        }
        seenThreadEntityReferences.add(key);
      }
    }
  }
}

function bindingsValue(value: unknown): EngineeringOperationInputBinding[] {
  if (!Array.isArray(value)) {
    invalidInput("operation input.bindings must be an array");
  }
  return value.map((item, index) => bindingValue(item, index));
}

function bindingValue(
  value: unknown,
  index: number,
): EngineeringOperationInputBinding {
  const path = `operation input.bindings[${index}]`;
  const record = exactRecord(value, ["name", "source"], path);
  const name = nonEmptyString(record.name, `${path}.name`);
  const sourcePath = `${path}.source`;
  const source = object(record.source, sourcePath);
  if (source.kind === "approved-brief") {
    exactRecord(source, ["kind"], sourcePath);
    return { name, source: { kind: "approved-brief" } };
  }
  if (source.kind === "project-answer") {
    exactRecord(source, ["kind", "answerId"], sourcePath);
    return {
      name,
      source: {
        kind: "project-answer",
        answerId: nonEmptyString(source.answerId, `${sourcePath}.answerId`),
      },
    };
  }
  if (source.kind === "thread-entity") {
    exactRecord(source, ["kind", "reference"], sourcePath);
    return {
      name,
      source: {
        kind: "thread-entity",
        reference: threadEntityReference(source.reference, `${sourcePath}.reference`),
      },
    };
  }
  invalidInput(`${sourcePath}.kind must be an approved state-reference source`);
}

function threadEntityReference(
  value: unknown,
  path: string,
): EngineeringThreadEntityRef {
  const record = exactRecord(
    value,
    ["snapshotId", "snapshotRevision", "kind", "id"],
    path,
  );
  const kind = record.kind;
  if (!THREAD_ENTITY_KINDS.includes(kind as ThreadEntityKind)) {
    invalidInput(`${path}.kind must be a ThreadSnapshot entity kind`);
  }
  return {
    snapshotId: nonEmptyString(record.snapshotId, `${path}.snapshotId`),
    snapshotRevision: positiveInteger(
      record.snapshotRevision,
      `${path}.snapshotRevision`,
    ),
    kind: kind as ThreadEntityKind,
    id: nonEmptyString(record.id, `${path}.id`),
  };
}

function basisKindValue(value: unknown, path: string): EngineeringOperationBasisKind {
  if (
    value === "approved-brief" || value === "thread-snapshot"
  ) return value;
  invalidInput(`${path} must be an approved basis kind`);
}

function validationStageValue(
  value: unknown,
  path: string,
): EngineeringOperationValidationStage {
  if (value === "planning" || value === "queue") return value;
  invalidInput(`${path} must be planning or queue`);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = object(value, path);
  const extras = Object.keys(record).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in record));
  if (extras.length > 0 || missing.length > 0) {
    invalidInput(
      `${path} must contain exactly ${keys.join(", ")}`,
    );
  }
  return record;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  invalidInput(`${path} must be an object`);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  invalidInput(`${path} must be a non-empty string`);
}

function positiveInteger(value: unknown, path: string): number {
  if (Number.isSafeInteger(value) && (value as number) > 0) return value as number;
  invalidInput(`${path} must be a positive integer`);
}

function invalidInput(message: string): never {
  throw new EngineeringOperationRegistryError("invalid_input", message);
}

function invalidBindings(message: string): never {
  throw new EngineeringOperationRegistryError("invalid_bindings", message);
}

function operationKey(
  reference: Pick<EngineeringOperationRef, "id" | "version">,
): string {
  return `${reference.id}@${reference.version}`;
}

function operationLabel(
  reference: Pick<EngineeringOperationRef, "id" | "version">,
): string {
  const id = typeof reference.id === "string" ? reference.id : "<invalid-id>";
  const version = typeof reference.version === "string"
    ? reference.version
    : "<invalid-version>";
  return `${id}@${version}`;
}

function copyOperation(
  operation: RegisteredEngineeringOperation,
): RegisteredEngineeringOperation {
  return {
    ...operation,
    allowedBasisKinds: [...operation.allowedBasisKinds],
    bindings: operation.bindings.map((binding) => ({
      ...binding,
      allowedSourceKinds: [...binding.allowedSourceKinds],
      ...(binding.allowedThreadEntityKinds
        ? { allowedThreadEntityKinds: [...binding.allowedThreadEntityKinds] }
        : {}),
    })),
  };
}

function copyInputBinding(
  binding: EngineeringOperationInputBinding,
): EngineeringOperationInputBinding {
  switch (binding.source.kind) {
    case "approved-brief":
      return { name: binding.name, source: { kind: "approved-brief" } };
    case "project-answer":
      return {
        name: binding.name,
        source: {
          kind: "project-answer",
          answerId: binding.source.answerId,
        },
      };
    case "thread-entity":
      return {
        name: binding.name,
        source: {
          kind: "thread-entity",
          reference: { ...binding.source.reference },
        },
      };
    default:
      throw new Error("Validated operation binding has an unsupported source");
  }
}

/** Injectable V1 validation boundary for project-plan publication. */
export const REGISTERED_ENGINEERING_OPERATION_REGISTRY = Object.freeze({
  validate(
    input: RegisteredEngineeringOperationInput,
  ): ValidatedRegisteredEngineeringOperationInput {
    return validateRegisteredEngineeringOperationInput(input);
  },
});
