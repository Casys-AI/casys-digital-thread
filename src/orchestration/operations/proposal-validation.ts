/**
 * Grammar gate for MRTR decision proposals, applied when the agent proposes.
 *
 * WHY AT PROPOSAL TIME — every trusted operation parses its decision parameters
 * fail-closed at execution, and the browser preview parses them again to render
 * the proposal. Both are too late for the agent: it learns that a key is
 * misspelled or a parent unknown only after a human has been asked to look at
 * an unreadable proposal, or after a run is queued. Validating here turns that
 * round trip into an immediate, machine-readable rejection at the boundary the
 * agent is actually calling — AX "Fast Fail Early".
 *
 * The validators are the very functions the executors use; this module owns no
 * grammar of its own, so the gate can never drift from what execution accepts.
 */

import {
  feaProofDecisionParametersToMap,
  parseFeaProofDecisionParameters,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../domain/fea/seal-case/fea-proof-proposal.ts";
import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  parseSensitivityStudyDecisionParameters,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  parseArchitectureProposalParameters,
} from "../../domain/architecture/renderer/architecture-proposal.ts";
import {
  parseSysonModelSeedProposalParameters,
  SYSON_MODEL_SEED_OPERATION,
} from "../../domain/architecture/seed/syson-model-seed-proposal.ts";
import {
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  parseArchitectureSysmlSealParameters,
} from "../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import {
  DESIGN_WRITE_GEOMETRY_OPERATION,
  geometryDecisionParametersToMap,
  parseGeometryDecisionParameters,
} from "../../domain/cad/canonical/geometry-proposal.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  parseRequirementsProposalParameters,
} from "../../domain/architecture/requirements/requirements-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../domain/project/engineering-project.ts";
import {
  parseReconcileUncertainWriterProposal,
  RECONCILE_UNCERTAIN_WRITER_OPERATION,
} from "../../domain/record/reconcile-uncertain-writer-proposal.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  parseTechnicalCompilationAdmissionParameters,
} from "../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  parseBuild123dExecutionAdmissionParameters,
} from "../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  parseIsolatedGeometrySealParameters,
} from "../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import {
  parseAssemblyIntegrityObservationAdmissionParameters,
} from "../../domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import {
  parseAssemblyIntegrityEvaluationAdmissionParameters,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-admission.ts";
import {
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  parseAcceptAssemblyIntegrityEvaluationParameters,
  parseRejectAssemblyIntegrityEvaluationParameters,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import {
  DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
  parseVectorCorrectionDecisionParameters,
} from "../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import {
  parseModelicaQualifiedKitRunAdmissionParameters,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
} from "../../domain/modelica/qualified-kit/run-proposal.ts";
import {
  parseModelicaAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
} from "../../domain/modelica/admitted/run-proposal.ts";
import {
  parseSpiceAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
} from "../../domain/electrical/spice/admitted/run-proposal.ts";
import {
  parseElectricalObservationMethodSheetSealParameters,
  VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
} from "../../domain/electrical/observation-method-sheet-proposal.ts";
import {
  parseSpiceAdmittedObservationEvaluationParameters,
  VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
} from "../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  parseAcceptAdmittedSpiceEvaluationParameters,
  parseRejectAdmittedSpiceEvaluationParameters,
} from "../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  parseThermalMethodSheetSealParameters,
  VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
} from "../../domain/modelica/thermal-method-sheet-proposal.ts";
import {
  parseCrossDomainImpactManifestSealParameters,
  VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
} from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import {
  DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
  parseCrossDomainImpactDecisionParameters,
} from "../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  parseAdmittedObservationEvaluationParameters,
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
} from "../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  parseAcceptAdmittedModelicaEvaluationParameters,
  parseRejectAdmittedModelicaEvaluationParameters,
} from "../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  parseDfmDecisionParameters,
  parseDfmRunDecisionParameters,
} from "../../domain/make/dfm/dfm-proposal.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
} from "../../domain/mechanism/prescribed-kinematics/operations.ts";
import { assertPrescribedKinematicsProposalParameters } from "../../domain/mechanism/prescribed-kinematics/proposal-validation.ts";
import {
  parsePrescribedKinematicsCaseProposalParameters,
  parsePrescribedKinematicsRunProposalParameters,
} from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-proposal.ts";

/** Operation identity as `id@version`, the key used across the registry. */
export type OperationKey = string;

function keyOf(operation: { id: string; version: string }): OperationKey {
  return `${operation.id}@${operation.version}`;
}

/**
 * Proposal grammars, keyed by the operation the decision authorises.
 *
 * An operation absent from this map has no MRTR grammar of its own — its
 * proposal carries free-form review parameters — and is deliberately not
 * gated here.
 */
const PROPOSAL_VALIDATORS = new Map<
  OperationKey,
  (parameters: readonly EngineeringDecisionProposalParameter[]) => void
>([
  [
    keyOf(VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION),
    (parameters) => {
      parsePrescribedKinematicsCaseProposalParameters(parameters);
    },
  ],
  [
    keyOf(VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION),
    (parameters) => {
      parsePrescribedKinematicsRunProposalParameters(parameters);
    },
  ],
  [
    keyOf(VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION),
    assertPrescribedKinematicsProposalParameters,
  ],
  [
    keyOf(VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION),
    assertPrescribedKinematicsProposalParameters,
  ],
  [
    keyOf(DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION),
    assertPrescribedKinematicsProposalParameters,
  ],
  [
    keyOf(DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION),
    assertPrescribedKinematicsProposalParameters,
  ],
  [
    keyOf(COMPILE_SEAL_ADMISSION_OPERATION),
    (parameters) => {
      parseTechnicalCompilationAdmissionParameters(parameters);
    },
  ],
  [
    keyOf(DESIGN_EXECUTE_BUILD123D_OPERATION),
    (parameters) => {
      parseBuild123dExecutionAdmissionParameters(parameters);
    },
  ],
  [
    keyOf(DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION),
    (parameters) => {
      parseIsolatedGeometrySealParameters(parameters);
    },
  ],
  [
    keyOf(VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION),
    (parameters) => {
      parseAssemblyIntegrityObservationAdmissionParameters(parameters);
    },
  ],
  [
    keyOf(VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION),
    (parameters) => {
      parseAssemblyIntegrityEvaluationAdmissionParameters(parameters);
    },
  ],
  [
    keyOf(DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION),
    parseAcceptAssemblyIntegrityEvaluationParameters,
  ],
  [
    keyOf(DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION),
    parseRejectAssemblyIntegrityEvaluationParameters,
  ],
  [
    keyOf(DESIGN_APPLY_VECTOR_CORRECTION_OPERATION),
    (parameters) => {
      parseVectorCorrectionDecisionParameters(parameters);
    },
  ],
  [
    keyOf(SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION),
    (parameters) => {
      parseModelicaQualifiedKitRunAdmissionParameters(parameters);
    },
  ],
  [
    keyOf(SIMULATE_RUN_ADMITTED_MODELICA_OPERATION),
    (parameters) => {
      parseModelicaAdmittedRunAdmissionParameters(parameters);
    },
  ],
  [
    keyOf(SIMULATE_RUN_ADMITTED_SPICE_OPERATION),
    (parameters) => {
      parseSpiceAdmittedRunAdmissionParameters(parameters);
    },
  ],
  [
    keyOf(VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION),
    (parameters) => {
      parseElectricalObservationMethodSheetSealParameters(parameters);
    },
  ],
  [
    keyOf(VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION),
    (parameters) => {
      parseSpiceAdmittedObservationEvaluationParameters(parameters);
    },
  ],
  [
    keyOf(DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION),
    parseAcceptAdmittedSpiceEvaluationParameters,
  ],
  [
    keyOf(DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION),
    parseRejectAdmittedSpiceEvaluationParameters,
  ],
  [
    keyOf(SYSON_MODEL_SEED_OPERATION),
    (parameters) => {
      parseSysonModelSeedProposalParameters(parameters);
    },
  ],
  [
    keyOf(MODEL_WRITE_ARCHITECTURE_OPERATION),
    (parameters) => {
      parseArchitectureProposalParameters(parameters);
    },
  ],
  [
    keyOf(MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION),
    (parameters) => {
      parseArchitectureSysmlSealParameters(parameters);
    },
  ],
  [
    keyOf(MODEL_WRITE_REQUIREMENTS_OPERATION),
    (parameters) => {
      parseRequirementsProposalParameters(parameters);
    },
  ],
  [
    keyOf(DESIGN_WRITE_GEOMETRY_OPERATION),
    (parameters) => {
      parseGeometryDecisionParameters(geometryDecisionParametersToMap(parameters));
    },
  ],
  [
    keyOf(VERIFY_SEAL_PROOF_CASE_OPERATION),
    (parameters) => {
      parseFeaProofDecisionParameters(feaProofDecisionParametersToMap(parameters));
    },
  ],
  [
    keyOf(VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION),
    (parameters) => {
      parseThermalMethodSheetSealParameters(parameters);
    },
  ],
  [
    keyOf(VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION),
    (parameters) => {
      parseCrossDomainImpactManifestSealParameters(parameters);
    },
  ],
  [
    keyOf(DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION),
    (parameters) => {
      parseCrossDomainImpactDecisionParameters(parameters);
    },
  ],
  [
    keyOf(VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION),
    (parameters) => {
      parseAdmittedObservationEvaluationParameters(parameters);
    },
  ],
  [
    keyOf(DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION),
    parseAcceptAdmittedModelicaEvaluationParameters,
  ],
  [
    keyOf(DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION),
    parseRejectAdmittedModelicaEvaluationParameters,
  ],
  [
    keyOf(ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION),
    (parameters) => {
      parseSensitivityStudyDecisionParameters(parameters);
    },
  ],
  [
    keyOf(RECONCILE_UNCERTAIN_WRITER_OPERATION),
    parseReconcileUncertainWriterProposal,
  ],
  [
    keyOf(INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION),
    (parameters) => {
      parseDfmDecisionParameters(parameters);
    },
  ],
  [
    keyOf(INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION),
    (parameters) => {
      parseDfmRunDecisionParameters(parameters);
    },
  ],
]);

/** Raised when a proposal cannot be parsed by the grammar of its operation. */
export class ProposalGrammarError extends Error {
  constructor(
    readonly operationKey: OperationKey,
    readonly reason: string,
  ) {
    super(
      `The proposal does not satisfy the reviewed grammar of ${operationKey}: ` +
        `${reason} Fix the parameters and propose again; nothing was recorded.`,
    );
    this.name = "ProposalGrammarError";
  }
}

/**
 * Reject a proposal whose parameters the authorised operation could not parse.
 *
 * A decision bound to no operation, or to one without a declared grammar, is
 * left untouched: this gate narrows the accepted set, it never invents one.
 */
export function assertProposalMatchesOperationGrammar(
  operations:
    | { readonly id: string; readonly version: string }
    | readonly { readonly id: string; readonly version: string }[]
    | undefined,
  parameters: readonly EngineeringDecisionProposalParameter[],
): void {
  const distinct = new Map<string, { readonly id: string; readonly version: string }>();
  for (
    const operation of operations === undefined
      ? []
      : Array.isArray(operations)
      ? operations
      : [operations]
  ) {
    distinct.set(keyOf(operation), operation);
  }
  for (const [operationKey] of distinct) {
    const validate = PROPOSAL_VALIDATORS.get(operationKey);
    if (!validate) continue;
    try {
      validate(parameters);
    } catch (error) {
      throw new ProposalGrammarError(
        operationKey,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/** Operations whose proposals are gated. Exported so tests can pin coverage. */
export function gatedProposalOperations(): readonly OperationKey[] {
  return [...PROPOSAL_VALIDATORS.keys()].sort();
}
