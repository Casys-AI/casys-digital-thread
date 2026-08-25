# Reference: mcp-spice provider surface

Audience: agent · Diátaxis: reference · Kind: provider contract

`mcp-spice` is an engine, not an electrical oracle or a registered Digital Thread
operation. The maintainer-only `deno task probe:spice-contract` is deliberately
read-only: it reads the desired fleet manifest and makes only `GET /health`, MCP
`server/discover`, and `tools/list` to the code-owned loopback endpoint. It cannot send
`tools/call`, create a netlist, choose a tool, or inspect Docker; an image digest
written in its JSON report is desired configuration, never runtime verification.

## Current surface

The desired deployment contract is `config/mcp-fleet.json`: the optional local provider
is `mcp-spice` at `127.0.0.1:3023`, with the image pinned by digest. Its current
discovery surface is constrained to `spice_simulate_op` and `spice_simulate_tran`.

- OP reports named node voltages and an input artifact identity.
- Reduced transient reports voltage min/max/final, `n_points`, and requested `tstop_s`.
- Neither surface establishes A or W observations, an event/extremum time in `s`,
  provider readback/replay, a size/point bound, or the wire form of a simulation-tool
  error.

The probe fingerprints the canonical ordered `{name,inputSchema,outputSchema}`
projection plus observed MCP identity. A fingerprint or provider-version change requires
a new D2 review. It concludes `non-executable-preflight` with integration `unresolved`
when the current contract is observed; it is evidence for D2 review, not E08 authority.
An uncertain provider effect must be quarantined for human review; do not redispatch.

## Dated live observation

The 2026-08-22 maintainer observation at `127.0.0.1:3023` reported health/discovery
version `0.1.0`, while the embedded package declared `0.2.0`; its OCI label used
`version=latest`. The observed image digest was
`sha256:cabf9a87e2006811484625f833859b96724faaf5dab6d60f1a10dc7cc6777a69` and OCI
revision `98fbed61d9117f6bd152809fa992a8c473ae548b`. This is a dated observation, not a
claim about a future container. Record digest and revision together; do not infer a
stable single semver from these conflicting fields.

D1 (closed circuit representation) and D3 (method/evaluator) remain human decisions. No
D2 probe turns an engine result into L4 or L5.

See [the reproducible runbook](../../../how-to/maintainers/preflight-spice-provider.md).
Electrical product bounds are on
[electrical boundedness](../../domains/electrical/boundedness.md). The product run is
admitted `simulate.run-admitted-spice@1`, not this probe.
