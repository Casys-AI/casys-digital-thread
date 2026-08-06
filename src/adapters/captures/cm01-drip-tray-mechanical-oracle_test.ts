import { assertEquals, assertThrows } from "@std/assert";
import {
  evaluationFromOracle,
  type ParsedOracleResult,
  parseOracleOutcome,
} from "./cm01-drip-tray-mechanical-oracle.ts";
import type { OracleRequirement } from "../../domain/analysis/proof-case.ts";
import type {
  ThreadFreshness,
  ThreadOperationRef,
  TracedRequirement,
} from "../../domain/thread/thread-snapshot.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TWO_REQUIREMENTS: OracleRequirement[] = [
  {
    id: "assembly_max_displacement",
    name: "DripTray maximum displacement limit",
    metric: "assembly_max_displacement",
    operator: "<=",
    limit: { value: 1, unit: "mm" },
  },
  {
    id: "assembly_max_von_mises",
    name: "DripTray maximum von Mises stress limit",
    metric: "assembly_max_von_mises",
    operator: "<=",
    limit: { value: 20, unit: "MPa" },
  },
];

const PASS_CONTENT = {
  results: [
    {
      constraintId: "assembly_max_displacement",
      status: "pass",
      computedValue: 0.1,
      threshold: 1,
      margin: 0.9,
      marginPercent: 90,
      unit: "mm",
    },
    {
      constraintId: "assembly_max_von_mises",
      status: "pass",
      computedValue: 0.5,
      threshold: 20,
      margin: 19.5,
      marginPercent: 97.5,
      unit: "MPa",
    },
  ],
};

const FAIL_CONTENT = {
  results: [
    {
      constraintId: "assembly_max_displacement",
      status: "fail",
      computedValue: 1.5,
      threshold: 1,
      margin: -0.5,
      marginPercent: -50,
      unit: "mm",
    },
    {
      constraintId: "assembly_max_von_mises",
      status: "fail",
      computedValue: 25,
      threshold: 20,
      margin: -5,
      marginPercent: -25,
      unit: "MPa",
    },
  ],
};

const EVALUATOR: ThreadOperationRef = {
  serverId: "digital-thread",
  tool: "evaluate_cm01_drip_tray_limits_r2",
  runId: "run:test",
};

const FRESHNESS: ThreadFreshness = {
  status: "fresh",
  changedAt: "2026-08-04T00:00:00.000Z",
  invalidatedByChangeIds: [],
};

const REQUIREMENT: TracedRequirement = {
  id: "r-displacement",
  name: "CM-01 displacement",
  statement: "assembly_max_displacement <= 1 [mm]",
  version: "cm01-v3-r2",
  criterion: {
    metric: "assembly_max_displacement",
    operator: "<=",
    limit: { value: 1, unit: "mm" },
  },
  trace: {
    sourceArtifactId: "proof",
    elementId: "r-displacement",
    targetArtifactIds: ["step"],
  },
  freshness: FRESHNESS,
};

const OBSERVATION = {
  id: "obs-displacement",
  quantity: { value: 0.1, unit: "mm" },
};

// ---------------------------------------------------------------------------
// parseOracleOutcome — pass
// ---------------------------------------------------------------------------

Deno.test("parseOracleOutcome returns pass for both constraints when oracle confirms pass", () => {
  const result = parseOracleOutcome(PASS_CONTENT, TWO_REQUIREMENTS);
  assertEquals(result.size, 2);
  const disp = result.get("assembly_max_displacement")!;
  assertEquals(disp.status, "pass");
  if (disp.status === "pass") {
    assertEquals(disp.computedValue, 0.1);
    assertEquals(disp.threshold, 1);
    assertEquals(disp.unit, "mm");
  }
  const vm = result.get("assembly_max_von_mises")!;
  assertEquals(vm.status, "pass");
});

// ---------------------------------------------------------------------------
// parseOracleOutcome — fail
// ---------------------------------------------------------------------------

Deno.test("parseOracleOutcome returns fail for both constraints when oracle confirms fail", () => {
  const result = parseOracleOutcome(FAIL_CONTENT, TWO_REQUIREMENTS);
  assertEquals(result.get("assembly_max_displacement")!.status, "fail");
  assertEquals(result.get("assembly_max_von_mises")!.status, "fail");
});

// ---------------------------------------------------------------------------
// parseOracleOutcome — error propagated without exception
// ---------------------------------------------------------------------------

Deno.test("parseOracleOutcome propagates error status without throwing", () => {
  const content = {
    results: [
      { constraintId: "assembly_max_displacement", status: "error" },
      { constraintId: "assembly_max_von_mises", status: "error" },
    ],
  };
  const result = parseOracleOutcome(content, TWO_REQUIREMENTS);
  assertEquals(result.get("assembly_max_displacement")!.status, "error");
  assertEquals(result.get("assembly_max_von_mises")!.status, "error");
});

// ---------------------------------------------------------------------------
// parseOracleOutcome — unresolved propagated without exception
// ---------------------------------------------------------------------------

Deno.test("parseOracleOutcome propagates unresolved status without throwing", () => {
  const content = {
    results: [
      { constraintId: "assembly_max_displacement", status: "unresolved" },
      { constraintId: "assembly_max_von_mises", status: "unresolved" },
    ],
  };
  const result = parseOracleOutcome(content, TWO_REQUIREMENTS);
  assertEquals(result.get("assembly_max_displacement")!.status, "unresolved");
  assertEquals(result.get("assembly_max_von_mises")!.status, "unresolved");
});

// ---------------------------------------------------------------------------
// parseOracleOutcome — malformed responses rejected fail-closed
// ---------------------------------------------------------------------------

Deno.test("parseOracleOutcome rejects a response missing the results array", () => {
  assertThrows(
    () => parseOracleOutcome({ data: [] }, TWO_REQUIREMENTS),
    Error,
    "results must be an array",
  );
});

Deno.test("parseOracleOutcome rejects a response with wrong number of results", () => {
  assertThrows(
    () => parseOracleOutcome({ results: [PASS_CONTENT.results[0]] }, TWO_REQUIREMENTS),
    Error,
    "expected 2 result(s), got 1",
  );
});

Deno.test("parseOracleOutcome rejects a result with an unknown constraintId", () => {
  const content = {
    results: [
      {
        constraintId: "unknown_id",
        status: "pass",
        computedValue: 0,
        threshold: 1,
        margin: 1,
        marginPercent: 100,
        unit: "mm",
      },
      {
        constraintId: "assembly_max_von_mises",
        status: "pass",
        computedValue: 0,
        threshold: 20,
        margin: 20,
        marginPercent: 100,
        unit: "MPa",
      },
    ],
  };
  assertThrows(
    () => parseOracleOutcome(content, TWO_REQUIREMENTS),
    Error,
    "constraintId is unknown or missing",
  );
});

Deno.test("parseOracleOutcome rejects a unit mismatch — Pa oracle response vs MPa requirement", () => {
  const content = {
    results: [
      {
        constraintId: "assembly_max_displacement",
        status: "pass",
        computedValue: 0.1,
        threshold: 1,
        margin: 0.9,
        marginPercent: 90,
        unit: "mm",
      },
      {
        constraintId: "assembly_max_von_mises",
        status: "pass",
        computedValue: 500000,
        threshold: 20000000,
        margin: 19500000,
        marginPercent: 97.5,
        unit: "Pa", // Pa instead of required MPa — must be rejected
      },
    ],
  };
  assertThrows(
    () => parseOracleOutcome(content, TWO_REQUIREMENTS),
    Error,
    'must equal "MPa"',
  );
});

Deno.test("parseOracleOutcome rejects a non-finite computedValue", () => {
  const content = {
    results: [
      {
        constraintId: "assembly_max_displacement",
        status: "pass",
        computedValue: Infinity,
        threshold: 1,
        margin: 0.9,
        marginPercent: 90,
        unit: "mm",
      },
      { constraintId: "assembly_max_von_mises", status: "error" },
    ],
  };
  assertThrows(
    () => parseOracleOutcome(content, TWO_REQUIREMENTS),
    Error,
    "computedValue must be a finite number",
  );
});

// ---------------------------------------------------------------------------
// evaluationFromOracle — verdict comes from oracle, not from local comparison
// ---------------------------------------------------------------------------

Deno.test("evaluationFromOracle verdict pass comes from oracle, not local value comparison", () => {
  // The observation value (0.1) is well within the limit (1), but we pass
  // a "pass" oracle result — the function must trust the oracle.
  const oracleResult: ParsedOracleResult = {
    status: "pass",
    computedValue: 0.1,
    threshold: 1,
    margin: 0.9,
    marginPercent: 90,
    unit: "mm",
  };
  const ev = evaluationFromOracle(
    REQUIREMENT,
    OBSERVATION,
    oracleResult,
    EVALUATOR,
    "solve-id",
    "2026-08-04T00:00:00.000Z",
    FRESHNESS,
  );
  assertEquals(ev.status, "pass");
  assertEquals(ev.comparison?.actual.value, 0.1);
  assertEquals(ev.comparison?.limit.value, 1);
});

Deno.test("evaluationFromOracle verdict fail comes from oracle, not local value comparison", () => {
  // The oracle says fail even though in a naive comparison 0.1 <= 1 would pass.
  const oracleResult: ParsedOracleResult = {
    status: "fail",
    computedValue: 0.1,
    threshold: 1,
    margin: -0.9,
    marginPercent: -90,
    unit: "mm",
  };
  const ev = evaluationFromOracle(
    REQUIREMENT,
    OBSERVATION,
    oracleResult,
    EVALUATOR,
    "solve-id",
    "2026-08-04T00:00:00.000Z",
    FRESHNESS,
  );
  assertEquals(ev.status, "fail");
});

Deno.test("evaluationFromOracle propagates error status without comparison and without throwing", () => {
  const oracleResult: ParsedOracleResult = { status: "error" };
  const ev = evaluationFromOracle(
    REQUIREMENT,
    OBSERVATION,
    oracleResult,
    EVALUATOR,
    "solve-id",
    "2026-08-04T00:00:00.000Z",
    FRESHNESS,
  );
  assertEquals(ev.status, "error");
  assertEquals(ev.comparison, undefined);
  assertEquals(ev.message?.includes("error"), true);
});

Deno.test("evaluationFromOracle propagates unresolved status without comparison and without throwing", () => {
  const oracleResult: ParsedOracleResult = { status: "unresolved" };
  const ev = evaluationFromOracle(
    REQUIREMENT,
    OBSERVATION,
    oracleResult,
    EVALUATOR,
    "solve-id",
    "2026-08-04T00:00:00.000Z",
    FRESHNESS,
  );
  assertEquals(ev.status, "unresolved");
  assertEquals(ev.comparison, undefined);
});

Deno.test("evaluationFromOracle never compares observation value to limit numerically", () => {
  // Observation value (999) is far above the limit (1), but the oracle says pass.
  // The verdict must be pass; a local comparison would wrongly yield fail.
  const oracleResult: ParsedOracleResult = {
    status: "pass",
    computedValue: 999,
    threshold: 1,
    margin: -998,
    marginPercent: -99800,
    unit: "mm",
  };
  const ev = evaluationFromOracle(
    REQUIREMENT,
    { id: "obs", quantity: { value: 999, unit: "mm" } },
    oracleResult,
    EVALUATOR,
    "solve-id",
    "2026-08-04T00:00:00.000Z",
    FRESHNESS,
  );
  // If the verdict were computed locally, it would be "fail"; must be "pass".
  assertEquals(ev.status, "pass");
});
