/**
 * Registered, provider-free mechanical preservation control after X09.
 *
 * The operation rereads the exact impact decision, evaluation, independence
 * assertion, and current FEA proof/closeout identities. It never accepts an
 * MRTR of its own, mutates a claim, queues a work item or rerun, or calls
 * CalculiX / SysON / CAD / ngspice / OMC.
 */

import type { EngineeringOperationRef } from "../project/engineering-project.ts";

export const ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION = {
  id: "analyze.evaluate-mechanical-preservation",
  version: "2",
} as const;

export const MECHANICAL_PRESERVATION_LIMITS = {
  providerCalls: "none",
  solverCalls: "none",
  gateClaimTransitions: "none",
  workItemInvalidations: "none",
  rerunProposals: "none",
  newWorkItems: "none",
} as const;

/**
 * The server derives every preservation input from the exact Thread basis
 * after the human X09 decision. The approved-brief binding keeps this
 * documentary control on the existing project authority path; it is not an
 * MRTR decision input.
 */
export function evaluateMechanicalPreservationWorkItemOperation(): EngineeringOperationRef {
  return {
    id: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION.id,
    version: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  };
}
