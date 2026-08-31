# Reference: mcp-build123d provider surface

Audience: agent · Diátaxis: reference · Kind: provider contract

`mcp-build123d` is a provider, not a registered Digital Thread operation or a geometry
verdict. The maintainer-only `deno task probe:build123d-contract` is read-only: it uses
only `GET /health`, MCP `server/discover`, `tools/list`, and `resources/list` at the
code-owned loopback endpoint. It never issues `tools/call`, reads an artifact resource,
executes CAD, or selects a provider argument.

## Reviewed 0.6.1 OCI identity

Both Compose services pin the dedicated multi-architecture OCI index:

`ghcr.io/casys-ai/mcp-build123d@sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d`

| Field                           | Reviewed value                                                            |
| ------------------------------- | ------------------------------------------------------------------------- |
| Release tag                     | `v0.6.1`                                                                  |
| Source tag commit               | `beaeb648a979437cce8676da103a39d9eb312290`                                |
| Release hardening commit        | `84ccc91`                                                                 |
| README-only post-release commit | `f0cebfc`                                                                 |
| Runtime                         | Deno `2.9.6`                                                              |
| Linux AMD64 manifest            | `sha256:e040ee6385df909d481ac58ec290a1b13f50ca40b0e48eec58949fb5efde8309` |
| Linux ARM64 manifest            | `sha256:420d9ba94b71605443ee59cc1160f94e17ead0c5b6a3f5e7a80f76dffa1ea84b` |

The index exposes SBOM/provenance attestations. The local candidate verifies the exact
OCI labels `source`, `revision`, and `version` alongside its cache digest; that is a
supply-chain identity check, not a legal or product qualification.

The image owns its `/tini -- docker-entrypoint.sh` ENTRYPOINT and default HTTP CMD
`deno run -A server.ts --hostname=0.0.0.0 --port=3014`. Compose must not reintroduce the
legacy `engineering-toolchain` `build123d` subcommand.

## Declared discovery surface

The exact live `0.6.1` discovery/schema fingerprint is
`sha256:43801a71a10eb91959b616947b6ca028fa2ca05e8bf010159180fbf1067f68fa`. The declared
names are `build123d_execute`, `build123d_export`, and
`build123d_observe_assembly_integrity`; the only declared viewer resource is
`ui://mcp-build123d/results-viewer`. A changed schema, viewer URI, release identity, or
fleet/Compose pin makes the preflight literal `contract-divergent`.

For `build123d_export`, the server-owned `timeout_ms` argument is an integer in
`[1, 60000]`; the Digital Thread submits its fixed maximum, `60000`. This provider
argument is distinct from the 120000 ms HTTP client deadline and from any 120000 ms
isolated-microVM limit.

This tells a maintainer only that the declared provider surface matches. It does not
prove a CAD execution, an OCCT observation, canonical geometry, admission, a product
proof, or an engineering verdict.

## Two services, two authority boundaries

`mcp-build123d` mounts the shared `exports` volume and is used only by server-fixed
recipes. `mcp-build123d-sandbox` runs the same provider release with its separate
`build123d-sandbox-exports` volume for agent-proposed source. The sandbox result remains
a private draft until its separately registered review and canonical seal; pinning the
same provider image does not join those authorities.
