# How-to: host the Console in a local Compose dashboard

Use this guide when the Console must run through the generic local `mcp-compose` MCP
Apps host: it reads the App resource through MCP, delivers the initiating result after
the App handshake, and relays the Console's explicitly granted read-only calls. For the
smallest visual check of this one fixed view, use the
[browser-preview how-to](preview-console.md) instead.

The Workbench consumes the published npm `@casys/mcp-compose@0.8.1` package and its
`/runtime` subpath. No sibling checkout is required to start or switch compositions.

## 1. Start the Console MCP server

From this repository, build the MCP App and start the read-only Console:

```bash
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task start
```

The Console listens at `http://127.0.0.1:3020/mcp`. Start the engineering services with
`docker compose up -d` first if the resulting Fleet and Runs panels must contain live
observations rather than labelled unavailable or demo evidence.

## 2. Start the dynamic Workbench

Keep the dashboard selector and active composition inside the Console Workbench tab by
starting the stable local manager:

```bash
deno task compose:workbench
```

It listens on `http://127.0.0.1:60060/`. Open the Console through an MCP Apps host and
select **Workbench**, or open that URL directly. The left rail lists the CM-01,
Engineering qualification, Manufacturing readiness, and focused CalculiX compositions.
The Console composition remains a direct launcher so it cannot recursively embed its own
Workbench. Selecting a dashboard starts its real Compose host inside the page; selecting
another swaps hosts and then closes the previous MCP cluster.

The manager accepts activation only from its own browser origin. Each dashboard accepts
framing only from that exact manager origin, while every child viewer keeps its separate
loopback origin and manifest-bounded tool grants.

## 3. Start one dashboard directly

For a one-off Console-only dashboard without the selector, run:

```bash
deno task compose:console
```

Open the printed loopback URL. Press `Ctrl-C` in that terminal to close the dashboard
and release its MCP connections.

The launcher has only read access to `config/compose` and network access to loopback.
The host binds only to loopback and enforces the manifest capability allowlist.

The project keeps Deno's one-day dependency quarantine enabled. Its two name-based
exceptions cover only Casys packages, while `mcp-server` stays pinned to `0.24.1`.

To run the real engineering evidence dashboard instead:

```bash
deno task compose:engineering
```

To run the five-MCP manufacturing handoff composition:

```bash
deno task compose:manufacturing
```

To run the reproducible CalculiX bracket solve and its four-component surface:

```bash
deno task compose:calculix
```

This expects `/exports/bracket.step`, produced by the Build123d step documented in
[`examples/bracket`](../../examples/bracket/README.md).

The five-MCP dashboards also include the ERPNext BOM components. Their local build,
credential and network prerequisites are documented in
[Show the real ERPNext BOM in Compose](show-erpnext-bom.md). A live `count: 0` is an
empty ERP, not permission to substitute mock BOM rows.

For the product-specific five-MCP example, use `deno task compose:cm01`. Its saved
layout, local runtime arguments, and replay semantics are documented in
[View the CoffeeMachine CM-01 digital thread](view-coffee-machine-cm01.md).

## 4. Confirm the right behaviour

The page has one Console panel because the current template calls `console_snapshot`. In
that panel:

1. Fleet and Runs should reflect the initiating `console_snapshot` result. After the
   Apps handshake, Compose sends that complete result once through
   `ui/notifications/tool-result`; the Console does not call `console_snapshot` again or
   substitute fixture/text/session data.
2. **Refresh** should invoke the Console's read-only `console_refresh`.
3. Selecting a run should invoke `console_run_detail`.

A labelled demo fixture is still a demo fixture: it is not evidence that the Compose
host, Docker fleet, Modelica, or SysON are live. The Console owns the observation logic;
Compose does not synthesize data or bypass it.

## Know the three local hosts

`deno task preview:browser` is the existing fixed, single-view harness on
`127.0.0.1:3021`. It has a small, deliberately hard-coded forwarding surface for Console
visual testing.

`deno task compose:workbench` is the persistent product shell on `127.0.0.1:60060`. It
owns the selector and one active dashboard handle; it does not imitate any viewer or
manufacture tool results.

`composeAndServeDashboard()` starts a separate loopback dashboard with a random free
parent port and a distinct loopback origin for each iframe. It loads
`ui://casys-digital-thread/console` through MCP `resources/read`, never by guessing an
upstream `/ui` route. A panel is bound to its source server, its original resource URI,
and the manifest tools marked `appCallable`; it cannot choose another MCP server,
resource, or tool.

The [workspace reference](../reference/workspace-map.md) is the authoritative map for
the template, manifest, Console endpoint, and harness locations.

## Change the declared Console capability only deliberately

The Compose manifest is
[`config/compose/manifests/casys-digital-thread.json`](../../config/compose/manifests/casys-digital-thread.json).
It uses `"auto"`: Compose tries stateless MCP `2026-07-28` first, then uses the legacy
Streamable HTTP client only when a source explicitly rejects that protocol. The current
Console takes the stateless path; the fallback keeps one dashboard declaration usable
with an older compatible source without changing its browser capability boundary.

`console_snapshot` is the initiating call, not a browser capability. Compose delivers
its complete result once after the Apps handshake. The manifest marks only these
read-only App calls as `appCallable`:

- `console_refresh`
- `console_run_detail`

Omitting `appCallable` means deny. Do not add lifecycle, Docker, SysON model mutation,
arbitrary resource, or arbitrary MCP calls merely to make a panel more convenient. Add a
narrowly justified tool and update the manifest, template, and its proof together.
