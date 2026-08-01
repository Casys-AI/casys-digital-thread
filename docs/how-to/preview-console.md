# How-to: preview the MCP console in a local browser

Use this when you want the fastest visual check of the current fixed Console
resource and its live read-only data. The result is a local preview at
<http://127.0.0.1:3021/>.

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
Its upstream requests use the stateless MCP 2026-07-28 wire, with no session or
SSE fallback. It forwards exactly these console tools:

- `console_snapshot`
- `console_run_detail`
- `console_refresh`

The harness invokes `console_snapshot` once as the initiating host call, then
delivers that complete result after `ui/notifications/initialized`; the view
never repeats it.

It does not forward lifecycle mutations, Docker access, Modelica tools, SysON
model mutations, arbitrary resources, or arbitrary MCP calls. The console
continues to own the observation logic; the browser host does not substitute its
own data.

## It is not the native Workbench

This preview renders one already-registered Console view. Keep using it for
fast, fixed-view Console checks.

It is also not the native product Workbench. The Console is an operational
observer and one valid rich MCP App; the product shell renders a linked
`ThreadSnapshot` in one native Preact application. Use
[the native Workbench preview](preview-native-workbench.md) to inspect that
shell. Its current projection comes from a persisted canonical snapshot, so the
two previews answer different questions rather than replacing one another.

For paths, ports, and source ownership, see the
[workspace map](../reference/workspace-map.md).
