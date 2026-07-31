# How-to: host the Console in a local Compose dashboard

Use this guide when the Console must run through the generic local `mcp-compose` MCP
Apps host: it reads the App resource through MCP, delivers the initiating result after
the App handshake, and relays the Console's explicitly granted read-only calls. For the
smallest visual check of this one fixed view, use the
[browser-preview how-to](preview-console.md) instead.

This is a development integration. It uses the sibling `mcp-server` checkout instead of
adding `mcp-compose` as a runtime dependency of this control-plane repository.

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

In another terminal, run this from the sibling Compose package checkout:

```bash
cd ../mcp-server/packages/compose
deno eval '
  import {
    composeAndServeDashboard,
    loadManifests,
    loadTemplate,
  } from "./src/runtime/mod.ts";

  const manifests = await loadManifests(
    "../../../casys-digital-thread/config/compose/manifests",
  );
  const template = await loadTemplate(
    "../../../casys-digital-thread/config/compose/dashboards/console.yaml",
  );
  const dashboard = await composeAndServeDashboard(
    { manifests, template },
    { open: false },
  );

  console.log(`Compose dashboard: ${dashboard.url}`);
  await new Promise((resolve) =>
    addEventListener("SIGINT", resolve, { once: true })
  );
  await dashboard.shutdown();
'
```

Open the printed loopback URL. `open: false` prevents the launcher from opening a
browser; set it to `true` when that is useful. Press `Ctrl-C` in that terminal to close
the dashboard and release its MCP connections.

Deno 2 gives `deno eval` implicit permissions. Use this short launcher only from the
reviewed local checkout. The host it starts still binds only to loopback and enforces
the manifest capability allowlist; a future checked-in launcher can use `deno run` with
scoped permissions if this becomes a regular operating path.

## 3. Confirm the right behaviour

The page has one Console panel because the current template calls `console_snapshot`. In
that panel:

1. Fleet and Runs should reflect the Console's own observations.
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
It pins the existing Console to `"streamable-http"` and marks only these read-only App
calls as `appCallable`:

- `console_snapshot`
- `console_refresh`
- `console_run_detail`

Omitting `appCallable` means deny. Do not add lifecycle, Docker, SysON model mutation,
arbitrary resource, or arbitrary MCP calls merely to make a panel more convenient. Add a
narrowly justified tool and update the manifest, template, and its proof together.
