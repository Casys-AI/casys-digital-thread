# Reference: cross-tool component identity

Audience: both · Diátaxis: reference · Kind: contract

> **Diátaxis category: reference.** This page describes the reviewed component catalog
> implemented in
> [`src/domain/thread/thread-component-catalog.ts`](../../../src/domain/thread/thread-component-catalog.ts).

A `ThreadComponentCatalog` gives one physical component a stable Workbench identity
while preserving each provider's native identity. It is the navigation boundary used by
the **Parts** workspace; it is not a name-matching service and it creates no causal edge
in `ThreadSnapshot`.

The current schema is `thread-components/1.0`. Catalogues are project-specific reviewed
inputs; none is inferred from archived evidence or used as a Workbench fallback.

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

## System views and presentation assets

`systemViews` records the provider-owned container views used as context: the SysON
project/editing-context/diagram IDs and the ERPNext BOM name. They do not replace the
per-component bindings.

A component may also declare a same-origin STL `preview`. This mesh is presentation only
and carries its own SHA-256. The authoritative engineering identity remains the
referenced STEP artifact and its canonical fingerprint. The BFF read path serves only
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

The Evidence read model projects the exact SysON identity pair as separate `PartUsage`
and `PartDefinition` nodes, preserves the catalog parent hierarchy, and links the
definition to its authoritative STEP when that reviewed CAD binding exists. This is a
structural overlay in the existing Evidence canvas; it is never reconstructed from
labels and does not replace the Product component workspace.

The architecture artifact anchors the root `PartDefinition`. Each parent definition then
`contains` its exact usage, each usage is `typed_by` its definition, each definition
`contains` its exact `AttributeUsage` rows when the catalog recorded them, and each
definition may be `represented_by` its authoritative STEP and exact GLB presentation
derivative. A sealed `compile.seal-admission@3` may add a `cad-lever` that
`parameterizes` that AttributeUsage; a missing unique bind adds nothing. The GLB remains
inspectable presentation evidence, not CAD authority. A reused definition therefore
keeps several usage occurrences but one exact pair of definition assets; the browser
never invents a direct usage-to-file relation.

The default Evidence and Activity canvases display a UI-only quotient of that exact
structure. A definition used by one occurrence appears as one component node using the
typed-usage notation `stem : FixedStem`; selecting it restores the exact `PartUsage`,
`typed_by`, and `PartDefinition` records in the local detail. A definition referenced by
two or more distinct usages is never compacted: the shared definition and every usage
remain separate so reuse is visible. The raw Workbench graph and the SysON inspector
inventory always retain both identities regardless of this presentation.

The **Parts** workspace keeps the component selected while switching provider facets.
The right inspector follows the selected provider evidence. No iframe or provider UI
runtime is mounted.
