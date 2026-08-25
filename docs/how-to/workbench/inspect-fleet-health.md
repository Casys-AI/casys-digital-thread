# How-to: inspect fleet health without the retired Console preview

Audience: both · Diátaxis: how-to · Kind: how-to

The Fleet / Runs / Workbench MCP App at <http://127.0.0.1:3021/> is no longer a
product surface. `deno task preview:browser` refuses to start it.

## Open the product cockpit instead

```bash
deno task preview:thread   # http://127.0.0.1:5173/
```

See [Preview the native digital-thread Workbench](preview-native-workbench.md).

## Read fleet health without a page

The control-plane tools remain on the Console MCP server (`:3020/mcp`):

- `console_snapshot`
- `console_server_detail`
- `console_run_list`
- `console_run_detail`

These compare [`config/mcp-fleet.json`](../../../config/mcp-fleet.json) with live MCP
and Docker observations. They are ops reads for agents and tests, not a human
dashboard.

`mcp-tolerance` on `:3019` is the ISO 286-1 provider. It is not this retired page.

For the remaining observer contract, see the [console reference](../../reference/runtime/agent-control-plane.md).
