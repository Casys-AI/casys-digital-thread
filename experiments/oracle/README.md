# The oracle experiment

**The project's decisive measurement, still to run** — everything else is
infrastructure.

## Question

Does the verification chain actually improve the modeling agent's output? Measure the
agent's correction rate **with and without the oracle**:

1. Give the agent a modeling task with known ground truth (part + requirements).
2. Arm A: generate SysML + geometry, no feedback.
3. Arm B: same, but each proposal is verified (constraint evaluation, satisfiability,
   FEA) and the verdict fed back; the agent revises.
4. Count: constraint violations surviving in the final artifact, iterations to
   convergence, false-accepts (violations the arm reported as fine).

If B does not beat A decisively, the chain is infrastructure without a product — better
to know early.

## Protocol shortcut

**Hephaestus-CCX** ([arXiv:2605.17448](https://arxiv.org/pdf/2605.17448)) is a 50-case
benchmark with CalculiX evaluation kits and typed pass/fail checkers, built for exactly
this pipeline (CAD programs → STEP → CalculiX). Pointing the chain at it avoids
inventing an evaluation protocol and yields numbers comparable to published work.

## Status

**First campaign executed 2026-08-04** — see
`results/2026-08-04T13-42-37-238Z-b-vs-c.json`. Protocol note: Hephaestus-CCX turned out
not to be publicly retrievable (anonymised submission zip, no repo, no dataset), and its
paper already publishes the FEA-feedback-only arm — so the useful comparison became **B
vs C**: does a _measured sensitivity edge_ beat a strong gradient-free baseline? Three
arms, all actually executed against live CalculiX on five frozen DripTray tasks (safe
domain [20, 31] mm, thresholds hash-frozen, verdicts by real solves only):

| Arm                                | Total solves | Converged | Avg/task |
| ---------------------------------- | ------------ | --------- | -------- |
| B — bounded bisection              | 16           | 5/5       | 3.2      |
| C — self-measured gradient         | 26           | 4/5       | 5.2      |
| CA — campaign gradient (2 + tasks) | **11**       | 4/5       | **1.8**  |

Findings, stated with their edges:

1. **The sensitivity edge wins only amortised.** CA beats B (11 vs 16 solves, measured
   break-even at N≥2 tasks) and lands closer to the minimal satisfying height (less
   over-correction). Per-task self-measurement (arm C) _loses_ to bisection — a
   derivative is only worth measuring if it will be reused. This is the argument for
   publishing edges into the thread rather than measuring ad hoc.
2. **Derivative locality is real and the guards held.** The large correction (T05: start
   23 mm, threshold 0.11 mm) sits far outside the measured 30 ± 1 mm neighbourhood;
   linear extrapolation proposed out of domain and both gradient arms stopped with typed
   refusals (`domain_exceeded`, `budget_exceeded`) instead of converging on a lie.
   Bisection, which assumes nothing, converged. A hybrid policy (gradient first,
   bisection fallback — or local re-measurement) is the obvious next arm.
3. **The solver is exactly repeatable** at identical geometry (amplitude 0.000000 mm),
   so between-height variation is pure signal.

Not yet measured: an LLM-agent arm (with vs without the edge in context), and
multi-parameter tasks where edge _selection_ matters.
