# How-to: recover a prescribed-kinematics observation

Audience: both · Diátaxis: how-to · Kind: how-to

Use this guide after the L3 run failed with
`verify-run-prescribed-kinematics-provider-outcome-unknown`, or after a historical
`prescribed-kinematics-execution-failed` run whose exact L3 WAL recrosses as terminal
`quarantined` (including `malformed`). The server computes that extra eligibility from
the sealed ROP and WAL; do not supply it. The failure says that a provider outcome could
not be proved after the one allowed dispatch; it is not a failed mechanism verdict and
does not turn samples into Thread evidence.

For the exact state machine, read
[prescribed-kinematics observation recovery](../../reference/pipeline/prescribed-kinematics-observation-recovery.md).
For the generic human authority ceremony, read
[recover a quarantined provider run](recover-a-quarantined-provider-run.md).

## 1. Freeze the failed attempt

Read `project_snapshot` and retain the exact failed run id, failure code, request/basis
identity, and any server-provided receipt or WAL information. Do not cancel and recreate
the failed run to make it look clean. The shared Thread-write guard deliberately blocks
sibling writers on the same basis while this state is unresolved.

Do not call Chrono directly, repeat the provider run, reset the WAL, or invent a receipt.
After the durable L3 dispatch boundary, only the server can perform same-request
readback; after the terminal failure, recovery is a human reconciliation, not an
operator-triggered redispatch.

## 2. Make the human reconciliation decision

Append the registered human work item `record.reconcile-uncertain-writer@1` and use its
generated, exact MRTR parameters. The person must record an auditable attestation of the
approved provider-state inspection and choose exactly one conclusion:

| Conclusion | Meaning |
| --- | --- |
| `provider-did-not-write` | The person found no durable effect that a successor observation would duplicate or contradict. |
| `write-effect-accepted` | A provider effect may exist but was not captured as L3 evidence. |

The reconciled run remains failed in either case. Reconciliation is neither an L3
observation nor an L4/L5 decision.

## 3. Release the basis only when the server permits it

For `provider-did-not-write`, let the existing reconciliation and current-basis guards
decide whether a successor can be planned. For `write-effect-accepted`, obtain the
separate server-derived, human-approved Thread-basis release decision before planning
another writer on that basis. Do not infer that the reconciliation alone released it.

If the Thread has advanced, work from the new declared head; do not force the old basis
back into service.

## 4. Create a successor, not a retry

Append a successor work-item revision and take it through the ordinary review, MRTR,
queue, and registered-execution flow. It has a new run/request identity and must satisfy
the current project authorization, sealed ROP, exact host evidence, Thread basis, and JIT
lease checks.

The failed run and its quarantine remain historical evidence. No manual Chrono call,
blind redispatch, or direct provider inspection can turn them into a recorded L3 fact.
