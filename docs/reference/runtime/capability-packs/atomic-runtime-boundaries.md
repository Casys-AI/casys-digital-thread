# Reference: atomic runtime boundaries

Audience: both · Diátaxis: reference · Kind: boundary

Review date: 2026-08-29.

The atomic runtime catalogue records local developer composition only. It does not
vendor OCI images into this source repository, certify production deployment, or grant
an agent any runtime selection authority.

## Platform and distribution

The currently reviewed first-party material is limited to the platforms literally
declared by each atomic material. The SysON stack, private Build123d sandbox and
CalculiX worker each have a `linux/arm64` claim. The separate `casys.mcp-calculix@0.8.2`
material declares both `linux/arm64` and `linux/amd64`; on this ARM64 host its future
live qualification must attest the native ARM64 manifest, not an emulated AMD64
fallback. The catalogue makes no general AMD64 claim for the isolated CalculiX worker. A
missing platform claim stays `unavailable`; it is not derived from a registry label or a
successful Docker pull.

Exact PostgreSQL, SysON, Build123d, CalculiX, Modelica, SPICE and operating-system
licences remain properties of their exact images. Source publication neither replaces
those licences nor grants image redistribution. Bundled or production distribution
requires an image-level SBOM, notices and licence review for the exact digest. A digest
change requires a new review.

`casys.mcp-chrono@0.3.2` is a separate, digest-pinned Linux/amd64 material:
`ghcr.io/casys-ai/mcp-chrono@sha256:2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557`.
It is a loopback-only service on port 3025, has a preserved `chrono-data` volume and
requires only the local `chrono-mcp-bearer-token` secret slot. It declares no privileged
mode, Docker socket, device or bind mount. Its source is MIT, but its aggregate OCI
distribution is `NOASSERTION`, so the exact retained notices remain part of the image
review. The catalogue baseline for this binding remains `unqualified`. Effective
qualification is a host-local attestation overlay, never a catalogue rewrite; on ARM64 a
matching overlay may be only `emulated`, never `native`. See
[local runtime and ports](../local-runtime-and-ports.md).

## Host and data boundary

The selected Compose materials expose only declared loopback ports. The SysON services
may mutate a system model; the private Build123d sandbox executes admitted CAD source
inside its reviewed bounded container. Microsandbox workers have fixed profiles,
deny-all networking, pinned images and server-owned limits. No first-party material
requests a privileged container, Docker socket, device, host networking, arbitrary
Compose input or provider/tool/argument selection.

`syson-db-data`, `build123d-sandbox-exports`, `chrono-data`, and the private CalculiX
input/run-ledger volumes are retained data where their exact material declares
`preserve`. [Local runtime administration](local-runtime-administration.md) may remove
an inactive owned group only while preserving those volumes, Thread, CAS, WAL and
project state. This catalogue and its planner remain read-only: they never pull, start,
stop, bind, dispatch, qualify or delete material.

Canonical admitted geometry export has a separate short preparation lease for exactly
`design.write-geometry@1`'s registered preparation demand. It activates only the
server-owned sandbox group, then repeats cold admission/project/source/SysML/artifact
validation before constructing the fixed private client at `127.0.0.1:3024`. It creates
no agent run or work item. The canonical export lane records a tiny monotone replay WAL
`prepared -> dispatching -> recorded`: the non-idempotent provider is called only after
the synced `dispatching` marker, and restart with that marker but no `recorded` result
is recoverable `unavailable`, never permission to redispatch. A post-dispatch ambiguity
retains the lease for recovery; a known pre-provider validation failure releases it. An
interrupted `prepared` reservation can resume its exact still-live lease after fresh
observation, or use an immutable successor linked to an expired claim; it cannot reuse a
different scope. Conversely, replaying `recorded` performs exact lease cleanup without
activation or provider call, while the group supervisor preserves other live leases/JIT
demands before any stop.

Public MCP exposure, remote Docker access, production secrets and an unreviewed host
effect remain blockers for future activation.
