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

Every revision carries the hash of its predecessor. Rollback creates a new successor
copying the selected historic unit body; it never moves the head backwards. The retired
overwrite-era `admin-lock.json` is deliberately ignored and never migrated.

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
`casys.syson-stack@1.0.0` / `casys-syson@1.0.0` to
`casys.syson-stack@1.0.1` / `casys-syson@1.0.1`. It changes only the pinned
SysON application image identity. The Compose project, services, loopback ports,
secrets, mounts and retained `syson-db-data` volume stay exact. It is neither a
general upgrade mechanism nor a provider-selection surface.

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

The transition identifier is literal. The CLI rejects every other id and has no
image, provider, endpoint, tool or argument option. `rollover-apply` recomputes the
review under the host lock; it refuses a stale fingerprint or missing `--confirm`.
The returned review is the operator record: it exposes `ready`, `blocked`,
`in-progress`, `completed` or `recovery-required`, never an engineering verdict.

Before it can be `ready`, the server requires one exact predecessor lock and topology,
no pending capability ledger, no active SysON lease, no unfinished SysON runtime
journal action, and no `ready`/`in-progress` SysON JIT demand. A hybrid, foreign or
unobservable topology blocks; an already-present successor with no durable saga also
blocks rather than being adopted. Thus normal SysON preload and JIT are blocked while a
durable rollover saga is non-terminal.

The saga records its intent before material acquisition, then observes the successor,
appends exact per-project capability amendments, writes the successor lock and rereads
all durable state before it can complete. An interrupted or ambiguous host observation
becomes `recovery-required`: no automatic rollback, Docker mutation or inferred
handoff follows. Thread, CAS, WAL, project evidence and retained volumes are preserved
at every phase. This path never uses `down`, `down -v`, `prune`, volume removal or a
general rollback command.

## Bounded material removal

Removal is an exceptional local operator action for one complete, code-owned persistent
launch group. The caller may name only `--unit-id` or `--launch-group-id`; neither form
accepts an image, provider, endpoint, tool, Compose service, Docker argument or volume.
Cache-only and microVM material without an enrolled launch group remain literally
`unavailable` for this action.

The review constructs a closed `capability-runtime-removal-plan/1.0`: its fingerprint
binds the exact group reference, complete ordered materials and image digests, exact
owned container IDs observed at review time, and the five literal preservation flags for
Thread, CAS, WAL, project state and retained volumes. A review is refused if any current
project authorization retains a target unit, its project ledger is pending, an active
lease or fresh JIT demand intersects a target material, the administrative lock cannot
be made exact/inactive, a group journal mutation is pending or uncertain, the image
digest is catalogued by another group, or Docker observation is unknown/foreign. The
ledger scan is authoritative for this check: even a project whose first visible revision
exists only as an exact `.pending` file blocks relevant removal; a malformed or
indeterminable pending record blocks rather than being skipped.

Apply holds the same host-mutation lock, recomputes the exact review, writes the needed
inactive lock successor before its durable `material-remove` intent, then rereads the
host. Recovery observes first and may resume only one exact pending removal intent for
the same plan; it never replays an ambiguous action. An all-absent exact group is a
successful no-op.

The host adapter stops and removes only plan-bound owned container IDs (without `-v` or
`--volumes`) and removes only sealed `repository@sha256:…` image references. It refuses
foreign containers/references and shared catalogue digests. `down`, `down -v`, volume
removal, image prune, tag/alias removal and foreign Docker objects are outside this
surface.

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
deno task capability:admin rollover-status --transition-id=casys-syson-node-repack-v1
deno task capability:admin rollover-review --transition-id=casys-syson-node-repack-v1
deno task capability:admin rollover-apply --transition-id=casys-syson-node-repack-v1 --review-fingerprint=<sha256> --confirm
```

Every apply recomputes the review under the local host mutation lock and refuses a stale
fingerprint or absent `--confirm`. Revocation is append-only and all-or-nothing for one
effective project envelope. It recomposes host desired state but does not delete its
engineering proof history.
