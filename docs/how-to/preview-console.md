# How-to: preview the MCP console in a local browser

Use this when you want to see the current console resource and its live
read-only data without waiting for a general-purpose MCP Apps host. The result
is a local preview at <http://127.0.0.1:3021/>.

## Start the two local processes

Build the viewer and start the console MCP server first:

```bash
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task start
```

In another terminal, start the browser host:

```bash
deno task preview:browser
```

Then open <http://127.0.0.1:3021/>. The harness is loopback-only. Its health
endpoint is useful for a quick check:

```bash
curl -fsS http://127.0.0.1:3021/health
```

It reports the upstream console URL (`http://127.0.0.1:3020/mcp`) and the
resource it is reading (`ui://casys-digital-thread/console`).

## Confirm that the preview is live

The page should identify itself as an MCP-hosted view, and Fleet/Runs should
reflect observations from the console server. Use **Refresh** to re-probe the
read-only fleet state, then select an observed run to load its detail. A
labelled demo fixture is deliberately different: it is not proof that Docker,
Modelica, or SysON are running.

If the preview falls back to a labelled demo fixture:

1. Check that `deno task start` is still listening on `127.0.0.1:3020`.
2. Reload the browser page after the console starts or restarts.
3. Check the harness health endpoint above.

The [CoffeeMachine tutorial](../tutorials/coffee-machine-nominal.md) gives a
concrete live result to look for.

## Know the boundary

The harness is a narrow visual-test host for the existing fixed MCP App. It
reads the registered console resource from the live MCP server and supplies the
MCP Apps host capability the view needs for its server-side, read-only calls.
It forwards exactly these console tools:

- `console_snapshot`
- `console_run_detail`
- `console_refresh`

It does not forward lifecycle mutations, Docker access, Modelica tools, SysON
model mutations, arbitrary resources, or arbitrary MCP calls. The console
continues to own the observation logic; the browser host does not substitute
its own data.

## It is not mcp-compose

This preview is intentionally **not** an `mcp-compose` dashboard. It renders
one already-registered view and has no YAML layout composition, no general
resource bridge for other servers, and no cross-panel event routing. The
future `mcp-compose` work remains a separate integration: it needs a real
browser/resource bridge and event/session routing before generated multi-view
dashboards can be treated as live.

For paths, ports, and source ownership, see the
[workspace map](../reference/workspace-map.md).
