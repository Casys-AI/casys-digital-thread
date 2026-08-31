/**
 * Provider-neutral operation identities for the prescribed-kinematics family.
 *
 * An operation identity is not an MCP tool, a runtime selection, or an
 * admission of a scientific method. Server composition binds each registered
 * run operation to its exact capability/runtime envelope at queue time. The
 * L5 identities are registered but require an exact project, subject, Thread
 * basis, and signed human origin; neither a provider nor an agent can create
 * that decision evidence.
 */

export const VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION = Object.freeze(
  {
    id: "verify.seal-prescribed-kinematics-case",
    version: "1",
  } as const,
);

export const VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION = Object.freeze(
  {
    id: "verify.run-prescribed-kinematics",
    version: "1",
  } as const,
);

/**
 * Terminal failure recorded when Chrono reports an uncertain, absent, or
 * malformed provider outcome after dispatch intent. The exact run may be
 * released only through the human uncertain-writer reconciliation ceremony.
 * Keeping the code beside the operation identity prevents the executor and
 * reconciliation policy from inventing aliases.
 */
export const VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE =
  "verify-run-prescribed-kinematics-provider-outcome-unknown" as const;

export const VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION = Object.freeze(
  {
    id: "verify.seal-prescribed-kinematics-method",
    version: "1",
  } as const,
);

export const VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION = Object.freeze(
  {
    id: "verify.evaluate-prescribed-kinematics",
    version: "1",
  } as const,
);

export const DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION = Object.freeze(
  {
    id: "decide.accept-prescribed-kinematics-evaluation",
    version: "1",
  } as const,
);

export const DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION = Object.freeze(
  {
    id: "decide.reject-prescribed-kinematics-evaluation",
    version: "1",
  } as const,
);

export const PRESCRIBED_KINEMATICS_OPERATIONS = Object.freeze(
  [
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
    VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
    VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
    DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
    DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  ] as const,
);
