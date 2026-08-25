# Recovery gates

This checklist controls stopping behavior. The public
[recovery procedure](../../../../docs/how-to/run/recover-a-quarantined-provider-run.md)
remains authoritative for operation fields and sequence.

## Incident identity gate

Continue only when one terminal failed run is identified by:

- exact run id;
- exact terminal failure code from its receipt;
- exact basis subject, snapshot id, and revision;
- a receipt showing acknowledged dispatch without published evidence;
- current reconciliation and release-blocker state.

Stop on ambiguity, missing receipt data, an ordinary provider failure, a nonterminal
run, or a different recovery family.

## Human inspection gate

The agent may organize facts but cannot settle provider state. Continue only after the
human explicitly supplies one literal outcome:

- `provider-did-not-write`; or
- `write-effect-accepted`.

The attestation must name what was inspected, how it was inspected, relevant container
or provider identity, paths, content digests, and WAL state. Stop on a vague statement
such as "provider checked", an agent-only inference, or contradictory observations.

Do not restart, retry, delete, clean, or otherwise alter provider state while gathering
the inspection record.

## Mutation gates

| Intended action                 | Continue only when                                                                          | Otherwise |
| ------------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| Cancel a queued run             | Exact run selected and signed human confirmation returned                                   | Stop      |
| Append reconciliation work      | No active run blocks the change; exact registered operation and binding are current         | Stop      |
| Propose reconciliation MRTR     | All seven current fields match the failed run and human inspection                          | Stop      |
| Execute reconciliation          | Exact MRTR is human-approved and execution obtains verified human origin                    | Stop      |
| Release an accepted-write basis | Exact server-generated blocker and all eleven release fields are present and human-approved | Stop      |
| Requeue work                    | Defect is fixed and a reread snapshot proves the basis writable                             | Stop      |

A stale, partial, legacy, mismatched, or re-hash-invalid ceremony never authorizes
continuation.

## Structural-defect gate

If the receipt points to an unfixed code, configuration, snapshot, or attestation
defect, stop the reconciliation sequence and report that defect first. Do not accumulate
repeated reconciliations against the same unresolved cause. Repair or restart work
requires its own authorization and verification.

## Durable result gate

After every confirmed mutation, reread `project_snapshot`.

- Reconciliation annotates the failed run; it never converts it to success.
- `provider-did-not-write` releases only when the persisted guard accepts the exact
  ceremony.
- `write-effect-accepted` opens a separate release blocker.
- A proposal, elicitation request, queue receipt, directory listing, or runtime
  observation is not proof that the basis is writable.
