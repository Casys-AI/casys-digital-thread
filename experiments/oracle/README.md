# The oracle experiment

**The project's decisive measurement, still to run** — everything else is infrastructure.

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

Not started. Blocked on nothing — all bricks published 2026-07-30.
