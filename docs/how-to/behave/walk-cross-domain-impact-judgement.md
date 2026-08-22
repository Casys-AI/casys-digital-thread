# How-to: walk cross-domain impact judgement

Audience: both · Diátaxis: how-to · Kind: how-to

Walk an **already captured** closed `cross-domain-impact-manifest/1.0` through seal,
X07/X08 recross, human X09, and X11 mechanical preservation. The Workbench is
read-only. The person never types a provider tool. The agent queues only registered
operations.

Truth: [impact coverage](../../reference/domains/impact/coverage.md),
[impact boundedness](../../reference/domains/impact/boundedness.md),
[lookalike traps](../../reference/agent/lookalike-traps.md#cross-domain-impact).

## Literal gaps — do not invent a substitute

| Missing surface | What that means |
| --------------- | --------------- |
| Public manifest authoring/capture | No project-control tool accepts manifest bytes. The server-owned CAS reader reopens an opaque fingerprint already stored. Do not invent a capture command, JSON envelope, or manual CAS write. |
| Generic X10 rerun planner | X07/X08 fix `rerunProposals` to `none`. There is no registered thermal/electrical redispatch from impact. Independent Modelica or LED-fiche paths are not X10. ngspice is not a product run. |

Start only when a closed manifest for this `projectId` is already reopenable by
fingerprint. If `project_cross_domain_impact_manifest_seal_review` returns
`unavailable` / `manifest_unavailable`, stop.

## 0. Surfaces

Connect the agent to `http://127.0.0.1:3020/mcp`. Public reads that exist:

```bash
deno task mcp:call --name=project_cross_domain_impact_manifest_seal_review \
  --args='{"projectId":"<project-id>","manifestRef":{"fingerprint":{"algorithm":"sha256","digest":"<64-hex>"}}}'

deno task mcp:call --name=project_cross_domain_impact_decision_review \
  --args='{"projectId":"<project-id>"}'
```

There is no public X07 or X11 review compiler. Queue the registered operation; the
server selects the unique current Thread tip and unique prerequisite capture.

## 1. Seal the closed manifest (X06)

Call `project_cross_domain_impact_manifest_seal_review`. Stop on `unavailable` or
`unresolved`.

On `resolved`, append `verify.seal-cross-domain-impact-manifest@1` with the sole
`approvedBrief` binding and the returned `decisionParameters`:

```text
project_change_append → project_decision_propose → project_decision_approve
  → project_agent_run_queue → project_agent_run_execute
```

The seal is documentary. It does not evaluate a branch, change a gate claim, or call a
solver.

## 2. Recross without mutating claims (X07 / X08)

After that unique seal work item is complete, append
`analyze.evaluate-cross-domain-impact@1` (`requiresAdditiveChange`,
`dependsOn` the unique seal work item, `approvedBrief` binding). This operation
accepts **no** MRTR of its own.

Queue and execute. The run is X07 pure analysis plus X08 documentary capture. It
proposes `current`, `impact-unresolved`, `invalidated`, or `carried-forward`. It does
not apply those statuses, invent work items, or queue reruns.

## 3. Human applies the proposed claims (X09)

Call `project_cross_domain_impact_decision_review` with `projectId` only. Stop on
`unavailable` or `unresolved`.

On `resolved`, append `decide.accept-cross-domain-impact@1` (`mustOrigin: human`) with
the returned `decisionParameters`. Human MRTR, then agent queue and execute.

X09 `accept` applies the **already-proposed** statuses onto existing work-item claims.
It is not a product `pass`. There is no `decide.reject-cross-domain-impact@1`. Limits
stay `reruns: none` and `newWorkItems: none`.

## 4. Mechanical preservation (X11)

After the unique X09 decision is complete, append
`analyze.evaluate-mechanical-preservation@1` (`dependsOn` that decision work item,
`approvedBrief` binding, no MRTR of its own). Queue and execute.

`carried-forward` requires a current independence assertion covering the exact
inspected FEA inputs and the unique accepted static-mechanical L5 closeout of that
execution. Otherwise the capture keeps literal `impact-unresolved`. Absence of a
mechanical causal edge is never proof. No CalculiX call.

Static-mechanical L5 is a separate human walk:
[Review static-mechanical closeout](review-static-mechanical-closeout.md).
X11 rereads that accepted closeout; it does not create it.

## What this walk does not do

- Author or capture a manifest.
- X10 reruns of invalidated electrical or thermal branches.
- Treat electrical `impact-unresolved` as an ngspice implementation gap to paper over.
- Conflate mechanical all-pass L5 eligibility with Modelica both-choice L5.
- Command the Workbench.
