# Reference: capability packs

Audience: both · Diátaxis: reference · Kind: index

Capability-pack pages separate project engineering demand from host runtime state. They
do not add an agent-facing provider selector or give the Workbench runtime authority.

| Page                                                                    | Scope                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Project capability demand](project-capability-demand.md)               | Exact provider-neutral ceiling from registered operation runtime demands          |
| [Atomic runtime catalogue](atomic-runtime-catalog.md)                   | Trusted bindings, concrete units and pure project host planning                   |
| [Atomic runtime boundaries](atomic-runtime-boundaries.md)               | Platform, licence, security, and retained-data limits for those units             |
| [Project capability authorization](project-capability-authorization.md) | Brief-bound operational ceiling, append-only amendments and read-only inspection  |
| [Host runtime supervision](host-runtime-supervision.md)                 | Immutable launch groups, local leases, journaling and closed Compose host control |
| [Capability runtime connection](capability-runtime-connection.md)       | Current fixed loopback seam; progressive lease-bound connection handle            |
| [Local runtime administration](local-runtime-administration.md)         | Append-only lock/revocation and bounded exact private material removal            |
| [Local runtime qualification](local-runtime-qualification.md)           | Private Chrono `chrono-arm64-emulation-v1` review/apply/recover probe             |

`Behave Foundation` remains a derived recipe name only: it is neither an installable
pack nor a separate capability authority. Names such as `canonical`, `static` and
`admitted` describe a method or operation use, not an installable package identity.

The executable surface records a separate, brief-bound operational authorization
ledger. After that confirmation the local supervisor may acquire approved persistent
material and activates it JIT under a lease; authorization itself never starts Docker or
a worker. Ordinary Digital Thread start is cold Deno. H1 starts its own Compose launch
groups (`casys-syson`, `casys-build123d-sandbox`, `casys-build123d-observation`,
`casys-chrono`, `casys-mcp-calculix`) as separate Docker projects. Registry enrollment
is candidacy; it does not start a service, and only an executor that opens its registered
runtime/preparation session can activate a demanded group. Root `docker-compose.yml` is
a maintainer probe and collides with those groups on the same loopback ports. A
successful JIT start proves the group active; it does not yet mint a lease-bound
connection handle. This remains an operational boundary: it neither admits an
engineering method nor turns container health into an engineering result.

Loopback publications and the three start paths live on
[local runtime and ports](../local-runtime-and-ports.md).
