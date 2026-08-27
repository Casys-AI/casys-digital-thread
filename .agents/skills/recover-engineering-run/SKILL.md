---
name: recover-engineering-run
description: Diagnose and govern recovery of a Casys Digital Thread run quarantined after a provider acknowledged dispatch but evidence was not published. Use when a terminal receipt names an uncertain writer, a sibling run is refused on the same basis, or the user asks to reconcile a quarantined provider write. Do not use for ordinary failed runs or queued-run cancellation alone.
---

# Recover a quarantined engineering run

Restore safe progress without turning an uncertain provider outcome into guessed
evidence or an agent decision.

## Load the current authority

Read these before acting:

- [`AGENTS.md`](../../../AGENTS.md);
- [recover a quarantined provider run](../../../docs/how-to/run/recover-a-quarantined-provider-run.md);
- [agent workspace](../../../docs/reference/agent/agent-workspace.md).

Read `project_snapshot` and the exact terminal receipt. Use current persisted
identities, never `latest`, labels, directory order, or remembered values. If
documentation, registered operations, persisted state, and runtime observations
disagree, report the disagreement instead of reconciling it yourself.

Once an eligible failed run is identified, read
[recovery gates](references/recovery-gates.md) before any mutation.

## Work in two phases

### Establish the incident without mutation

Record the exact failed run id, terminal failure code, basis subject, snapshot id,
revision, receipt cause, and any persisted reconciliation or release blocker. Keep
receipt facts, WAL/runtime observations, and human conclusions separate.

Help the human inspect the provider using the current recovery procedure. Read-only
diagnostics may inform that inspection, but an agent observation is not the required
human provider inspection. Do not choose between `provider-did-not-write` and
`write-effect-accepted`, sign an attestation, retry the run, restart a service, clean
provider state, or delete evidence.

Present the two outcomes literally and ask the human for:

- the outcome they concluded after inspection;
- what they inspected and by what means;
- the paths, content digests, and write-ahead state involved.

### Continue only through governed project control

After the human supplies an explicit outcome and an auditable attestation:

1. If another run is still `queued`, request its narrow cancellation through
   `project_agent_run_cancel` and wait for signed human confirmation.
2. Append exactly one human-owned work item for the currently registered
   `record.reconcile-uncertain-writer@1`, using only its `approvedBrief` binding and one
   required decision.
3. Prepare the exact seven-field MRTR from the current recovery procedure and persisted
   failed-run facts. Never infer the outcome or improve the human's conclusion.
4. Continue only after the exact proposal receives verified human approval.
5. Queue through project control, then invoke execution only through the paired
   human-confirmation path. Never spoof human origin or bypass `mustOrigin: "human"`.
6. Reread `project_snapshot`. The original run must remain failed.

For `write-effect-accepted`, the basis remains blocked. Prepare the server-fixed
eleven-field release proposal and an explicitly agent-proposed release attestation for
human review. Do not requeue until the separate release decision is signed and the
persisted snapshot proves the blocker resolved.

For `provider-did-not-write`, do not assume the basis was released: verify it from the
reread snapshot and exact signed ceremony.

Requeue the original work only through a new work item after the structural defect is
fixed and persisted state proves the basis writable.

## Report each gate

Return:

- exact incident facts;
- non-authoritative diagnostics;
- the human conclusion, if supplied;
- the current blocking gate;
- the next authorized action;
- any remaining literal evidence state, including `unavailable`, `unresolved`, `error`,
  `TRACE GAP`, or `UNLINKED`.
