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

**LLM-subject campaign, same day** — see `results/2026-08-04-llm-l0-l1-l2.json`.
Subject: a fresh Haiku agent per proposal (no session context, frozen prompts, judge in
the deterministic script), 3 levels × 5 tasks × 3 reps, real solves:

| Level                        | Converged | Total solves | Avg/trajectory |
| ---------------------------- | --------- | ------------ | -------------- |
| L0 — LLM alone, one shot     | 12/15     | 15           | 1.00           |
| L1 — LLM + FEA feedback      | **15/15** | 17           | 1.13           |
| L2 — L1 + the published edge | **15/15** | 18           | 1.20           |

Read against the mechanical arms (same judge): bisection needed 3.2 solves/task, the
amortised edge 1.8 — the LLM subject needs ~1.1, because its physics prior (the
rationales derive the plate-bending H³ law unprompted) replaces search. Three findings:

1. **The feedback loop buys the guarantee, not the speed.** L0 is right 80 % of the time
   and silently wrong 20 % — including 2/3 failures on the hard task. One verification
   loop turns that into 15/15 at almost no extra cost (avg 1.13). That is the product's
   value in one line: the oracle converts "usually right" into "always verified".
2. **The edge helps exactly where the prior is weakest.** On easy tasks L2 adds nothing
   over L1 (the prior already lands). On the hard task (T05, far from H0) L2 converges
   in 1.33 solves vs 1.67 and lands identically at 28 mm across all reps — more
   consistent, less oversized (L1 scattered to 29).
3. **Caveat, stated plainly:** this geometry has a textbook closed form, so the LLM
   prior is unusually strong. On geometry with no textbook law the prior degrades and
   the measured edge should matter more — that is the next experiment worth running, not
   a conclusion to assume.

**Hard-geometry campaign, same day** — see
`results/2026-08-04-ribbed-hard-campaign.json`. The caveat's experiment: a ribbed tray
(plate 190×135×6, five transverse ribs, rib height R as the parameter) whose composite
T-section response has no recitable closed form. Real curve measured over R ∈ [2, 14]: u
from 7.995 mm down to 3.416 mm, strongly non-linear and saturating. ~103 real solves:

| Arm                       | Converged | Avg solves |
| ------------------------- | --------- | ---------- |
| B — bisection             | 5/5       | 4.4        |
| CA — single measured edge | 4/5       | 2.8        |
| L0 — LLM alone            | **7/15**  | 1.0        |
| L1 — LLM + FEA feedback   | **15/15** | 1.73       |
| L2 — L1 + edge            | **15/15** | 1.67       |

1. **The prior collapsed as predicted: 80 % → 47 %.** L0 still aces the easy
   near-saturation tasks (T01/T02: 6/6) but scores 1/9 on the three tasks needing real
   extrapolation — and its rationales now _invent_ plausible laws (I ∝ R^2.5 and other
   confident fabrications). Exactly the silent-plausible-error the oracle exists for.
2. **The loop is the invariant: L1 = 15/15 on both geometries.** Even with a broken
   prior, a rough guess plus real verdicts converges in 1.73 solves — still beating
   bisection (4.4) by ~2.5×. The product claim survives its hard test: the guarantee is
   the loop, and it does not depend on the agent being right.
3. **A single edge is not enough on a curved response.** CA, applying the R=6 derivative
   everywhere, failed T01 (six under-corrections near saturation, budget exhausted —
   true local slope ~3× flatter than measured) and grossly over-corrected T05 (final R
   13.4 vs ~9.9 minimal — true local slope ~2.5× steeper). Both are the same failure:
   locality violated in opposite directions. This is the measured argument for the
   piecewise map (several local edges) and for neighbourhood-bounded proposals — the
   traversal engine under construction refuses exactly what CA here silently did.
