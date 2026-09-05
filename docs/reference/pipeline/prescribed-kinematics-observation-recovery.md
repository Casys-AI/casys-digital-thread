# Reference: prescribed-kinematics observation recovery

Audience: both · Diátaxis: reference · Kind: pipeline contract

This is the recovery boundary for the product L3 operation
`verify.run-prescribed-kinematics@1`. It is distinct from the private host runtime
qualification WAL. The registered operation never gives an agent a Chrono tool, endpoint,
image, bearer, case payload, or redispatch control.

## Preconditions before the WAL

While holding the shared Thread-write-basis lease, the executor first verifies that the
run basis is the unique declared project Thread head and that no sibling writer on that
basis is active, completed, or terminal-uncertain without its required human release.
This check happens before the capability session, secret snapshot, L3 WAL, or provider
effect. A blocked basis is `unavailable`; the server does not start a JIT runtime or
inspect a provider on behalf of that run.

For an available basis, the executor rereads the exact L2 sealed ROP, project
authorization, L1 case artifact, and runtime identity. The JIT capability session then
performs its own cold recheck before it can journal or start the trusted group. Only the
resulting server-owned session may construct the private adapter.

## Product L3 WAL and one dispatch

The durable L3 attempt is keyed by exact project, run, request, case, source/lowering and
sealed-runtime identities. Its monotone phases are:

```text
prepared → case-submitted → dispatching → recorded
                                    ├──→ rejected
                                    └──→ quarantined
```

- `prepared` binds the reopened case and exact L2/runtime identity.
- `case-submitted` records the exact submitted-case identity. Submission is not the run
  dispatch.
- `dispatching` is preceded by an immutable create-new dispatch claim. Only the process
  that created that claim may call the provider run once.
- `recorded` is allowed only after same-request readback, complete receipt pagination,
  identity validation, and factual observation parsing.
- `rejected` preserves a known rejection which the server binding can classify as
  definite. It is not an unknown outcome.
- `quarantined` preserves `uncertain`, `absent`, or `malformed`. A later factual receipt
  may promote the WAL to `recorded`; it may not make a second dispatch legal.

After `dispatching`, every continuation is read-only with respect to provider execution:
it calls only same-request `readRun` and, when a receipt exists, `readReceipt`. A direct
acknowledgement is insufficient; the receipt must be reread, match the request and case,
and cover every bounded sample page. A lost acknowledgement, timeout, malformed reply,
or non-recorded response gets one same-request readback opportunity, never a second
`run` call.

## Quarantine and project failure

When exact readback cannot prove a factual receipt, the L3 WAL remains quarantined. The
registered project run fails with the dedicated terminal code:

```text
verify-run-prescribed-kinematics-provider-outcome-unknown
```

That code means the provider outcome is unknown; it does not mean provider failure,
absence of an engineering effect, or a failed kinematics verdict. Known rejections and
ordinary local failures retain their own failure states.

A historical run that recorded the generic `prescribed-kinematics-execution-failed`
code remains generic in the project snapshot. The server may still treat it as
terminal-uncertain for reconciliation and the shared Thread-basis guard when the
recorded ROP and the exact L3 WAL recross as monotone terminal `quarantined`
(including `malformed`). Callers cannot supply that eligibility. The recross cannot
invent L3 evidence or a verdict. An approved human annotation then becomes the
lifecycle truth without rewriting the original failure.

The JIT session is retained for recovery on an uncertain outcome. It must not be released
as though the provider boundary were known safe.

## Thread-basis block and human reconciliation

An L3 terminal-uncertain run blocks every sibling Thread writer on the same basis. The
guard does not infer that a failed project run erased a provider effect. A human must use
the registered `record.reconcile-uncertain-writer@1` ceremony, with its exact signed MRTR,
to record one of these literal conclusions:

| Human conclusion | Consequence |
| --- | --- |
| `provider-did-not-write` | The failure remains historical; the exact reconciliation can permit normal successor planning subject to the current-basis checks. |
| `write-effect-accepted` | The failure remains historical and the basis stays blocked until the separate human-approved Thread-basis release ceremony completes. |

Reconciliation is a human judgment after approved operator inspection. It is not a
provider readback, an L3 observation, or an authorization to invent/capture a missing
receipt.

## Retry is a successor, never a redispatch

Do not execute the failed run again, reset its WAL, reuse its request identity for a new
provider call, or call Chrono directly. After the required reconciliation (and, where
applicable, basis release), append a successor work-item revision and take that
successor through the normal review, MRTR, queue, and execution flow from the current
Thread head. The old run remains terminal history.

## Qualification WAL is a different authority

`deno task capability:qualify` operates a private host qualification WAL. It has its own
candidate, host state, start/stop proofs, one qualification dispatch claim, and
attestation. It has no project, Thread, L1 case, L2 MRTR, or product evidence. Its
repository catalogue baseline is `unqualified`; an exact host-local qualified emulated
AMD64 attestation may make only that exact runtime available for later server checks.

That attestation neither dispatches L3 nor replaces the project authorization, sealed
ROP, current Thread basis, or JIT lease required above. See
[local runtime qualification](../runtime/capability-packs/local-runtime-qualification.md).
