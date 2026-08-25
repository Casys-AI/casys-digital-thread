# How-to: sequence a SysON model-seed work item

Audience: agent · Diátaxis: how-to · Kind: how-to

Four sequencing rules govern work items that call `architecture.seed-syson-model@2`.
Violating any of them either blocks the append, blocks execution, or leaves an orphan
work item in "Next current work".

## Rule 1 — Seed via append, not initial plan

`architecture.seed-syson-model@2` carries `requiresAdditiveChange` and
`requiredPlanningLineage: "change-append"`. `project_plan_publish` refuses a seed in the
initial plan. The executor still rejects a historical initial-plan seed with
`planning_lineage_violation` because `changeIds` is only populated by
`project_change_append`.

**Do:**

```text
project_plan_publish  ← initial phases, non-seed work items
project_change_append ← adds the seed work item and its required decision
```

**Do not:**

```text
project_plan_publish ← includes the seed work item ← executor will reject it
```

## Rule 2 — Append first, sign after

A work item in a `project_change_append` payload can only reference `decisionIds` that
are declared in the **same append call**. Decisions from the initial plan are not
available to append-introduced work items, because the append is anchored to a specific
`baseSnapshot` and the cross-reference validator checks lineage.

This means the conversation that introduces the seed work item and the decision that
governs it must happen in a single `project_change_append`. The human signs the decision
(`project_decision_approve`) only after the append is committed. The ordering is:

1. `project_change_append` — introduces phase, work item and required decision together.
2. Agent proposes the decision via `project_decision_propose`.
3. Human approves via `project_decision_approve` (MCP elicitation flow).
4. Agent queues the work item via `project_agent_run_queue`.
5. Agent executes via `project_agent_run_execute`.

## Rule 3 — Seed must name the unique baseline at append

`architecture.seed-syson-model@2` carries `requiresDependsOnOperation` for
`baseline.from-approved-brief@1`. `project_change_append` refuses unless
`dependsOnWorkItemIds` includes that unique existing work item.

**Do:**

```text
dependsOnWorkItemIds: ["<id of the unique baseline.from-approved-brief@1 work item>"]
```

**Do not:**

```text
dependsOnWorkItemIds: []   ← append refuses; do not queue, execute, or reconcile this
```

A historical seed accepted before this guard can still reach `ready` and fail at
`project_agent_run_execute`. Close it with Rule 4 after appending a correct successor.

## Rule 4 — Closing an orphan with direct reconciliation

When rule 1 or rule 3 was violated, the seed work item stays `ready` because its
executor rejects it. New appends cannot omit `dependsOn`. The fix sequence for a
historical orphan is:

1. A human cancels the queued-but-rejected run via `project_agent_run_cancel`. This is a
   prerequisite — reconciliation is **not** a substitute for cancellation. A run that is
   still `queued` cannot be used as `failedRunId`.
2. Append the correct seed work item via `project_change_append` (rules 1 and 3).
3. Execute the new work item through the normal queue → execute path.
4. Close the orphan with `deno task recover:work-item-successor` once the successor
   run is complete. This is operator recovery, not a project-control tool.

The runner accepts two forms of "failed" anchor:

- A run that **failed with a recorded failure** and produced no durable evidence
  (`status: "failed"`, `failure` present, `evidenceRefs: []`).
- A run that was **cancelled before any agent claim** — the executor rejected the
  planning lineage so the run was never handed to a provider (`status: "cancelled"`,
  `claimedAt` absent, `startedAt` absent, `evidenceRefs: []`). This is the DL-01 case.

In both forms the run never produced durable evidence, so closing through a successor is
safe.

```text
deno task recover:work-item-successor --project-id=<id>
deno task recover:work-item-successor --project-id=<id> \
  --failed-work-item-id=wi-seed \
  --failed-run-id=run:wi-seed-... \
  --successor-run-id=run:wi-seed-2-... \
  --rationale='wi-seed omitted dependsOn; wi-seed-2 completed the seed.' \
  --apply
```

Default is inspect. `--apply` persists. The script derives the successor snapshot and
evidence from the named completed run.

The reconciliation closes the orphan work item (`cancelled`) without touching either run
history. The failed or pre-claim-cancelled run keeps its original status; the successor
retains its evidence. Phase completion counts the cancelled-and-reconciled item as done
through `successorEvidenceRefs`.

## Concrete example — DL-01 project

The desk-lamp-dl01 project surfaced this pattern during its first agent path test:

- Initial plan included `wi-seed` (operation `architecture.seed-syson-model@2`).
- `project_agent_run_execute` on `wi-seed` was rejected with
  `planning_lineage_violation` because the run's `changeIds` was empty (no append in its
  lineage). The executor rejected the run before any agent claim, so it remained
  `queued`.
- A human cancelled the queued run (`project_agent_run_cancel`) so it could serve as the
  reconciliation anchor. The cancelled run never touched a provider.
- A `project_change_append` correctly introduced `wi-seed-2` with the same operation and
  a co-declared required decision.
- `wi-seed-2` executed successfully; its result became the project thread head.
- `deno task recover:work-item-successor --apply` closed `wi-seed` using the
  pre-claim cancelled run as `--failed-run-id` and `wi-seed-2` as
  `--successor-run-id`.

The project phase completed because `successorEvidenceRefs` from `wi-seed-2` satisfied
the phase evidence invariant through the reconciliation record.

## Design note — why no closeout snapshot for direct reconciliation

The recovery runner always uses the direct reconciliation path: no separate closeout
`ThreadSnapshot` is produced. The successor run's result is already the project thread
head, so recording a redundant closeout snapshot would advance the thread revision
without adding evidence.

No product-specific closeout path is active. Direct reconciliation satisfies the phase
completion invariant through `successorEvidenceRefs` without manufacturing technical
evidence.
