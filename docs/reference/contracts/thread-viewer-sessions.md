# Thread whole-App viewer sessions

Audience: technical · Diátaxis: reference · Kind: contract

Digital Thread projects exact read-only whole-App descriptors. It does not discover an
App, act as an MCP client, call a provider, interpret a domain payload or render a
domain result.

## Projection

`GET /api/thread/viewer-sessions` and the `viewer-sessions` SSE event publish a complete
`thread-viewer-sessions/2.0` replacement. `basis` pins project id and revision, subject
id, and—when technical evidence exists—exact Thread id and revision. `sequence` is
monotonic within that basis and `projectionFingerprint` covers the complete replacement.

Without configured registry paths the binding list is empty. The projector emits a
session only when an explicit registration has the exact basis and either an exact graph
anchor present in the current snapshot or an exact pending Project-review anchor. A
review anchor pins review/proposal id, Project revision and input fingerprint; it has no
Thread identity and remains `provisional` or `documentary`, never canonical evidence.
The projector never selects an App from a label, artifact kind, provider, edge or
proximity.

Each session contains only:

```text
id, kind: "mcp-app", anchor
app: exact id + SemVer
manifest: exact ui:// URI + sha256 fingerprint
resource: exact whole-view ui:// URI + MIME + bytes + sha256 fingerprint
launchUri: root-relative same-origin URI
readResources[]: exact URI + MIME + bytes + sha256 fingerprint
session: viewer.session.apply + exact App schema + opaque payload + sha256
```

The payload is direct App-owned session data, not a Digital Thread wrapper. Its
`schemaVersion` must equal `session.schema`; Digital Thread recomputes only the
canonical payload fingerprint. Provider endpoint, credentials, tool name, tool
arguments, aliases and `latest` are rejected by the exact descriptor shape.

The resource manifest must declare `ownership: "whole-view"`. A component catalog is not
a substitute and no internal component acceptor is required. One coherent MCP App may
own several internal views: the same exact whole-view resource can accept several exact
session schemas or App-owned discriminators. Digital Thread still hosts that one
complete resource and opaque session; it does not split, select or reconstruct the App's
internal views.

`ThreadViewerAppBinding` deliberately has no `launchUri`. Production reads a
server-owned `thread-viewer-app-registry/1.0` file plus an immutable CAS, configured
together with `--viewer-app-registry` and `--viewer-app-object-dir`. A trusted registrar
outside the Workbench writes those files. The Workbench only rereads, validates and
rehashes them.

For every binding, the registry parses the fingerprinted
`io.casys.mcp.view-app-manifest/1.0` bytes and requires exact App id and SemVer, a
unique matching `ui://` resource with `ownership: "whole-view"`, `viewer.session.apply`
in `acceptedActions`, and the binding's exact schema in `sessionSchemas`. It reopens and
rehashes manifest, HTML and registered read resources before resolving or serving them.
Any absent file, malformed manifest, semantic mismatch, missing object, changed byte or
digest produces zero sessions.

The gateway derives, never accepts, these same-origin routes:

- `/api/thread/viewer-apps/launch/<manifest-sha>/<html-sha>`
- `/api/thread/viewer-apps/resources/<resource-sha>`

For local materialization, the trusted runner accepts a complete explicit catalogue and
replaces the registry atomically:

```bash
deno task thread:viewer-apps:materialize -- \
  --catalog=/exact/path/to/viewer-app-catalog.json
```

The catalogue supplies exact basis, anchor, App identity, manifest/HTML source paths,
read-resource paths and the App-owned session schema/payload. The runner derives hashes,
byte counts, resource routes and the fixed session action. It does not accept a launch
URL, declared fingerprint, provider endpoint, tool selection, arguments or credentials.
Materialization never changes the Workbench boundary: the BFF remains a registry/CAS
reader only.

On the Project whiteboard, business-object viewers are these exact recorded MCP Apps:
left click only selects or manipulates the graph, and right click exposes the contextual
App choices for a node or hull. The native Hull Monitor is the sole exception because it
is a Digital Thread monitoring tool, not a provider result viewer. Digital Thread must
not recreate provider result cards, summaries or fallback JSON viewers around it.

The launch response serves the re-attested HTML with exact `text/html;profile=mcp-app`,
byte count, no-store/nosniff/CORP and no redirect. The browser fetches that URI itself
and, before decoding or parsing any HTML, requires status 200, exact MIME, exact bounded
byte count and the registered SHA-256. The App-owned payload cannot select browser code
or a provider.

The rehashed whole-App HTML written by the trusted registrar is the lifecycle trust
root. Admission does not authorize arbitrary replacement documents or a registered App
that deliberately navigates away before completing its exact handshake. An observed
secondary document load revokes the host; the exact App identity is never inherited
across that navigation.

## Frame and Apps lifecycle

The whiteboard renders an accessible iframe with `sandbox="allow-scripts"` and no
`allow-same-origin`. It never navigates that frame directly to `launchUri`. After
raw-byte attestation, a strict fail-closed transform accepts inline styles and exactly
one inline `type="module"` bootstrap (a boolean `crossorigin` is tolerated), moves that
module unchanged to the start of the explicit `head`, and rejects original `src`,
integrity, additional scripts, import maps, speculation rules, module-preload links and
ambiguous forms. Admission also requires the document prefix to be only optional
whitespace, `<!doctype html>`, `<html>` (with at most a literal `lang`) and `<head>`;
content before that head fails closed. The transformed HTML is a parent-created Blob
document.

The moved module comes first with the Workbench document's unique 32-byte base64url
nonce, so the inherited parent policy admits exactly that parser-time bootstrap.
Immediately after it, and before the deferred module executes, the transform injects a
second CSP with `script-src 'none'` and `script-src-attr 'none'`. That closing policy
also denies connections, frames, forms, base URLs, objects, media, workers and child
contexts, while allowing only inline style plus `data:`/`blob:` images. App code can
read its nonce, but the active child policy never grants that nonce; reusing it on an
external or dynamic script remains blocked.

The generic host accepts messages only from the exact iframe `WindowProxy` with opaque
origin `null`. It answers `ui/initialize` only when `appInfo.name`, `appInfo.version`
and `protocolVersion` equal the descriptor's exact App id, SemVer and pinned
`2026-01-26` protocol. The response uses MCP Apps protocol `2026-01-26`, inline-only
host context and an empty `hostCapabilities` object: notably no `serverTools`,
`serverResources`, sampling or message capability.

Only after `ui/notifications/initialized` does the host send one `ui/compose/event` with
`action: "viewer.session.apply"` and the exact opaque session payload as `data`. A
repeated initialized notification cannot replay it. Tool calls, MCP resource
calls/listing, sampling, messages, open-link, model-context updates and App-originated
compose routing are rejected as unsupported requests or ignored when they are
notifications. Digital Thread does not forward any of them to an MCP server or provider.

The iframe is created imperatively with its native `load` listener attached before
insertion. A synchronous or asynchronous initial `about:blank` load is remembered; only
after the source-locked controller and global message listener exist does that phase
start the verified fetch and Blob wrapping. The next load is the transformed registered
App document. Every later load permanently invalidates the host and byte bridge for the
retained `WindowProxy`; pending reads are dropped and the HTML Blob is revoked. Fetch
error, stale session, React teardown and abort revoke it too. Teardown does not fake the
MCP Apps `ui/resource-teardown` request/response exchange while destroying the frame.

Registry/resolver reads and projection admission are serialized as one factory, then
assigned a viewer-projection sequence. Revocation or re-attestation therefore replaces
GET/SSE state monotonically even when Project/Thread revisions do not move; an older
slow resolver completion cannot resurrect a revoked App.

## Opaque-origin resource read

An opaque-origin App cannot raw-fetch the BFF CAS. At top level, before
connect/initialize, it creates a `MessageChannel`, keeps and starts `port1`, and
transfers `port2` once to its parent with this exact bare window message:

```json
{
  "schemaVersion": "io.casys.mcp-app-host.resource-read/1.0",
  "type": "mcp-app-host.resource.port.offer"
}
```

The host accepts only the first exact offer from the locked WindowProxy with opaque
origin `null` and exactly one transferred port. It never transfers a port back through
the navigation-surviving WindowProxy. The top-level offer is posted before
`ui/initialize`; FIFO message delivery lets the accepted exact initialize seal the offer
window. No offer at that point means every later offer is closed, including one from a
replacement document.

After session delivery, requests travel exclusively over the retained port:

```json
{
  "schemaVersion": "io.casys.mcp-app-host.resource-read/1.0",
  "type": "mcp-app-host.resource.read",
  "requestId": "build123d-resource-1",
  "fingerprint": "sha256:<64 lowercase hex>"
}
```

`requestId` matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Extra fields are rejected. In
particular the request cannot name a URI, MIME type, endpoint, credential, tool,
arguments or byte limit. The parent resolves the fingerprint against that session's
unique `readResources` entry, performs a no-store same-origin GET with redirects
disabled, and streams the body with a hard `min(registered bytes, 32 MiB)` bound. A
syntactically false or mismatching `Content-Length`, excess chunks, MIME drift,
byte-count drift or SHA drift fails closed. An absent `Content-Length` is accepted only
after the bounded stream ends at the exact registered byte count and its SHA-256
matches.

Success is correlated by `requestId` and returns RFC 4648 base64 without a data-URL
prefix:

```json
{
  "schemaVersion": "io.casys.mcp-app-host.resource-read/1.0",
  "type": "mcp-app-host.resource.read.result",
  "requestId": "build123d-resource-1",
  "fingerprint": "sha256:<64 lowercase hex>",
  "status": "available",
  "resource": {
    "uri": "/api/thread/viewer-apps/resources/<digest>",
    "mimeType": "model/gltf-binary",
    "bytes": 123,
    "fingerprint": "sha256:<64 lowercase hex>",
    "encoding": "base64",
    "data": "..."
  }
}
```

Failure returns `status: "unavailable"` with one literal reason: `not-registered`,
`fetch-failed`, `identity-mismatch`, or `too-large`. Responses travel only over the same
document-scoped port. Invalidation closes it and suppresses every pending response, so
bytes cannot arrive at a navigated document. The bridge calls no MCP server or
engineering provider.
