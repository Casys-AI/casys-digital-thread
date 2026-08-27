# How to preflight the mcp-spice provider

Audience: maintainer · Diátaxis: how-to · Kind: D2 preflight

Run the read-only D2 observation from the repository root:

```sh
deno task probe:spice-contract
```

The task has only network permission to `127.0.0.1:3023` and read permission for
`config/mcp-fleet.json`. It sends exactly `GET /health`, `server/discover`, and
`tools/list`; it never calls `tools/call`, makes a netlist, selects a simulation, or
inspects Docker. Save the emitted JSON with the method evidence if a maintainer wants to
use it in a D2 review.

Treat `non-executable-preflight` with `unresolved` literally. Today it means the listed
surface is voltage-only and does not attest A/W, event time in seconds, safe provider
readback, input-size limits, or a simulation error envelope. It does not prove an engine
execution, a replayable electrical run, L4, or L5. After an unknown external effect,
quarantine for human review; never redispatch from this probe.

If the report is `contract-divergent`, stop: the canonical schema fingerprint or
provider identity/version changed. If it is `unavailable`, retain that literal state.
Neither status authorizes an E08 adapter. D1 and D3 are still separate human gates.

For the dated 2026-08-22 observation and the digest/revision/semver mismatch, see the
[provider reference](../../reference/providers/spice/README.md).
