# Reference: mcp-spice provider surface

Audience: agent · Diátaxis: reference · Kind: provider contract

`mcp-spice` is an engine, not an electrical oracle or a registered Digital Thread
operation. The maintainer-only `deno task probe:spice-contract` is deliberately
read-only: it reads the desired fleet manifest and makes only `GET /health`, MCP
`server/discover`, and `tools/list` to the code-owned loopback endpoint. It cannot send
`tools/call`, create a netlist, choose a tool, or inspect Docker. Its
`imageDigestVerified` field is therefore always `false`: the image identity in the
report is desired configuration, never a runtime claim.

## Qualified desired release

`config/mcp-fleet.json` and `docker-compose.yml` pin the optional local provider to the
multi-architecture OCI index
`ghcr.io/casys-ai/mcp-spice@sha256:80f8d6b34dc55e623daf936faea5ff9ee75871331aa88d7339191ea17584991b`.
The manifest's `release` extension is documentation consumed by the preflight, not a
new control-plane authority field. It records the separately qualified desired image:

| Field | Exact value |
| ----- | ----------- |
| package / health / discovery version | `0.5.2` |
| OCI revision | `0575f2d0efdca30965c5b155187b78d9412fb1d1` |
| OCI created | `2026-08-28T15:49:55.406Z` |
| source / URL | `https://github.com/Casys-AI/mcp-spice` |
| title / license | `mcp-spice` / `MIT` |
| description | `MCP oracle for circuit verification — ngspice batch operating point and reduced transients. The server owns the .control block.` |

The exact `org.opencontainers.image.*` labels — including `version`, `revision`,
`created`, `source`, `url`, `title`, `licenses`, and `description` — are duplicated in
that manifest extension. A local Docker observation may compare a running container to
the pin; this D2 probe intentionally cannot. Do not turn a matching health version or
a matching configured digest into `imageDigestVerified: true`.

## Current discovery surface

The code-owned endpoint is `mcp-spice` at `127.0.0.1:3023`. Its exact reviewed
`tools/list` set is:

- `ngspice_netlist_submit` — validate and content-address exact UTF-8 circuit bytes.
- `spice_simulate_op` — requested node voltages and optional voltage-source branch
  currents in A.
- `spice_simulate_tran` — reduced voltage/current extrema, final values, and their
  earliest timestamps in seconds.
- `spice_simulate_dc` — one server-owned voltage-source sweep with reduced voltage and
  current summaries; never a raw transfer curve.

The D2 fingerprint is
`sha256:5873f79d571a67aeafd74f1749ae4a4172a692cfdf9fbab2c8032df95d0d2e8a`. It covers the concordant provider identity,
supported MCP versions, all four exact `{name,inputSchema,outputSchema}` projections,
and the reviewed execution-budget projection below. A changed observed identity,
schema, tool set, or code-owned reviewed projection is `contract-divergent` and
requires a new D2 review.

| Reviewed provider execution bound | Value |
| --------------------------------- | ----- |
| submitted and legacy-path netlist bytes | 1 MiB (1,048,576 bytes) |
| requested nodes or branch sources, per kind | 32 |
| timeout | default 30 s; accepted range 1–300 s |
| transient private `wrdata` | 8 MiB and 50,000 samples before reduction |
| DC private `wrdata` pre-read | 8 MiB before decoding |
| DC request / parser | 512 points each; no partial result beyond the parser cap |
| ngspice diagnostics | stdout and stderr each capped at 1 MiB before parsing |

The netlist, observable, timeout, transient, and DC request limits are represented by
discovery/schema. The matching DC parser cap, private DC pre-read, and log limits are
separately release-qualified and included in the code-owned fingerprint; the probe
cannot inspect the image to verify them. This is not an executed boundary test. The
read-only preflight never submits a byte or runs ngspice, so it cannot prove runtime
enforcement, a typed `tools/call` error envelope, or a replayable provider run.
`spice_simulate_op`, `spice_simulate_tran`, and `spice_simulate_dc` expose only reduced
results; no provider run-readback method is listed. W remains unresolved.

## Authority remains unchanged

The probe concludes `non-executable-preflight` with integration `unresolved` when this
surface is observed. It is D2 method evidence only, not E08 authority. D1 (closed
circuit representation) and D3 (method/evaluator) remain human decisions. No D2 probe
turns an engine result into L4 or L5.

Electrical product bounds are on
[electrical boundedness](../../domains/electrical/boundedness.md). The product run is
admitted `simulate.run-admitted-spice@1`, not this provider or its probe. See the
[reproducible runbook](../../../how-to/maintainers/preflight-spice-provider.md).
