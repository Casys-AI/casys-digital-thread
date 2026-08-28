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
`ghcr.io/casys-ai/mcp-spice@sha256:124fb54f2dd19d26126c7825b85cdcb6b0a352f21cbd8c39d06835e5987dc458`.
The manifest's `release` extension is documentation consumed by the preflight, not a
new control-plane authority field. It records the separately qualified desired image:

| Field | Exact value |
| ----- | ----------- |
| package / health / discovery version | `0.5.1` |
| OCI revision | `ecd03281069373a14b2fbf6eea1fe4b0a3c781c6` |
| OCI created | `2026-08-28T14:59:50.017Z` |
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
`sha256:9471f4a95bb3e3793526367356043237a0ab3c44b278654540c75ea384547476`. It covers
the concordant provider identity, supported MCP versions, all four exact
`{name,inputSchema,outputSchema}` projections, and the reviewed execution-budget
projection below. Any identity, schema, tool-set, or budget change is
`contract-divergent` and requires a new D2 review.

| Bound declared by discovery/schema | Value |
| ----------------------------------- | ----- |
| submitted and legacy-path netlist bytes | 1 MiB (1,048,576 bytes) |
| requested nodes or branch sources, per kind | 32 |
| timeout | default 30 s; accepted range 1–300 s |
| transient private `wrdata` | 8 MiB and 50,000 samples before reduction |
| DC sweep | 512 internal points |

These are a discovered provider contract, not an executed boundary test. The read-only
preflight never submits a byte or runs ngspice, so it cannot prove their runtime
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
