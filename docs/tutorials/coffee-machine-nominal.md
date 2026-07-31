# Tutorial: run the first CoffeeMachine evidence through Compose

> **Diátaxis category: tutorial.** Follow this once, in order, to create and inspect one
> real, persisted CoffeeMachine simulation run. It proves a narrow scenario contract; it
> does not create or validate a product requirement.

By the end, you will have a Modelica run identifier, its immutable metrics and artifact
ledger, and a clear distinction between **simulation succeeded** and **a constraint was
evaluated**.

## Before you begin

Start at the repository root with Docker, `curl`, `jq`, Deno, and Node.js available. The
stack binds only to loopback addresses. This tutorial uses the current stateless MCP
contract: `MCP-Protocol-Version: 2026-07-28`, no initialize exchange, no session
identifier, and no SSE stream.

## 1. Start the required Compose services

Validate the topology, then start SysON and Modelica. Starting the full stack is also
fine when you want the CAD and FEA services available.

```bash
docker compose config --quiet
docker compose up -d syson-db syson-app mcp-syson mcp-modelica
curl --fail --silent http://127.0.0.1:3016/health
curl --fail --silent http://127.0.0.1:3009/health
```

The Modelica server owns persisted records in its `/runs` volume. SysON owns the
units-aware constraint evaluation. Neither service has enough information to silently
turn a successful simulation into a product verdict.

## 2. Discover the approved CoffeeMachine kit

Use a stateless MCP call, rather than an old stdio or session workflow:

```bash
curl --fail --silent http://127.0.0.1:3016/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' \
  -H 'Mcp-Name: modelica_kit_list' \
  --data '{
    "jsonrpc":"2.0", "id":1, "method":"tools/call",
    "params":{
      "_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}
      },
      "name":"modelica_kit_list", "arguments":{}
    }
  }' | jq .
```

Find `coffee-machine-v1` and its `heat-up-nominal` scenario in the result. The catalogue
is deliberately bounded: callers cannot submit Modelica source, scripts, or arbitrary
file paths.

## 3. Run the nominal scenario and retain its identifier

```bash
run_json="$({
  curl --fail --silent http://127.0.0.1:3016/mcp \
    -H 'Content-Type: application/json' \
    -H 'MCP-Protocol-Version: 2026-07-28' \
    -H 'Mcp-Method: tools/call' \
    -H 'Mcp-Name: modelica_simulate' \
    --data '{
      "jsonrpc":"2.0", "id":2, "method":"tools/call",
      "params":{
        "_meta":{
          "io.modelcontextprotocol/protocolVersion":"2026-07-28",
          "io.modelcontextprotocol/clientCapabilities":{}
        },
        "name":"modelica_simulate",
        "arguments":{"model_id":"coffee-machine-v1","scenario_id":"heat-up-nominal"}
      }
    }'
})"
run_id="$(printf '%s' "$run_json" | jq -r '.result.structuredContent.run.run_id')"
printf 'Run: %s\n' "$run_id"
printf '%s' "$run_json" | jq '.result.structuredContent'
```

The structured result is the versioned `v1` envelope:

```json
{
  "schemaVersion": "1.0",
  "kind": "run",
  "run": { "run_id": "…", "status": "succeeded", "metrics": {}, "artifacts": [] }
}
```

`succeeded` says only that OpenModelica produced observations and an artifact ledger. It
is intentionally not a `pass` or `fail` field.

## 4. Read back the immutable evidence

Use the identifier returned in the preceding response. A fresh request proves that the
UI need not own the evidence volume.

```bash
curl --fail --silent http://127.0.0.1:3016/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' \
  -H 'Mcp-Name: modelica_run_get' \
  --data "$(jq -nc --arg run_id "$run_id" '{
    jsonrpc:"2.0", id:3, method:"tools/call",
    params:{
      _meta:{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}
      },
      name:"modelica_run_get", arguments:{run_id:$run_id}
    }
  }')" | jq '.result.structuredContent.run'
```

Keep the run ID, metrics, model/scenario identities, and artifact hashes together. They
are the proof produced by the physical simulation.

## 5. See the same evidence in the Console

Build and start the read-only Console:

```bash
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task start
```

In another terminal, run `deno task preview:browser` and open <http://127.0.0.1:3021/>.
Select the CoffeeMachine run in **Runs**. The Console reads it through
`modelica_run_list` and `modelica_run_get`; it does not mount `/runs` or manufacture a
verdict. For the generic multi-panel host, use the
[Compose Console how-to](../how-to/compose-console.md).

## 6. Interpret a comparison correctly

The checked-in plan
[`coffee-machine-nominal-v1`](../../config/verification-plans/coffee-machine-nominal-v1.json)
contains one provisional scenario condition:

```text
water_temperature_max >= 90 degC
```

Only a run whose exact model and scenario identities match the plan may receive that
comparison through SysON. If it is evaluated, read the result in this order:

1. **Simulation**: execution state and Modelica evidence.
2. **Scenario contract**: `passed`, `failed`, `unresolved`, or `error` from a separate
   units-aware comparison.
3. **Provenance**: the plan, metric, limit, margin, and hashes used for that comparison.

The `90 degC` target and `900 s` horizon are scenario data, not an implicit product
requirement or heat-up-time requirement. To validate a product requirement later, model
its business limit and traceability in SysON, then attach appropriate evidence.

## If a step fails

- A missing health endpoint means the service is not ready; inspect the port and image
  mapping in the [workspace reference](../reference/workspace-map.md).
- A protocol or session error means the started image is not on the stateless 2026-07-28
  contract. Do not fall back to a stdio/session request; update the image/topology
  first.
- An empty run list is valid. Run the approved scenario above and use the new identifier
  rather than relying on a historical fixture.
