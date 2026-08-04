import { assertEquals } from "@std/assert";
import {
  armBStep,
  armCAmortisedStep,
  armCStep,
  type OracleTask,
  type SolveObservation,
} from "./policies.ts";

// ── Shared test fixture ────────────────────────────────────────────────────────

function t01(): OracleTask {
  return {
    id: "T01",
    startingHeightMm: 29,
    displacementThresholdMm: 0.088,
    toleranceMm: 0.5,
  };
}

function obs(
  heightMm: number,
  displacementMm: number,
  verdict: "pass" | "fail",
): SolveObservation {
  return { heightMm, displacementMm, vonMisesMpa: 0.47, verdict };
}

const SAFE_MAX = 31;
const BUDGET = 8;
const MEASURE_STEP = 1;

// ── Arm B ──────────────────────────────────────────────────────────────────────

Deno.test("armBStep with empty history proposes midpoint between H0 and safeMax", () => {
  const step = armBStep([], t01(), SAFE_MAX, BUDGET);
  assertEquals(step.action, "propose");
  if (step.action === "propose") {
    assertEquals(step.heightMm, (29 + 31) / 2);
  }
});

Deno.test("armBStep after a failing midpoint proposes the next bisection midpoint", () => {
  // First step: 30mm (midpoint of [29, 31]), fails.
  const history = [obs(30, 0.091, "fail")];
  const step = armBStep(history, t01(), SAFE_MAX, BUDGET);
  assertEquals(step.action, "propose");
  if (step.action === "propose") {
    // New bracket: L=30, R=31. Mid = 30.5.
    assertEquals(step.heightMm, (30 + 31) / 2);
  }
});

Deno.test("armBStep converges when bracket width reaches the tolerance", () => {
  // Bracket [30.6, 31]: width = 0.4 ≤ 0.5.
  const history = [
    obs(30, 0.091, "fail"),
    obs(30.5, 0.0895, "fail"),
    obs(30.75, 0.0878, "pass"),
    obs(30.625, 0.0887, "fail"),
    obs(30.6875, 0.0882, "fail"),
  ];
  const step = armBStep(history, t01(), SAFE_MAX, BUDGET);
  // L = 30.6875, R = 30.75, width = 0.0625 ≤ 0.5 → converged.
  assertEquals(step.action, "stop");
  if (step.action === "stop") {
    assertEquals(step.reason, "converged");
  }
});

Deno.test("armBStep stops with budget_exceeded when budget is consumed before convergence", () => {
  // 8 failing solves — bracket not yet narrow enough.
  const history = Array.from({ length: 8 }, (_, i) => obs(29 + i * 0.1, 0.090, "fail"));
  const step = armBStep(history, t01(), SAFE_MAX, BUDGET);
  assertEquals(step.action, "stop");
  if (step.action === "stop") {
    assertEquals(step.reason, "budget_exceeded");
  }
});

Deno.test("armBStep never proposes a height above safeMaxMm", () => {
  // Empty history with a safeMax of 30.
  const step = armBStep([], t01(), 30, BUDGET);
  assertEquals(step.action, "propose");
  if (step.action === "propose") {
    // Must not exceed 30.
    assertEquals(step.heightMm <= 30, true);
  }
});

// ── Arm C ──────────────────────────────────────────────────────────────────────

Deno.test("armCStep with empty history proposes H0 as the first gradient measurement", () => {
  const step = armCStep([], t01(), MEASURE_STEP, SAFE_MAX, BUDGET);
  assertEquals(step.action, "propose");
  if (step.action === "propose") {
    assertEquals(step.heightMm, 29);
  }
});

Deno.test("armCStep after H0 fail proposes H0+step as the second gradient measurement", () => {
  const history = [obs(29, 0.0933, "fail")];
  const step = armCStep(history, t01(), MEASURE_STEP, SAFE_MAX, BUDGET);
  assertEquals(step.action, "propose");
  if (step.action === "propose") {
    assertEquals(step.heightMm, 30);
  }
});

Deno.test("armCStep after H0 pass returns converged without measuring the gradient", () => {
  // Task threshold is 0.088 but H0 displacement is 0.082 — already passes.
  const history = [obs(29, 0.082, "pass")];
  const step = armCStep(history, t01(), MEASURE_STEP, SAFE_MAX, BUDGET);
  assertEquals(step.action, "stop");
  if (step.action === "stop") {
    assertEquals(step.reason, "converged");
  }
});

Deno.test(
  "armCStep after two gradient measurements proposes the gradient-corrected height",
  () => {
    // Both observations must have displacement > threshold (0.088) to stay failing.
    // Measured derivative: (0.091 - 0.100) / 1 = -0.009 mm/mm.
    // Policy uses lastObs (H=30, disp=0.091): excess = 0.091 - 0.088 = 0.003.
    // delta = 0.003 / 0.009 = 0.333...; hProp = 30 + 0.333... = 30.333...
    // This equals H0 + (u0 - thresh)/|dDisp| = 29 + (0.100 - 0.088)/0.009 = 30.333...
    // (the two formulas are equivalent in the linear approximation).
    const history = [
      obs(29, 0.100, "fail"), // H0 solve: 0.100 > 0.088 → fail ✓
      obs(30, 0.091, "fail"), // H0+step solve: 0.091 > 0.088 → fail ✓
    ];
    const step = armCStep(history, t01(), MEASURE_STEP, SAFE_MAX, BUDGET);
    assertEquals(step.action, "propose");
    if (step.action === "propose") {
      const dDisp = (0.091 - 0.100) / 1; // -0.009
      const expected = 30 + (0.091 - 0.088) / Math.abs(dDisp); // 30.333...
      assertEquals(
        Math.abs(step.heightMm - expected) < 1e-9,
        true,
        `expected ≈${expected.toFixed(6)}, got ${step.heightMm.toFixed(6)}`,
      );
    }
  },
);

Deno.test("armCStep stops with physics_violated when dDisp/dH is non-negative", () => {
  // Displacement increased with height — unexpected physics.
  const history = [
    obs(29, 0.085, "fail"),
    obs(30, 0.090, "fail"), // dDisp = +0.005, positive → violation
  ];
  const step = armCStep(history, t01(), MEASURE_STEP, SAFE_MAX, BUDGET);
  assertEquals(step.action, "stop");
  if (step.action === "stop") {
    assertEquals(step.reason, "physics_violated");
  }
});

Deno.test("armCStep stops with domain_exceeded when gradient proposal exceeds safeMaxMm", () => {
  // Very small gradient: dDisp = -0.0001 mm/mm.
  // excess = 0.0933 - 0.088 = 0.0053 mm.
  // delta = 0.0053 / 0.0001 = 53 mm → proposal 29 + 53 = 82 >> 31.
  const history = [
    obs(29, 0.0933, "fail"),
    obs(30, 0.0932, "fail"), // dDisp = -0.0001
  ];
  const step = armCStep(history, t01(), MEASURE_STEP, SAFE_MAX, BUDGET);
  assertEquals(step.action, "stop");
  if (step.action === "stop") {
    assertEquals(step.reason, "domain_exceeded");
  }
});

Deno.test("armCStep returns converged after a verification solve passes", () => {
  // History: measure H0, measure H0+step, propose H_grad (passes).
  const history = [
    obs(29, 0.0933, "fail"),
    obs(30, 0.0852, "fail"),
    obs(29.654, 0.0879, "pass"), // gradient proposal passes
  ];
  const step = armCStep(history, t01(), MEASURE_STEP, SAFE_MAX, BUDGET);
  assertEquals(step.action, "stop");
  if (step.action === "stop") {
    assertEquals(step.reason, "converged");
  }
});

Deno.test("armCStep stops with budget_exceeded when all solves are consumed", () => {
  // 8 failing solves.
  const history = [
    obs(29, 0.0933, "fail"),
    obs(30, 0.0852, "fail"),
    obs(29.654, 0.0890, "fail"), // proposal fails (threshold 0.088, got 0.0890)
    obs(29.901, 0.0889, "fail"),
    obs(30.025, 0.0889, "fail"),
    obs(30.148, 0.0889, "fail"),
    obs(30.271, 0.0889, "fail"),
    obs(30.394, 0.0889, "fail"),
  ];
  const step = armCStep(history, t01(), MEASURE_STEP, SAFE_MAX, BUDGET);
  assertEquals(step.action, "stop");
  if (step.action === "stop") {
    assertEquals(step.reason, "budget_exceeded");
  }
});

Deno.test("armBStep always returns converged when safeMax equals H0 plus tolerance", () => {
  // safeMax = 29.4, H0 = 29. Bracket [29, 29.4] = 0.4 ≤ 0.5 tolerance.
  const task: OracleTask = {
    id: "T-edge",
    startingHeightMm: 29,
    displacementThresholdMm: 0.088,
    toleranceMm: 0.5,
  };
  const step = armBStep([], task, 29.4, BUDGET);
  // Bracket width = 0.4 ≤ 0.5 → immediate convergence.
  assertEquals(step.action, "stop");
  if (step.action === "stop") {
    assertEquals(step.reason, "converged");
  }
});

Deno.test("Arm CA establishes the real starting point before trusting the campaign gradient", () => {
  const step = armCAmortisedStep([], t01(), -0.008, 31, 15);
  if (step.action !== "propose" || step.heightMm !== t01().startingHeightMm) {
    throw new Error("CA must first solve H0 — no free knowledge of u(H0)");
  }
});

Deno.test("Arm CA proposes exactly excess over gradient from a failing start, without measurement solves", () => {
  const task = t01();
  const failing = {
    heightMm: task.startingHeightMm,
    displacementMm: task.displacementThresholdMm + 0.008,
    vonMisesMpa: 0.5,
    verdict: "fail" as const,
  };
  const step = armCAmortisedStep([failing], task, -0.008, 31, 15);
  if (step.action !== "propose") throw new Error("expected a proposal");
  const expected = failing.heightMm + 0.008 / 0.008;
  if (Math.abs(step.heightMm - expected) > 1e-9) {
    throw new Error(`expected ${expected}, got ${step.heightMm}`);
  }
});

Deno.test("Arm CA stops as physics_violated on a non-negative campaign gradient", () => {
  const step = armCAmortisedStep([], t01(), 0.001, 31, 15);
  if (step.action !== "stop" || step.reason !== "physics_violated") {
    throw new Error("a non-negative gradient must halt the arm");
  }
});
