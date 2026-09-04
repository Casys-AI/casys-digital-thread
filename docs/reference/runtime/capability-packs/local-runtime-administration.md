# Reference: local runtime administration

Audience: maintainer · Diátaxis: reference · Kind: contract

This is a local host-administration surface. It is not a project command, MCP tool,
Workbench mutation, Docker shortcut, provider selector, or engineering verdict. Chrono
emulation qualification is the separate
[local runtime qualification](local-runtime-qualification.md) CLI.

## Desired-state history

The human brief authorization remains the normal authority for a project. The local
admin lock only answers whether an exact already-authorized atomic unit may activate JIT
on this Mac. `desired: active` permits JIT; it never means the service must remain
running.

Lock revisions are immutable under `state/local/capability-runtime-host/`:

```text
admin-lock-revisions/<revision>.json   immutable exact bodies
admin-lock-head.json                   exact current revision fingerprint
```

Every revision carries the hash of its predecessor. Historical revisions are immutable
evidence: they are read by schema, canonical JSON, the exact predecessor-hash chain and
the exact head fingerprint. The current catalogue is not an allowlist for old bodies,
and no code-owned historical runtime fingerprint list is maintained. New writes still
require exact current-catalogue identities. A catalogue-stale head is readable so
`status` and `lock-review` can display and reconverge it; it does not authorize
activation. Rollback creates a new successor copying the selected historic unit body; it
never moves the head backwards. `rollback-review` refuses a source whose unit identities
are not exact in the current catalogue. Rollback to a historical revision whose
identities still match remains allowed. The retired overwrite-era `admin-lock.json` is
deliberately ignored and never migrated. Never edit, delete or rewrite `state/local`
history.

After each initial authorization, amendment, or full revocation, the server reads every
local capability ledger and rebuilds the union of all currently authorized proposals.
Every exact authorized unit becomes `active`; current catalogued units no longer needed
become `inactive`. This includes a concrete candidate that is not yet qualified: the
brief can authorize/preload its exact host material while the independent qualification
guard still blocks engineering execution. The ledger-to-lock handoff is fail-safe: a
crash can only leave the lock stricter, and the same finalization retry converges before
preload is scheduled.

No Thread/CAS/WAL/project/retained volume is removed by this boundary.

## Closed SysON rollover

`casys-syson-node-repack-v1` is one closed, server-owned transition from
`casys.syson-stack@1.0.0` / `casys-syson@1.0.0` to `casys.syson-stack@1.0.1` /
`casys-syson@1.0.1`. It changes only the pinned SysON application image identity. The
Compose project, services, loopback ports, secrets, mounts and retained `syson-db-data`
volume stay exact. It is neither a general upgrade mechanism nor a provider-selection
surface.

Use the private local CLI only after normal project work has drained:

```bash
deno task capability:admin rollover-review \
  --transition-id=casys-syson-node-repack-v1
# Copy the returned exact reviewFingerprint.
deno task capability:admin rollover-apply \
  --transition-id=casys-syson-node-repack-v1 \
  --review-fingerprint=<sha256> --confirm
deno task capability:admin rollover-status \
  --transition-id=casys-syson-node-repack-v1
```

The transition identifier is literal. The CLI accepts only this id and the closed Chrono
id below. It has no image, provider, endpoint, tool or argument option. `rollover-apply`
recomputes the review under the host lock; it refuses a stale fingerprint or missing
`--confirm`. The returned review is the operator record: it exposes `ready`, `blocked`,
`in-progress`, `completed` or `recovery-required`, never an engineering verdict.

Before it can be `ready`, the server requires one exact predecessor lock and topology,
no pending capability ledger, no active SysON lease, no unfinished SysON runtime journal
action, and no `ready`/`in-progress` SysON JIT demand. A hybrid, foreign or unobservable
topology blocks; an already-present successor with no durable saga also blocks rather
than being adopted. Thus normal SysON preload and JIT are blocked while a durable
rollover saga is non-terminal.

The saga records its intent before material acquisition, then observes the successor,
appends exact per-project capability amendments, writes the successor lock and rereads
all durable state before it can complete. An interrupted or ambiguous host observation
becomes `recovery-required`: no automatic rollback, Docker mutation or inferred handoff
follows. Thread, CAS, WAL, project evidence and retained volumes are preserved at every
phase. This path never uses `down`, `down -v`, `prune`, volume removal or a general
rollback command.

## Closed Chrono rollover

`casys-chrono-031-to-032-v1` is one closed, host-only transition from
`casys.mcp-chrono@0.3.1` to `casys.mcp-chrono@0.3.2` on `casys-chrono@1.0.0`. It changes
only the pinned mcp-chrono image identity. The Compose project, service, loopback port,
secret slot, healthcheck, retention and named volume `chrono-data` stay exact. Runtime
replacement is not qualification, MRTR, or an engineering result.

Project capability amendment and admin-lock reconciliation to the successor happen on
the ordinary surfaces **before** this saga. The saga itself has `affectedProjects: []`:
it never appends a ledger and never writes the lock. A later private qualification probe
may start, probe and stop 0.3.2 with the opaque secret overlay; this rollover never
calls successor activation.

Use the private local CLI only after those standard amendments have drained:

```bash
deno task capability:admin rollover-review \
  --transition-id=casys-chrono-031-to-032-v1
deno task capability:admin rollover-apply \
  --transition-id=casys-chrono-031-to-032-v1 \
  --review-fingerprint=<sha256> --confirm
deno task capability:admin rollover-status \
  --transition-id=casys-chrono-031-to-032-v1
```

The transition identifier is literal. The CLI accepts only this id and
`casys-syson-node-repack-v1`. It has no image, provider, endpoint, tool or argument
option. `successor-runtime-observed` records the host transition receipt: predecessor
retired, classification `absent`, successor material complete, both runtimes inactive.
It does not mean the successor is active. Thread, CAS, WAL, project evidence and
`chrono-data` are preserved. This path never uses `down`, `down -v`, `prune`, volume
removal or a general rollback command. A non-terminal saga blocks Chrono preload, JIT
and qualification only.

## Bounded material removal

Removal is an exceptional local operator action. Persistent Compose material still names
one complete, code-owned launch group: `--unit-id` or `--launch-group-id`. Neither form
accepts an image, provider, endpoint, tool, Compose service, Docker argument or volume.

Non-persistent cache material — an unused exact Docker cache image or Microsandbox
cached microVM image whose catalogue `launchGroup` is null — is a sibling lifecycle. The
operator names only `--unit-id` plus `--material-id`. The server resolves the exact
catalogue unit/version/manifest and the sealed image digest/backend. This path does not
remove, disable, uninstall or replace Microsandbox itself. It never runs after a project
capability authorization withdrawal; withdrawal removes operational authority only and
does not delete cache.

`--material-id` must be paired with exactly one `--unit-id`. Mixed or partial targets
are refused. A persistent launch group cannot be removed through this sibling path, and
the Compose plan's mandatory `launchGroup` is not made nullable.

The persistent review constructs a closed `capability-runtime-removal-plan/1.0`: its
fingerprint binds the exact group reference, complete ordered materials and image
digests, exact owned container IDs observed at review time, and the five literal
preservation flags for Thread, CAS, WAL, project state and retained volumes. The
non-persistent sibling constructs `capability-runtime-nonpersistent-removal-plan/1.0`:
its fingerprint binds the exact unit `{id, version, manifestFingerprint}`, the exact
material `{unitId, materialId, imageReference, imageDigest, launchGroup: null}`, the
internally derived backend `docker-cache` or `microsandbox-cache`, the observed
`owned`/`absent` state, and the same five preservation flags. Foreign or ambiguous
observation is a refusal, not absence.

A review is refused if any current project authorization retains a target unit, its
project ledger is pending, an active lease or fresh JIT demand intersects a target
material, cache preparation for that material is pending, in progress or unreadable, the
administrative lock cannot be made exact/inactive, a journal mutation is pending or
uncertain, the image digest is catalogued by another material or launch group, or host
observation is unknown/foreign. The ledger scan is authoritative for this check: even a
project whose first visible revision exists only as an exact `.pending` file blocks
relevant removal; a malformed or indeterminable pending record blocks rather than being
skipped.

Apply holds the same host-mutation lock, recomputes the exact review, writes the needed
inactive lock successor before its durable intent, rereads that intent, then grants a
one-shot internal mutation authorization. No intent means no host mutation. A
non-persistent intent carries a positive `generation` derived under that lock
(`max + 1`, starting at 1) and included in its id, so a later owned image of the same
material can be removed again after ordinary cache preparation. Recovery observes first
and may resume only one exact pending removal intent for the same plan
(`resume-pending`); if that pending owned intent is followed by exact absence after a
host effect without a recorded outcome, apply completes it as `succeeded/absent`
(`complete-pending-absent`) without another destructive call. Foreign, unknown,
catalog/manifest/digest/backend drift, multiple pending intents, and a non-exact
original fingerprint stay blocked. An all-absent exact group or an already-absent cache
image with no pending intent is a successful no-op.

The Compose host adapter stops and removes only plan-bound owned container IDs (without
`-v` or `--volumes`) and removes only sealed `repository@sha256:…` image references. The
Docker-cache adapter inspects only that sealed reference, accepts equivalent catalog and
`docker.io/` RepoDigest spellings of the same repository+digest, refuses extra tags, a
foreign digest and any ancestor container including stopped ones, and runs exactly
`docker image rm <sealed-ref>` without `--force`. The Microsandbox-cache adapter attests
the exact cached image (reference/digest/platform/user/entrypoint) and calls
`Image.remove(reference, { force: false })`. Neither adapter calls prune, force removal,
`down -v`, sandbox/session deletion, or Microsandbox uninstallation. Foreign objects and
shared catalogue digests stay outside this surface.

## Private operator CLI

The local-only CLI has no provider, image, endpoint, tool, or argument options:

```bash
deno task capability:admin status
deno task capability:admin lock-review
deno task capability:admin lock-apply --review-fingerprint=<sha256> --confirm
deno task capability:admin rollback-review --revision=<n>
deno task capability:admin rollback-apply --revision=<n> --review-fingerprint=<sha256> --confirm
deno task capability:admin revoke-review --project-id=<id> --reason=<text>
deno task capability:admin revoke-apply --project-id=<id> --reason=<text> --review-fingerprint=<sha256> --confirm
deno task capability:admin remove-review --unit-id=<code-owned-id>
deno task capability:admin remove-apply --unit-id=<code-owned-id> --review-fingerprint=<sha256> --confirm
# Or name one code-owned group, never a Docker service:
deno task capability:admin remove-review --launch-group-id=<code-owned-id>
# Or one exact non-persistent cache image; never a backend, OCI digest, force or prune flag:
deno task capability:admin remove-review --unit-id=<code-owned-id> --material-id=<code-owned-id>
deno task capability:admin remove-apply --unit-id=<code-owned-id> --material-id=<code-owned-id> --review-fingerprint=<sha256> --confirm
deno task capability:admin rollover-status --transition-id=casys-syson-node-repack-v1
deno task capability:admin rollover-review --transition-id=casys-syson-node-repack-v1
deno task capability:admin rollover-apply --transition-id=casys-syson-node-repack-v1 --review-fingerprint=<sha256> --confirm
deno task capability:admin rollover-status --transition-id=casys-chrono-031-to-032-v1
deno task capability:admin rollover-review --transition-id=casys-chrono-031-to-032-v1
deno task capability:admin rollover-apply --transition-id=casys-chrono-031-to-032-v1 --review-fingerprint=<sha256> --confirm
```

Every apply recomputes the review under the local host mutation lock and refuses a stale
fingerprint or absent `--confirm`. Revocation is append-only and all-or-nothing for one
effective project envelope. It recomposes host desired state but does not delete its
engineering proof history.
