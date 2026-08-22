# Reference: impact coverage

Audience: both · Diátaxis: reference · Kind: scope

This is the current production surface of the impact bounded context. A slice label, a
fixture, or a successful solver call is not a product capability by itself.

## Identifiers

| Token | Authority | Shape |
| ----- | --------- | ----- |
| Causal `changeKinds` | Closed manifest body | Document-defined `safeId` tokens from `sourceAnchors`. Lexicographically canonical. Not a code catalog, not free prose, not `threadChange.kind`. |
| Branch IDs | Protocol | Exactly `electrical`, `thermal`, `mechanical`. Callers do not invent a fourth branch. |

`threadChange.kind` stays the Thread mutation vocabulary (`created`, `modified`,
`deleted`, `archived`). Do not copy a causal `changeKind` into that field.

## X04–X11 inventory

| Slice | Status | Current product boundary |
| ----- | ------ | ------------------------ |
| X04 | Supported | Outbound ports under `src/application/ports/out/impact/`: manifest reader, Thread lineage, Brief V2 gates, capture stores, L5 closeout reader. No MCP provider client, no Workbench write. |
| X05 | Supported | Server recross use cases under `src/application/use-cases/impact/` plus CAS/Thread adapters under `src/adapters/impact/`. Mismatch stays `unavailable` or `unresolved`. |
| X06 | Supported | Read-only `project_cross_domain_impact_manifest_seal_review` (`projectId` + opaque manifest fingerprint) then registered `verify.seal-cross-domain-impact-manifest@1`. Seal publishes identities; it does not evaluate a branch. |
| X07 | Supported | Pure analysis: registered `analyze.evaluate-cross-domain-impact@1`. Internal command is not an agent JSON envelope. Proposes branch and gate-claim statuses. Mutates none. |
| X08 | Supported | Documentary Thread capture of that X07 recross (`cross-domain-impact-evaluation-capture/1.0`). `workItemInvalidations` and `rerunProposals` are literal `none`. |
| X09 | Bounded | Read-only `project_cross_domain_impact_decision_review` (`projectId` only) then human-origin `decide.accept-cross-domain-impact@1`. Applies the already-proposed statuses onto existing work-item claims. No `decide.reject-cross-domain-impact@1`. |
| X10 | `unavailable` | No registered rerun planner, no public review, no generic thermal/electrical redispatch from impact. X07/X08 keep `rerunProposals: none`. Independent Modelica or LED-fiche paths are not X10. ngspice is not a product run. |
| X11 | Supported | Registered `analyze.evaluate-mechanical-preservation@1` after X09. Recrosses exact FEA proof/closeout identities and the reviewed independence assertion. Result is `carried-forward` or literal `impact-unresolved`. No CalculiX call. |

## Distinctions that must not collapse

| Slice | What it is | What it is not |
| ----- | ---------- | -------------- |
| X07 | Pure recross of the sealed manifest against current Thread/brief facts. Outcomes are proposed gate-claim link states. | A human decision, a claim mutation, a rerun, or an engineering `pass`/`fail`. |
| X08 | Persistence of that recross as one documentary Thread artifact plus CAS capture. | Authority to invalidate work items or to queue replacement methods. |
| X09 | Human application of those already-proposed statuses onto existing claims. Completes only its own decision work item. | Work-item invention, invalidation, X10, X11, or a solver/provider call. |
| X10 | Not implemented as a generic product surface. | An implied follow-on of `invalidated`. Do not invent a planner, JSON envelope, or CAS hack. |
| X11 | Provider-free mechanical preservation after X09. `carried-forward` needs a current independence assertion covering the exact inspected FEA inputs and the unique accepted L5 closeout of that execution. Absence of a mechanical causal edge is never proof. | A CalculiX rerun, a global unique closeout, thermal/electrical verdict, or implicit `pass`. |

Electrical or thermal `method.available = false` keeps that branch
`impact-unresolved` even when a positive causal edge exists. That is bounded
readiness, not an implemented electrical/ngspice run.

## Public and registered surfaces

Read-only project-control tools that exist:

- `project_cross_domain_impact_manifest_seal_review`
- `project_cross_domain_impact_decision_review`

Registered operations that exist:

- `verify.seal-cross-domain-impact-manifest@1`
- `analyze.evaluate-cross-domain-impact@1` (X07 analysis + X08 capture)
- `decide.accept-cross-domain-impact@1` (X09, `mustOrigin: human`)
- `analyze.evaluate-mechanical-preservation@1` (X11)

There is no public manifest authoring or capture tool. Composition records that no MCP
tool accepts manifest bytes; the seal review reopens an already stored opaque
fingerprint. There is no `project_cross_domain_impact_evaluation_review` and no X11
review compiler: the agent queues the registered operation; the server selects the
unique current Thread tip and unique prerequisite capture.

Static-mechanical L5 is a sibling FEA surface, not an impact slice:
`project_evaluation_closeout_review` then `decide.accept-evaluation-closeout@1` /
`decide.reject-evaluation-closeout@1`. See
[Review static-mechanical closeout](../../../how-to/behave/review-static-mechanical-closeout.md).

## Outside the current surface

- Caller-selected branch, edge, artifact, status, provider, tool, or solver argument.
- A Workbench `POST`, MCP App command, or UI selection used as a join key.
- Treating X09 `accept` as a product `pass`, or treating X07 proposals as applied claims.
- Inferring mechanical preservation from omitted edges or from thermal/electrical evidence.
- Isolated, preview, or draft STEP as canonical geometry for X11.
- A public capture of `cross-domain-impact-manifest/1.0` bytes.
- Generic X10 reruns of invalidated electrical or thermal branches.
