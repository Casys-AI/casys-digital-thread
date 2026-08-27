# How-to: review cross-domain impact

Audience: both · Diátaxis: how-to · Kind: how-to

Review a closed `cross-domain-impact-manifest/2.0` from public draft capture through
seal, X07/X08 recross, human X09, and X11 mechanical preservation. The Workbench is
read-only. The person never types a provider tool. The agent queues only registered
operations. The JSON body declares its own branch list: nonempty unique
lexicographic `safeId` tokens, not a global catalogue. Extra or missing branch
data fails closed. Independence assertions remain legal only for the exact id
`mechanical`.

Truth: [impact coverage](../../reference/domains/impact/coverage.md),
[impact boundedness](../../reference/domains/impact/boundedness.md),
[lookalike traps](../../reference/agent/lookalike-traps.md#cross-domain-impact).

## Literal gaps — do not invent a substitute

| Missing surface | What that means |
| --------------- | --------------- |
| Generic X10 rerun planner | X07/X08 fix `rerunProposals` to `none`. There is no registered thermal/electrical redispatch from impact. Independent admitted Modelica or admitted SPICE walks are not X10. |

Draft capture is public: `project_resource_capture` then
`project_cross_domain_impact_manifest_capture` with that full `resourceRef`. Pass
`result.reference` as `manifestRef`. If
`project_cross_domain_impact_manifest_seal_review` returns `unavailable` /
`manifest_unavailable`, stop.

## 0. Connect to the control surface

Connect the agent to `http://127.0.0.1:3020/mcp`. Public surfaces that exist:

```bash
deno task mcp:call --name=project_cross_domain_impact_manifest_capture \
  --args='{"resourceRef":{}}'

deno task mcp:call --name=project_cross_domain_impact_manifest_seal_review \
  --args='{"projectId":"<project-id>","manifestRef":{"fingerprint":{"algorithm":"sha256","digest":"<opaque-capture-digest>"}}}'

deno task mcp:call --name=project_cross_domain_impact_decision_review \
  --args='{"projectId":"<project-id>"}'
```

There is no public X07 or X11 review compiler. Queue the registered operation. Its
current work revision names the prerequisite through the required `dependsOn` leaf.
The completed document may come from an ancestor result only while the unique current
tip remains its exact descendant and carries the same `fresh`, unarchived artifact.

## 1. Capture the closed manifest body

Upload the JSON body with `project_resource_capture`, then call
`project_cross_domain_impact_manifest_capture` with that full `resourceRef`. Exact
`cross-domain-impact-manifest/2.0` body keys, no `fingerprint` field, and a
declared nonempty unique lexicographic branch list. The server
canonicalizes, computes the embedded body fingerprint and the outer CAS fingerprint, and
returns `status: captured`, opaque `reference.fingerprint`, a summary of exact
ids/revision/basis/`changeKinds`, and `grants: none`. Do not echo or persist a path or
URI. Same bytes are deterministic.

Pass only `result.reference` as later `manifestRef`. A human-shaped assertion in that
JSON is not proof.

## 2. Seal the closed manifest (X06)

Call `project_cross_domain_impact_manifest_seal_review` with `projectId` and that opaque
reference. The server recrosses project/subject/current Thread, Brief V2 gates, and
declared evidence. Each manifest `gateMap` entry must resolve exactly one current
work-item `gateClaim` with the same role. Missing, mismatched or ambiguous claims stop
`unresolved`. Stop on `unavailable` or `unresolved`.

On `resolved`, append `verify.seal-cross-domain-impact-manifest@2` with the sole
`approvedBrief` binding and the returned `decisionParameters`:

```text
project_change_append → project_decision_propose → project_decision_approve
  → project_agent_run_queue → project_agent_run_execute
```

The seal is documentary. It does not evaluate a branch, change a gate claim, or call a
solver.

## 3. Recross without mutating claims (X07 / X08)

After that unique seal work item is complete, append
`analyze.evaluate-cross-domain-impact@2` (`requiresAdditiveChange`,
`dependsOn` the unique seal work item, `approvedBrief` binding). This operation
accepts **no** MRTR of its own.

Queue and execute. X07 reopens the X06 seal named by the current evaluation work
revision's required `dependsOn` leaf, including on a later descendant retry of that
same activity. It never selects a seal by label, timestamp, recency, or `latest`.
Archived seals stay history. X07/X08 recheck that every manifest `gateMap` still
resolves exactly one current same-role `gateClaim`; a missing, mismatched or ambiguous
mapping stops
`unresolved` before evaluation capture. A successful run is X07 pure analysis plus X08
documentary capture. It proposes `current`, `impact-unresolved`, `invalidated`, or
`carried-forward`. It does not apply those statuses, invent work items, or queue reruns.

## 4. Human applies the proposed claims (X09)

Call `project_cross_domain_impact_decision_review` with `projectId` only. X09 recrosses
the sealed result itself; stop on `unavailable` or `unresolved`.

On `resolved`, append `decide.accept-cross-domain-impact@2` (`mustOrigin: human`) with
the returned `decisionParameters`. Human MRTR, then agent queue and execute.

X09 `accept` applies the **already-proposed** statuses onto existing work-item claims.
It is not a product `pass`. There is no `decide.reject-cross-domain-impact@1`. Limits
stay `reruns: none` and `newWorkItems: none`.

## 5. Mechanical preservation (X11)

After the unique X09 decision is complete, append
`analyze.evaluate-mechanical-preservation@2` (`dependsOn` that decision work item,
`approvedBrief` binding, no MRTR of its own). Queue and execute.

`carried-forward` requires a current independence assertion covering the exact
inspected FEA inputs and the unique accepted static-mechanical L5 closeout of that
execution. Otherwise the capture keeps literal `impact-unresolved`. Absence of a
mechanical causal edge is never proof. No CalculiX call.

Static-mechanical L5 is a separate human review:
[Close out a static mechanical proof](close-out-a-static-mechanical-proof.md).
X11 rereads that accepted closeout; it does not create it.

## What this impact review does not do

- Treat draft capture as a Thread artifact, approval, L4/L5 result, or dispatch grant.
- Let the caller select fingerprints, CAS paths, provider, tool, args, or runtime.
- X10 reruns of invalidated electrical or thermal branches.
- Treat electrical `impact-unresolved` as an ngspice implementation gap to paper over.
- Treat X09 `invalidated` as an automatic admitted SPICE or Modelica redispatch.
- Conflate mechanical all-pass L5 eligibility with Modelica both-choice L5.
- Command the Workbench.
