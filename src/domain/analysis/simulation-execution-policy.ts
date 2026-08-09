/**
 * Typed execution policy for the simulate.run-modelica-scenario@1 operation.
 *
 * WHY THIS MODULE EXISTS — the executor needs a versioned, injected guard that
 * caps the simulation timeout before any provider call is made.  An inline
 * numeric check embedded in the executor cannot be independently tested or
 * versioned: any change would silently alter the planDigest that travels into
 * the WAL and the execution receipt.  A dedicated domain module gives the
 * policy a stable policyVersion that is recorded in both, making policy changes
 * traceable through evidence without touching the executor.
 *
 * WIRING NOTE — the HTTP client timeout for the MCP tool call (150 000 ms) is
 * distinct from timeoutMaxMs (120 000 ms).  The client timeout must be strictly
 * greater than the maximum provider timeout so that a provider-side timeout is
 * surfaced as a structured result rather than a transport error.  That
 * relationship is a server.ts wiring constraint, not enforced here.
 *
 * This module is pure domain: no I/O, no Modelica names, no provider details.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
} from "../kernel/case-validation.ts";

// ---------------------------------------------------------------------------
// Policy version
// ---------------------------------------------------------------------------

export const SIMULATION_EXECUTION_POLICY_VERSION =
  "simulation-execution-policy/1" as const;

// ---------------------------------------------------------------------------
// Typed violation
// ---------------------------------------------------------------------------

export type SimulationPolicyViolationCode = "timeout_exceeds_policy";

/**
 * Typed policy violation: machine-readable code + numeric context, no provider
 * prose.  Callers match on .code; .context carries the measured value and the
 * relevant limit so structured reporters never need to parse the message.
 *
 * AX principle Machine-Readable Errors: code + context, never prose-only.
 */
export class SimulationPolicyViolationError extends Error {
  readonly code: SimulationPolicyViolationCode;
  readonly context: Readonly<Record<string, number>>;

  constructor(
    code: SimulationPolicyViolationCode,
    context: Record<string, number>,
  ) {
    super(`simulation-execution-policy violation: ${code}`);
    this.name = "SimulationPolicyViolationError";
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

// ---------------------------------------------------------------------------
// Policy interface
// ---------------------------------------------------------------------------

/**
 * Versioned execution policy injected from server.ts into the Modelica executor.
 *
 * BOUNDARY CONTRACT (tested, must not drift):
 *   timeoutMaxMs — case.timeoutMs <= timeoutMaxMs → accepted;
 *                  strictly above → timeout_exceeds_policy.
 *                  At the limit (equality) the assertion is a no-op.
 */
export interface SimulationExecutionPolicy {
  readonly policyVersion: typeof SIMULATION_EXECUTION_POLICY_VERSION;
  /** Maximum allowed simulation timeout in milliseconds (inclusive upper bound). */
  readonly timeoutMaxMs: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const POLICY_KEYS = ["policyVersion", "timeoutMaxMs"] as const;

/**
 * Validate an untrusted value and return an immutable SimulationExecutionPolicy.
 *
 * Fail-closed: extra or missing keys, wrong policyVersion, and non-positive
 * or non-integer timeoutMaxMs are all rejected with TypeError.
 */
export function validateSimulationExecutionPolicy(
  value: unknown,
): SimulationExecutionPolicy {
  const rec = exactRecord(value, POLICY_KEYS, "$policy");
  literalValue(
    rec.policyVersion,
    SIMULATION_EXECUTION_POLICY_VERSION,
    "$policy.policyVersion",
  );
  const timeoutMaxMs = positiveInteger(rec.timeoutMaxMs, "$policy.timeoutMaxMs");
  return deepFreeze({
    policyVersion: SIMULATION_EXECUTION_POLICY_VERSION,
    timeoutMaxMs,
  });
}

// ---------------------------------------------------------------------------
// Assertion
// ---------------------------------------------------------------------------

/**
 * Assert that a simulation case's requested timeout satisfies the policy cap.
 *
 * Accepts at the limit: case.timeoutMs === policy.timeoutMaxMs is accepted.
 * Only strictly above the limit is rejected.
 *
 * Throws SimulationPolicyViolationError with code timeout_exceeds_policy and
 * a context carrying both the requested and maximum values in milliseconds.
 */
export function assertCaseWithinPolicy(
  simulationCase: { readonly timeoutMs: number },
  policy: SimulationExecutionPolicy,
): void {
  if (simulationCase.timeoutMs > policy.timeoutMaxMs) {
    throw new SimulationPolicyViolationError("timeout_exceeds_policy", {
      timeoutMs: simulationCase.timeoutMs,
      timeoutMaxMs: policy.timeoutMaxMs,
    });
  }
}
