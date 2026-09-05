# Reference: assembly integrity

Audience: both · Diátaxis: reference · Kind: contract

Assembly integrity is a narrow, post-publication evidence family over one exact current
`geometry-module-capture/1.0` and its canonical assembly STEP. It has three distinct
levels:

```text
L3 factual observation → L4 deterministic evaluation → L5 human closeout
```

None of these levels creates CAD geometry or substitutes for the admitted CAD export.
The operational procedure is
[Verify assembly integrity](../../../how-to/verify-design/verify-assembly-integrity.md).

## L3: factual observation only

`project_assembly_integrity_review` is a read-only preparation tool. It accepts only a
project id, an exact current Thread snapshot basis, and the exact primary
geometry-module identity. It selects the profile and configured runtime server-side,
then returns the closed append/proposal material for
`verify.observe-assembly-integrity@1`. It does not call a provider, write a Thread
successor, or produce a verdict.

The registered L3 operation first reopens the
[exact static assembly basis](static-assembly-basis.md), then adds this family's method,
bounds, and server-owned observer profile. `assembly-integrity-observation/1.0` records
these normalized facts and their provenance:

| Fact group            | L3 records                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input identity        | Exact module capture, canonical STEP, structure and placement bases, factual method/profile, configured runtime, and raw request/response provenance |
| Import and topology   | Importability, unit system, solid count, BRep validity, shell count, degenerate-edge count, and free-edge count where observable                     |
| Immediate occurrences | Each expected target, expected placement and matrix, and the observed placement and matrix                                                           |
| Immediate pairs       | Each pair's minimum distance, intersection volume, and contact state                                                                                 |

`observed`, `unavailable`, and `unresolved` remain literal fact states. L3 does not
compare the facts with a criterion and does not infer a result from a missing field. The
configured runtime is a reviewed identity, not proof that it received a call; only the
recorded raw provenance can establish that provider event. Its durable sequence is
`dispatched` → `capture-recorded` → `completed`. Once a dispatch is durable without an
exact capture, the provider outcome is unknown and the server does not retry it
automatically.

## L4: five provider-free criteria

`project_assembly_integrity_evaluation_review` accepts only `projectId`. It recrosses
one fresh L3 capture and its exact module/STEP inputs, then supplies the closed proposal
for the zero-binding `verify.evaluate-assembly-integrity@1` operation. L4 never calls
the provider and never accepts provider, tool, tolerance, fact, rule, or verdict input
from a caller.

The resulting `assembly-integrity-evaluation-capture/1.0` is a custom evaluation
capture, not a generic requirement evaluation. It has exactly these criteria:

| Criterion               | `pass`                                                                                                                  | `fail`                                                        | `unresolved`                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `assembly-import`       | Import is observed as `imported` and solid count is at least 1                                                          | Import is observed as `failed`, or the exact solid count is 0 | Any other import or solid-count state                               |
| `occurrence-coverage`   | The exact expected immediate-occurrence cardinality is at least 1 and every expected target is observed                 | No direct fail case                                           | Missing, unavailable, or incomplete expected occurrence observation |
| `placement-recross`     | Every exact occurrence transform is observed and equals the bundle-derived expected matrix at structural epsilon `1e-9` | An observed matrix differs                                    | A transform or expected occurrence is missing or unavailable        |
| `brep-validity`         | BRep validity is observed as valid                                                                                      | BRep validity is observed as invalid                          | BRep validity is unavailable or unresolved                          |
| `pairwise-intersection` | The exact `n(n−1)/2` immediate-pair set is present and every observed intersection volume is exactly `0`                | Any observed intersection volume is strictly positive         | A pair, volume, or expected cardinality is missing or unknown       |

The aggregate precedence is `fail`, then `unresolved`, then `pass`. The expected
occurrence matrix is derived one-way from the bundle placement: millimetre translation
after `Rx * Ry * Rz`. The label `right-handed-mm-extrinsic-xyz-degrees` is not enough
by itself. The fixed matrix epsilon is representation equivalence, not a clearance
allowance. Pairwise minimum distance and contact are L3 diagnostics; they are not an L4
clearance, joint, or assemblability criterion.

Every L4 capture also carries these method limits as literals: `providerCalls` and
`genericSysmlRequirementEvaluation` are `none`; `safety`, `physicalJoints`, `clearance`,
`motion`, `load`, and `fabricability` are `not-evaluated`. A later closeout cannot
broaden those fields.

An L4 work item is an exact zero-binding leaf with the L3 work item as its mandatory
dependency. It must use the fresh current Thread tip and current human-approved Brief
V2. Its optional gate claims may only be `contributes-to/current` an existing current
Brief V2 gate; L4 never satisfies a gate.

## L5: human gate closeout

`project_assembly_integrity_evaluation_closeout_review` accepts only `projectId`. It
reopens the unique fresh L4 result whose result snapshot equals the current Thread tip,
then recrosses the L4 capture, L3 observation, module, and STEP. It returns closed human
consequences; it selects no gate, provider, tolerance, work item, or disposition.

| Human consequence | Registered operation                            | Availability and gate rule                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accept            | `decide.accept-assembly-integrity-evaluation@1` | Returned only when all five L4 criteria are literal `pass`. A claim may only `satisfies/current` an existing current Brief V2 gate. Without that claim, no gate is satisfied.                                       |
| Reject            | `decide.reject-assembly-integrity-evaluation@1` | Always returned. Its disposition is `none` when all criteria pass, otherwise `assembly-integrity-review-required`. It may omit gate claims or only `contributes-to/current` a current gate; it never satisfies one. |

The person chooses one returned consequence, then signs its MRTR. The L5 work must be a
newly appended, human-origin (`mustOrigin: "human"`) item based on the exact L4 result
snapshot, dependent on the exact L4 work item, and use the sole `approvedBrief` binding.
Execution writes a documentary `assembly-integrity-evaluation-closeout/1.0` Thread
successor. It does not call a provider or SysON.

## Provider boundary and replacement

The raw
[`build123d_observe_assembly_integrity`](https://github.com/Casys-AI/mcp-build123d)
capability is public `mcp-build123d` functionality. It is not a Digital Thread public
command and its provider request/response shape is not repeated here.

Digital Thread instead depends on a provider-neutral assembly-observer port and a
server-owned, versioned profile. The present Build123d integration is a provider-named
adapter behind that boundary; callers cannot choose its provider, tool, profile,
runtime, endpoint, arguments, or fallback. A CATIA or OpenShape adapter may replace it
only by implementing the same neutral port and gaining its own reviewed profile and
runtime proof. An absent or unqualified adapter is `unavailable`, not a reason to fall
back to local OCCT, sandbox execution, or a caller-selected provider.

At a strict provider boundary, the server must project the selected profile to the
consumer's accepted shape explicitly. Profile extension fields are not portable merely
because they are valid on the server side. Preserve a rejected attempt as historical
friction; only a later captured observation, with its raw request/response provenance,
is L3 evidence.

## Explicit non-claims

This family does not prove or grant any of the following:

- complete assembly definition, assembly mapping, component manufacture, fit-up, joints,
  required contact, required clearance, motion, kinematics, load capacity, strength,
  fatigue, thermal behavior, routing, fabrication, safety, certification, or product
  fitness;
- a CAD correction, FEA run, provider rerun, SysON mutation, or an automatic remedy
  after an L4 failure or an L5 rejection;
- an L5 decision from provider success, an L3 fact, an L4 `pass`, a configured runtime,
  or a work item's `executed` status.

Availability is a server-composition and evidence question. This contract alone does not
mean that a particular project has an L3 capture, L4 evaluation, or L5 closeout.

## Mechanism boundary

The exact module and STEP are reopened through the profile-free
[static assembly basis](static-assembly-basis.md). Static integrity then adds its own
bundle, method, bounds, and provider profile.

Kinematics is not a richer provider profile for this port. It has a separate bounded
vertical with explicit bodies, frames, joints, limits, sampled scenarios, capture,
evaluation, and Brief verification authority; see
[mechanism](../mechanism/README.md). It still does not turn static non-intersection into
a motion, contact, clearance, forces, strength, safety, or manufacturability claim.

The mechanism catalogue baseline is `unqualified`. A particular host may carry an exact
qualified emulated AMD64 attestation, but that host fact neither rewrites the catalogue
nor makes an L3 product observation. Product L3 separately needs project authorization,
a sealed ROP, a current Thread basis, and a JIT lease. Static assembly integrity does not
establish any of those prerequisites, and its L3/L4/L5 evidence never establishes motion.
