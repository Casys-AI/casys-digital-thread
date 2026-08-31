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

Treat `non-executable-preflight` with `unresolved` literally. For the qualified 0.5.2
surface, the read checks the four-tool schema set (netlist submission, OP, transient,
and DC sweep), declared 1 MiB netlist ceiling on both paths, 32-per-kind observables,
1–300 s timeout, 8 MiB / 50,000-sample transient reduction, and the 512-point DC
request ceiling. The reviewed release also caps the private DC pre-read at 8 MiB, DC
parsing at 512 points, and ngspice stdout/stderr at 1 MiB each; those private limits are
included in the code-owned fingerprint but are not an image or runtime observation. It
can observe branch-current and transient-time schema fields, but it does not submit a
byte or run ngspice. It therefore does not prove runtime enforcement, an engine
execution, a replayable electrical run, a typed `tools/call` error, L4, or L5. W and
provider run readback remain unresolved. After an unknown external effect, quarantine
for human review; never redispatch from this probe.

The emitted `desired.release` records the exact configured 0.5.2 OCI index, revision,
and labels. It is not an inspected container: this task deliberately lacks Docker
permission and always reports `imageDigestVerified: false`, even if health/discovery
version and configured digest appear to agree.

If the report is `contract-divergent`, stop: the canonical schema fingerprint or
provider identity/version changed. If it is `unavailable`, retain that literal state.
Neither status authorizes an E08 adapter. D1 and D3 are still separate human gates.

For the qualified image identity, discovery fingerprint, and authority boundary, see
the [provider reference](../../reference/providers/spice/README.md).
