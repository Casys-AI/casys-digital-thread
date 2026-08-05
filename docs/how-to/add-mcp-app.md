# How-to: add a standard result-viewer MCP App

> **Diátaxis category: how-to guide.** Use this when a tool already has a structured
> result and needs a focused, interactive view. It is not a guide to inventing a
> dashboard or changing an engineering server's authority.

## 1. Scaffold into a new, empty child directory

`@casys/mcp-view@0.7.0` is the stable result-viewer and component-surface scaffold. On
Deno 2.9, a package published less than 24 hours ago can still be withheld by the
resolver's minimum dependency age.

```bash
deno run -A jsr:@casys/mcp-view@0.7.0/scaffold result-viewer ./src/ui/my-result-viewer
cd ./src/ui/my-result-viewer
deno task test
deno task build
```

The target must be a new or empty child directory. The scaffold refuses a non-empty
target by default; use `--force` only when replacing its named files is intentional. It
emits a standalone `index.html`, TypeScript parser/renderer, host-aware styles, build
script, and parser/render test. The build writes `dist/result-viewer/index.html`.

If Deno 2.9 reports that age gate, keep the import pinned to `0.7.0` and add a temporary
exception scoped only to the package name `jsr:@casys/mcp-view`; do not set a global
`minimumDependencyAge: 0`. Remove the exception once the package is past the age window.

## 2. Keep the tool result closed and versioned

The view must render `structuredContent`, not parse a prose fallback. Give the
initiating tool a closed `outputSchema` and return a versioned object, for example:

```ts
{
  content: [{ type: "text", text: "Simulation completed." }],
  structuredContent: {
    schemaVersion: "1.0",
    kind: "run",
    run: { /* declared fields only */ }
  },
}
```

Use `content` for a concise client fallback and errors; make the App parser strict about
the structured shape it owns. The stock scaffold has a generic evidence model, so
replace its parser only with fields your `outputSchema` actually promises. Treat an
unknown schema version as an error state, not a best-effort verdict.

## 3. Register the resource with its source server

Build the generated viewer and make its resulting `index.html` available as a resource
owned by the same MCP server as the tool. The tool metadata must point to that exact
resource URI:

```ts
_meta: {
  ui: {
    resourceUri: "ui://mcp-example/my-result-viewer",
  }
}
```

Register the resource before connecting the server. The viewer's
`createMcpApp({ onToolResult })` callback is also configured before the Apps handshake,
so the initiating structured result is retained and replayed safely. Do not register
handlers after `connect()`.

Keep all extra tool calls in the view capability-scoped and explicit. A result viewer
normally needs no mutation permission; a follow-up detail call should be one named,
read-only server tool with a documented input schema.

## 4. Integrate it with the native product

A provider App remains one rich result owned by its MCP server. To reuse its
presentation in the native Workbench, export the trusted pure Preact component
separately and let the shell render a BFF projection derived from `ThreadSnapshot`. The
browser must not call the provider MCP directly.

## 5. Verify the complete path

1. Run `deno task check`, `deno task test`, `deno task fmt`, and `deno task build`
   inside the scaffold directory.
2. Call the source server through stateless MCP `2026-07-28` and confirm the tool
   advertises its `outputSchema` and `ui.resourceUri`.
3. Read the URI through `resources/read`; verify that it is the generated single-HTML
   bundle, not source files or a private filesystem path.
4. Open it in the intended MCP Apps host and confirm its first rendered state came from
   the initiating `structuredContent`.
5. Exercise every declared follow-up call and confirm undeclared calls are denied.

For the existing Console host boundary, see the
[browser preview guide](preview-console.md).
