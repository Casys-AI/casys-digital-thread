# CL01 — capability runtime

Audience: maintainer · Diátaxis: reference · Kind: dated local-runtime observation

The CL01 briefing and published plan drove a server-selected, local capability plan.
The local supervisor preloaded approved material and activated the needed runtime JIT
under its lease. This is operational evidence only: it does not admit an engineering
method, choose a provider on behalf of an agent, or make container health a result.

## Exact SPICE image identities

Two digests are intentionally different:

| Identity | SHA-256 | Meaning |
| --- | --- | --- |
| Source OCI image | `4350b3b70bb75acee46d24ffe329b809d1132acd506cc9bd4e83c1340aa6942d` | Local Docker source image from which the worker was promoted |
| Runtime microVM manifest | `54079cf7c0e1fcdf9dc30941cc97a752460d787d8d27dd9617d4cfe462e59720` | Exact local Microsandbox runtime material used by the admitted SPICE worker |

The source OCI digest is neither a runtime-manifest pin nor proof of external
distribution. Conversely, the local runtime manifest is not an OCI publication.

## Local-only limit

This dossier observes acquisition/preload and runtime use on this Mac only. It does
not claim a public GHCR worker image, anonymous pull, external installation,
reproducible rebuild, licence clearance or a cross-host qualification. Candidate
first-party distribution is a separate maintainer process described in
[first-party microVM distribution](../../../reference/runtime/capability-packs/first-party-microvm-distribution.md).

The architecture boundary is [capability management](../../../explanations/runtime/capability-management.md)
and [host runtime supervision](../../../reference/runtime/capability-packs/host-runtime-supervision.md).
