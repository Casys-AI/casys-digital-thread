# How-to: show the real ERPNext BOM in Compose

Use this guide to add the manufacturing BOM panel to the engineering dashboard. The
panel reads ERPNext; an empty list is valid live data and must not be replaced by a demo
fixture.

## Prerequisites

- The ERPNext Docker stack is running and exposes its frontend service as `frontend` on
  the external network `erpnext-docker_frappe_network`.
- An `mcp-erpnext` checkout is clean at commit
  `1d99467f58cdb6a606e044ace5010b2bbb6c5386`. That remote branch combines the pending
  `@casys/mcp-server` 0.24 base with the viewer/UOM fix already merged independently on
  main. This temporary composite build remains explicit until the 0.24 base receives its
  own review and release.
- A local env file contains `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET`. Never commit it.

The default workspace layout reads `../mcp-erpnext/.env`. For an independent local file:

```bash
cp .env.erpnext.example .env.erpnext
# Fill only the two credential placeholders, then:
export ERPNEXT_ENV_FILE=.env.erpnext
```

`docker-compose.yml` replaces only `ERPNEXT_URL` with `http://frontend:8080`, which has
been verified from the external ERPNext network. Set `ERPNEXT_DOCKER_NETWORK`,
`ERPNEXT_UPSTREAM_URL`, or `MCP_ERPNEXT_CONTEXT` only when the local topology or source
checkout differs. Before rebuilding the local image, verify the selected context rather
than silently building the tag from another branch:

```bash
git -C "${MCP_ERPNEXT_CONTEXT:-../mcp-erpnext}" rev-parse HEAD
# Expected temporary composite revision: 1d99467f58cdb6a606e044ace5010b2bbb6c5386
```

## Build and start the manufacturing MCP

```bash
docker compose build mcp-erpnext
docker compose up -d mcp-erpnext
docker compose ps mcp-erpnext
```

The host endpoints are `http://127.0.0.1:3012/health` and `http://127.0.0.1:3012/mcp`.
The server deliberately loads 26 tools from `manufacturing`, `inventory`, and
`operations`. This is the minimum current agent surface that can create Items, create
and submit a BOM document, then read manufacturing detail; it also includes generic
update, cancel, delete, upload, and assignment mutations. Treat the MCP as privileged.

Compose applies a narrower, independent capability boundary. It grants only two
read-only calls: `erpnext_bom_list` for initial load and refresh, and `erpnext_bom_get`
for the selected row's material/operation detail. The BOM viewer cannot invoke the
mutation tools.

## Open the engineering dashboard

Start the other engineering services, then launch the existing dashboard:

```bash
docker compose up -d
deno task compose:engineering
```

Open the printed loopback URL. The `manufacturing-bom` panel calls `erpnext_bom_list`
with active-only filtering. Confirm both gates separately:

1. the tool result is non-error structured data with `doctype: "BOM"` (a `count` of zero
   means the ERP currently has no active BOM);
2. the Doclist MCP App receives that initiating result after its Apps handshake and can
   refresh or open a row detail.

A healthy container or a successful API call proves connectivity, not visual hydration.
Do not label the panel verified until both gates pass.
