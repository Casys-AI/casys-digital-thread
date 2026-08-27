# MSM01 — project source workspace

Workspace r27 still has five files and six active authoring attachments. It was
navigated through the MCP as a tree plus exact SysML-linked attachments, not as a flat
product manifest.

| File                         | Observed revision | Role / attachment                                 |
| ---------------------------- | ----------------- | ------------------------------------------------- |
| `msm01.shared.dimensions`    | r1                | Shared source dependency only                     |
| `msm01.base-plate.cad`       | r2                | CAD root → BasePlate PartDefinition               |
| `msm01.riser.cad`            | r2                | CAD root → Riser PartDefinition                   |
| `msm01.sensor-cradle.cad`    | r3                | CAD root → SensorCradle PartDefinition            |
| `msm01.immediate-placements` | r1                | Placement source → all three immediate PartUsages |

One atomic `project_source_attachment_recross` produced the six exact-basis successors
on Thread r14 / architecture r3. File, role and target were preserved; grants none:

| Attachment                              | Successor revision |
| --------------------------------------- | ------------------ |
| `att.msm01.base-plate`                  | r2                 |
| `att.msm01.riser`                       | r3                 |
| `att.msm01.sensor-cradle`               | r4                 |
| the three `att.msm01.placement.*` heads | r3                 |

Replay of the same `mutationId` returned r27 and the same workspace-event fingerprint,
so idempotence after lost acknowledgement holds.

`project_product_explore` then `project_product_inspect` on the root, the three
PartDefinitions and the three PartUsages all returned `observed` with no diagnostics.
Each PartDefinition has exactly its authoring exact-basis head. Each PartUsage
occurrence keeps its identity and has exactly the placement exact-basis head. Inspected
requirements count is 0; that is not a product claim.

Unfiltered `project_source_attachment_list` walked the six heads at r27 in three pages
of two. Reusing that unfiltered cursor with `fileId` is refused `cursor_mismatch`.

Each original CAD root had a two-file, one-edge closure through shared dimensions. MCP
closure navigation and capture preserved those exact bytes, but executable preview and
admission stayed `unresolved` / `source.dependency-lowering-unavailable`. At the time
of the MSM01 run, no executable path was registered for those non-trivial two-file
closures. The current [Build123d workspace-closure lowering v1](../../../reference/domains/cad/build123d-workspace-closure-lowering-v1.md)
instead covers only the narrow direct root-to-direct-scalar-leaf form; it neither
changes MSM01's historical `unresolved` result nor makes those sources runtime proof.
A workspace dependency is not an executable Build123d import environment.

Root-only successors (no executable dependency edge) were deliberately used for the
three admitted CAD parts. This preserves the navigable multi-file historical source
lineage without claiming that multi-file Build123d lowering exists.
