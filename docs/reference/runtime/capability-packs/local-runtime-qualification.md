# Reference: local runtime qualification

Audience: maintainer · Diátaxis: reference · Kind: contract

This is a private host-local Chrono emulation probe. It is not an MCP operation,
Workbench command, project authority, MRTR, L3 product run, generic qualification
engine, revoke surface, or CalculiX path. The agent never selects provider, image,
digest, platform, mode, URL, tool or arguments. Material acquisition for the sealed
Chrono group is allowed; provider selection stays code-owned.

## Candidate

The only code-owned candidate is `chrono-arm64-emulation-v1`. It binds
`chrono-prescribed-kinematics@1` to `casys.mcp-chrono@0.3.2` / `casys-chrono@1.0.0` on
an observed `linux/arm64` Docker daemon, targeting `linux/amd64` as `emulated`. The
fixture is the fixed two-body one-hinge source (`duration=1`, `timeStep=1/64`, 65
samples) owned by server code. The matching specification
`chrono-arm64-emulation-v1-spec` fingerprints candidate, source, lowering, exact case
bytes, protocol and criteria (including pose/residual tolerances). An older attestation
cannot make the binding effective after that spec changes.

## Review, apply, recover

`review` fingerprints a timestamp-free closed body: candidate, catalog binding
selector/contract/unit manifest/material digest/launch group, observed daemon identity
and `linux/arm64` host, target `linux/amd64`, emulated mode, exact fixture,
source/lowering/case/run-request/protocol/criteria fingerprints, the exact qualification
specification, relevant admin policy/lock, complete host effects, secret-slot
availability (never the secret value or hash), sorted attestation state, and a derived
`chrono-qual-<sha256>` request id. The fingerprint excludes timestamps, bearer/secret
values, lease/journal/container ids, samples and provider
endpoint/tool/args/payload/token/project/MRTR/Thread. Calling `review` may materialize
the opaque host-identity file under `state/local/capability-runtime-host/` on first
read; it does not mutate Docker or the qualification WAL.

`apply` recomputes that review under the live host, refuses a stale fingerprint or a
missing `--confirm`, then under H1:

1. recomposes the exact review, group/material/`runtime-qualification-start` authority
   and secret availability
2. validates lease scope/expiry/pending/competitor preflight
3. prepares the qualification WAL (`prepareAfterAuthorization`)
4. claims the reserved `system-capability-qualification` lease
5. starts only from an exact all-inactive group with no exact qualification intent,
   after canonical verification of the current group journal tip. Recovery of an
   existing exact qualification-start is allowed only when that start **is** the current
   group tip. A later tip (normal start/stop or another qualification) blocks even if it
   already converged. An already-active group is never claimed as a fresh start. Active
   is acceptable only as observation-based convergence of that exact current-tip intent
   (same group/candidate/authority). Partial or foreign active state is blocked. A crash
   between host mutation and `appendOutcome` reconverges read-only from that intent: no
   second Docker start. The start proof fingerprints the full journal entry, the exact
   outcome or its absence, the convergence tag, the complete observation vector, and the
   authority. Uncertain/failed host outcomes are never rewritten to success.
6. submits the exact code-owned fixture
7. durably claims exactly one dispatch (`claimedAt`/`deadlineAt`) and calls `run` at
   most once. A lost bearer **before** that claim is `pre-dispatch-unavailable` with a
   real timestamp, never a provider uncertainty, then stop via the exact start proof.
   After the claim, recovery never calls `run` again.
8. continues only through `readRun` / `readReceipt`
9. reads every receipt page (provider page limit 64, 65 samples total)
10. requires Project Chrono `completed` and the closed FULL kinematics predicate
    (`ABSTOL_RESIDUAL` | `RELTOL_UPDATE` | `ABSTOL_UPDATE` in the code-owned criteria
    manifest). Provider `{1,SUCCESS}` is never that predicate. Requires 65 complete
    samples, exact base/link/hinge ids, fixed base pose, link `[0,0,1]` with quaternion
    `[cos(θ/2),0,0,sin(θ/2)]` compared as normalized sign-invariant `abs(dot(q,e))`,
    prescribed ramp `0 -> 0.5` rad, `within` limits, residual bounds, and the literal
    `notEvaluated` limits. Motor-angle echo with a static body pose is never
    qualification. `{1,SUCCESS}` and `NOT_CONVERGED` are rejected.
11. records an immutable outcome, stops from the exact start proof and observes
    inactive. Stop may mutate only when the current group tip is that start (no stop
    yet) or the exact stop intent derived from it. A later tip blocks before lease
    release or host mutate. Historical start-proof lookup still binds stop to start; it
    is not mutation authority. The WAL persists the complete closed host stop proof.
    Verification requires the derived stop id, reserved qualification owner, exact
    group/materials, active start observations, inactive stop observations, and a
    convergence consistent with the journal outcome. `host-outcome-succeeded` is
    selected only when the succeeded outcome itself covers the exact group. A stopped
    WAL never reacquires a lease or calls stop again. The lease stays until a fresh
    all-inactive proof. Before any release, including the start-failure catch, H1
    re-reads the held lease and requires injective `sameLeaseScope`. A foreign lease is
    left intact. An absent lease is accepted only with an already-persisted exact
    succeeded stop proof.
12. verifies the host stop proof, then reconstructs the expected attestation from
    **this** stopped WAL + candidate + spec and requires that exact fingerprint before a
    lock-serialized `appendQualifiedUnlessRevoked`. If an exact-scope revocation already
    won that File.lock order, qualification loses: no qualified event, WAL stays
    stopped. A qualified event that linearized first may be followed by a revocation;
    effective projection remains revoked. Effective qualification accepts only phase
    `attested` and recrosses the reconstructed event against the WAL
    `attestationFingerprint`. The stopped outcome reference is the strict terminal
    predicate `capability-runtime-qualification-stopped-<fingerprint>`, not a raw
    provider exit code. Revocation is monotone on binding/candidate/host identity across
    spec revisions, but does not block factual readback, terminal stop or lease release
    of an already-started attempt. A self-consistent arbitrary digest is not a verdict.

`recover` is monotonic continuation and cleanup of that WAL. It never redispatches,
never starts Docker, and never creates a second qualified attestation. From `prepared`
it resumes a durable start proof when one exists, otherwise it reports the recoverable
state without consuming a dispatch claim. After a claim it uses only `readRun` /
`readReceipt`. Rapid recoveries do not advance any logical poll clock. Stop and lease
release do not depend on the current start policy, review admissibility, or bearer.

## WAL identity, lock and deadline

Attempt **identity/basis** is candidate + observed host + review + request +
source/lowering/case/runRequest + spec. The WAL **key** is candidate + host + spec
fingerprint: a later spec (S2) opens a new directory without deleting S1. `preparedAt`
is an event fact supplied to `prepare(..., { preparedAt })` and written once under lock.
It is not part of identity. Concurrent prepares on the same basis reuse the first
`Prepared`. There is no legacy `CHRONO_RUNTIME_QUALIFICATION_PREPARED_AT` constant and
no poll sidecar.

File-store transitions are linearizable across processes via exclusive
`Deno.File.lock(true)` on `{attemptDir}/attempt.lock`. That lock is distinct from the H1
host mutation lock (`prepareAfterAuthorization` already runs under H1). Dispatch
create-new remains at-most-once. Relative production roots (`state/local/...`) capture
`Deno.cwd()` as the trusted lexical anchor and never inspect ancestors above it. The cwd
node itself is not `lstat`/`realPath`'d: `start`/`start:yolo` grants
`--allow-read=config,state,src/ui,mcp-server.yaml` and cannot inspect the worktree root.
Inspection starts at descendants. `capability:qualify` still uses `--allow-read=.`,
which remains sufficient. An explicit absolute root still walks from `/`. An ancestor
symlink below the trusted anchor, including a pre-existing real descendant behind one,
is refused. The attestation store uses the same anchored primitive for directory
creation, lock open/revalidation after `File.lock(true)`, reads, listings and writes.

Quarantine uses a code-owned temporal window, not a 4-poll counter. Protocol
`chrono-qualification-protocol/2.0` fingerprints `dispatchDeadlineMs: 300000` (5
minutes). The fixture is 1 s of kinematics plus one extra receipt page; five minutes
covers host inspect/start jitter. `claimedAt`/`deadlineAt` are persisted before `run`.
Recoveries before the deadline never terminalize. At or after the deadline, one last
factual readback runs, then the store seals a single `unavailable` under lock with its
real `now()`. A late receipt before that seal still promotes to `recorded`.

The path fails closed on a stale review, missing Chrono bearer at start, unknown or
unreviewed **security** host effects (privileged, docker socket, devices), host drift,
receipt mismatch, or incomplete pagination. Unknown size or licence stay literal and do
not block this probe. Literal `unavailable` states stay `unavailable`.

## Private operator CLI

```bash
deno task capability:qualify review --candidate=chrono-arm64-emulation-v1
deno task capability:qualify apply --candidate=chrono-arm64-emulation-v1 --review-fingerprint=<sha256> --confirm
deno task capability:qualify recover --candidate=chrono-arm64-emulation-v1
```

Durable WAL and attestations stay under `state/local/capability-runtime-host/`. They are
not Thread, CAS or project evidence. A successful probe is operational host
qualification only: it does not admit a method or certify a product.
