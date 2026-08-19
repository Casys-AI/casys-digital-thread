import { assertEquals, assertThrows } from "@std/assert";
import {
  assertCaseWithinPolicy,
  SIMULATION_EXECUTION_POLICY_VERSION,
  SimulationPolicyViolationError,
  validateSimulationExecutionPolicy,
} from "./simulation-execution-policy.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_POLICY: unknown = {
  policyVersion: SIMULATION_EXECUTION_POLICY_VERSION,
  timeoutMaxMs: 120_000,
};

// ---------------------------------------------------------------------------
// validateSimulationExecutionPolicy — structural guards
// ---------------------------------------------------------------------------

Deno.test(
  "validateSimulationExecutionPolicy accepts a correct policy object",
  () => {
    const policy = validateSimulationExecutionPolicy(VALID_POLICY);
    assertEquals(policy.policyVersion, SIMULATION_EXECUTION_POLICY_VERSION);
    assertEquals(policy.timeoutMaxMs, 120_000);
  },
);

Deno.test(
  "validateSimulationExecutionPolicy returns a frozen immutable value",
  () => {
    const policy = validateSimulationExecutionPolicy(VALID_POLICY);
    assertThrows(
      () => {
        // deno-lint-ignore no-explicit-any
        (policy as any).timeoutMaxMs = 1;
      },
      TypeError,
    );
  },
);

Deno.test(
  "validateSimulationExecutionPolicy rejects an extra key",
  () => {
    assertThrows(
      () =>
        validateSimulationExecutionPolicy({
          ...VALID_POLICY as object,
          unexpected: true,
        }),
      TypeError,
    );
  },
);

Deno.test(
  "validateSimulationExecutionPolicy rejects a missing timeoutMaxMs",
  () => {
    assertThrows(
      () =>
        validateSimulationExecutionPolicy({
          policyVersion: SIMULATION_EXECUTION_POLICY_VERSION,
        }),
      TypeError,
    );
  },
);

Deno.test(
  "validateSimulationExecutionPolicy rejects a missing policyVersion",
  () => {
    assertThrows(
      () => validateSimulationExecutionPolicy({ timeoutMaxMs: 120_000 }),
      TypeError,
    );
  },
);

Deno.test(
  "validateSimulationExecutionPolicy rejects a wrong policyVersion string",
  () => {
    assertThrows(
      () =>
        validateSimulationExecutionPolicy({
          policyVersion: "fea-execution-policy/1",
          timeoutMaxMs: 120_000,
        }),
      TypeError,
    );
  },
);

Deno.test(
  "validateSimulationExecutionPolicy rejects timeoutMaxMs of zero",
  () => {
    assertThrows(
      () =>
        validateSimulationExecutionPolicy({
          policyVersion: SIMULATION_EXECUTION_POLICY_VERSION,
          timeoutMaxMs: 0,
        }),
      TypeError,
    );
  },
);

Deno.test(
  "validateSimulationExecutionPolicy rejects a negative timeoutMaxMs",
  () => {
    assertThrows(
      () =>
        validateSimulationExecutionPolicy({
          policyVersion: SIMULATION_EXECUTION_POLICY_VERSION,
          timeoutMaxMs: -1,
        }),
      TypeError,
    );
  },
);

Deno.test(
  "validateSimulationExecutionPolicy rejects a fractional timeoutMaxMs",
  () => {
    assertThrows(
      () =>
        validateSimulationExecutionPolicy({
          policyVersion: SIMULATION_EXECUTION_POLICY_VERSION,
          timeoutMaxMs: 1.5,
        }),
      TypeError,
    );
  },
);

Deno.test(
  "validateSimulationExecutionPolicy rejects a non-number timeoutMaxMs",
  () => {
    assertThrows(
      () =>
        validateSimulationExecutionPolicy({
          policyVersion: SIMULATION_EXECUTION_POLICY_VERSION,
          timeoutMaxMs: "120000",
        }),
      TypeError,
    );
  },
);

// ---------------------------------------------------------------------------
// assertCaseWithinPolicy — boundary conditions
// ---------------------------------------------------------------------------

Deno.test(
  "assertCaseWithinPolicy accepts a timeout strictly below the maximum",
  () => {
    const policy = validateSimulationExecutionPolicy(VALID_POLICY);
    // Must not throw — no return value to assert on.
    assertCaseWithinPolicy({ timeoutMs: 60_000 }, policy);
  },
);

Deno.test(
  "assertCaseWithinPolicy accepts a timeout exactly at the maximum (equality = accepted)",
  () => {
    const policy = validateSimulationExecutionPolicy(VALID_POLICY);
    // Exact equality must be accepted — the design invariant is <=.
    assertCaseWithinPolicy({ timeoutMs: 120_000 }, policy);
  },
);

Deno.test(
  "assertCaseWithinPolicy rejects a timeout one millisecond above the maximum",
  () => {
    const policy = validateSimulationExecutionPolicy(VALID_POLICY);
    assertThrows(
      () => assertCaseWithinPolicy({ timeoutMs: 120_001 }, policy),
      SimulationPolicyViolationError,
    );
  },
);

Deno.test(
  "assertCaseWithinPolicy rejection carries the typed code timeout_exceeds_policy",
  () => {
    const policy = validateSimulationExecutionPolicy(VALID_POLICY);
    try {
      assertCaseWithinPolicy({ timeoutMs: 999_999 }, policy);
      throw new Error("assertCaseWithinPolicy must have thrown.");
    } catch (err) {
      if (!(err instanceof SimulationPolicyViolationError)) {
        throw new Error(
          `Expected SimulationPolicyViolationError, got ${String(err)}`,
        );
      }
      assertEquals(err.code, "timeout_exceeds_policy");
      assertEquals(err.context.timeoutMs, 999_999);
      assertEquals(err.context.timeoutMaxMs, 120_000);
    }
  },
);

Deno.test(
  "assertCaseWithinPolicy accepts the minimum valid timeout of one millisecond",
  () => {
    const policy = validateSimulationExecutionPolicy(VALID_POLICY);
    assertCaseWithinPolicy({ timeoutMs: 1 }, policy);
  },
);
