# Reference: MCP console

The Console is a read-only MCP App for observing the engineering fleet and
indexed evidence. Its resource is `ui://casys-digital-thread/console`; its
operational snapshot contract is `2.0`.

## Surfaces

- **Fleet** compares [`config/mcp-fleet.json`](../config/mcp-fleet.json) with
  live MCP discovery and read-only Docker observations.
- **Runs** keeps execution, evidence, and requirement-verdict states separate.
- **Workbench** renders the native linked-thread projection. It does not mount
  provider Apps or call provider MCPs from the browser.

## Endpoints

```bash
deno task start             # http://127.0.0.1:3020/mcp
deno task preview:browser   # http://127.0.0.1:3021/
deno task thread:assemble
deno task preview:thread    # http://127.0.0.1:5173/
```

The browser harness relays only the Console's reviewed read operations. The
native preview reads a persisted canonical snapshot from
`GET /api/thread/workbench`. Neither path starts CAD, meshing, FEA, Modelica, or
a SysON mutation on page load.

## Tools

| Tool                    | Audience       | Meaning                                                        |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| `console_snapshot`      | Any MCP client | Fleet observations and run summaries                           |
| `console_server_detail` | Any MCP client | Desired state, observation, drift, image and trust information |
| `console_run_list`      | Any MCP client | Indexed engineering-run summaries                              |
| `console_run_detail`    | Any MCP client | Evidence, observations, comparisons and provenance             |
| `console_refresh`       | MCP App only   | Explicitly refresh the read-only probes                        |

`console_snapshot` no longer carries dashboard-panel declarations. Product state
lives in the canonical [`ThreadSnapshot`](reference/thread-snapshot.md) and its
native Workbench projection.

## Truth boundary

Desired state comes from the fleet manifest. Observed state comes from the
running MCP endpoints and Docker. Checked-in example evidence is always labelled
demo.

The native Workbench BFF is deliberately read-only. Its local file adapter
validates and serves immutable `ThreadSnapshot` documents; it exposes no
workflow execution endpoint. The current CM-01 document assembles captured or
read-only observed branches from SysON, build123d, CalculiX, Modelica, and
ERPNext through an explicit identity manifest. The live CoffeeMachine model
still has no mechanical `ConstraintUsage`, so no model-owned stress verdict
exists. Assembly does not claim that independent thermal or ERP evidence was
caused by the CAD branch.

ERPNext remains one provider-native MCP on port `3012`. The backend selects
reviewed read tools and projects their results; the browser receives neither ERP
credentials nor generic tool-call authority.

## Verification

```bash
deno run --allow-read scripts/verify-console-evidence.ts
```

This checks the Console fixture, cross-file values, byte counts and SHA-256
identities without rewriting evidence.
