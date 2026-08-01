# Explanation: positioning — industry category and state of the art

_Written 2026-07-30, the day the chain shipped._

> **Status update, 2026-08-01.** The provider tools and protocol path shipped;
> the native linked product loop did not. The accepted shell now renders a
> persisted `ThreadSnapshot`. The current live SysON model still has no
> `ConstraintUsage`, so it cannot yet produce the model-owned closed-loop
> verdict described below.

This is explanatory context, not an operating guide. Start from the
[documentation map](README.md) when you need a tutorial, a focused how-to, or an
exact repository reference.

## Industry category: the executable digital thread

The tool is not SysML tooling, not PLM, not CAD — it is **what circulates
between those silos**. Industry names that connective tissue the _digital
thread_: the traceability requirement → system model → geometry → analysis →
proof. In practice, everywhere, that thread is a concept — document links and a
spreadsheet a systems engineer keeps alive by hand.

This project makes the thread **executable**: an agent traverses it, derives
each artifact from the previous one, and proves the result against the model's
own requirements. The activity automated is **continuous virtual V&V** (the left
branch of the V-cycle): _does this design hold every requirement it traces to,
with computed proof, at every change?_ — turned from weeks between requirement
freeze and design review into minutes, continuously.

### Digital twin, precisely

In Grieves' original taxonomy the concept splits into the **Digital Twin
Prototype** (design side, before the physical exists) and the **Digital Twin
Instance** (mirror of a physical asset in operation). The market's "digital
twin" is dominated by the second (IoT/monitoring — Siemens, GE, Ansys). This
chain builds the first: a twin **verified at birth**.

The extension to a true operational twin is already wired: `syson_value_set` +
`syson_constraint_validate` is exactly the mechanism for injecting measured
operational data into the model and re-verifying the asset in service against
its requirements. Same chain, same oracle, zero new bricks — DTP becomes DTI the
day a sensor pushes a value.

## Research category: physics-in-the-loop

The 2026 literature has converged on this pattern under three overlapping
vocabularies:

| Register    | Term                                                       | Meaning                                                                      |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| research    | **generate-and-verify** (LLM-Modulo family, neurosymbolic) | the LLM proposes, _sound_ verifiers dispose — never judge of its own output  |
| engineering | **physics-in-the-loop**                                    | design as a closed loop guided by explicit physical verification             |
| infra       | **agent-computer interface** (ACI, SWE-agent)              | tool layers designed for agent consumption: deterministic, fail-fast, narrow |

Key references:

- **Physics-in-the-Loop: A Hybrid Agentic Architecture for Validated CAD
  Engineering Design** — [arXiv:2605.19717](https://arxiv.org/abs/2605.19717).
  Names the pattern; agents plan/generate/evaluate/revise with knowledge-based
  tools as feedback.
- **Self-Improving CAD Generation Agents with FEA as Feedback** —
  [arXiv:2605.17448](https://arxiv.org/pdf/2605.17448). Independently converged
  on the same pipeline (CadQuery programs → STEP → CalculiX validation) and
  ships **Hephaestus-CCX**: a 50-case benchmark with CalculiX evaluation kits
  and typed pass/fail checkers.
- **LLM-empowered next-generation CAE** (survey) —
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0045782525008631).
  Six-level maturity model from ungrounded LLM to full closed-loop neurosymbolic
  integration.

## Where this implementation differs from the papers

1. **Model-driven, not prompt-driven.** The papers start from a natural-language
   prompt; this chain starts from a SysML v2 model with traced requirements. The
   MBSE ↔ geometry hop is nearly absent from the literature.
2. **Protocol-level providers, explicit product orchestration.** Paper harnesses
   are monolithic; these links remain independent MCP servers with
   provider-native data contracts. A reviewed backend DAG binds them into a
   causal product run; the browser does not compose tools or receive MCP
   authority.
3. **Units as values.** 2.5 kg against a 4 lb budget fails; most published
   verifiers compare bare numbers. Unit-blindness in an oracle is a
   false-positive machine, and false positives are worse than no oracle.
4. **Shipped infrastructure**, not paper artifacts: published JSR packages and
   digest-pinned GHCR images, reproducible on any machine with Docker.

## Where the papers are ahead — the open work

They **close the loop**: generate → physics feedback → revise, and they measure
the improvement. On the maturity scale this project sits at "grounded,
tool-verified"; the loop is not yet closed. The decisive next step is
`experiments/oracle/`: measure the modeling agent's correction rate with and
without the oracle chain — and Hephaestus-CCX provides a ready-made evaluation
protocol rather than one to invent.

## The pitch, in one line

**Model-driven, physics-in-the-loop engineering agents — an executable digital
thread from system model to computed proof.**

Internally, the founding formulation remains the best compass: _le calcul est
l'oracle, pas le produit._
