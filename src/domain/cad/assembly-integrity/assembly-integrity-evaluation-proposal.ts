/**
 * Registered provider-free L4 recross for factual assembly-integrity evidence.
 *
 * The operation has no caller-controlled bindings. Server composition selects
 * one exact fresh L3 observation and its canonical module basis; the evaluator
 * never dispatches CAD, chooses a provider, accepts a tolerance, or receives a
 * requested outcome.
 */

import type { EngineeringOperationRef } from "../../project/engineering-project.ts";

export const VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION = Object.freeze(
  {
    id: "verify.evaluate-assembly-integrity",
    version: "1",
  } as const,
);

/** The exact zero-binding operation expected on the L4 work item. */
export function evaluateAssemblyIntegrityWorkItemOperation(): EngineeringOperationRef {
  return {
    id: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
    version: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
    bindings: [],
  };
}
