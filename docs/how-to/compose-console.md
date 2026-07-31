# How-to: host the Console in a local Compose dashboard

Use this guide when the Console must run through the generic local `mcp-compose` MCP
Apps host: it reads the App resource through MCP, delivers the initiating result after
the App handshake, and relays the Console's explicitly granted read-only calls. For the
smallest visual check of this one fixed view, use the
[browser-preview how-to](preview-console.md) instead.

The checked-in launcher consumes the exact published `@casys/mcp-compose@0.6.0` runtime.
No sibling source checkout is required.

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

## 2. Start the local Compose host

In another terminal, run:

```bash
deno task compose:console
```

Open the printed loopback URL. Press `Ctrl-C` in that terminal to close the dashboard
and release its MCP connections.

The launcher has only read access to `config/compose` and network access to loopback.
The host binds only to loopback and enforces the manifest capability allowlist.

The project keeps Deno's one-day dependency quarantine enabled. Its two name-based
exceptions cover only the newly published Casys packages; the import map and lockfile
pin `mcp-compose` to `0.6.0` and `mcp-server` to `0.24.0`.

To run the real engineering evidence dashboard instead:

```bash
deno task compose:engineering
```

## 3. Confirm the right behaviour

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

## Know the two local hosts

`deno task preview:browser` is the existing fixed, single-view harness on
`127.0.0.1:3021`. It has a small, deliberately hard-coded forwarding surface for Console
visual testing.

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
It pins the existing Console to `"stateless-2026-07-28"`. Every request carries the
stateless MCP 2026-07-28 headers and client metadata; there is no initialize exchange,
session identifier, or SSE stream. It marks only these read-only App calls as
`appCallable`:

- `console_snapshot`
- `console_refresh`
- `console_run_detail`

Omitting `appCallable` means deny. Do not add lifecycle, Docker, SysON model mutation,
arbitrary resource, or arbitrary MCP calls merely to make a panel more convenient. Add a
narrowly justified tool and update the manifest, template, and its proof together.
