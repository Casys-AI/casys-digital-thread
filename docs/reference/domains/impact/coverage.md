# Reference: impact coverage

Audience: both · Diátaxis: reference · Kind: scope

This is the current production surface of the impact bounded context. A slice label, a
fixture, or a successful solver call is not a product capability by itself.

## Identifiers

| Token | Authority | Shape |
| ----- | --------- | ----- |
| Causal `changeKinds` | Closed manifest body | Document-defined `safeId` tokens from `sourceAnchors`. Lexicographically canonical. Not a code catalog, not free prose, not `threadChange.kind`. |
| Branch IDs | Closed manifest body | Document-defined `safeId` tokens declared on that manifest. Nonempty, unique, lexicographically canonical. Not a global catalogue. Extra or missing branch data at capture fails closed. Independence assertions and X11 preservation are legal only for the exact id `mechanical`. |

`threadChange.kind` stays the Thread mutation vocabulary (`created`, `modified`,
`deleted`, `archived`). Do not copy a causal `changeKind` into that field.

## X04–X11 inventory

| Slice | Status | Current product boundary |
| ----- | ------ | ------------------------ |
| X04 | Supported | Outbound ports under `src/application/ports/out/impact/`: manifest store (save + opaque read), Thread lineage, Brief V2 gates, capture stores, L5 closeout reader. No MCP provider client, no Workbench write. |
| X05 | Supported | Draft-capture and recross use cases under `src/application/use-cases/impact/` plus CAS/Thread adapters under `src/adapters/impact/`. Invalid capture fails closed. Recross mismatch stays `unavailable` or `unresolved`. |
| X06 | Supported | Public `project_cross_domain_impact_manifest_capture` writes draft CAS only (full `resourceRef` → opaque `{ fingerprint }`). Read-only `project_cross_domain_impact_manifest_seal_review` (`projectId` + that reference) then registered `verify.seal-cross-domain-impact-manifest@2`. Every manifest `gateMap` entry must resolve exactly one current work-item `gateClaim` with the same role; missing, mismatched or ambiguous claims stop `unresolved`. Seal publishes identities; it does not evaluate a branch. Capture is not a registered operation. |
| X07 | Supported | Pure analysis: registered `analyze.evaluate-cross-domain-impact@2`. It reopens the X06 seal named by the current work revision's required `dependsOn` leaf (never `latest`/label/recency; archived seals stay history). It rechecks the same current `gateMap`/`gateClaim` relation before analysis. Internal command is not an agent JSON envelope. Proposes branch and gate-claim statuses. Mutates none. |
| X08 | Supported | Documentary Thread capture of that X07 recross (`cross-domain-impact-evaluation-capture/2.0`). Missing, mismatched or ambiguous gate claims stop before the evaluation capture; `workItemInvalidations` and `rerunProposals` are literal `none`. |
| X09 | Bounded | Read-only `project_cross_domain_impact_decision_review` (`projectId` only) then human-origin `decide.accept-cross-domain-impact@2`. It recrosses the sealed result before applying already-proposed statuses onto existing work-item claims. No `decide.reject-cross-domain-impact@1`. |
| X10 | `unavailable` | No registered rerun planner, no public review, no generic thermal/electrical redispatch from impact. X07/X08 keep `rerunProposals: none`. Independent admitted Modelica or admitted SPICE walks are not X10. `mcp-spice` is not a product run. |
| X11 | Supported | Registered `analyze.evaluate-mechanical-preservation@2` after X09. Recrosses exact FEA proof/closeout identities and the reviewed independence assertion. Result is `carried-forward` or literal `impact-unresolved`. No CalculiX call. |

## Distinctions that must not collapse

| Slice | What it is | What it is not |
| ----- | ---------- | -------------- |
| X07 | Pure recross of the sealed manifest against current Thread/brief facts. Outcomes are proposed gate-claim link states. | A human decision, a claim mutation, a rerun, or an engineering `pass`/`fail`. |
| X08 | Persistence of that recross as one documentary Thread artifact plus CAS capture. | Authority to invalidate work items or to queue replacement methods. |
| X09 | Human application of those already-proposed statuses onto existing claims. Completes only its own decision work item. | Work-item invention, invalidation, X10, X11, or a solver/provider call. |
| X10 | Not implemented as a generic product surface. | An implied follow-on of `invalidated`. Do not invent a planner, JSON envelope, or CAS hack. |
| X11 | Provider-free mechanical preservation after X09. `carried-forward` needs a current independence assertion covering the exact inspected FEA inputs and the unique accepted L5 closeout of that execution. Absence of a mechanical causal edge is never proof. | A CalculiX rerun, a global unique closeout, thermal/electrical verdict, or implicit `pass`. |

A nonmechanical declared branch with `method.available = false` stays
`impact-unresolved` even when a positive causal edge exists. That is bounded
readiness, not a named-domain switch. An available admitted SPICE or Modelica
method still does not make X10 exist.

## Public and registered surfaces

Project-control tools that exist:

- `project_cross_domain_impact_manifest_capture` (draft CAS write; full `resourceRef` only)
- `project_cross_domain_impact_manifest_seal_review` (read-only; `projectId` + opaque capture reference)
- `project_cross_domain_impact_decision_review`

Registered operations that exist:

- `verify.seal-cross-domain-impact-manifest@2`
- `analyze.evaluate-cross-domain-impact@2` (X07 analysis + X08 capture)
- `decide.accept-cross-domain-impact@2` (X09, `mustOrigin: human`)
- `analyze.evaluate-mechanical-preservation@2` (X11)

Draft capture writes immutable CAS only. Pass `result.reference` as `manifestRef` to
the seal review; never pass `sourceText`, the review envelope, a path, or a
caller-selected fingerprint. The server recrosses project/subject/current Thread/Brief
gates/evidence at seal review time. A human-shaped assertion in draft JSON is not
proof until signed MRTR for `verify.seal-cross-domain-impact-manifest@2`. There is no
`project_cross_domain_impact_evaluation_review` and no X11 review compiler: the agent
queues the registered operation. Its current work revision names the prerequisite
through the required `dependsOn` leaf. That completed document may have been produced
on an ancestor of the unique current tip; reuse requires exact descendant lineage plus
a byte-identical, `fresh`, unarchived artifact on the tip.

Static-mechanical L5 is a sibling FEA surface, not an impact slice:
`project_evaluation_closeout_review` then `decide.accept-evaluation-closeout@1` /
`decide.reject-evaluation-closeout@1`. See
[Review static-mechanical closeout](../../../how-to/verify-design/close-out-a-static-mechanical-proof.md).

## Outside the current surface

- Caller-selected branch, edge, artifact, status, provider, tool, or solver argument.
- A Workbench `POST`, MCP App command, or UI selection used as a join key.
- Treating X09 `accept` as a product `pass`, or treating X07 proposals as applied claims.
- Inferring mechanical preservation from omitted edges or from thermal/electrical evidence.
- Isolated, preview, or draft STEP as canonical geometry for X11.
- Treating draft capture as a Thread artifact, MRTR, L4/L5 result, or dispatch grant.
- Generic X10 reruns of invalidated electrical or thermal branches.
