# How-to: extend the Workbench without adding a native domain viewer

Audience: both · Diátaxis: how-to · Kind: how-to

> **Diátaxis category: how-to guide.** Use this before adding a domain result surface. A
> native Digital Thread result viewer is the retired path.

The product cockpit is **not** an MCP App. `native-preview.tsx` mounts `ThreadWorkbench`
as a React + Vite SPA. `deno task preview:browser` refuses: the former Console MCP App
on `:3021` is gone.

## Choose the owning repository

If the change renders CAD, SysML, solver, simulation or ERP data, implement the whole
App in the provider MCP repository. Pin its exact App id and SemVer, `whole-view`
`ui://` resource, accepted `viewer.session.apply` schema and fingerprints there. One
coherent App may route several exact schemas or App-owned discriminators to its internal
views; do not publish each view as a separate mini-App. Digital Thread must not
duplicate its parser, canvas, diagram, table or provider UX.

Only generic shell work belongs here:

1. Change reusable project, graph, record or spatial-window behavior under
   `src/ui/src/{project,thread,ui}/`.
2. Register an exact `ThreadViewerAppBinding` on the server composition edge. Do not put
   a `launchUri` in it and do not derive it from labels, artifact kinds, providers or
   adjacency.
3. Keep the App-owned session payload opaque. Digital Thread verifies its schema
   identity and canonical SHA-256 but does not understand its fields.
4. Register every byte resource in `readResources` with exact same-origin URI, MIME,
   byte count and SHA-256. The App requests only that fingerprint through
   `io.casys.mcp-app-host.resource-read/1.0`.
5. Supply a `ThreadViewerAppLaunchResolver` which reopens and SHA-verifies the exact
   manifest and whole-view HTML MIME, byte count and bytes on its same-origin route.
   Without this gateway attestation, the projector correctly emits no App session.
6. Build the whole App as one single-file HTML document with one exact inline
   `type="module"` bootstrap and inline styles. External/additional scripts,
   module-preload links, import maps and ambiguous script forms are refused by the
   generic browser host.
7. Keep the frame at `sandbox="allow-scripts"`; never add `allow-same-origin` to make a
   raw asset fetch work.
8. Rebuild with `npm --prefix src/ui run build:thread`, preview with
   `deno task preview:thread`, and run `deno task verify:thread:presentation`.

The presentation gate still forbids `@casys/mcp-view`, MCP server capability
advertisement, tool-result hydration, `allow-same-origin` and native domain renderers.
`ThreadWorkbench` owns only the read-only Apps handshake and sends one
`viewer.session.apply` after `ui/notifications/initialized`. The launch gateway must
resolve the exact fingerprinted `ui://` identities to the registered root-relative URI;
it must not derive that route from the session payload.

See [preview the native Workbench](preview-native-workbench.md) and
[the native Workbench explanation](../../explanations/workbench/workbench-overview.md).
The exact descriptor and resource-message shapes are in
[Thread whole-App viewer sessions](../../reference/contracts/thread-viewer-sessions.md).
