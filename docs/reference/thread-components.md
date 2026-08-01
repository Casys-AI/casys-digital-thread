# Reference: cross-tool component identity

> **Diátaxis category: reference.** This page describes the reviewed component catalog
> implemented in
> [`src/domain/thread-component-catalog.ts`](../../src/domain/thread-component-catalog.ts).

A `ThreadComponentCatalog` gives one physical component a stable Workbench identity
while preserving each provider's native identity. It is the navigation boundary used by
the **Parts** workspace; it is not a name-matching service and it creates no causal edge
in `ThreadSnapshot`.

The current schema is `thread-components/1.0`. The CM-01 declaration is
[`coffee-machine-cm01.components.json`](../../config/thread-subjects/coffee-machine-cm01.components.json).

## Authority and evidence

Every catalog is `workspace-declared`: a human-reviewed declaration states that exact
provider identities represent facets of the same physical component. A binding has:

| Field                | Meaning                                                       |
| -------------------- | ------------------------------------------------------------- |
| `provider`           | `syson`, `build123d`, or `erpnext`                            |
| `kind`               | Provider-native identity kind: PartUsage, artifact, or Item   |
| `id`                 | Exact provider-owned ID; never a display name                 |
| `label`              | Display-only provider label                                   |
| `evidenceArtifactId` | Immutable canonical artifact that captured or produced the ID |

At projection time a binding is `verified` only when that artifact exists in the current
canonical snapshot and its producer is the declared provider. Otherwise it is
`unverified` with a visible reason. Duplicate provider identities, duplicate component
IDs, unknown parents, and parent cycles are rejected.

The declaration relates identities; it does not assert that SysON caused an ERP row or
that CAD satisfies a requirement. Those claims still require typed canonical provenance,
consumption attestation, and model-owned evaluation.

## Current CM-01 structure

The catalog contains ten existing assembly components with exact SysON `PartUsage` and
ERPNext `Item` identities. The ERP evidence is the persisted full result of
`erpnext_bom_get` for `BOM-CASYS-CM01-001`, including its ten child rows; the BOM-list
header is not used as component proof.

The build123d support bracket is an eleventh component. It has an exact STEP artifact
and presentation mesh but no reviewed SysON PartUsage or ERPNext Item in the current
model. Those two facets are intentionally rendered as trace gaps. The Workbench never
maps the bracket to `Enclosure` merely because that would make the screen look complete.

## System views and presentation assets

`systemViews` records the provider-owned container views used as context: the SysON
project/editing-context/diagram IDs and the ERPNext BOM name. They do not replace the
per-component bindings.

A component may also declare a same-origin STL `preview`. This mesh is presentation only
and carries its own SHA-256. The authoritative engineering identity remains the
referenced STEP artifact and its canonical fingerprint. The read-only BFF serves only
strict `.stl` filenames below `/api/thread/assets/`; it does not expose arbitrary local
paths.

## Browser projection

The browser receives the resolved catalog inside `ThreadWorkbenchSnapshot.components`.
Verified bindings include a selection reference to their canonical evidence artifact.
This gives one selection path in both directions:

```text
SysON PartUsage <-> Workbench component <-> ERPNext Item
                              |
                              +-> build123d artifact, when reviewed
```

The **Parts** workspace keeps the component selected while switching provider facets.
The right inspector follows the selected provider evidence. No iframe or provider UI
runtime is mounted.
