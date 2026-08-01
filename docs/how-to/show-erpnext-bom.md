# How-to: show the real ERPNext BOM in Compose

Use this guide to run the read-only ERPNext component palette used by the three five-MCP
dashboards. Empty ERP data is valid live data and must never be replaced by a demo
fixture.

## Prerequisites

- The ERPNext Docker stack exposes its frontend service as `frontend` on the external
  network `erpnext-docker_frappe_network`.
- A local ignored env file contains `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET`.
- Deno and Node are installed for local verification; Docker performs the runtime build.

The default workspace layout reads `../mcp-erpnext/.env`. For an independent file:

```bash
cp .env.erpnext.example .env.erpnext
# Fill only the two credential placeholders, then:
export ERPNEXT_ENV_FILE=.env.erpnext
```

`docker-compose.yml` replaces only `ERPNEXT_URL` with `http://frontend:8080`. Override
`ERPNEXT_DOCKER_NETWORK` or `ERPNEXT_UPSTREAM_URL` only when the local ERP topology
differs.

## Verify and start the component MCP

The editable service is
[`services/mcp-erpnext-components/`](../../services/mcp-erpnext-components/). It uses
the published `@casys/mcp-erpnext` client as its provider data plane and the local
`@casys/mcp-view/preact` candidate for presentation.

```bash
cd services/mcp-erpnext-components
deno task verify
cd ../..
docker compose build mcp-erpnext-components
docker compose up -d mcp-erpnext-components
curl --fail --silent http://127.0.0.1:3017/health
```

The server registers one read-only tool, `erpnext_bom_surface`, and one UI resource,
`ui://mcp-erpnext-components/bom-surface`. Its component catalog contains BOM list,
identity, metrics, materials, operations, and cost blocks. It intentionally omits a
standalone `defaultSurface`; the Compose YAML decides which blocks form a product view.

The broad provider-native `mcp-erpnext` service remains available on port `3012` for
agent workflows. It is not a browser capability and is not the source used by these
product dashboards.

## Open a real dashboard

Start the remaining services and choose a recipe:

```bash
docker compose up -d
deno task compose:engineering
# or: deno task compose:cm01
# or: deno task compose:manufacturing
```

Open the printed loopback URL. Confirm the BOM identity and real rows from ERPNext. A
healthy container proves connectivity; the rendered component proves that MCP
`resources/read`, the Apps handshake, the initiating tool result, Preact mounting, and
the selected surface all completed.

In CM-01 and Manufacturing readiness, select a SysON part such as Boiler. The declared
`syson.element.selected` route should display the selection in the ERP materials block
and highlight `CASYS-CM01-BOILER`. That interaction is an event route between viewers,
not hidden ERP access.
