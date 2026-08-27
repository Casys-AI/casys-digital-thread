# Explanation: positioning — industry category and state of the art

Audience: both · Diátaxis: explanation · Kind: contract

_Written 2026-07-30, the day the chain shipped._

This is explanatory context, not an operating guide. Start from the
[documentation map](../../README.md) when you need a focused how-to, explanation, or an
exact repository reference.

## Industry category: the executable digital thread

The tool is not SysML tooling, not PLM, not CAD — it is **what circulates between those
silos**. Industry names that connective tissue the _digital thread_: the traceability
requirement → system model → geometry → analysis → proof. In practice, everywhere, that
thread is a concept — document links and a spreadsheet a systems engineer keeps alive by
hand.

This project is building an **executable** thread: an agent traverses it, derives
artifacts, and proves results against the model's own requirements. The target activity
is **continuous virtual V&V** (the left branch of the V-cycle): _does this design hold
every requirement it traces to, with computed proof, after a meaningful change?_ The
implementation records bounded component proof cases; it does not yet provide continuous
correction across an arbitrary whole product.

### Digital twin, precisely

In Grieves' taxonomy the concept splits into the **Digital Twin Prototype** (design
side, before the physical exists) and the **Digital Twin Instance** (mirror of one
physical asset in operation). This workspace currently builds design-time model,
simulation, and proof evidence resembling the first. The product deliberately calls that
an executable digital thread rather than claiming an operational twin.

`syson_value_set` and the constraint tools could participate in a later operational
loop, but they are only primitives. A Digital Twin Instance also requires an exact
physical-asset identity, telemetry ingestion, timestamps and quality, time-series
ownership, state estimation or calibration, and a proven measurement-to-verdict lineage.
Those are not implemented. Operational digital twin work is a V2 candidate after the
beginner-facing V1 design loop is coherent. See
[the product direction](product-direction.md).

## Research category: physics-in-the-loop

The 2026 literature has converged on this pattern under three overlapping vocabularies:

| Register    | Term                                                       | Meaning                                                                      |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| research    | **generate-and-verify** (LLM-Modulo family, neurosymbolic) | the LLM proposes, _sound_ verifiers dispose — never judge of its own output  |
| engineering | **physics-in-the-loop**                                    | design as a closed loop guided by explicit physical verification             |
| infra       | **agent-computer interface** (ACI, SWE-agent)              | tool layers designed for agent consumption: deterministic, fail-fast, narrow |

Key references:

- **Physics-in-the-Loop: A Hybrid Agentic Architecture for Validated CAD Engineering
  Design** — [arXiv:2605.19717](https://arxiv.org/abs/2605.19717). Names the pattern;
  agents plan/generate/evaluate/revise with knowledge-based tools as feedback.
- **Self-Improving CAD Generation Agents with FEA as Feedback** —
  [arXiv:2605.17448](https://arxiv.org/pdf/2605.17448). Independently converged on the
  same pipeline (CadQuery programs → STEP → CalculiX validation) and ships
  **Hephaestus-CCX**: a 50-case benchmark with CalculiX evaluation kits and typed
  pass/fail checkers.
- **LLM-empowered next-generation CAE** (survey) —
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0045782525008631).
  Six-level maturity model from ungrounded LLM to full closed-loop neurosymbolic
  integration.

## Where this implementation differs from the papers

1. **Model-grounded, not prompt-only.** The papers start from a natural-language prompt;
   verified product work in this chain is grounded in a SysML v2 model with traced
   requirements. New ideas still begin as provisional briefs, and CAD-first or
   reverse-engineering entry points must recover missing intent before they can make
   equivalent claims. The MBSE ↔ geometry hop is nearly absent from the literature.
2. **Protocol-level providers, explicit product orchestration.** Paper harnesses are
   monolithic; these links remain independent MCP servers with provider-native data
   contracts. A reviewed backend DAG binds them into a causal product run; the browser
   does not compose tools or receive MCP authority.
3. **Units as values.** 2.5 kg against a 4 lb budget fails; most published verifiers
   compare bare numbers. Unit-blindness in an oracle is a false-positive machine, and
   false positives are worse than no oracle.
4. **Shipped infrastructure**, not paper artifacts: published JSR packages and
   digest-pinned GHCR images, reproducible on any machine with Docker.

## Where the papers are ahead — the open work

They **close the loop**: generate → physics feedback → revise, and they measure the
improvement. On the maturity scale this project sits at "grounded, tool-verified" for
one bounded proof case; the reusable correction loop is not yet closed. V1 must first
generalize proof cases, connect the approved living brief to technical work, and make
change, impact, evidence, and review legible to a beginner. A future benchmark can then
measure the modeling agent's correction rate with and without computed feedback;
Hephaestus-CCX provides a ready-made evaluation protocol rather than one to invent.

## The pitch, in one line

**Model-driven, physics-in-the-loop engineering agents — an executable digital thread
from system model to computed proof.**

Internally, the founding formulation remains the best compass: _le calcul est l'oracle,
pas le produit._
