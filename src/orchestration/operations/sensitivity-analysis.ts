/**
 * Orchestration re-export of the first-order FEA sensitivity operation
 * identities. Canonical definitions live in the domain proposal module so
 * registry, gate and executors share one source without adapters importing
 * inward-out.
 */

export {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../domain/analysis/sensitivity-study-proposal.ts";
