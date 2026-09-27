# Tool runtime backend decision (Desktop host, iteration 1)

> Verified-Against: aec70cd7 (2026-09-27). Backend selection for MCP host
> runtime lifecycle (#56) before any packaging change.

Audience: both · Diátaxis: reference · Kind: decision

Parent contract: [host runtime supervision](capability-packs/host-runtime-supervision.md).
Consumers: catalogue (#54) and connection (#49); packaging journey (#53);
Build123d journey (#52).

## Decision

First Desktop target: **macOS** (the proved Desktop distribution).

- **Reuse path**: a compatible existing OCI engine is reused as-is. Compatible
  means: `docker` binary present, daemon reachable, server OS `linux`,
  server arch covered by the pinned image manifest list (`amd64`/`arm64`),
  Compose v2 plugin present. No minimum daemon version is imposed: versions
  are recorded as evidence, and only required capabilities gate readiness.
  Reuse never changes global engine configuration and never disrupts other
  workloads: all host actions are scoped to owned Compose project names and
  `casys.*` container labels, and prune/remove-all commands are forbidden.
- **App-managed path** (no engine installed): Casys drives a guided Docker
  Desktop installation — pinned official DMG URL plus Apple Developer ID
  signature-authority verification (`codesign`, expected authority only; no
  DMG content digest is checked), explicit user approval, genuinely required
  macOS admin authorization for the install step only, then daemon wait and
  the reuse path. No silent download, no invented image tag, no CAD
  toolchain install by Casys.

First MCP: Build123d `v0.7.0`, image pinned by index digest in
`config/mcp-fleet.json`, with `linux/amd64` and `linux/arm64` platform
manifests. The backend runs this actual provider image; the admitted-source
interpreter is not a substitute and is never used here.

Privileged control (subprocess, Docker, package install) lives in the
explicit `desktop/src/tool-runtime/` host/backend boundary. MCP App viewers
never receive it. The backend itself ships as a Desktop host module in this
iteration; #53 owns the download-to-first-result packaging journey.

## Candidates rejected for iteration 1

- **Colima / Podman machine / another OCI VM**: same admin/download weight as
  Docker Desktop with a second VM stack to qualify and no macOS distribution
  proof in this repo. Revisit only with a measured clean-machine path.
- **Subprocess/stdio provider distribution**: providers ship as pinned OCI
  images; no qualified non-OCI distribution exists. Inventing one would
  violate "run the actual MCP".
- **Reusing the project lease/JIT supervisor directly**: that machinery is
  bound to brief authorization, ROP projections, and project leases — the
  wrong layer for a host backend. #56 reuses its mechanisms instead:
  journalled intent, owned-service discipline, digest verification, and
  no-prune removal rules.

## What is measured vs stubbed

The reuse path is proven end to end on the maintainer machine (see the
[tested matrix](tool-runtime-matrix.md)). The fresh-install path is proven
through engine-absent detection, install-plan computation, and
download+verify mechanics; a full DMG install on a clean machine is NOT
claimed until #53 measures it there.
