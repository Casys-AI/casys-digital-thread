# RFC: modular project source workspace

Core workspace status: implemented · Owner: Digital Thread architecture

Large-assembly extension status: in progress · exact SysML roots and read-side
navigation implemented · versioned authoring attachments and real proving run pending

This RFC defines how an engineering agent keeps source files for a project without
turning the project, a Thread snapshot, or one manifest into a monolith.

The workspace is the agent-owned draft source tree. It is not product evidence and it
grants no permission to compile, execute, seal, or judge anything. Existing reviewed
operations remain the only route from source bytes to Thread evidence.

The design is split deliberately:

- [authority and boundaries](authority.md)
- [domain model](domain-model.md)
- [commands and navigation](operations.md)
- [persistence and recovery](persistence-and-recovery.md)
- [CAD assembly bridge](cad-assembly-bridge.md)
- [implementation and retirement](implementation.md)

The proposed large-assembly extension is also split deliberately. None of these pages
widens the currently registered operations:

- [versioned source attachments](source-attachments.md)
- [server-resolved source dependency closure](dependency-closure.md)
- [SysML product-structure projection](sysml-product-structure-projection.md)
- [CAD part and module builds](cad-part-and-module-builds.md)
- [hierarchical geometry evidence](hierarchical-geometry-evidence.md)
- [incremental rebuild](incremental-rebuild.md)
- [Workbench for large assemblies](workbench-large-assemblies.md)
- [FEA targeting](fea-targeting.md)
- [large-assembly implementation plan](implementation-plan.md)

SysML/SysON is the sole authority for `PartDefinition`, `PartUsage`, hierarchy and
reuse. `ProjectSourceWorkspace` owns only files, revisions and their exact dependency
DAG. Any server product-structure view is derived from an exact SysON capture and is
rebuildable, cacheable and disposable. CAD and FEA may attach artifacts or analyses to
exact SysML identities; they cannot create, move or delete product structure.

Product and source navigation therefore starts from the exact sealed SysML/SysON graph.
Lean MCP read controls for the engineering agent and Workbench GET/SSE are thin
consumers of one application read-side navigation service. From a `System`, `PartUsage`
or `PartDefinition`, they expose attached sources, geometry, physics and verdict
evidence. Only after a semantic target and attached source are selected does
`ProjectSourceWorkspace` resolve technical imports or includes. Its dependency DAG is
never the product tree or a parallel product explorer.

The first proving vehicle is `motorized-camera-slider-mcs01`. Its architecture has
separate rail, carriage, mount, transmission, motor, driver and controller identities.
Its CAD, FEA, Modelica and SPICE sources must therefore remain separate resources.
