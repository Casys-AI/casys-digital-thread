# Impact boundedness inventory

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory of authority and fail-closed recross for the impact bounded context. It
does not invent a limit. Status words: **enforced**, **physical-only**, **unbounded**,
**needs decision**. Labels `unavailable`, `unresolved`, `impact-unresolved`,
`documentary`, `TRACE GAP`, and `UNLINKED` stay literal.

Sibling: [coverage](coverage.md). Shared isolation:
[isolation and Thread boundedness](../../runtime/isolation-and-thread-boundedness.md).

## Authority

| Actor | Owns here | Must not |
| ----- | --------- | -------- |
| Human | Consequential X06 seal MRTR, X09 claim application, and static-mechanical L5 closeout | Author solver payloads, provider envelopes, or invented gate statuses |
| Agent | Queue and execute **registered** operations after the required human decision | Choose provider/tool/args, self-approve MRTR, invent a branch, or apply X09 |
| Server | Unique Thread tip, unique captures, Brief V2 gates, profiles, recross, CAS | Accept `latest`, caller-selected runtimes, or a branch id absent from the sealed manifest |
| Workbench | Read-only `GET` + SSE projection | Receive commands, MCP authority, or provider credentials |

X07 and X11 are documentary (`riskClass: low`): they take the `approvedBrief` binding,
require an additive change and the unique predecessor operation, and accept **no** MRTR
of their own. X09 is `mustOrigin: human`. Static-mechanical L5 is agent-dispatched only
after the exact human-signed closeout MRTR; dispatch is not the L5 disposition.

No impact port, use case, executor, or project-control tool holds a provider client,
solver grant, ngspice/OMC/CalculiX/SysON envelope, or Workbench write.

## Fail-closed recross

Authority:
[`cross-domain-impact-manifest.ts`](../../../../src/domain/impact/cross-domain-impact-manifest.ts),
[`cross-domain-impact-evaluation.ts`](../../../../src/domain/impact/cross-domain-impact-evaluation.ts),
[`cross-domain-impact-decision.ts`](../../../../src/domain/impact/cross-domain-impact-decision.ts),
[`cross-domain-impact-mechanical-preservation.ts`](../../../../src/domain/impact/cross-domain-impact-mechanical-preservation.ts).

| Surface | Today | Status |
| ------- | ----- | ------ |
| Extra JSON keys | `exactRecord` refuses | Enforced |
| Manifest body fingerprint | SHA-256 of canonical body; digest mismatch refused | Enforced |
| Branch set | Manifest-local nonempty unique lexicographic `safeId` list; exact set equality both directions at capture | Enforced |
| Causal `changeKinds` | Non-empty unique `safeId`; each has an exact `sourceAnchor`; lexicographic order | Enforced uniqueness; **unbounded** count |
| Causal edges | Positive `positive-input` only; exact branch input fingerprint | Enforced; no negative edge; **unbounded** count |
| Independence assertions | Human author; `assertion: independent`; exact inspected anchors/consumptions; legal only for `mechanical` | Enforced shape; **unbounded** count |
| Gate-claim statuses | `current` \| `impact-unresolved` \| `invalidated` \| `carried-forward` | Enforced. Never `pass`/`fail` |
| X07/X08 limits | `providerCalls`, `solverCalls`, `gateClaimTransitions`, `workItemInvalidations`, `rerunProposals` = `none` | Enforced |
| X09 claim map | Each proposed gate-claim recrosses exactly one existing work-item claim | Enforced; missing/ambiguous/mismatched refused |
| X09 limits | `providerCalls`, `solverCalls`, `reruns`, `newWorkItems` = `none` | Enforced |
| X11 `carried-forward` | Current mechanical independence assertion + exact fresh `@3` evidence + unique accepted closeout of that execution | Enforced; otherwise literal `impact-unresolved` |
| Public capture input | Full `resourceRef` only; JSON object; exact body keys; no fingerprint/extra key; max 262144 bytes | Enforced |
| Public review input | Seal review: `projectId` + opaque capture `{ fingerprint }`. Decision/L5 reviews: `projectId` only | Enforced |

Review diagnostics stay `unavailable` (cannot reopen) or `unresolved` (reopened but
inexact). Never relabel those as `resolved`.

CAS roots live under `state/local/recorded-analysis/impact/`. Public capture
`resourceRef` payload is capped at 262144 bytes. The file adapter has no separate
code-owned byte ceiling beyond that public parser (**unbounded** storage size once
admitted; needs a product/storage decision). Do not treat a directory listing or
“latest file” as authority.

## What this context does not grant

- Provider, solver, tool, argument, URI, threshold, or result selection.
- Workbench mutation or MCP App command path.
- Caller-computed fingerprints, CAS paths/URIs, or treating draft capture as proof.
- A generic X10 rerun planner.
- Mechanical preservation by omission of a causal edge.
- Implicit L5 from an L4 `pass`.
