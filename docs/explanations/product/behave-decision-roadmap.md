# Explanation: Behave decision roadmap

Audience: both · Diátaxis: explanation · Kind: roadmap

This roadmap grows a product that helps a person make a bounded engineering decision.
It is not an API inventory, a promise that every native solver feature is available, or
a certification plan. A decision concerns one exact project revision; source capture,
an operation being queued, and a solver exit are not that decision.

## Current position and first reference vertical

The current Behave surface can admit parameterized closed-subset CAD, seal a canonical
part STEP, run one catalogued linear-static proof case in a fixed Gmsh/CalculiX profile,
and have the SysON constraint oracle evaluate declared displacement and stress criteria.
The Modelica admitted path produces separately documentary simulation observations. The
current covered surfaces and their exclusions are authoritative in [CAD
coverage](../../reference/domains/cad/coverage.md), [FEA
coverage](../../reference/domains/fea/coverage.md), [SysML
coverage](../../reference/domains/sysml/coverage.md), and [Modelica
coverage](../../reference/domains/modelica/coverage.md).

`cantilever-arm-ca02` is the proposed first **mechanical-family** reference vertical:
one isolated, parameterized rectangular cantilever part and a linear-static check of
declared maximum displacement and von Mises stress. Its catalogued declaration itself
limits the evidence to concept verification: it excludes certification, material
release, joints, fatigue, stability and fabrication. It is **provisional**, not a
completed product proof.

A separate local observation, not a replacement of that CA02 horizon, is
`articulated-led-desk-lamp-al01` on the primary atelier (project r227 / Thread r26):
distinct mechanical, thermal, and electrical L3–L5 records plus one reviewed impact
recross. G6 is a proposed shared coupling input for a future re-run, not a thermal
result. X10 stays `unavailable`. Tracking:
[AL01 status](../../project-dossiers/articulated-led-desk-lamp/status.md). That walk is not
physical safety, compliance, lifetime, brightness, manufacturing, or vendor validity.

Before using CA02 as the reference, a human must confirm that this isolated-part scope,
the declared assumptions, and its two criteria are the intended first engineering
question. The agent must not turn that confirmation into a solver payload, a material
choice, or a release claim.

## Maturity is the maturity of a decision

| Level | A person can honestly say | Required basis | Still not established |
| --- | --- | --- | --- |
| **L1 — framed** | “We have identified the question and its limits.” | Exact project/source identities, explicit unknowns and the intended engineering question. | A method, result, or conclusion. |
| **L2 — reviewable** | “I can approve this bounded method and its consequential inputs.” | A server-derived proposal bound to the current revision, declared criteria and assumptions, and the required human MRTR. | That a run occurred or a criterion passed. |
| **L3 — evidenced** | “This exact admitted input was executed and can be inspected or replayed.” | Sealed admission, fixed lowering/runtime, validated outputs, receipt, lineage and recovery/replay evidence. | A requirement verdict, safety, manufacturability or release. |
| **L4 — evaluated** | “The named criterion passed, failed, or remains explicitly unresolved for this exact evidence.” | Oracle evaluation of declared criteria on the exact evidence and canonical STEP lineage, including units and margins where the oracle defines them. | A cross-branch Make/Buy conclusion, certification, or permission to silently alter geometry. |
| **L5 — decided** | “The responsible human accepted or rejected the stated consequence of this L4 result.” | The L4 record, its stated scope/limits and an explicit human decision recorded against that exact revision. | A general product guarantee or a decision for a successor geometry. |

`pass` belongs at L4; it is not L5. A new canonical STEP supersedes its Behave evidence,
and each re-run needs its own review. These levels deliberately preserve the separate
Behave, Make and Buy judgement branches.

## Definition of done

A Behave vertical is done at L5 only when it has one complete, inspectable chain:

```text
bounded question → human-confirmed method → admitted source and canonical STEP
  → separate reviewed proof/run → validated evidence and replay → oracle evaluation
  → human decision with stated scope
```

Every link must name exact, rereadable artifacts. A missing join, unproven recovery,
`unresolved`, `error`, or unavailable provider remains that literal state. A displayed
result, a static catalog row, a parser success, or private isolated CAD output cannot
fill a missing link.

## Three concrete horizons

### Horizon 1 — establish the CA02 reference decision

Move the human-confirmed CA02 scope through L1–L5 without expanding the current method:
parameterized admitted source, canonical part STEP, the existing linear-static proof
declaration, distinct seal/run reviews, evidence/replay, then exact oracle evaluation.
The closing human decision is deliberately narrow: whether the result is usable as the
reference example within its declared isolated-part boundary. It is not a claim about a
real assembly, a manufactured part, or another judgement branch.

**Done:** the complete chain above is inspectable from one project revision, including a
replay that does not redispatch the solver; both the L4 evaluation and L5 human decision
retain their limits. If the initial confirmation is not given, CA02 stays provisional and
the horizon is not done.

### Horizon 2 — ratchet the existing vertical across instances

Use the unchanged closed CAD, proof-case and oracle contracts on additional
human-selected simple mechanical parts. Each new instance supplies only project data and
source: its brief/architecture bindings, parameterized CAD source, reviewed catalogued
case and MRTRs. The server still owns parsing, lowering, provider selection, execution
and recovery.

**Done:** at least three distinct simple-part products, including the reference, have
independent L5 decisions with their limits intact, with no per-project code branch or
agent-selected envelope. A counterexample that falls outside the current surface is
recorded as a gap; it is not forced through as a special case.

### Horizon 3 — decide whether the family is reusable

Continue to three to five human-selected simple mechanical products only while the same
decision pattern remains meaningful: a canonical single part, bounded linear-static
assumptions, named criteria, and an explicit human consequence. Compare the resulting
L1–L5 records for recurring missing inputs, ambiguous assumptions and correction needs.
Then decide whether to keep the family bounded, extend one shared capability, or stop
claiming that the family is a useful product route.

**Done:** the product has evidence from three to five independent instances, an explicit
statement of the common scope and exclusions, and a human decision on the next shared
investment. Repetition alone never widens the covered language or FEA method.

## Ratchet rule: instance data versus shared capability

| Situation | Change permitted | Change forbidden |
| --- | --- | --- |
| A new part fits every current closed grammar and proof schema. | New source and project/catalog data, then normal review and MRTR. | A project-specific parser, worker, solver option or provider envelope. |
| The part requires a form, value semantics, analysis family, material model, criterion or recovery rule outside coverage. | A separately approved shared extension: closed contract → parser/analysis or schema → server-owned lowering → worker/output validation → oracle → replay, then coverage update. | Hiding the new capability in a JSON row, an MRTR free-text field, a special-case branch, or native provider availability. |

This is the product ratchet: a new *instance* is source/data only; a new *capability* is
shared code and an end-to-end authority proof. Candidate examples—richer CAD forms,
value-bearing SysML, non-static mechanics, or Modelica component composition—remain
candidates until that complete path exists.

## Resolving the old oracle-coverage claim

The older [oracle coverage roadmap](../verification/verification-coverage-roadmap.md) is a dated
market-demand hypothesis. Its `30 % → 55 % → 80 %` figures and claim of a “nearly-free”
native CalculiX jump are not Behave maturity or present product coverage. The current FEA
contract is linear-static only; any additional physics first follows the full
contract-to-replay extension path. This roadmap therefore uses no percentage target and
does not place modal, creep, or thermo-mechanics on a delivery horizon.
