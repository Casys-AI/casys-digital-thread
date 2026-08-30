# Reference: capability runtime connection

Audience: both · Diátaxis: reference · Kind: boundary

H1 can prove a launch group is active. It does not yet mint a connection handle bound to
that lease. This page records that seam. It does not implement
`CapabilityRuntimeConnectionBroker`.

Demand, catalogue, authorization and supervision stay on their own pages. A connection
fact is not a capability, a binding, an MRTR, or an engineering result.

## Current seam

Adapters and the fleet manifest still use **server-owned fixed loopback URLs**
(`config/mcp-fleet.json`, provider clients). A JIT session starts the exact group, then
those clients call the same published number they already knew. The lease proves
material/runtime presence; it is not a locator.

Published numbers are an inventory of **current HTTP publications**, not a reserved-port
plan. A semantic capability does not own a port. Several materials may share one launch
group and one MCP port (`casys-syson` publishes `127.0.0.1:3009` only). MicroVM workers
publish none. Adding a capability does not allocate a host port.

Three start paths remain distinct:

| Path | Who starts it | Compatible with H1 |
| ---- | ------------- | ------------------ |
| Cold Deno (`deno task start`) | This repo's MCP/control plane | Yes. Starts no CapabilityRuntime provider. |
| H1 JIT launch group (`casys-syson`, `casys-build123d-sandbox`, …) | `CapabilityRuntimeSupervisor` | Yes. Separate Compose project names. Enrollment is not a running service. |
| Root `docker-compose.yml` | Maintainer diagnostic | No. Different Compose project; same host ports collide. |

The historical SysON UI on `:8180` is root-Compose convenience. It is not a
`casys-syson` publication.

## Progressive target

The intended server-owned type is `CapabilityRuntimeConnectionBroker` plus a locator.
The handle is process-local and opaque. It binds at least:

- the exact trusted binding;
- the exact launch group;
- the exact lease.

No endpoint, URL, port, hostname, bearer, provider, or tool name enters a project brief,
Thread document, `ResolvedOperationPlan`, agent tool argument, Workbench command, or
MRTR.

Delivery order:

1. **Identical compatibility.** The broker/locator returns a handle that still resolves
   to the current fixed loopback publications. Callers stop naming the URL; the
   published number does not change. This first phase wraps those server-owned URLs
   without changing behavior.
2. **Ephemeral host loopback.** Docker publishes or assigns an ephemeral loopback host
   port; a server-only broker then observes and verifies that exact mapping. The handle
   remains the only caller-visible connection fact. Activation does not preselect a free
   process-local port: that user-space race is what this phase avoids.
3. **Gateway later.** A later hop may sit in front of those handles. It is not this
   seam and not a public agent endpoint.

Remote connectors, VPS/Kubernetes routing, and marketplace publication stay outside this
page.

## What this page is not

- Not a rewrite of `config/mcp-fleet.json` or of provider adapters.
- Not permission to put an endpoint in project or Thread state.
- Not a claim that fleet health, container health, or a successful `compose up` is a
  verdict.
