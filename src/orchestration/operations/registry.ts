import type {
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectStartingPoint,
  EngineeringThreadEntityRef,
} from "../../domain/project/engineering-project.ts";
import type { ThreadEntityKind } from "../../domain/thread/thread-snapshot.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/architecture/seed/syson-model-seed.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/architecture/renderer/architecture-proposal.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "../../domain/architecture/part-definitions/part-definitions-capture.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../domain/cad/canonical/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../domain/architecture/requirements/requirements-proposal.ts";
import { COMPILATION_ADMISSION_BINDING_NAME } from "../../domain/compile/admission/compilation-admission-run-operation.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../domain/compile/admission/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../domain/cad/isolated/build123d-execution-proposal.ts";
import { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION } from "../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import { DESIGN_APPLY_VECTOR_CORRECTION_OPERATION } from "../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../domain/modelica/qualified-kit/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../domain/modelica/admitted/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "../../domain/electrical/spice/admitted/run-proposal.ts";
import { VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION } from "../../domain/electrical/observation-method-sheet-proposal.ts";
import { VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION } from "../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
} from "../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION } from "../../domain/modelica/thermal-method-sheet-proposal.ts";
import { VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION } from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-decision-proposal.ts";
import { ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION } from "../../domain/impact/cross-domain-impact-mechanical-preservation-proposal.ts";
import { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION } from "../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
} from "../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
} from "../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import { RECONCILE_UNCERTAIN_WRITER_OPERATION } from "../../domain/record/reconcile-uncertain-writer-proposal.ts";
import { FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS } from "./fea-isolated-static-proof.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import {
  INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
  INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
} from "../../domain/make/printability/printability-proposal.ts";
import {
  INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION,
  INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
} from "../../domain/make/print-estimate/print-estimate-proposal.ts";
import {
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
} from "../../domain/make/dfm/dfm-proposal.ts";
import {
  type EngineeringOperationBasisKind,
  type EngineeringOperationRegistry,
  EngineeringOperationRegistryError,
  type EngineeringOperationValidationStage,
  type RegisteredEngineeringOperation,
  type RegisteredEngineeringOperationInput,
  type ValidatedRegisteredEngineeringOperationInput,
} from "./operation-contract.ts";

export * from "./operation-contract.ts";

/**
 * Reviewed, code-owned engineering operations.
 *
 * This registry intentionally describes only the safe planning boundary.  It
 * does not reveal provider selection, tool names, or provider arguments.
 */

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
    requiresDependsOnOperation: {
      id: "baseline.from-approved-brief",
      version: "1",
    },
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
  {
    id: MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.id,
    version: MODEL_CAPTURE_PART_DEFINITIONS_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Capture the reviewed PartDefinition structures",
    description:
      "Re-read the exact PartDefinition subgraph sealed by the current generic architecture capture, " +
      "verify live SysON still matches that parent→usage→target graph, and publish a " +
      "content-addressed read-only bundle. Sibling PartDefinitions added after that capture are not observed. " +
      "No SysML write, quantity inference, CAD, physics, or verdict.",
    workItemKind: "define",
    riskClass: "low",
    execution: "trusted",
    requiresAdditiveChange: true,
    bindings: [{
      name: "architecture",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * Provider-free seal of one agent-authored architecture SysML closed-subset
   * analysis. The signed proposal names exact CAS identities. The executor
   * writes a Thread document only and never inserts into SysON.
   */
  {
    id: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.id,
    version: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed architecture SysML analysis",
    description:
      "Reopen the exact captured agent-authored architecture SysML source and its " +
      "closed-subset analysis, then seal that document into the evidence thread. " +
      "No SysON insertion, provider call, or compile.seal-admission@3 authority is granted.",
    workItemKind: "architect",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [],
  },
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
  /**
   * Technical-compilation admission seal — trusted boundary
   * `compile.seal-admission@3`.
   *
   * The MRTR proposal seals the exact ready-for-review compilation draft,
   * source analyses, semantic bindings, compiler profiles and SysML basis. The
   * sole state binding identifies that SysML model as one exact Thread
   * artifact; it is consequently included in the signed evidence scope. This
   * operation grants no provider execution and accepts no provider arguments.
   */
  {
    id: COMPILE_SEAL_ADMISSION_OPERATION.id,
    version: COMPILE_SEAL_ADMISSION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed technical compilation admission",
    description:
      "Reopen the exact ready-for-review compilation draft and its captured sources, " +
      "verify every operator-signed identity against the current Thread and SysML basis, " +
      "then seal the provider-free admission into the evidence thread. No technical " +
      "provider is called and no execution authority is granted.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: "sysmlModel",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },

  /**
   * Qualified Build123d execution — trusted executor
   * `design.execute-build123d@1`.
   *
   * The signed proposal names one exact provider-free compilation admission
   * and one server-owned isolation profile. Execution publishes only a
   * document capture plus a non-canonical geometry-review draft: STEP bytes
   * never become canonical Thread geometry through this operation.
   */
  {
    id: DESIGN_EXECUTE_BUILD123D_OPERATION.id,
    version: DESIGN_EXECUTE_BUILD123D_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Execute the reviewed Build123d compilation in isolation",
    description:
      "Reopen one exact sealed technical-compilation admission, verify the human-signed " +
      "server-owned execution and isolation contract, execute its qualified Build123d source, " +
      "validate the declared STEP output, and publish only a documentary execution capture " +
      "with a non-canonical geometry-review draft.",
    workItemKind: "design",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: COMPILATION_ADMISSION_BINDING_NAME,
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * Isolated geometry document seal — trusted executor
   * `design.seal-isolated-geometry@1`.
   *
   * The signed proposal names one exact documentary Build123d execution
   * capture and the published STEP identities. The executor re-reads those
   * bytes only to verify sha256+byteCount and writes a Thread document.
   * It never copies STEP into thread-assets, never writes a cad-model, and
   * never grants Product or FEA authority. The isolation receipt and the
   * first execute MRTR are not this approval.
   */
  {
    id: DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.id,
    version: DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed isolated geometry document",
    description:
      "Reopen one exact documentary isolated Build123d execution capture, verify the " +
      "human-signed published STEP identities by re-reading the gated object, and " +
      "seal one Thread document. No STEP artifact, cad-model, thread-assets copy, " +
      "Product catalog, or FEA authority is granted.",
    workItemKind: "design",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: "executionCapture",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * Trusted factual assembly-integrity observation.
   *
   * Its executor reopens a human-approved exact module and profile, records
   * recovery state, and seals facts. It never grants a product verdict.
   */
  {
    id: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
    version: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Observe factual assembly integrity",
    description:
      "Reopen one human-approved factual observation over one exact current primary geometry module. " +
      "The signed admission names only the server-owned observation profile, method and exact configured runtime; " +
      "it supplies no verdict, provider capability, tool, runtime, transform, or caller-selected tolerance.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: "geometryModule",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
      uniqueThreadEntityReferences: true,
    }],
  },
  /**
   * Provider-free L4 verdict over one exact completed L3 observation.
   *
   * The server selects and recrosses the dependency capture, canonical module,
   * STEP and bundle.  No caller can bind a provider, tolerance, observation
   * facts, rule, or requested verdict.  This is evidence only: L4 may
   * contribute to Brief gates but never satisfies one.
   */
  {
    id: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
    version: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Evaluate assembly integrity",
    description:
      "Recross one exact completed factual assembly-integrity observation and its canonical module, STEP, and input bundle, " +
      "then record the code-owned L4 verdict capture. No provider, tool, tolerance, factual values, criteria, or verdict is caller-selected; " +
      "the result does not satisfy a product gate.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    requiresAdditiveChange: true,
    requiresDependsOnOperation: {
      id: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
      version: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    },
    bindings: [],
  },
  /**
   * One closed local Modelica solver-conformance kit. This operation is
   * deliberately distinct from the historical generic MCP-backed Modelica
   * operations: it has no provider plan, no caller-selected source, and no
   * Thread entity binding. Its exact basis, kit, profile and durable runtime
   * qualification are carried by the one human-approved MRTR proposal.
   */
  {
    id: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.id,
    version: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Run the qualified local Modelica conformance kit",
    description:
      "Reopen the exact current Thread basis and the server-owned linear thermal ramp kit, " +
      "verify its pinned local Microsandbox qualification, execute it without shell or " +
      "caller-selected Modelica, and publish documentary solver-conformance evidence only.",
    workItemKind: "simulate",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [],
  },
  /**
   * Admitted Modelica closed-subset execution — trusted executor
   * `simulate.run-admitted-modelica@1`.
   *
   * The signed proposal names one exact `compile.seal-admission@3` Modelica
   * compilation and one server-owned isolation profile. Execution reopens
   * those admitted `.mo` bytes. It is not the pinned kit, not recorded `@2`,
   * and not a caller-supplied `modelicaText`.
   */
  {
    id: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id,
    version: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Execute the reviewed admitted Modelica compilation in isolation",
    description:
      "Reopen one exact sealed technical-compilation admission, verify the human-signed " +
      "server-owned execution and isolation contract, execute its qualified Modelica source, " +
      "and publish documentary solver evidence only. Callers never supply Modelica text.",
    workItemKind: "simulate",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: COMPILATION_ADMISSION_BINDING_NAME,
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * Admitted SPICE closed-subset operating-point execution — trusted executor
   * `simulate.run-admitted-spice@1`.
   *
   * The signed proposal names one exact `compile.seal-admission@3` SPICE
   * compilation and one server-owned isolation profile. Execution reopens
   * those admitted `.cir` bytes. It is not mcp-spice, not the LED-driver
   * fiche, and not a caller-supplied netlist, image, path or observation list.
   */
  {
    id: SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id,
    version: SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Execute the reviewed admitted SPICE compilation in isolation",
    description:
      "Reopen one exact sealed technical-compilation admission, verify the human-signed " +
      "server-owned execution and isolation contract, execute its qualified SPICE source, " +
      "and publish documentary operating-point evidence only. Callers never supply SPICE " +
      "text, image, runtime, path, or observations.",
    workItemKind: "simulate",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: COMPILATION_ADMISSION_BINDING_NAME,
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * Provider-free seal of one reviewed `electrical-observation-method-sheet/1.0`.
   * The MRTR names identities and fingerprints only. No ngspice, SPICE text,
   * provider tool or L4 verdict is granted.
   */
  {
    id: VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id,
    version: VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed electrical observation method sheet",
    description:
      "Reopen one exact reviewed electrical observation method sheet, recross its identities and " +
      "fingerprints, and publish the content-addressed method document. Callers never " +
      "supply SPICE text, provider tools, or solver arguments. This is not an " +
      "admitted run and not an evaluation.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Trusted closed-method evaluation of admitted SPICE observations. The MRTR
   * names identities and fingerprints only. No ngspice, caller values, or
   * SysON envelope.
   */
  {
    id: VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id,
    version: VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Evaluate admitted SPICE observations",
    description:
      "Reopen one sealed electrical observation method sheet and one admitted SPICE result, " +
      "recross identities, and evaluate the exact criteria with the server-owned closed " +
      "comparator. Callers never supply values, units, provider tools, or ngspice arguments. " +
      "Unresolved natives stay unresolved. An L4 pass is not L5.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Human-only L5 closeout of one exact L4 admitted SPICE evaluation
   * capture. Reopens the signed capture, electrical method sheet, and
   * selected L3 run/capture/evidence/result. Never calls ngspice or SysON.
   * An L4 `pass` is never implicit L5.
   */
  {
    id: DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION.id,
    version: DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Accept the admitted SPICE evaluation closeout",
    description:
      "Reopen one exact L4 admitted SPICE observation evaluation capture, its electrical " +
      "method sheet, and the selected L3 run/capture/evidence/result, recross the signed " +
      "Thread basis, and record the human accept closeout. No engine is called. An L4 pass is not L5.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    mustOrigin: "human",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  {
    id: DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION.id,
    version: DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Reject the admitted SPICE evaluation closeout",
    description:
      "Reopen one exact L4 admitted SPICE observation evaluation capture, its electrical " +
      "method sheet, and the selected L3 run/capture/evidence/result, recross the signed " +
      "Thread basis, and record the human reject closeout. No engine is called. An L4 pass is not L5.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    mustOrigin: "human",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Provider-free seal of one reviewed `modelica-thermal-method-sheet/1.0`.
   * The MRTR names identities and fingerprints only. No OMC, Modelica text,
   * provider tool or L4 verdict is granted.
   */
  {
    id: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id,
    version: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed Modelica thermal method sheet",
    description:
      "Reopen one exact reviewed thermal method sheet, recross its identities and " +
      "fingerprints, and publish the content-addressed method document. Callers never " +
      "supply Modelica text, provider tools, or solver arguments. This is not an " +
      "admitted run and not an evaluation.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Provider-free seal of one closed cross-domain impact manifest. The signed
   * grammar contains reread identities only; no causal evaluation, gate-claim
   * transition, solver/provider request, or caller-selected artifact path is
   * exposed by this operation.
   */
  {
    id: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id,
    version: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed cross-domain impact manifest",
    description:
      "Reopen one exact closed cross-domain impact manifest, its named Thread lineage, " +
      "declared mechanical evidence references, and current approved Brief V2 gate dependencies, " +
      "then publish one documentary seal. Callers never supply branches, causal edges, artifacts, " +
      "provider envelopes, solver arguments, or an evaluation result.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * X07/X08 only rereads the exact X05 seal and records proposed literal
   * impact states.  It is deliberately not an MRTR transition, provider run,
   * rerun request, or Workbench command.
   */
  {
    id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Capture the sealed cross-domain impact analysis",
    description:
      "Reopen the one direct sealed impact-manifest document, recross every declared source anchor " +
      "and only exact current evidence, then publish a provider-free documentary evaluation capture. " +
      "It proposes literal branch and gate-claim states without changing any claim, work item, " +
      "freshness record, rerun queue, or human decision.",
    workItemKind: "review",
    riskClass: "low",
    execution: "trusted",
    requiresAdditiveChange: true,
    requiresDependsOnOperation: {
      id: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id,
      version: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version,
    },
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Human-only application of the exact X07/X08 proposed gate-claim statuses
   * onto existing work-item claims. X07/X08 records workItemInvalidations and
   * rerunProposals as none; this operation does not invent, invalidate, or
   * queue work items. It recrosses the evaluation capture, Brief V2 gates and
   * existing claims, then mutates those claim statuses. It never infers an
   * impact, queues a rerun, or calls a provider.
   */
  {
    id: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Accept the cross-domain impact decision",
    description:
      "Reopen one exact provider-free impact-evaluation capture, recross the current Brief V2 " +
      "gates and existing work-item claims, and apply only the already-proposed gate-claim statuses. " +
      "X07/X08 does not propose work-item invalidations or reruns; this decision does not add, " +
      "retire, or otherwise change work-item lifecycle except completing this decision run. " +
      "Callers never supply branches, impacts, providers, tools, arguments, or work items. " +
      "No rerun is queued and no engineering engine is called.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    mustOrigin: "human",
    requiresAdditiveChange: true,
    requiresDependsOnOperation: {
      id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
      version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
    },
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Provider-free mechanical preservation control after the human X09
   * decision. It rereads the exact FEA proof/closeout identities, consumptions
   * and independence assertion. Absence of a mechanical edge is never proof.
   * It never calls CalculiX and never invents a work item or rerun.
   */
  {
    id: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION.id,
    version: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Capture mechanical preservation after the impact decision",
    description:
      "Reopen the unique current Thread tip and unique X09 impact-decision capture, " +
      "recross the exact X08 evaluation, approved Brief V2, reviewed independence assertion, " +
      "and current FEA proof/closeout identities and consumptions, then publish a " +
      "provider-free documentary preservation result. Carried-forward requires an exact " +
      "current assertion covering the inspected FEA inputs; otherwise the literal " +
      "impact-unresolved state is preserved. Callers never supply a branch, assertion, " +
      "artifact list, provider, solver argument, or verdict. No CalculiX call, claim " +
      "mutation, work item, or rerun is created.",
    workItemKind: "review",
    riskClass: "low",
    execution: "trusted",
    requiresAdditiveChange: true,
    requiresDependsOnOperation: {
      id: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
      version: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
    },
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Trusted SysON evaluation of admitted Modelica observations. The MRTR names
   * identities and fingerprints only. No OMC, caller values, or SysON envelope.
   */
  {
    id: VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id,
    version: VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Evaluate admitted Modelica observations",
    description:
      "Reopen one sealed thermal method sheet and one admitted Modelica evidence " +
      "capture, recross identities, and ask SysON to evaluate the exact " +
      "requirement/observation pairs. Callers never supply values, units, " +
      "provider tools, or OMC arguments. A unit-identity mismatch stays unresolved.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Human-only L5 closeout of one exact L4 admitted Modelica evaluation
   * capture. Reopens the signed capture and thermal method sheet. Never calls
   * OMC or SysON. An L4 `pass` is never implicit L5.
   */
  {
    id: DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.id,
    version: DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Accept the admitted Modelica evaluation closeout",
    description:
      "Reopen one exact L4 admitted observation evaluation capture and its thermal " +
      "method sheet, recross the signed Thread basis, and record the human accept " +
      "closeout. No engine is called. An L4 pass is not L5.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    mustOrigin: "human",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  {
    id: DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.id,
    version: DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Reject the admitted Modelica evaluation closeout",
    description:
      "Reopen one exact L4 admitted observation evaluation capture and its thermal " +
      "method sheet, recross the signed Thread basis, and record the human reject " +
      "closeout. No engine is called. An L4 pass is not L5.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    mustOrigin: "human",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Human-only L5 over one exact current provider-free L4 assembly-integrity
   * capture. The appended work is anchored to the L4 tip by the generic
   * dependency declaration and executor recross; no caller chooses a gate,
   * provider, SysON envelope, tolerance, verdict, safety conclusion, or
   * certification.
   */
  {
    id: DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id,
    version: DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Accept the assembly-integrity evaluation closeout",
    description:
      "Reopen one exact current assembly-integrity L4 capture and record a human accept closeout only when all five literal L4 criteria are pass. No provider or SysON call occurs; this is neither safety nor certification.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    mustOrigin: "human",
    requiresAdditiveChange: true,
    requiresDependsOnOperation: {
      id: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
      version: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
    },
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  {
    id: DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id,
    version: DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Reject the assembly-integrity evaluation closeout",
    description:
      "Reopen one exact current assembly-integrity L4 capture and record a human reject closeout. Reject grants no correction, CAD, FEA, provider, SysON, safety, or certification authority.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    mustOrigin: "human",
    requiresAdditiveChange: true,
    requiresDependsOnOperation: {
      id: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
      version: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
    },
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Generic static-mechanical L5. The server reopens current FEA @3 evidence
   * and the sealed proof limitations; human disposition is never inferred
   * from a literal L4 pass. An agent dispatches the provider-free run only
   * after the exact human MRTR is approved. Both operations are documentary
   * Thread writers, not correction/CAD/FEA grants.
   */
  {
    id: DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id,
    version: DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Accept the static-mechanical evaluation closeout",
    description:
      "Reopen one exact current static FEA @3 branch and its sealed proof limitations, then record a human accept closeout only when every declared L4 criterion is literal pass. No engine or SysON call occurs; an L4 pass is not L5.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  {
    id: DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.id,
    version: DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Reject the static-mechanical evaluation closeout",
    description:
      "Reopen one exact current static FEA @3 branch and its sealed proof limitations, then record a human reject closeout. The bounded disposition is none or mechanical-review-required and grants no correction, CAD, FEA, engine, or SysON action.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Provider-free documentary seal of one bounded vector-correction proposal.
   * The human signs recomputed scalars and the study-capture digest. The
   * published document declares grants: none and is not a CAD admission,
   * SysON write, or provider run. Bindings are identities only; the executor
   * fail-closes if they do not resolve on the named basis.
   */
  {
    id: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.id,
    version: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed vector-correction document",
    description:
      "Reopen one exact failing evaluation and one sensitivity-study capture, reconstruct " +
      "the unique measured edge, invert the first-order slope only inside the declared " +
      "validity neighborhood, and seal a Thread document. No CAD, SysON, or provider " +
      "authority is granted.",
    workItemKind: "design",
    riskClass: "low",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [
      {
        name: "failingEvaluation",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["evaluation"],
      },
      {
        name: "studyCapture",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["artifact"],
      },
    ],
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
   * Reopens the exact captured mechanical-proof-case-source/1.0, recrosses the
   * unique current Thread tip, and publishes a content-addressed
   * mechanical-proof-case/1.0 Thread artifact. The agent never supplies a
   * catalog id, path, provider, tool or runtime. No provider is called.
   */
  {
    id: "verify.seal-proof-case",
    version: "1",
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed FEA proof case into the evidence thread",
    description:
      "Reopen the exact signed proof-case source capture, recross unique canonical " +
      "part STEP, CAD provenance and SysON requirements against the current Thread tip, " +
      "verify the operator-signed digest and every clear-text parameter, and publish " +
      "the content-addressed proof-case artifact. No provider is called.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Provider-free seal of one reviewed sensitivity-study-case/2.0. The catalog
   * holds the scientific template; the signed MRTR binds the exact Thread
   * compilation admission. No provider is called and no derivative is computed.
   */
  {
    id: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id,
    version: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed FEA sensitivity study case",
    description:
      "Resolve the reviewed sensitivity-study template through the server-owned catalog, " +
      "bind the exact compilation-admission cadSource from the current Thread, verify the " +
      "operator-signed digest against the assembled sensitivity-study-case/2.0 bytes, and " +
      "publish the content-addressed case artifact. No provider is called.",
    workItemKind: "review",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Two-solve finite-difference FEA study. Consumes only the sealed case
   * artifact. Publishes dimensioned observations and a sensitivity capture.
   * Never a verdict, requirement, evaluation or violation.
   */
  {
    id: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id,
    version: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Run the sealed FEA sensitivity study and publish observations",
    description:
      "Re-read the sealed sensitivity-study-case/2.0, execute the exact admitted " +
      "Build123d source and one server-owned stepped substitution, dispatch two " +
      "attested CalculiX static solves, compute finite-difference derivatives from " +
      "the sealed step, and publish unit-carrying observations. No verdict is derived.",
    workItemKind: "simulate",
    riskClass: "low",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: "studyCase",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * Server-rendered SysML PartDef for the measured derivative set. Reads the
   * sensitivity-study capture, never agent-authored SysML.
   */
  {
    id: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.id,
    version: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Author the reviewed sensitivity edges in the system model",
    description:
      "Re-read the sealed sensitivity-study capture, reconstruct the SensitivityEdge " +
      "set with server-fixed SysML names, insert the rendered PartDef under the existing " +
      "SysON seed root package, and publish the sensitivity-edges artifact after " +
      "re-extraction. No SysML text is supplied by the agent.",
    workItemKind: "architect",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: "studyCapture",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * SysON evaluation of study-base observations. Never a solve. Never a
   * mapping from proof-run observations. A fail is publishable.
   */
  {
    id: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id,
    version: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Evaluate the study-base observations against named requirements",
    description:
      "Re-read the sealed sensitivity-study capture, join each declared metric " +
      "to the unique Thread requirement of the same metric id and to the " +
      "sensitivity-base observation of that digest, then ask SysON to evaluate. " +
      "No metric mapping is invented. A fail is a named violation.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [{
      name: "studyCapture",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }],
  },
  /**
   * Provider-free seal of one reviewed printability-check-case/1.0. The catalog
   * is server-owned and empty until a reviewed case is committed. No provider
   * is called and no geometry is produced.
   */
  {
    id: INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION.id,
    version: INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed FDM printability case",
    description:
      "Resolve the reviewed printability-check-case/1.0 through the server-owned catalog, " +
      "verify the operator-signed digest against the canonical case bytes, and publish " +
      "the content-addressed case artifact. No provider is called.",
    workItemKind: "industrialize",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Observational FDM printability run. Consumes the sealed case and one
   * canonical write-geometry artifact. Publishes unit-carrying observations.
   * Never a verdict, evaluation or violation.
   */
  {
    id: INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.id,
    version: INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Observe FDM printability on sealed canonical geometry",
    description:
      "Re-read the sealed printability case and the bound canonical geometry, stage the " +
      "exact bytes, dispatch the locked DFM thickness and overhang checks, and publish " +
      "unit-carrying observations. No verdict is derived.",
    workItemKind: "industrialize",
    riskClass: "low",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [
      {
        name: "printabilityCase",
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
   * Provider-free seal of one reviewed print-estimate-case/1.0. The committed
   * INI digest is part of the signed identity. No provider is called and no
   * price is derived.
   */
  {
    id: INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.id,
    version: INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed FFF print-estimate case",
    description:
      "Resolve the reviewed print-estimate-case/1.0 through the server-owned catalog, " +
      "verify the operator-signed digest and committed profile identity, and publish " +
      "the content-addressed case artifact. No provider is called.",
    workItemKind: "industrialize",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Observational FFF print-time-and-material run. Consumes the sealed case
   * and one canonical write-geometry artifact. Publishes unit-carrying
   * observations. Never a price, verdict or evaluation.
   */
  {
    id: INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION.id,
    version: INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Observe FFF print time and material on sealed canonical geometry",
    description:
      "Re-read the sealed print-estimate case and the bound canonical geometry, verify " +
      "the committed INI digest, dispatch the locked PrusaSlicer estimate, and publish " +
      "unit-carrying observations. No price or verdict is derived.",
    workItemKind: "industrialize",
    riskClass: "low",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [
      {
        name: "printEstimateCase",
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
   * Provider-free seal of one reviewed dfm-check-case/1.0. The signed case
   * names an attested STEP artefact, a build volume object, thickness and
   * overhang limits, and an explicit Z-min filter. No provider is called.
   */
  {
    id: INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.id,
    version: INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Seal the reviewed measured DFM case",
    description:
      "Reconstruct the reviewed dfm-check-case/1.0 from the signed MRTR, verify " +
      "the attested STEP identity against the basis snapshot, and publish the " +
      "content-addressed case artifact. No provider is called.",
    workItemKind: "industrialize",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  /**
   * Measured DFM run. Consumes the sealed case and one canonical
   * write-geometry STEP. Calls the three mcp-dfm tools with sha256
   * attestation and publishes measured observations plus fail-closed
   * evaluations. A fail is publishable with named violations.
   */
  {
    id: INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.id,
    version: INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.version,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Run measured DFM checks on sealed canonical geometry",
    description:
      "Re-read the sealed DFM case and the bound canonical STEP, dispatch the " +
      "locked envelope, thickness and overhang checks with expected_step_sha256, " +
      "apply the declared Z-min filter, and publish measured observations plus " +
      "fail-closed evaluations. A fail is a named violation, not an omitted result.",
    workItemKind: "industrialize",
    riskClass: "consequential",
    execution: "trusted",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [
      {
        name: "dfmCase",
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
  // Isolated FEA @3 descriptors become reachable only with the
  // composition-root resolver/sealer and fixed executors. Their provider
  // details remain absent from this planning boundary.
  ...FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS,
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
