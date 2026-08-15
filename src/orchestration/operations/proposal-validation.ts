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
} from "../../domain/analysis/fea-proof-proposal.ts";
import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  parseSensitivityStudyDecisionParameters,
} from "../../domain/analysis/sensitivity-study-proposal.ts";
import {
  parseSimulationCaseDecisionParameters,
  SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
  simulationCaseDecisionParametersToMap,
} from "../../domain/analysis/simulation-case-proposal.ts";
import {
  parseSimulationCaseV2DecisionParameters,
  simulationCaseV2DecisionParametersToMap,
} from "../../domain/analysis/simulation-case-v2-proposal.ts";
import { SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION } from "./recorded-analysis.ts";
import {
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  parseArchitectureProposalParameters,
} from "../../domain/engineering/architecture-proposal.ts";
import {
  parseSysonModelSeedProposalParameters,
  SYSON_MODEL_SEED_OPERATION,
} from "../../domain/engineering/syson-model-seed-proposal.ts";
import {
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  parseArchitectureSysmlSealParameters,
} from "../../domain/engineering/architecture-sysml-seal-proposal.ts";
import {
  DESIGN_WRITE_GEOMETRY_OPERATION,
  geometryDecisionParametersToMap,
  parseGeometryDecisionParameters,
} from "../../domain/engineering/geometry-proposal.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  parseRequirementsProposalParameters,
} from "../../domain/engineering/requirements-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../domain/project/engineering-project.ts";
import {
  parseReconcileUncertainWriterProposal,
  RECONCILE_UNCERTAIN_WRITER_OPERATION,
} from "../../domain/project/reconcile-uncertain-writer-proposal.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  parseTechnicalCompilationAdmissionParameters,
} from "../../domain/analysis/technical-compilation-proposal.ts";
import {
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  parseBuild123dExecutionAdmissionParameters,
} from "../../domain/analysis/build123d-execution-proposal.ts";
import {
  DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  parseIsolatedGeometrySealParameters,
} from "../../domain/analysis/isolated-geometry-seal-proposal.ts";
import {
  DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
  parseVectorCorrectionDecisionParameters,
} from "../../domain/analysis/vector-correction-proposal.ts";
import {
  parseModelicaQualifiedKitRunAdmissionParameters,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
} from "../../domain/analysis/modelica-qualified-kit-run-proposal.ts";
import {
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  parseDfmDecisionParameters,
  parseDfmRunDecisionParameters,
} from "../../domain/analysis/dfm-proposal.ts";

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
    keyOf(ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION),
    (parameters) => {
      parseSensitivityStudyDecisionParameters(parameters);
    },
  ],
  [
    keyOf(SIMULATE_SEAL_SIMULATION_CASE_OPERATION),
    (parameters) => {
      parseSimulationCaseDecisionParameters(
        simulationCaseDecisionParametersToMap(parameters),
      );
    },
  ],
  [
    keyOf(SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION),
    (parameters) => {
      parseSimulationCaseV2DecisionParameters(
        simulationCaseV2DecisionParametersToMap(parameters),
      );
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
