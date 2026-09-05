# Reference: capability packs

Audience: both · Diátaxis: reference · Kind: index

Capability-pack pages separate project engineering demand from host runtime state. They
do not add an agent-facing provider selector or give the Workbench runtime authority.

| Page                                                                    | Scope                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Project capability intent](project-capability-intent.md)               | Pending-brief verification authorities, server routes, and initial semantic forecast                                                     |
| [Project capability demand](project-capability-demand.md)               | Exact provider-neutral ceiling from registered operation runtime demands                                                                 |
| [Atomic runtime catalogue](atomic-runtime-catalog.md)                   | Trusted bindings, concrete units and pure project host planning                                                                          |
| [First-party microVM distribution](first-party-microvm-distribution.md) | Candidate GHCR publication of the five physical Microsandbox worker images, plus maintainer-only non-catalog import; not a catalogue pin |
| [Qualified binding catalogue](qualified-binding-catalog.md)             | Current semantic capability to binding and unit mapping, with literal qualification state                                                |
| [Atomic runtime boundaries](atomic-runtime-boundaries.md)               | Platform, licence, security, and retained-data limits for those units                                                                    |
| [Project capability authorization](project-capability-authorization.md) | Brief-bound operational ceiling, append-only amendments, explicit unused withdrawal, and read-only inspection                            |
| [Host runtime supervision](host-runtime-supervision.md)                 | Immutable launch groups, local leases, journaling and closed Compose host control                                                        |
| [Capability runtime connection](capability-runtime-connection.md)       | Current fixed loopback seam; progressive lease-bound connection handle                                                                   |
| [Local runtime administration](local-runtime-administration.md)         | Append-only lock/revocation and bounded exact private Compose or cache-image removal                                                     |
| [Local runtime qualification](local-runtime-qualification.md)           | Private Chrono `chrono-arm64-emulation-v1` review/apply/recover probe                                                                    |

`Behave Foundation` remains a derived recipe name only: it is neither an installable
pack nor a separate capability authority. Names such as `canonical`, `static` and
`admitted` describe a method or operation use, not an installable package identity.

The executable surface records a separate, brief-bound operational authorization ledger.
After that confirmation the local supervisor may acquire approved persistent material
and activates it JIT under a lease; authorization itself never starts Docker or a
worker. Ordinary Digital Thread start is cold Deno. H1 starts its own Compose launch
groups (`casys-syson`, `casys-build123d-sandbox`, `casys-build123d-observation`,
`casys-chrono`, `casys-mcp-calculix`) as separate Docker projects. Registry enrollment
is candidacy; it does not start a service, and only an executor that opens its
registered runtime/preparation session can activate a demanded group. Root
`docker-compose.yml` is a maintainer probe and collides with those groups on the same
loopback ports. A successful JIT start proves the group active. The SysON seed and
assembly-observation canaries then obtain a lease-bound, process-local connection
handle; the remaining provider clients still use their fixed server-owned publications.
Host ports remain current compatibility publications; ephemeral ports remain a later,
separate migration. This remains an operational boundary: it neither admits an
engineering method nor turns container health into an engineering result.

Loopback publications and the three start paths live on
[local runtime and ports](../local-runtime-and-ports.md).

## Guidance

- [Capability management](../../../explanations/runtime/capability-management.md)
  explains the separation between demand, binding, unit, authorization, activation, and
  engineering evidence.
- [Review project capability authorization](../../../how-to/agents/review-project-capability-authorization.md)
  is the agent procedure for the brief fingerprint, inspection, subset, amendment, and
  stop states.
- [Administer the local capability runtime](../../../how-to/maintainers/administer-local-capability-runtime.md)
  is the maintainer procedure for automatic lifecycle observation and bounded local
  administration.
- [Publish first-party microVM images](../../../how-to/maintainers/publish-first-party-microvm-images.md)
  is the maintainer procedure for opt-in candidate GHCR publication of the five physical
  Microsandbox worker images.
- [Import a first-party microVM image candidate](../../../how-to/maintainers/import-a-first-party-microvm-image-candidate.md)
  is the maintainer procedure for receipt-bound, non-catalog Microsandbox import. It
  does not qualify or promote.
- [Qualify a first-party microVM image candidate](../../../how-to/maintainers/qualify-a-first-party-microvm-image-candidate.md)
  is the maintainer procedure that binds that import record to one CAD or CalculiX
  worker atom and records host/runtime evidence with `eligibleForPromotion=false`.
