# Reference: local runtime administration

Audience: maintainer · Diátaxis: reference · Kind: contract

This is a local host-administration surface. It is not a project command, MCP tool,
Workbench mutation, Docker shortcut, provider selector, or engineering verdict.

## Desired-state history

The human brief authorization remains the normal authority for a project. The local
admin lock only answers whether an exact already-authorized atomic unit may activate
JIT on this Mac. `desired: active` permits JIT; it never means the service must remain
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
```

Every apply recomputes the review under the local host mutation lock and refuses a stale
fingerprint or absent `--confirm`. Revocation is append-only and all-or-nothing for one
effective project envelope. It recomposes host desired state but does not delete its
engineering proof history.
