# How-to: close out a static mechanical proof

Audience: both · Diátaxis: how-to · Kind: how-to

Record a human L5 over one current static FEA `@3` branch. Use this after
`verify.run-fea-static-proof@3` has published exact L4 criteria on the unique current
Thread tip. The Workbench is read-only. The person never types a provider tool.

This is **not** Modelica L5. Admitted Modelica always offers both accept and reject
from the unique current L4. Mechanical **accept** is offered only when every declared
L4 criterion is literal `pass`. Do not copy one family's eligibility onto the other.

Domain: [FEA coverage](../../reference/domains/fea/coverage.md),
[impact boundedness](../../reference/domains/impact/boundedness.md).

## 0. Connect to the control surface

Connect the agent to `http://127.0.0.1:3020/mcp`. Loopback reads:

```bash
deno task mcp:call --name=project_evaluation_closeout_review \
  --args='{"projectId":"<project-id>"}'
```

The public tool accepts **only** `projectId`. Extra keys stay `unavailable`. The server
selects the unique current Thread tip and reopens the exact canonical STEP, sealed
proof, isolated execution evidence, L4 evaluation capture, criteria, proof limitations,
producer runs, and freshness. It grants no solver, SysON, CAD, correction, provider
tool, argument, URI, threshold, or result.

## 1. Read the review

Stop if `status` is `unavailable` or `unresolved`. Do not invent a closeout.

On `resolved`, read `selected` first:

| Field | Meaning |
| ----- | ------- |
| `family` | Always `static-mechanical` |
| `criteria[].status` | Literal L4 `pass`, `fail`, `unresolved`, or `error` |
| `acceptanceEligibility` | `true` only when every declared criterion is literal `pass` |
| `accept` | Present **only** when eligibility is true. Closed MRTR parameters for `decide.accept-evaluation-closeout@1` |
| `reject` | Always present. Closed MRTR parameters for `decide.reject-evaluation-closeout@1` |

An L4 `pass` is never L5. Provider success is never L4 and never L5.

`reject.admission.rejectionDisposition` is `none` when every criterion is `pass`, else
`mechanical-review-required`. Both dispositions grant `none`: no correction, CAD, FEA,
engine, or SysON action.

## 2. Human chooses; agent queues the registered operation

Signed sequence for either consequence:

```text
project_change_append          # work item + required decision together
  → project_decision_propose   # paste the review's decisionParameters
  → project_decision_approve   # human MRTR
  → project_agent_run_queue
  → project_agent_run_execute  # registered agent dispatcher only
```

| Human choice | Registered operation | When it is legal |
| ------------ | -------------------- | ---------------- |
| Accept | `decide.accept-evaluation-closeout@1` | `selected.accept` is present: every L4 criterion is literal `pass` |
| Reject | `decide.reject-evaluation-closeout@1` | Always, including after an all-`pass` L4 |

Use the sole `approvedBrief` binding. Do not type criterion limits, measured values, or
artifact ids. Paste the review parameters; the executor recrosses the same identities.

The executor refuses a non-agent origin and refuses execution without the exact
human-signed MRTR. Dispatch is not the L5 disposition.

## 3. What reject does not do

Reject writes a documentary Thread successor. It does **not** grant
`design.apply-vector-correction@1`, CAD, FEA, SysON, or a provider rerun. A later
correction still needs a study-base **fail** that cites
`sensitivity-base-<metric>-<digest>`. A proof-run evaluation cannot authorize that.

## What this closeout does not do

- Cross-domain impact. Separate review:
  [Review cross-domain impact](review-cross-domain-impact.md).
- Modelica L5 (`project_admitted_modelica_evaluation_closeout_review`). Both
  consequences are always derived there; L4 `pass` is still not L5.
- Make or buy.
