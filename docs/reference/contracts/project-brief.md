# Reference: living project brief

Audience: both · Diátaxis: reference · Kind: contract

> **Diátaxis category: reference.** This page describes the schema-`4.0` framing
> contract implemented by
> [`src/domain/project/project-brief.ts`](../../../src/domain/project/project-brief.ts)
> and stored inside each immutable `EngineeringProjectSnapshot` revision.

A project exists from the first reported intent. There is no pre-project aggregate,
Discovery page, or handoff in the current product contract. The paired conversation is
the authoring and review surface; the cockpit's **Project** tab is its passive, live
projection.

## Truth model

`framing.intent` records what the person or an exact document reported and who persisted
it. Questions are agent guidance, not requirements. Answers always cite a human, tool,
document, or expert source and may explicitly remain unknown.

The brief uses stable semantic item kinds such as objective, mission scenario, success
criterion, constraint, exclusion, jurisdiction, compliance target, observed fact,
assumption, open question, and proposed decision. Every item cites at least one source.
An assumption also names its owner and review trigger; an observed fact must cite a
tool, document, or expert rather than agent prose.

`currentBrief` is the latest human-approved canonical intent. `proposedBrief` is a newer
agent proposal. The latter never overwrites the former until the person confirms the
exact brief snapshot, revision, and SHA-256 fingerprint through signed MCP elicitation.
A rejection preserves the current canonical brief and leaves the proposed revision
visible for correction.

## Gates and their declared dependencies

A brief can be revised after evidence exists. Nothing represented which proofs relied on
which part of the mandate, so a revision either invalidated everything — and nobody
would ever revise a brief — or invalidated nothing, and proofs outlived the mandate that
authorised them. The brief now declares that structure itself.

```text
normative item ──dependsOn──> brief gate
                                 ↑
                            gateClaims
                                 │
                             work item
                                 │
                        run → evidenceRefs
```

The brief owns the dependencies; a work item only claims a gate; the run seals the
evidence. A revision invalidates the claim, not automatically the artifact.

**Gates are existing kinds.** `success-criterion` and `verification-activity` already
are gates; no `gate` kind was added. `isProjectBriefGateKind` is the single predicate.

**The contract is versioned.** `ProjectBriefRevision.contractVersion` is `"1.0"` or
`"2.0"`; an omitted field _is_ the historical V1 form, resolved by
`projectBriefContractVersion` rather than written into storage. Every new proposal is
V2. Making the field mandatory in place would have rejected every brief written under
the earlier contract.

**`dependsOnItemIds` is mandatory as a field, and an empty array is legal.** The three
states are distinct and must not be collapsed:

| State                                             | Meaning                           |
| ------------------------------------------------- | --------------------------------- |
| gate carries no `dependsOnItemIds` in a V2 brief  | incomplete contract → **refused** |
| `dependsOnItemIds: []`                            | independence **declared**         |
| item neither depended on nor declared independent | `impact-unresolved`               |

A gate may legitimately depend on no other item — `evidence-chain` is defined by its own
statement. Revising that statement still invalidates its claims, because a gate always
depends on its own fingerprint.

**`gateClaims` is a sibling of `operation`, never a binding.** Bindings are the exact
inputs an operation consumes (`EngineeringOperationInputBinding`); a served gate is a
coverage claim. Placing one among the inputs would assert a consumption that never
happened. Each claim is `{ gateItemId, role, status }` with role
`contributes-to | satisfies`, and every `gateItemId` must exist in the canonical brief
and name a gate, or the change is refused.

**Claim status is distinct from artifact freshness**: `current`, `impact-unresolved`,
`invalidated`, `carried-forward`. Not `superseded` before a replacement claim exists,
and not `unverified` — the proof _was_ verified, inside a scope that has since changed.
An artifact only becomes stale when its own technical content loses validity.

**Deliberately out of scope.** The signed impact transition between `brief r1 / gate r1`
and `brief r2 / gate r2` — the statement of what is invalidated, carried forward or
untouched — is not implemented. This page describes the foundation that records the
links, not a cascade that computes them. Half a cascade cannot be exercised.

## MCP surface

| Tool                       | Authority         | Effect                                                                           |
| -------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `project_start`            | Agent or human    | Create revision 1 immediately from plain-language intent                         |
| `project_snapshot`         | Read              | Read the complete immutable project revision                                     |
| `project_question_propose` | Agent             | Add one adaptive question, recommendation, consequences, risk, and evidence need |
| `project_answer_record`    | Agent or human    | Record one sourced answer or explicit unknown                                    |
| `project_brief_propose`    | Agent             | Add an immutable review proposal plus its server-derived `capabilityProposalFingerprint`; neither changes canonical intent nor selects a runtime |
| `project_brief_confirm`    | Human elicitation | Promote only the exact accepted proposal while echoing its exact `capabilityProposalFingerprint` |
| `project_capability_inspect` | Read            | Inspect the separate local operational authorization after brief confirmation    |
| `project_capability_change_review` | Read / human elicitation | Recheck the exact published-plan ceiling; a covered subset needs no prompt and does not shrink the ceiling, `withdrawUnused: true` may confirm a strictly subtractive unused-authority withdrawal, and a server-derived widening delta still requires exact signed confirmation |

Every mutation has a stable command ID, optimistic `expectedRevision` after project
creation, and stable issue time. An identical retry is idempotent; another payload under
the same command ID or a stale project revision fails closed.

## Boundary with MBSE and evidence

The brief owns stakeholder intent and project framing. Formal requirements,
architecture, geometry, simulation, measurements, requirement evaluations, BOM facts,
and certification evidence remain in their linked SysML/provider records and immutable
`ThreadSnapshot` evidence. The brief may cite those facts; it must not copy an agent
guess back as an observed result.

After approval, `project_plan_publish` binds the first reviewed path to the exact
approved brief. `baseline.from-approved-brief@1` then materializes a content-addressed
documentary baseline. That record proves which brief and plan were used; it is not
technical evidence by itself.

While a brief is pending, the server derives a provider-neutral
`project-capability-intent/1.0` from its `verification-activity` authorities and the
code-owned route/operation registry. It produces the reviewable `brief-intent`
capability proposal beside the brief; no pack, provider, image, endpoint, tool,
argument, or host effect is stored in `ProjectBriefRevision` or supplied by the caller.
The human confirmation authorizes that exact operational ceiling through the separate
[project capability authorization](../runtime/capability-packs/project-capability-authorization.md)
ledger; it is not a brief field.

After `project_plan_publish`, the server compiles the exact
`project-capability-demand/2.0` from registered work-item history and rechecks it against
that ceiling. See [project capability intent](../runtime/capability-packs/project-capability-intent.md)
and [project capability demand](../runtime/capability-packs/project-capability-demand.md).

The generic V3 bootstrap is deliberately additive and exact:

```text
human-approved living brief
  -> baseline.from-approved-brief@1
  -> documentary ThreadSnapshot r1
  -> architecture.seed-syson-model@2
  -> syson-model-seed-capture/2.0 + ThreadSnapshot r2
```

The r2 record proves only the identity of the editable SysON container. It is not
geometry, physical analysis, cost, compliance, or a verified requirement verdict.

The generic route no longer stops there. Reviewed operations continue it through
architecture, requirements, geometry, a sealed mechanical proof case and its execution
receipt; `desk-lamp-dl03` and `desk-lamp-dl04` walked that path end to end on
2026-08-10, each publishing a mechanical verdict on an isolated part. Every step still
needs its own reviewed operation and evidence contract — the route is generic, not
open-ended.
