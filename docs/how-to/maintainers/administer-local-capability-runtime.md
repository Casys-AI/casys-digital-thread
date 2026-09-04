# How-to: administer the local capability runtime

Audience: maintainer · Diátaxis: how-to · Kind: how-to

Use this guide for the private host-administration surface. It changes neither a
project's engineering evidence nor an MRTR, and it is not an MCP/Workbench command path.
Exact contracts and state names live in
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
updates this lock from project authorization. A catalogue-stale head remains visible to
`status` and `lock-review`; `lock-apply` writes a current-catalogue successor. It does
not authorize runtime activation while stale. `rollback-review` refuses a historic
revision whose unit identities are retired or otherwise not exact in the current
catalogue. If an operator must apply the reviewed lock or restore a historic
desired-state revision whose identities still match, use the closed CLI:

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

Exceptional persistent removal may name one code-owned unit or one code-owned launch
group:

```bash
deno task capability:admin remove-review --unit-id=<code-owned-id>
deno task capability:admin remove-apply --unit-id=<code-owned-id> --review-fingerprint=<sha256> --confirm
```

Exceptional non-persistent cache removal names one code-owned unit and material. It
removes an unused exact Docker cache image or Microsandbox cached microVM image. It does
not uninstall Microsandbox, and a project authorization withdrawal never deletes that
cache:

```bash
deno task capability:admin remove-review --unit-id=<code-owned-id> --material-id=<code-owned-id>
deno task capability:admin remove-apply --unit-id=<code-owned-id> --material-id=<code-owned-id> --review-fingerprint=<sha256> --confirm
```

The exact review refuses a still-authorized unit, a pending ledger, active lease or JIT
demand, pending cache preparation, uncertain journal, shared digest, foreign object, or
unknown observation. It preserves Thread, CAS, WAL, project state, and retained volumes.
Docker Desktop may report the exact sealed `repository@sha256:digest` in both
`RepoDigests` and `RepoTags`; that duplicate exact identity is accepted. Any mutable
tag, different repository, or different digest remains foreign and blocks removal.

A historical terminal failure from a runtime start or stop does not permanently poison
later material removal. Pending or uncertain host mutations still block it, and a failed
`material-remove` action must be recovered before another removal attempt. Never replace
this with `down`, volume removal, prune, force, tag/alias removal, a root-Compose
action, or a Microsandbox uninstall.

## 6. Keep Chrono host qualification separate

Chrono's `chrono-arm64-emulation-v1` probe is a separate private local qualification
workflow. It records an exact host attestation; it is not a project command, generic
runtime qualification, engineering MRTR, or product result. Follow
[Qualify Chrono on an ARM64 host](qualify-chrono-on-arm64.md) for the closed review,
apply and recovery procedure. The exact state contract remains
[local runtime qualification](../../reference/runtime/capability-packs/local-runtime-qualification.md).

For the automatic lifecycle and lease/journal boundary behind this guide, see
[host runtime supervision](../../reference/runtime/capability-packs/host-runtime-supervision.md).
