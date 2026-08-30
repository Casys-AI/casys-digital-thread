# Reference: capability runtime connection

Audience: both · Diátaxis: reference · Kind: boundary

H1 can prove a launch group is active. The server now mints a process-local
`CapabilityRuntimeConnectionHandle` bound to that exact lease for the SysON seed and
Build123d assembly-observation canaries. This page records that seam.

Demand, catalogue, authorization and supervision stay on their own pages. A connection
fact is not a capability, a binding, an MRTR, or an engineering result.

## Current seam

The launch-group registry fail-closes when two distinct registered Compose groups
publish the same literal loopback host port. That check reuses each group's already
validated canonical Compose descriptor. It does not invent a second Compose authority.

Adapters and the fleet manifest still use **server-owned fixed loopback URLs**
(`config/mcp-fleet.json`, provider clients) except for `architecture.seed-syson-model@2`
and `verify.observe-assembly-integrity@1`. Those canaries obtain an opaque handle from
`CapabilityRuntimeConnectionBroker` after the JIT session yields an active lease, then
open `HttpMcpToolClient` from the handle. One generic local fixed-publication adapter
derives that URL from the unique published loopback host port of the sealed launch group
(`casys-syson` or `casys-build123d-observation`). A supplied fleet URL is accepted only
when it is exactly that derived URL. The executor, project, Thread, CAS, WAL, ROP, MRTR,
Workbench and MCP tool DTOs never receive that URL.

Write-architecture, write-requirements, part-definitions, FEA, sensitivity, other
Build123d clients, Chrono, CalculiX, Modelica and SPICE clients are not migrated. A JIT
session still starts the exact group; those other clients then call the same published
number they already knew.

Published numbers are an inventory of **current HTTP publications**, not a reserved-port
plan. A semantic capability does not own a port. Several materials may share one launch
group and one MCP port (`casys-syson` publishes `127.0.0.1:3009` only). MicroVM workers
publish none. Adding a capability does not allocate a host port. Host ports are **not**
ephemeral in this phase.

Three start paths remain distinct:

| Path                                                              | Who starts it                 | Compatible with H1                                                        |
| ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Cold Deno (`deno task start`)                                     | This repo's MCP/control plane | Yes. Starts no CapabilityRuntime provider.                                |
| H1 JIT launch group (`casys-syson`, `casys-build123d-sandbox`, …) | `CapabilityRuntimeSupervisor` | Yes. Separate Compose project names. Enrollment is not a running service. |
| Root `docker-compose.yml`                                         | Maintainer diagnostic         | No. Different Compose project; same host ports collide.                   |

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

1. **Identical compatibility.** Implemented for the SysON seed and Build123d
   assembly-observation canaries only. Host ports remain the current compatibility
   publications. The broker/locator returns a handle that still resolves to that fixed
   loopback publication. Callers of those canaries stop naming the URL; the published
   number does not change. Other clients still name the server-owned URL.
2. **Ephemeral host loopback.** Not implemented. That remains a later, separate
   migration. Docker would publish or assign an ephemeral loopback host port; a
   server-only broker would then observe and verify that exact mapping. The handle
   remains the only caller-visible connection fact. Activation does not preselect a free
   process-local port: that user-space race is what this phase avoids.
3. **Gateway later.** A later hop may sit in front of those handles. It is not this seam
   and not a public agent endpoint.

Remote connectors, VPS/Kubernetes routing, and marketplace publication stay outside this
page.

## What this page is not

- Not a rewrite of `config/mcp-fleet.json` or of the remaining provider adapters.
- Not permission to put an endpoint in project or Thread state.
- Not a claim that fleet health, container health, or a successful `compose up` is a
  verdict.
- Not a claim that every MCP client is lease-bound, or that host ports are ephemeral.
