# Reference: cross-tool component identity

Audience: both · Diátaxis: reference · Kind: contract

> **Diátaxis category: reference.** This page describes the reviewed component catalog
> implemented in
> [`src/domain/thread/thread-component-catalog.ts`](../../../src/domain/thread/thread-component-catalog.ts).

A `ThreadComponentCatalog` gives one physical component a stable catalog identity while
preserving each provider's native identity. It is a separate reviewed domain
declaration; it is not a name-matching service, a Workbench view model, or a source of
causal edges in `ThreadSnapshot`.

The current schema is `thread-components/1.0`. Catalogues are project-specific reviewed
inputs. None is inferred from archived evidence, embedded in the generic Workbench
snapshot, or used as a viewer fallback.

## Authority and evidence

Every catalog is `workspace-declared`: a human-reviewed declaration states that exact
provider identities represent facets of the same physical component. A binding has:

| Field                | Meaning                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `provider`           | `syson`, `build123d`, `erpnext`, or `digital-thread`                     |
| `kind`               | `part-definition`, `part-usage`, `item`, `artifact`, or `assembly-child` |
| `id`                 | Exact provider-owned ID; never a display name                            |
| `label`              | Display-only provider label                                              |
| `evidenceArtifactId` | Immutable canonical artifact that captured or produced the ID            |

When the domain catalog is resolved against a snapshot, a binding is `verified` only
when that artifact exists in the current canonical snapshot and its producer is the
declared provider. Otherwise it is `unverified` with a recorded reason. Duplicate
provider identities, duplicate component IDs, unknown parents, and parent cycles are
rejected.

The declaration relates identities; it does not assert that SysON caused an ERP row or
that CAD satisfies a requirement. Those claims still require typed canonical provenance,
consumption attestation, and model-owned evaluation.

## System views and presentation assets

`systemViews` records provider-owned container identities used by catalog consumers: the
SysON project/editing-context/diagram IDs and the ERPNext BOM name. They do not replace
the per-component bindings and are not sent to the generic Workbench.

A component may also retain a same-origin STL or GLB `preview` identity and its SHA-256
as catalog data. Digital Thread does not render or forward that mesh in the Workbench
snapshot. The authoritative engineering identity remains the referenced STEP artifact
and its canonical fingerprint. An MCP App can receive bytes only when that exact
resource is registered independently in its viewer session and passes the generic
fingerprint bridge; the catalog preview field does not authorize that transfer.

## Workbench exclusion and App handoff

`ThreadWorkbenchSnapshot` has no component catalog, `systemViews`, component hierarchy,
or preview field. Evidence and Activity receive only the graph nodes, edges, labels and
other literal record fields already present in the generic Thread projection. The
browser does not turn catalog bindings into `PartUsage`, `PartDefinition`, `typed_by`,
`represented_by`, provider facets, or any other topology.

Selecting a visible graph record opens only the generic exact-record and provenance
inspector. It does not switch provider contexts, render STL/GLB, reopen SysML, or
interpret a domain payload.

A complete domain surface is available only through an explicitly registered
[whole-App viewer session](thread-viewer-sessions.md) for the exact Project/Thread basis
and graph anchor. That contract pins the App, payload and separately admitted resources;
the Workbench never derives a session from this catalog. Zero matching sessions remain
unavailable, and multiple matching sessions remain ambiguous rather than being chosen by
the browser.
