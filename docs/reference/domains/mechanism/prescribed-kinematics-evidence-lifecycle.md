# Reference: prescribed-kinematics evidence lifecycle

Audience: both · Diátaxis: reference · Kind: domain contract

The prescribed-kinematics path has five distinct levels. A later level cannot be
backfilled from a provider response, runtime health check, or UI status.

| Level | Authority and output | It is not |
| --- | --- | --- |
| **L1 — case** | `verify.seal-prescribed-kinematics-case@1` seals one exact `prescribed-kinematics-case/1.0` from the recrossed workspace and architecture binding. | A provider request, runtime selection, or observation. |
| **L2 — MRTR** | A human approves the exact L3 run proposal. The server seals one `resolved-operation-plan/2.0` action that binds the current project/Thread basis, L1 artifact, project authorization, recovery policy, and runtime identities. | An engineering observation, provider dispatch, or L4 criterion. |
| **L3 — observation** | `verify.run-prescribed-kinematics@1` reopens the L2 plan and L1 case, obtains the JIT lease, makes at most one server-owned dispatch, and captures `prescribed-kinematics-observation/1.0`. | A verdict, L5 decision, or evidence of collision, clearance, force, safety, or product fitness. |
| **L4 — method and evaluation** | A separately reviewed and signed method resource is sealed by `verify.seal-prescribed-kinematics-method@1`; `verify.evaluate-prescribed-kinematics@1` applies only that method to the exact L1/L3 chain. Its aggregate is `fail`, then `unresolved`, then `pass`. | A provider call, a replacement observation, or L5. |
| **L5 — human closeout** | A human-origin signed decision executes `decide.accept-prescribed-kinematics-evaluation@1` (only for literal L4 `pass`) or `decide.reject-prescribed-kinematics-evaluation@1` (always available). | An automatic consequence of L3 or L4, or permission to correct CAD, rerun a provider, or claim safety. |

Every Thread-writing operation still has its own ordinary project decision and approval
requirements. “L2 MRTR” specifically names the separate authorization that lets the
registered L3 operation execute; it must not be conflated with the case-seal, method-seal,
evaluation, or L5 human decision.

## L3 factual boundary

L3 records exact case and request identity, source/lowering/request fingerprints, sealed
ROP and capability fingerprints, binding/material/launch-group provenance, normalized
sampled poses and joint values, residual vectors, convergence state, and a persisted
provider receipt. The receipt is reread under the same request identity before it is
captured. The transient provider request body, endpoint, bearer, and secret overlay are
not Thread evidence.

Facts remain facts: pose and angle observations do not become a conclusion merely because
they are complete. Provider-supplied `not_evaluated` boundaries are preserved verbatim;
Digital Thread separately preserves its own coverage limits. Missing facts remain
`unresolved`; unsupported facts remain `unavailable`.

## Current-basis lineage

Each successful evidence writer produces a successor Thread snapshot. The next review
must reopen the exact predecessor chain at its required current basis; it must not borrow
a convenient historical artifact with the same label. A stale, ambiguous, or blocked
basis is `unavailable`, not permission to merge branches or dispatch again.

The L3 unknown-outcome path is deliberately outside the normal evidence ladder. Its WAL,
quarantine, human reconciliation, and successor retry rules are defined in
[prescribed-kinematics observation recovery](../../pipeline/prescribed-kinematics-observation-recovery.md).
