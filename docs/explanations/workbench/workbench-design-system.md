# The Workbench component language

Audience: both · Diátaxis: explanation · Kind: explanation

The product cockpit is a native React + Vite workbench. It is **not** an MCP App
and does not import `@casys/mcp-view`.

`src/ui/src/thread/native-preview.tsx` mounts `ThreadWorkbench`. Preview is
`deno task preview:thread` (Vite HMR :5173 → BFF :5175) or `preview:cockpit`
(built HTML + hashed JS/CSS). `deno task preview:browser` refuses: the former
Console MCP App on `:3021` is retired.

The visual baseline (restrained cards, compact titles, dense metrics, semantic
badges) started as the ERPNext BOM palette and was later copied locally. Current
primitives live in `src/ui/src/ui/*` (Radix / shadcn-style). A historical token
copy remains at `src/ui/src/view/mcp-view-theme.ts` (`--cockpit-*`,
`.cockpit-surface`); leftover `.mcp-view-*` class rules were retired. That file
is not the npm package.

## What the native shell owns

The Workbench imports trusted first-party components and renders a linked
`ThreadSnapshot` projection from the BFF. YAML does not select presentation.
Domain viewers (SysON diagrams, build123d canvas, CalculiX mesh evidence,
Modelica provenance, ERPNext BOM) add only their specialized rendering.

New atomic UI is React in this repository. Do not scaffold a result-viewer MCP
App into `src/ui/`. Provider servers in other repositories may still use
`@casys/mcp-view` for one isolated tool result; that is not the atelier path.

## Presentation gate

`deno task verify:thread:presentation` is a hard release gate. It requires
`src/ui/src/mcp-view-primitives.ts` to stay free of `@casys/mcp-view` imports
and fails if `ui/initialize` or `toolresult` reappear in the native bundle.
`postMessage` is not a marker: react-dom's scheduler uses a MessageChannel.

This keeps iframe layout and the Apps handshake out of the product architecture:
agents compose workflows and linked evidence, while trusted UI code composes
local domain blocks.
