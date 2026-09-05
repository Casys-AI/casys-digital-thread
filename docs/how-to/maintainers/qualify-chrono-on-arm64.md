# How-to: qualify Chrono on an ARM64 host

Audience: maintainer · Diátaxis: how-to · Kind: procedure

Use this private host procedure only to qualify the one code-owned Chrono candidate. It
does not create project evidence, authorize L3, start a normal project runtime, or make
an engineering verdict. The repository catalogue remains `unqualified`; inspect the
result when a later server check needs to know whether this host has an exact
attestation.

Do not replace any step with manual Docker `up`, `down`, `-v`, prune, or image removal.
The only catalogued Chrono binding is `casys.mcp-chrono@0.3.2`. Qualification records
an exact host attestation for that binding; it does not start a normal project runtime
or rewrite the repository catalogue.

## 1. Review the closed candidate

The only accepted candidate is `chrono-arm64-emulation-v1`: Docker daemon `linux/arm64`,
target `linux/amd64`, mode `emulated`, launch group `casys-chrono@1.0.0`, and exact
material
`ghcr.io/casys-ai/mcp-chrono@sha256:2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557`.

Run:

```bash
deno task capability:qualify review --candidate=chrono-arm64-emulation-v1
```

Do not replace the reference with a tag, a bare digest, Docker `Image.Id`, or an image
from another repository that happens to have the same digest. The host check requires
the exact `RepoDigests` repository-and-digest identity and rejects a tagged image as
foreign. It also refuses an unsupported/non-ARM64 daemon, missing local bearer,
administrative disablement, stale code-owned probe/specification, drifted host state, or
an existing exact revocation.

Read the returned review. It contains the observed host identity, exact candidate,
fixture, lowering/case/protocol/criteria fingerprints, host effects, secret-slot
availability and a `reviewFingerprint`. Treat it as time-sensitive: it is recomputed
under the host mutation lock before apply.

## 2. Apply the reviewed probe

Copy exactly the review fingerprint and confirm the mutation:

```bash
deno task capability:qualify apply \
  --candidate=chrono-arm64-emulation-v1 \
  --review-fingerprint=<sha256> \
  --confirm
```

The server durably records the attempt before host mutation; starts the sealed
`casys-chrono` group with the code-owned emulated AMD64 material; submits the fixed
two-body, one-hinge case once; then reads the same run and every receipt page. A
successful qualification is an exact host attestation after a recorded factual receipt,
validated stop proof and reread. It is not a proof of a product mechanism, collision,
clearance, force, strength, safety, or suitability.

## 3. Recover, never redispatch

If apply reports a non-terminal or unavailable outcome, inspect the durable result and
continue only the existing candidate WAL:

```bash
deno task capability:qualify recover --candidate=chrono-arm64-emulation-v1
```

Recovery does not start Docker. Once dispatch is claimed, it calls only same-request
`readRun` / `readReceipt`; it never submits a second `run`. A terminal failed or
unavailable outcome stays factual host history. Do not delete the WAL, invoke Chrono
directly, change an image reference, or use root Compose to force convergence.

For exact state transitions, deadline, pagination and stop/attestation rules, read
[local runtime qualification](../../reference/runtime/capability-packs/local-runtime-qualification.md).
