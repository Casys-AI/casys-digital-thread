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
| [Local runtime administration](local-runtime-administration.md)         | Append-only desired-state lock, full revocation and private operator CLI           |

`Behave Foundation` remains a derived recipe name only: it is neither an installable
pack nor a separate capability authority. The executable surface records a separate,
brief-bound operational authorization ledger. The local supervisor may acquire approved
persistent material after confirmation and activates it JIT under a lease; authorization
itself never starts Docker or a worker. The proposed evolution is recorded separately in
the
[Project capability envelope RFC](../../../rfcs/capability-packs/project-capability-envelope.md).
H1 now composes one exact `casys-syson` launch group for covered JIT work. It remains an
operational boundary: it neither admits an engineering method nor turns container health
into an engineering result.
