# How-to: recover a quarantined provider run

Audience: both · Diátaxis: how-to · Kind: how-to

> **Diátaxis category: how-to.** This guide assumes you already know the run lifecycle
> in the [`EngineeringProjectSnapshot` reference](../../reference/contracts/engineering-project.md).
> It covers one task: getting a project moving again after a provider acknowledged a
> dispatch and the run failed before publishing evidence.

## When you are in this situation

The run's terminal receipt says the dispatch was acknowledged but evidence was not
published, and the run may not be retried automatically. Any sibling run on the same
basis is now refused with a message naming the uncertain writer.

That combination is deliberate. The provider was told to do something; the executor
cannot prove what came of it; retrying blindly could duplicate a durable effect. Only a
person who has looked at the provider can settle it.

Read the receipt first. It carries the structural cause verbatim, so you usually learn
why the publication failed before touching anything.

## 1. Inspect the provider, for real

Establish whether anything durable escaped the thread. For a compute-only provider such
as CalculiX this is usually a short check: the container is up, the staged input is
present and still matches its content address, no working directory remains, and the
write-ahead record shows whether the solve completed.

Use the recorded request id with the server-owned recovery path. The provider is
owned by the sealed `casys-mcp-calculix` launch group, not by the repository
Compose project, so a root-Compose container id is neither an input nor a
recovery authority.

`/inputs` is a provider-private, content-addressed staging volume, not the CAD exchange
or a ledger. It may survive a container restart, but its contents are never evidence and
do not settle the provider outcome; use the write-ahead record and recorded-run resources
for that.

For a sensitivity run, the write-ahead record under
`state/local/fea-sensitivity-attempts/` records each phase as `prepared`, `dispatched`,
`readback-recorded`, `captured`, or known terminal `rejected`. A prepared or dispatched
request is never reset or reissued: reopen it with the same request id through
`calculix_run_get`. A completed attempt with a quarantine file beside it means the
provider evidence was captured and later publication failed — a different situation from
an unknown dispatch.

Decide the outcome from what you saw:

- `provider-did-not-write` — no durable effect exists outside the thread that a fresh
  dispatch could duplicate or contradict;
- `write-effect-accepted` — the provider may have produced output that was never
  captured. This opens a blocker that must be resolved before requeueing from the same
  basis.

## 2. Free the project of any queued run

A project refuses an appended change while an agent run is active. If a run is sitting
in `queued`, cancel it first — cancellation before any claim is the narrow inverse of
queueing and touches no provider.

```
project_agent_run_cancel  → signed human confirmation → cancelled
```

## 3. Append the reconciliation work item

One work item, owner `human`, operation `record.reconcile-uncertain-writer@1`, with the
single `approvedBrief` binding and one required decision.

## 4. Approve the MRTR — all seven parameters

The decision is refused unless it carries every one of these. The first four are the
ones most often forgotten because they are constants rather than facts about your
incident:

| Parameter                  | Value                                                     |
| -------------------------- | --------------------------------------------------------- |
| `reconcileAction`          | `resolve-uncertain-writer`                                |
| `reconcileOperation`       | `record.reconcile-uncertain-writer@1`                     |
| `reconcileRunId`           | the exact failed run                                      |
| `reconcileFailureCode`     | the exact terminal failure code from the receipt          |
| `reconcileBasisSnapshotId` | the failed run's basis snapshot, exactly                  |
| `reconcileOutcome`         | `provider-did-not-write` or `write-effect-accepted`       |
| `reconcileAttestation`     | what you inspected, by what means, and what you concluded |

Write the attestation as a record someone else can audit later. Name the container, the
paths, the digests you compared and the write-ahead state you read. "Provider checked"
is not an attestation.

## 5. Execute it yourself

The operation is human-only: `project_agent_run_execute` recognises
`mustOrigin: "human"` in the registry and asks the paired MCP host for a signed
confirmation before dispatching under a human origin. An agent-originated call is
refused at the executor gate.

Once it completes, the annotation is attached to the failed run. The failed run stays
failed — reconciliation records a judgement, it never converts a failure into a success.
The original failed work item becomes terminal `cancelled` for either outcome and cannot
be queued again. `provider-did-not-write` can release the basis only while its exact
signed MRTR ceremony remains valid. `write-effect-accepted` deliberately keeps the basis
locked and creates a separate server-fixed release decision linked to the blocker.

## 6. Approve the basis release when the write effect was accepted

For `write-effect-accepted`, propose the generated release decision with all eleven
exact parameters:

| Parameter                  | Value                                                         |
| -------------------------- | ------------------------------------------------------------- |
| `releaseAction`            | `release-thread-write-basis`                                  |
| `releaseOutcome`           | `approved-after-provider-state-review`                        |
| `failedRunId`              | the exact accepted failed run                                 |
| `failureCode`              | that run's exact terminal failure code                        |
| `subjectId`                | the failed run basis subject                                  |
| `snapshotId`               | the failed run basis snapshot                                 |
| `revision`                 | the failed run basis revision, as an integer                  |
| `blockerId`                | the exact server-generated release blocker                    |
| `reconciliationDecisionId` | the exact approved reconciliation decision                    |
| `reconciliationOutcome`    | `write-effect-accepted`                                       |
| `releaseAttestation`       | a non-empty, agent-proposed statement for the human to review |

The release attestation is not a server observation or provider proof: it becomes
authority only when the human reviews and signs the exact proposal. The project-control
surface cross-checks every other value against the failed run and basis before recording
the proposal. A later signed human approval resolves the blocker. The write guard then
re-hashes both decision proposals and verifies their exact human approvals; a legacy or
partial record stays blocked.

## 7. Requeue the work

Append a successor work-item revision for the retry and take it through the normal path:
propose, approve, queue, execute. The original work item keeps its failed run in
history; do not make it `ready` again. After the successor has completed with exact
evidence, the separate successor-reconciliation closeout may record that relation on the
cancelled original work item. That successor must name the cancelled work item directly
through `predecessorRevisionId`; a same-activity sibling is not a recovery successor.

## What this procedure is not

It does not repair the defect that caused the failure. If the structural cause in the
receipt points at your own code — an invalid snapshot, a missing attestation — fix that
first, restart the server so the executor is reloaded, and only then spend a
reconciliation. Reconciling in a loop against an unfixed defect just accumulates
attestations for the same incident.
