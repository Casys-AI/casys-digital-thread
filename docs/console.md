# MCP console

The console is a read-only MCP App for seeing the engineering fleet and its
evidence without turning the language model into the control plane. Its own
tool is `console_snapshot`; its view is
`ui://casys-digital-thread/console`.

## Three surfaces

- **Fleet** compares desired state from
  [`config/mcp-fleet.json`](../config/mcp-fleet.json) with HTTP health,
  `tools/list`, `resources/list`, and read-only Docker/Compose observations.
  It shows missing or unexpected tools/views, container state, image drift,
  network exposure, shared volumes, and trust notes.
- **Runs** exposes the requirement → geometry → STEP → FEA → verdict chain.
  The checked-in bracket is explicitly a demo run, backed by
  [`examples/console/bracket-evidence.json`](../examples/console/bracket-evidence.json).
- **Workbench** lists the SysON MCP Apps, the SysON web UI, and CAD/FEA
  evidence panels intended for composition. Cross-panel selection is declared
  but not active in this MVP.

## Launch

Deno is enough to launch the console itself:

```bash
deno task check
MCP_PORT=3020 MCP_HOSTNAME=127.0.0.1 deno task dev
```

Connect an MCP-capable host to `http://127.0.0.1:3020/mcp`, then call
`console_snapshot`. A UI-capable host renders the returned console resource;
other hosts still receive the structured JSON snapshot.

For real Fleet probes, start the engineering services first:

```bash
docker compose up -d
MCP_PORT=3020 MCP_HOSTNAME=127.0.0.1 deno task start
```

Docker is required for real container/image observations, and the three
configured MCP HTTP endpoints must be reachable. Without them, the console
still starts but labels unavailable observations and demo evidence instead of
presenting them as live.

## Desired, observed, evidence

Desired state is declarative: endpoints, image references, expected tools and
views, topology, and trust boundaries live in `config/mcp-fleet.json`.
Observed state always comes from the running endpoints and Docker. Differences
remain visible; observed values never overwrite the manifest.

The bracket fixture records `56.915761 g`, a `52.5 mm` Z bounding box, and the
documented `26.6 MPa` FEA result. The FEA value is intentionally labelled
`documented-example`: generating the fixture did not run CalculiX. Source,
STEP, solve-case, and result-document hashes bind the display to this checkout.

Verify the console JSON, cross-file values, byte counts, and SHA-256 hashes with:

```bash
deno run --allow-read scripts/verify-console-evidence.ts
```

The verifier reads only; it does not rewrite evidence.

## MVP boundaries

- No restart, stop, delete, pull, configuration change, or other mutation is
  exposed.
- The console is an observer, not a persistent scheduler or run database.
- `:latest` is a mutable image reference and is reported as drift until pinned
  by version or digest.
- `build123d_execute` runs Python. The current shared Compose network is
  acceptable only for trusted local inputs and still needs stronger isolation.
- This MVP is a fixed cockpit. A later `mcp-compose` integration can render
  agent-generated YAML layouts and route their cross-panel events; it is not
  part of this change.
