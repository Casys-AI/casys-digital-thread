/**
 * Pure step-policies for the oracle B-vs-C experiment.
 *
 * Why purity matters: each policy is a deterministic function from observation
 * history to the next proposal. No I/O means the same history always produces
 * the same proposal, making the two arms directly comparable without any
 * provider noise or state leakage between calls.
 *
 * The runner (run-experiment.ts) owns the I/O: it calls solveAtHeight, applies
 * the frozen judge, appends to history, and calls the policy again. Policies
 * never call providers or read files.
 */

export interface SolveObservation {
  readonly heightMm: number;
  readonly displacementMm: number;
  readonly vonMisesMpa: number;
  readonly verdict: "pass" | "fail";
}

export interface OracleTask {
  readonly id: string;
  readonly startingHeightMm: number;
  readonly displacementThresholdMm: number;
  readonly toleranceMm: number;
}

export interface PolicyPropose {
  readonly action: "propose";
  readonly heightMm: number;
  readonly rationale: string;
}

export interface PolicyStop {
  readonly action: "stop";
  readonly reason:
    | "converged"
    | "budget_exceeded"
    | "physics_violated"
    | "domain_exceeded";
  readonly detail: string;
}

export type PolicyStep = PolicyPropose | PolicyStop;

/**
 * Bisection policy (Arm B): bounded binary search without gradient information.
 *
 * Pre-conditions: startingHeightMm is known to fail (not re-solved); safeMaxMm
 * is known to pass (reference from the 2026-08-04 sensitivity campaign, not
 * re-solved). B pays only for bisection steps between these two endpoints.
 *
 * Convergence: when the bracket [L, R] has width ≤ task.toleranceMm. H_final
 * is the smallest passing height found within the bracket.
 *
 * The 2-solve measurement overhead of Arm C is what this arm avoids — and is
 * exactly what B-vs-C measures.
 */
export function armBStep(
  history: readonly SolveObservation[],
  task: OracleTask,
  safeMaxMm: number,
  budgetMax: number,
): PolicyStep {
  // Reconstruct bracket from history.
  // L = last known failing height (startingHeightMm if history is empty).
  // R = first (lowest) known passing height (safeMaxMm if no pass yet).
  let L = task.startingHeightMm;
  let R = safeMaxMm;

  for (const obs of history) {
    if (obs.verdict === "pass") {
      if (obs.heightMm < R) {
        R = obs.heightMm;
      }
    } else {
      if (obs.heightMm > L) {
        L = obs.heightMm;
      }
    }
  }

  // Convergence check: bracket narrow enough to stop.
  if (R - L <= task.toleranceMm) {
    return {
      action: "stop",
      reason: "converged",
      detail: `bracket [${L.toFixed(4)}, ${R.toFixed(4)}] width ` +
        `${(R - L).toFixed(4)} ≤ tolerance ${task.toleranceMm}`,
    };
  }

  // Budget check before proposing.
  if (history.length >= budgetMax) {
    return {
      action: "stop",
      reason: "budget_exceeded",
      detail: `${history.length} solves consumed budget ${budgetMax}; ` +
        `bracket [${L.toFixed(4)}, ${R.toFixed(4)}] still open`,
    };
  }

  const mid = (L + R) / 2;
  return {
    action: "propose",
    heightMm: mid,
    rationale: `bisection midpoint ${mid.toFixed(4)} in [${L.toFixed(4)}, ${
      R.toFixed(4)
    }]`,
  };
}

/**
 * Gradient-guided policy (Arm C): pays 2 measurement solves upfront to
 * estimate the local derivative, then proposes a single corrected height.
 *
 * Solve 1: H0 — establishes the actual base displacement.
 * Solve 2: H0 + measureStepMm — establishes dDisp/dH locally.
 * Solve 3+: gradient-guided proposals, verified by the frozen judge.
 *
 * Honesty invariant: the 2 measurement solves count in the total. Arm C is
 * only cheaper than Arm B over a campaign of N tasks where the derivative
 * amortises. Single-task C is usually more expensive than single-task B for
 * small corrections.
 *
 * The policy reports domain_exceeded if a gradient proposal would exceed
 * safeMaxMm — the runner must not call solveAtHeight with heights above the
 * validated boundary.
 */
export function armCStep(
  history: readonly SolveObservation[],
  task: OracleTask,
  measureStepMm: number,
  safeMaxMm: number,
  budgetMax: number,
): PolicyStep {
  // Solve 1: measure at H0.
  if (history.length === 0) {
    return {
      action: "propose",
      heightMm: task.startingHeightMm,
      rationale: `gradient measurement solve 1: H0=${task.startingHeightMm}`,
    };
  }

  // Solve 2: measure at H0 + step to establish the derivative.
  if (history.length === 1) {
    const h0Obs = history[0];
    if (h0Obs.verdict === "pass") {
      // H0 already satisfies the threshold — no correction needed.
      return {
        action: "stop",
        reason: "converged",
        detail:
          `H0=${task.startingHeightMm} already passes threshold ${task.displacementThresholdMm}`,
      };
    }
    const h1 = task.startingHeightMm + measureStepMm;
    return {
      action: "propose",
      heightMm: h1,
      rationale: `gradient measurement solve 2: H0+step=${h1}`,
    };
  }

  // Gradient established from the first two solves.
  // dDisp < 0 is the reviewed physical expectation: increasing height reduces
  // displacement. A non-negative derivative signals a physics anomaly.
  const dDisp = (history[1].displacementMm - history[0].displacementMm) / measureStepMm;

  if (dDisp >= 0) {
    return {
      action: "stop",
      reason: "physics_violated",
      detail: `dDisp/dH = ${dDisp.toFixed(6)} ≥ 0; ` +
        `displacement must decrease as height increases`,
    };
  }

  // Last observation: if it passes, convergence is achieved.
  const lastObs = history[history.length - 1];
  if (lastObs.verdict === "pass") {
    return {
      action: "stop",
      reason: "converged",
      detail: `verified pass at H=${lastObs.heightMm.toFixed(4)}, ` +
        `displacement=${lastObs.displacementMm.toFixed(6)} mm`,
    };
  }

  // Budget guard before further proposals.
  if (history.length >= budgetMax) {
    return {
      action: "stop",
      reason: "budget_exceeded",
      detail: `${history.length} solves consumed budget ${budgetMax}`,
    };
  }

  // Use the measured derivative (from solves 1 and 2) to estimate the
  // correction needed from the current failing height. The derivative is not
  // re-measured on subsequent iterations.
  return proposeFromGradient(lastObs, task, dDisp, safeMaxMm);
}

/**
 * Shared gradient-guided proposal: from the last failing observation, step by
 * excess/|dDisp| toward the threshold, clamped to the safe domain and forced
 * to make forward progress. Used by both Arm C (self-measured gradient) and
 * Arm C-amortised (campaign gradient) so the two arms differ only in where
 * the derivative came from — which is exactly the variable under test.
 */
function proposeFromGradient(
  lastObs: SolveObservation,
  task: OracleTask,
  dDisp: number,
  safeMaxMm: number,
): PolicyStep {
  const thresh = task.displacementThresholdMm;
  const excess = lastObs.displacementMm - thresh;
  const delta = excess / Math.abs(dDisp);
  let hProp = lastObs.heightMm + delta;

  // Clamp to safe domain ceiling.
  if (hProp > safeMaxMm) {
    return {
      action: "stop",
      reason: "domain_exceeded",
      detail: `gradient proposal ${hProp.toFixed(4)} exceeds safeMax ${safeMaxMm}`,
    };
  }

  // Must make forward progress — proposal must exceed the last solved height.
  if (hProp <= lastObs.heightMm) {
    // Gradient is too flat or numerical precision issue; take a small step.
    hProp = lastObs.heightMm + 0.5;
    if (hProp > safeMaxMm) {
      return {
        action: "stop",
        reason: "domain_exceeded",
        detail: `minimum step proposal ${
          hProp.toFixed(4)
        } exceeds safeMax ${safeMaxMm}`,
      };
    }
  }

  return {
    action: "propose",
    heightMm: hProp,
    rationale: `gradient refinement: ${lastObs.heightMm.toFixed(4)} + ` +
      `${delta.toFixed(4)} = ${hProp.toFixed(4)} ` +
      `(dDisp/dH=${dDisp.toFixed(6)})`,
  };
}

/**
 * Arm C-amortised: the gradient was measured ONCE for the whole campaign (two
 * solves, paid once and reported in the campaign total — never hidden), and
 * every task reuses it. Per task the arm pays one solve to establish the real
 * starting point, then verifies each gradient proposal with a real solve: the
 * oracle decides convergence, never the prediction.
 *
 * Honesty invariant: this arm exists so the summary reports a MEASURED
 * amortised cost instead of extrapolating one from Arm C's per-task numbers.
 */
export function armCAmortisedStep(
  history: readonly SolveObservation[],
  task: OracleTask,
  campaignGradientDispPerMm: number,
  safeMaxMm: number,
  budgetMax: number,
): PolicyStep {
  if (campaignGradientDispPerMm >= 0) {
    return {
      action: "stop",
      reason: "physics_violated",
      detail: `campaign dDisp/dH = ${
        campaignGradientDispPerMm.toFixed(6)
      } >= 0; displacement must decrease as height increases`,
    };
  }

  // Solve 1: establish the real starting point (no free knowledge of u(H0)).
  if (history.length === 0) {
    return {
      action: "propose",
      heightMm: task.startingHeightMm,
      rationale: `starting-point solve: H0=${task.startingHeightMm}`,
    };
  }

  const lastObs = history[history.length - 1];
  if (lastObs.verdict === "pass") {
    return {
      action: "stop",
      reason: "converged",
      detail: `verified pass at H=${lastObs.heightMm.toFixed(4)}, ` +
        `displacement=${lastObs.displacementMm.toFixed(6)} mm`,
    };
  }

  if (history.length >= budgetMax) {
    return {
      action: "stop",
      reason: "budget_exceeded",
      detail: `${history.length} solves consumed budget ${budgetMax}`,
    };
  }

  return proposeFromGradient(lastObs, task, campaignGradientDispPerMm, safeMaxMm);
}
