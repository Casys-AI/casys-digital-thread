# How-to: administer the local capability runtime

Audience: maintainer · Diátaxis: how-to · Kind: how-to

Use this guide for the private host-administration surface. It changes neither a
project's engineering evidence nor an MRTR, and it is not an MCP/Workbench command
path. Exact contracts and state names live in
[local runtime administration](../../reference/runtime/capability-packs/local-runtime-administration.md).

## 1. Leave normal preload and JIT activation automatic

After a project brief authorization or amendment, the server recomposes the local
desired-state lock and may preload exact approved persistent material. Preload does not
start a Compose group. Immediately before a covered run, H1 performs its fresh plan
check and may activate the sealed group under a lease; release later stops an eligible
group when protected JIT demand is gone.

Ordinary `deno task start` is cold Deno. Do not use the root `docker-compose.yml` as a
shortcut to make an authorized capability active: it is a separate maintainer diagnostic
project and conflicts with H1-managed loopback groups. An `unavailable` runtime is a
state to report or administer through the sealed path, not a reason to start a provider
manually.

## 2. Inspect first

Use the private status and review commands from the repository root:

```bash
deno task capability:admin status
deno task capability:admin lock-review
```

Treat `blocked`, `in-progress`, `recovery-required`, `unavailable`, foreign, or
unobservable host state literally. Do not use a manual Docker action to converge it.
Every apply below recomputes its review under the host mutation lock, requires the exact
returned fingerprint, and requires `--confirm`.

## 3. Review or roll back desired state deliberately

The admin lock records whether exact already-authorized units may activate JIT. Its
`active` value permits JIT; it does not keep a service running. Normally the server
updates this lock from project authorization. If an operator must apply the reviewed
lock or restore a historic desired-state revision, use the closed CLI:

```bash
deno task capability:admin lock-apply --review-fingerprint=<sha256> --confirm
deno task capability:admin rollback-review --revision=<n>
deno task capability:admin rollback-apply --revision=<n> --review-fingerprint=<sha256> --confirm
```

Rollback creates a new successor revision; it never moves the lock head backwards or
rolls back Thread, CAS, WAL, project, or retained-volume history.

## 4. Revoke a project's operational envelope when required

Review and apply a full-envelope revocation with the project id and recorded reason:

```bash
deno task capability:admin revoke-review --project-id=<id> --reason=<text>
deno task capability:admin revoke-apply --project-id=<id> --reason=<text> --review-fingerprint=<sha256> --confirm
```

Revocation is append-only and recomposes desired state. It does not erase engineering
proofs, and a V1 revoked envelope cannot cover or receive an amendment.

## 5. Remove material only through its bounded review

Exceptional removal may name one code-owned unit or one code-owned launch group:

```bash
deno task capability:admin remove-review --unit-id=<code-owned-id>
deno task capability:admin remove-apply --unit-id=<code-owned-id> --review-fingerprint=<sha256> --confirm
```

The exact review refuses a still-authorized unit, a pending ledger, active lease or JIT
demand, uncertain journal, shared digest, foreign object, or unknown observation. It
preserves Thread, CAS, WAL, project state, and retained volumes. Never replace this with
`down`, volume removal, prune, tag/alias removal, or a root-Compose action.

## 6. Use the closed SysON rollover only for its named transition

Drain normal project work, then inspect the exact transition before applying it:

```bash
deno task capability:admin rollover-status --transition-id=casys-syson-node-repack-v1
deno task capability:admin rollover-review --transition-id=casys-syson-node-repack-v1
deno task capability:admin rollover-apply --transition-id=casys-syson-node-repack-v1 --review-fingerprint=<sha256> --confirm
```

This is one closed SysON image transition, not a general upgrade or runtime-selection
mechanism. A non-terminal saga blocks normal SysON preload/JIT; `recovery-required`
means stop and inspect the durable saga rather than infer a handoff.

## 7. Keep Chrono host qualification separate

Chrono's `chrono-arm64-emulation-v1` probe is a separate private local qualification
workflow. It records an exact host attestation; it is not a project command, generic
runtime qualification, engineering MRTR, or product result. Follow
[local runtime qualification](../../reference/runtime/capability-packs/local-runtime-qualification.md)
for its review, apply, and recovery sequence.

For the automatic lifecycle and lease/journal boundary behind this guide, see
[host runtime supervision](../../reference/runtime/capability-packs/host-runtime-supervision.md).
