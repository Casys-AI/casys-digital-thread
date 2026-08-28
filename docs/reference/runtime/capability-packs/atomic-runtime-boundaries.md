# Reference: atomic runtime boundaries

Audience: both · Diátaxis: reference · Kind: boundary

Review date: 2026-08-29.

The atomic runtime catalogue records local developer composition only. It does not
vendor OCI images into this source repository, certify production deployment, or grant
an agent any runtime selection authority.

## Platform and distribution

The currently reviewed first-party material is limited to the platforms literally
declared by each atomic material. The SysON stack, private Build123d sandbox and
CalculiX worker each have a `linux/arm64` claim. The catalogue makes no general AMD64
claim for the CalculiX worker. A missing platform claim stays `unavailable`; it is not
derived from a registry label or a successful Docker pull.

Exact PostgreSQL, SysON, Build123d, CalculiX, Modelica, SPICE and operating-system
licences remain properties of their exact images. Source publication neither replaces
those licences nor grants image redistribution. Bundled or production distribution
requires an image-level SBOM, notices and licence review for the exact digest. A digest
change requires a new review.

`casys.mcp-chrono@0.3.1` is a separate, digest-pinned Linux/amd64 material:
`ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c`.
It is a loopback-only service on port 3025, has a preserved `chrono-data` volume and
requires only the local `chrono-mcp-bearer-token` secret slot. It declares no privileged
mode, Docker socket, device or bind mount. Its source is MIT, but its aggregate OCI
distribution is `NOASSERTION`, so the exact retained notices remain part of the image
review. Until an explicit emulation probe is recorded, the Chrono binding is
`unqualified`; on ARM64 it may become only `emulated`, never `native`.

## Host and data boundary

The selected Compose materials expose only declared loopback ports. The SysON services
may mutate a system model; the private Build123d sandbox executes admitted CAD source
inside its reviewed bounded container. Microsandbox workers have fixed profiles,
deny-all networking, pinned images and server-owned limits. No first-party material
requests a privileged container, Docker socket, device, host networking, arbitrary
Compose input or provider/tool/argument selection.

The `syson-db-data` and `build123d-sandbox-exports` volumes are retained data. A future
runtime removal must preserve them by default and must never remove Thread, CAS, WAL or
project state. This catalogue and its planner are read-only: they never pull, start,
stop, bind, dispatch, qualify or delete material.

Canonical admitted geometry export has a separate short preparation lease for exactly
`design.write-geometry@1`'s registered preparation demand. It activates only the
server-owned sandbox group, then repeats cold admission/project/source/SysML/artifact
validation before constructing the fixed private client at `127.0.0.1:3024`. It creates
no agent run or work item. The canonical export lane records a tiny monotone replay WAL
`prepared -> dispatching -> recorded`: the non-idempotent provider is called only after
the synced `dispatching` marker, and restart with that marker but no `recorded` result is
recoverable `unavailable`, never permission to redispatch. A post-dispatch ambiguity
retains the lease for recovery; a known pre-provider validation failure releases it.

Public MCP exposure, remote Docker access, production secrets and an unreviewed host
effect remain blockers for future activation.
