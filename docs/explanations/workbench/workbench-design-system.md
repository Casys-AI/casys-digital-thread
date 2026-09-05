# The Workbench component language

Audience: both · Diátaxis: explanation · Kind: explanation

The product cockpit is a native React + Vite workbench. It is **not** an MCP App and
does not import `@casys/mcp-view`.

`src/ui/src/thread/native-preview.tsx` mounts `ThreadWorkbench`. Preview is
`deno task preview:thread` (Vite HMR :5173 → BFF :5175) or `preview:cockpit` (built
HTML + hashed JS/CSS). `deno task preview:browser` refuses: the former Console MCP App
on `:3021` is retired.

The visual baseline (restrained cards, compact titles, dense metrics, semantic badges)
started as the ERPNext BOM palette and was later copied locally. Current primitives live
in `src/ui/src/ui/*` (Radix / shadcn-style). A historical token copy remains at
`src/ui/src/view/mcp-view-theme.ts` (`--cockpit-*`, `.cockpit-surface`); leftover
`.mcp-view-*` class rules were retired. That file is not the npm package.

## What the native shell owns

The Workbench renders the generic project shell, graph, Activity records and spatial
windows from a linked `ThreadSnapshot` projection. It owns no CAD, SysML, CalculiX,
Modelica or ERPNext renderer. Those complete domain surfaces belong to versioned MCP
Apps in their provider repositories.

A domain surface enters the Project whiteboard only through an explicitly registered
`whole-view` descriptor. The descriptor pins the exact App SemVer, manifest JSON and
whole-view HTML `ui://` fingerprints, HTML MIME and byte count, graph anchor,
`viewer.session.apply` schema, opaque payload fingerprint and any exact same-origin
resources. A separate resolver must attest those manifest JSON and whole-view HTML
bytes, MIME and byte count before it supplies the projected root-relative launch URI. No
label, artifact kind, provider name or graph proximity selects an App. Without an exact
binding and verified resolver the shell renders none. One MCP can expose one coherent
whole App with several internal views. Exact session schemas or App-owned discriminators
may select those views inside the same resource; the Workbench never turns them into
separate native viewers.

Do not scaffold a domain renderer into `src/ui/`. Provider repositories use
`@casys/mcp-view` for their own whole App; the Digital Thread bundle does not import it
or interpret an App-owned session payload.

## Presentation gate

`deno task verify:thread:presentation` is a hard release gate. It requires
`src/ui/src/mcp-view-primitives.ts` to stay free of `@casys/mcp-view` imports and
rejects server capability advertisement, MCP tool-result hydration, `allow-same-origin`
and retired native domain renderer markers. `postMessage` and `ui/initialize` are
expected in the bounded whole-App host.

The shell fetches an exact same-origin launch URI but never assigns it directly to the
iframe. Status, MIME, bounded byte count and SHA-256 must match before a strict
transform moves exactly one inline module unchanged to the start of the explicit `head`
and creates a Blob HTML document. Original external/additional scripts, link-based
module loading and ambiguous script forms fail closed. The only accepted prefix is
optional whitespace, `<!doctype html>`, `<html>` (with at most a literal `lang`) and
`<head>`; no image, style, refresh or other content can precede that head. The module
receives the server-provided host nonce under the inherited policy; the immediately
following child CSP closes both element and attribute scripts before that deferred
module executes, so nonce reuse grants nothing. The shell frames the Blob document with
`sandbox="allow-scripts"` and deliberately omits `allow-same-origin`. It answers the
exact App's pinned-protocol `ui/initialize` with empty capabilities and an inline
context, then applies the exact session once after `ui/notifications/initialized`. The
iframe handler is installed before its imperative insertion: the empty-document load
triggers verified preparation, the Blob App load is accepted, and every later load
revokes the lifecycle and document Blob URL. Error, abort, session replacement and frame
removal revoke it as well. Removing the frame synchronously closes its byte port; the
shell does not send an uncorrelated `ui/resource-teardown` notification. A configured
file/CAS gateway parses and rehashes the exact App manifest and HTML before deriving the
root-relative launch URI.

Opaque-origin Apps cannot fetch the BFF CAS directly. The App therefore creates one
MessageChannel before connect and transfers its host endpoint once; the host seals that
offer window when exact initialize is accepted. Reads and base64 responses use only the
retained document-scoped port. The App requests only a registered SHA-256, and the
parent performs an exact bounded streaming GET, checks MIME, byte count, global ceiling
and SHA-256. The request cannot carry a URI, endpoint, credential, tool name, arguments
or caller-selected byte limit.
