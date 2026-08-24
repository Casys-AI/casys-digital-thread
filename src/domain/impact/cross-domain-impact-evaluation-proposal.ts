/**
 * Registered, provider-free publication of a cross-domain impact analysis.
 *
 * The operation records a bounded recross and its proposed claim states.  It
 * does not accept an MRTR, alter a claim, queue a replacement method, or
 * authorise any engineering execution.  Those consequential actions remain
 * deliberately outside X07/X08.
 */

import type { EngineeringOperationRef } from "../project/engineering-project.ts";

export const ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION = {
  id: "analyze.evaluate-cross-domain-impact",
  version: "2",
} as const;

/**
 * The server derives every impact input from the exact Thread basis.  The
 * approved-brief binding is retained only to keep this documentary analysis on
 * the existing project authority path; it is not an MRTR decision input.
 */
export function evaluateCrossDomainImpactWorkItemOperation(): EngineeringOperationRef {
  return {
    id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  };
}
