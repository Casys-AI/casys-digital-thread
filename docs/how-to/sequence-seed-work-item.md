# How-to: sequence a SysON model-seed work item

Three sequencing rules govern work items that call `architecture.seed-syson-model@2`.
Violating any of them either blocks execution permanently or leaves an orphan work item in
"Next current work".

## Rule 1 — Seed via append, not initial plan

`architecture.seed-syson-model@2` carries `requiredPlanningLineage: "change-append"` in
its executor. The guard reads the run's `changeIds` field; it is only populated by
`project_change_append`, not by `project_plan_publish`. A seed work item in the initial
plan will reach `ready` status but never execute: the executor rejects it with
`planning_lineage_violation`.

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

## Rule 3 — Closing an orphan with direct reconciliation

When rule 1 was violated, the seed work item stays `ready` forever because its executor
rejects it. The fix is:

1. Append the correct seed work item via `project_change_append` (rule 1 now satisfied).
2. Execute the new work item through the normal queue → execute path.
3. Close the orphan work item with `project_work_item_reconcile_successor` once the
   successor run is complete and its result snapshot is the current project thread head.

```text
project_work_item_reconcile_successor:
  failedWorkItemId  : "wi-seed"          ← the orphan in ready status
  failedRunId       : "run:wi-seed-..."  ← the rejected run (failure recorded)
  successorRunId    : "run:wi-seed-2-..." ← the completed successor run
  successorRunSnapshot: <current thread head>
  successorEvidenceRefs: [...]            ← from the completed successor run
  rationale: "wi-seed was rejected by the lineage guard; wi-seed-2 introduced
              via change-append completed the equivalent seed operation."
```

The reconciliation closes the orphan work item (`cancelled`) without touching either run
history. The failed run stays failed; the successor retains its evidence. Phase
completion counts the cancelled-and-reconciled item as done through
`successorEvidenceRefs`.

## Concrete example — DL-01 project

The desk-lamp-dl01 project surfaced this pattern during its first agent path test:

- Initial plan included `wi-seed` (operation `architecture.seed-syson-model@2`).
- `project_agent_run_execute` on `wi-seed` was rejected with `planning_lineage_violation`
  because the run's `changeIds` was empty (no append in its lineage).
- A `project_change_append` correctly introduced `wi-seed-2` with the same operation and
  a co-declared required decision.
- `wi-seed-2` executed successfully; its result became the project thread head.
- `project_work_item_reconcile_successor` closed `wi-seed` with `wi-seed-2` as successor.

The project phase completed because `successorEvidenceRefs` from `wi-seed-2` satisfied
the phase evidence invariant through the reconciliation record.

## Design note — why no closeout snapshot for direct reconciliation

The `project_work_item_reconcile_successor` MCP tool always uses the direct reconciliation
path: no separate closeout `ThreadSnapshot` is produced. The successor run's result is
already the project thread head, so recording a redundant closeout snapshot would advance
the thread revision without adding evidence.

The full closeout path (which does produce a closeout snapshot) is used only by the CM-01
V3 R11/R12 history, where an explicit closeout snapshot was already committed before this
tool existed. Both forms satisfy the phase completion invariant through
`successorEvidenceRefs`.
