# MCP ERPNext Components

Internal, read-only presentation MCP for the Casys Digital Thread. It reuses
`@casys/mcp-erpnext` for Frappe access but exposes only data shaped for small composable
Preact components.

Its visual structure is the reference implementation of the shared `mcp-view` theme.
Cards, metric grids, badges, tables, empty states, and cross-selection feedback come
from the framework; this package keeps only BOM-specific structure and behaviour.

This is deliberately separate from the public `mcp-erpnext` server:

- the public server remains a broad ERP agent API with native tools;
- this server owns the Digital Thread presentation vocabulary;
- no mutation tool is registered;
- the App is component-only and requires a host-selected surface.

## Component catalog

- `erpnext.bom.list`
- `erpnext.bom.identity`
- `erpnext.bom.metrics`
- `erpnext.bom.materials`
- `erpnext.bom.operations`
- `erpnext.bom.costs`

## Local verification

```sh
cd services/mcp-erpnext-components/ui
npm ci
cd ..
deno task verify
```
