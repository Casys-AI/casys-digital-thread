# How-to: verify assembly integrity

Audience: both · Diátaxis: how-to · Kind: how-to

Use this runbook to take one **current canonical assembly module** through factual L3,
provider-free L4, and a human L5 closeout. It never asks a person to select a provider,
tool, tolerance, or CAD payload. L3 first reopens the
[exact static assembly basis](../../reference/domains/cad/static-assembly-basis.md). For
the contract and limits, see
[Assembly integrity](../../reference/domains/cad/assembly-integrity.md).

## 1. Establish the exact current leaf

Start with `project_snapshot`. Record, without aliases or `latest`:

- the unique current Thread snapshot basis and its revision;
- the exact primary `geometry-<sha256>` module artifact and fingerprint;
- a current human-approved Brief V2 and the existing gate that may be cited;
- the unique planned work-item and decision identities returned by each review.

For the complete L3–L5 path, the Brief V2 must be current. No review invents a gate. L3
and L4 can only make an optional `contributes-to/current` claim against an existing
current Brief V2 gate; L5 accept is the only step that may `satisfies/current` one.

The same assembly moves through three **successive current** Thread tips:

| Stage | Required current input                                              | Operation and output                                                        |
| ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| L3    | `T0`: exact current module and canonical assembly STEP              | `verify.observe-assembly-integrity@1` publishes factual observation at `T1` |
| L4    | `T1`: now-current L3 result, with its exact L3 work-item dependency | `verify.evaluate-assembly-integrity@1` publishes evaluation at `T2`         |
| L5    | `T2`: now-current L4 result, with its exact L4 work-item dependency | A human accept or reject closeout publishes documentary closeout at `T3`    |

Stop if any named basis is no longer the unique current tip. Re-read the snapshot and
start the affected review again; do not reuse a historical `T0`, `T1`, or `T2`.

## 2. Prepare and execute L3

Call `project_assembly_integrity_review` with only `projectId`, the exact `T0`
thread-snapshot basis, and its exact primary `geometryModule` identity. It is read-only.
On `unavailable` or `unresolved`, do not append a lookalike work item.

On `resolved`, use the review's exact material in this order:

```text
project_change_append          # only when next.append is present
  → project_decision_propose   # paste next.propose.arguments
  → project_decision_approve   # human MRTR
  → project_agent_run_queue
  → project_agent_run_execute  # agent-origin registered dispatcher
```

If the review returns only `next.propose`, it selected one eligible existing leaf. Do
not append another. That L3 leaf must be the unique non-predecessor lifecycle leaf for
the exact operation and binding, be `waiting-for-decision`, have one proposal-ready
decision and exact current basis change, and have no ambiguous gate claim. If it has a
gate claim, that claim must point to the current approved Brief V2. The registered
operation is `verify.observe-assembly-integrity@1`; the review, not the agent, supplies
the closed decision parameters.

After execution, obtain the new current tip `T1`. A provider reply is not itself L4.

## 3. Prepare and execute L4

At current `T1`, append exactly one `verify.evaluate-assembly-integrity@1` work item: it
has zero bindings, depends on the exact L3 work-item id, uses the current Brief V2, and
is the sole pending leaf in its activity: no successor, no competing leaf,
`waiting-for-decision`, and exactly one pending decision. Then call
`project_assembly_integrity_evaluation_review` with only `projectId`.

The review returns only `next.propose`; paste it and finish the normal sequence:

```text
project_change_append → project_assembly_integrity_evaluation_review
  → project_decision_propose → project_decision_approve
  → project_agent_run_queue → project_agent_run_execute
```

Do not provide observation facts, a provider, a tool, a tolerance, a rule, or a verdict.
The server rereads the exact L3 observation and its canonical inputs. On completion,
read the new current `T2`; its L4 result is `pass`, `fail`, or `unresolved`, never L5.

## 4. Have the human close out L5

At current `T2`, call `project_assembly_integrity_evaluation_closeout_review` with only
`projectId`. It is read-only and returns `unavailable` or `unresolved` unless it can
select one fresh current L4 capture and recross all predecessor evidence.

Present the returned consequences to the responsible person:

| Choice | Operation                                       | Rule                                                     |
| ------ | ----------------------------------------------- | -------------------------------------------------------- |
| Accept | `decide.accept-assembly-integrity-evaluation@1` | Available only when every L4 criterion is literal `pass` |
| Reject | `decide.reject-assembly-integrity-evaluation@1` | Always available; it grants no remedy                    |

After the person chooses, paste that branch's `next.append.arguments` into
`project_change_append`, then that same branch's `next.propose.arguments` into
`project_decision_propose`. Both envelopes are complete except `issuedAt`.
`deno task mcp:call` fills omitted `issuedAt` because each envelope already has
`commandId`. A direct client must add `issuedAt` before calling either mutation.
`next.propose.arguments.expectedRevision` is the project revision after that successful
append — one successful `project_change_append` advances exactly one revision. A stale
or concurrent head fails closed; do not invent a revision. The server-derived leaf is a
new human-origin item (`mustOrigin: "human"`) based on exact `T2`, dependent on the
exact L4 work-item id, with the sole `approvedBrief` binding. Obtain the human MRTR,
queue, then use `project_agent_run_execute` with the required signed human confirmation.
An accept claim may only `satisfies/current` an existing current Brief V2 gate; reject
never does.

## 5. Recover without changing the evidence meaning

- A lost acknowledgement before durable dispatch: reread `project_snapshot` and the run
  receipt; do not append a duplicate leaf merely because the client timed out.
- L3 at durable `dispatched` with no exact capture: treat the provider outcome as
  unknown. Do not auto-retry. Inspect and reconcile the provider state through
  [Recover a quarantined provider run](../run/recover-a-quarantined-provider-run.md).
- L3 at `capture-recorded` or `completed`: recovery reopens the exact capture; it must
  not call the provider again.
- If an L3 profile projection is rejected at a strict provider boundary, retain that run
  as historical friction. Correct the server-side projection, then obtain a new review
  and queue a successor; do not relabel the rejected attempt as a provider observation.
- L4 recovery is deterministic over the exact capture. It must reuse that capture rather
  than replace facts or change criteria.
- L5 recovery reopens the exact closeout capture only while the L4 result is still fresh
  and current. If the Thread advanced or evidence is stale, start a successor review;
  never mutate the historical closeout.

If a run is merely queued, `project_agent_run_cancel` requires the signed human
confirmation before cancellation. It is not a provider recovery or a substitute for a
human L5 decision.

## What a completed path still does not prove

The five L4 criteria address importability, immediate occurrence coverage and placement,
BRep validity, and positive pairwise interference only. They do not prove joints,
required contact or clearance, physical assemblability, motion, loads, strength, safety,
certification, fabrication, or product fitness.
