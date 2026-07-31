# Reference: MCP console

The console is a read-only MCP App for seeing the engineering fleet and its evidence
without turning the language model into the control plane. Its own tool is
`console_snapshot`; its view is `ui://casys-digital-thread/console`.

This is a reference page. For a guided CoffeeMachine result, use the
[tutorial](tutorials/coffee-machine-nominal.md); for the fixed browser harness, use the
[browser-preview how-to](how-to/preview-console.md); and for the generic local Compose
host, use the [Compose how-to](how-to/compose-console.md). The
[workspace map](reference/workspace-map.md) is the authoritative path and port lookup.

## Three surfaces

- **Fleet** compares desired state from
  [`config/mcp-fleet.json`](../config/mcp-fleet.json) with HTTP health, `tools/list`,
  `resources/list`, and read-only Docker/Compose observations. It shows missing or
  unexpected tools/views, container state, image drift, network exposure, shared
  volumes, and trust notes.
- **Runs** exposes the requirement → geometry → STEP → FEA → verdict chain, plus
  persisted Modelica simulations discovered read-only through the owning MCP server. The
  checked-in bracket is explicitly a demo run, backed by
  [`examples/console/bracket-evidence.json`](../examples/console/bracket-evidence.json).
  A Modelica `succeeded` state means only that OpenModelica computed evidence; the
  console renders `not_evaluated` until a comparison is attached. The exact
  CoffeeMachine nominal model/scenario binding has one live, units-aware
  `syson_constraint_evaluate` comparison against its versioned `90 degC` scenario
  target. It is labelled a provisional scenario contract, never a product requirement or
  SysON project requirement.
- **Workbench** lists the SysON MCP Apps, the SysON web UI, and CAD/FEA evidence panels
  intended for composition. Cross-panel selection is declared but not active in this
  MVP.

## Connection reference

The console server's default endpoint is `http://127.0.0.1:3020/mcp`. It binds to
`127.0.0.1` by default and accepts `MCP_PORT` / `MCP_HOSTNAME` or `--port` /
`--hostname` overrides. Deno is enough to launch it:

```bash
deno task check
MCP_PORT=3020 MCP_HOSTNAME=127.0.0.1 deno task dev
```

Connect an MCP-capable host to `http://127.0.0.1:3020/mcp`, then call
`console_snapshot`. A UI-capable host renders the returned console resource; other hosts
still receive the structured JSON snapshot.

For a local browser rendering of that same live MCP App, leave the console on `3020` and
start the read-only harness in another terminal:

```bash
deno task preview:browser         # http://127.0.0.1:3021/
```

The harness reads `ui://casys-digital-thread/console` through `resources/read` and
relays only `console_snapshot`, `console_run_detail`, and `console_refresh` through a
persistent MCP session. It is deliberately marked as a local MCP Apps harness: it is not
a `mcp-compose` dashboard. Its exact scope and health check are documented in the
[browser-preview how-to](how-to/preview-console.md).

The Compose integration uses the same Console resource but has a different contract. Its
explicit manifest and one-panel YAML template live under `config/compose/`; the generic
local host resolves the resource through MCP `resources/read`, not an HTTP `/ui`
convention. It grants the view only the read-only manifest tools marked `appCallable`
and gives it a dedicated loopback iframe origin. See the
[Compose how-to](how-to/compose-console.md) for the source-checkout command and
verification path.

For real Fleet probes, start the engineering services first:

```bash
docker compose up -d
MCP_PORT=3020 MCP_HOSTNAME=127.0.0.1 deno task start
```

Docker is required for real container/image observations, and the four configured MCP
HTTP endpoints must be reachable. Without them, the console still starts but labels
unavailable observations and demo evidence instead of presenting them as live.

## Desired, observed, evidence

Desired state is declarative: endpoints, image references, expected tools and views,
topology, and trust boundaries live in `config/mcp-fleet.json`. Observed state always
comes from the running endpoints and Docker. Differences remain visible; observed values
never overwrite the manifest.

The bracket fixture records `56.915761 g`, a `52.5 mm` Z bounding box, and the
documented `26.6 MPa` FEA result. The FEA value is intentionally labelled
`documented-example`: generating the fixture did not run CalculiX. Source, STEP,
solve-case, and result-document hashes bind the display to this checkout.

Verify the console JSON, cross-file values, byte counts, and SHA-256 hashes with:

```bash
deno run --allow-read scripts/verify-console-evidence.ts
```

The verifier reads only; it does not rewrite evidence.

## MVP boundaries

- No restart, stop, delete, pull, configuration change, or other mutation is exposed.
- The console is an observer, not a persistent scheduler or run database.
- `:latest` is a mutable image reference and is reported as drift until pinned by
  version or digest.
- `build123d_execute` runs Python. The current shared Compose network is acceptable only
  for trusted local inputs and still needs stronger isolation.
- `mcp-modelica` has no native viewer yet. Its four tools expose bounded, approved
  simulations and hashed run evidence. The console uses only `modelica_run_list` and
  `modelica_run_get` to index that evidence; for an exact versioned Coffee scenario
  binding it may make the additional read-only `syson_constraint_evaluate` call. It must
  not receive a static Workbench panel that could be mistaken for a real run viewer.
- The current Compose template intentionally contains one Console panel. It proves the
  resource/host boundary; it does not yet declare SysON, CAD, FEA, or Modelica panels,
  nor any cross-panel selection event.
