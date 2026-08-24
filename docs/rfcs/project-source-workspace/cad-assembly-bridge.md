# CAD assembly bridge

Status: architecture entry point · large-assembly path proposed · not implemented

## Authority boundary

SysML/SysON is the sole authority for product structure. It owns every
`PartDefinition`, every `PartUsage`, their owner hierarchy and definition reuse. A CAD
source may attach geometry to one exact `PartDefinition`. A placement source may attach
a transform to one exact `PartUsage`. Neither source may invent, delete, reparent or
retarget structure.

`ProjectSourceWorkspace` owns source files, file revisions and their exact dependency
DAG. A server-resolved source closure is an operation input, not product structure. The
server product-structure view is derived from an exact SysON capture and may be rebuilt
or discarded without changing product truth.

The Engineering Thread preserves immutable evidence of the exact SysML structure basis,
the exact admitted source revisions and the exact generated assets.

Navigation follows the same boundary: start from the exact SysML/SysON `System`,
`PartUsage` or `PartDefinition`, then reveal its attached CAD sources and evidence. The
workspace dependency DAG may be opened from an attached source to inspect technical
imports, but it is not a parallel product hierarchy.

## Large-assembly design pages

- [Dependency closure](dependency-closure.md) resolves bounded multi-file source inputs.
- [SysML product-structure projection](sysml-product-structure-projection.md) defines the
  disposable server read model.
- [CAD part and module builds](cad-part-and-module-builds.md) separates reusable
  definition geometry from occurrence placement.
- [Hierarchical geometry evidence](hierarchical-geometry-evidence.md) keeps every capture
  bounded to one definition and its immediate children.
- [Incremental rebuild](incremental-rebuild.md) derives impact without a second product
  authority.
- [Workbench large assemblies](workbench-large-assemblies.md) projects the hierarchy
  lazily and read-only.
- [FEA targeting](fea-targeting.md) keeps proof selection tied to exact semantic targets.
- [Implementation plan](implementation-plan.md) states the proving order and exit
  criteria.

## Bounded current execution

This RFC does not widen the current closed CAD language, registered operations or
server-owned bounds. A navigable source module is not automatically an admitted or
executable source set. Multi-file closure, hierarchical module promotion, incremental
assembly rebuild and assembly-level FEA remain literally `unavailable` until each path
is implemented, registered and proven through the real runtime.
