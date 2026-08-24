# RFC: modular project source workspace

Core workspace and attachment-rooted technical-source bridge status: implemented and
runtime-proven on MCS-02 · Owner: Digital Thread architecture

Large-assembly extension status: in progress. Exact SysML navigation, versioned
authoring attachments, single-root closure/admission recross, targeted CAD, Modelica
and SPICE, plus downstream part-level FEA, are proven. Multi-file language lowering,
placements, hierarchical assembly evidence, incremental rebuild and assembly-level FEA
remain proposed or `unavailable`.

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

The large-assembly extension is also split deliberately. Each page states whether its
slice is implemented or still proposed; an RFC page never widens a registered
operation by itself:

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
consumers of one application read-side navigation service. From the semantic-root
`PartDefinition` representing the system, any exact `PartDefinition`, or any exact
`PartUsage`, they expose attached sources, geometry, physics and verdict evidence. Only
after a semantic target and attached source are selected does
`ProjectSourceWorkspace` resolve technical imports or includes. Its dependency DAG is
never the product tree or a parallel product explorer.

The current proving vehicle is `motorized-camera-slider-mcs02`. Its architecture keeps
rail, carriage, mount, transmission, motor, driver and controller identities separate.
MCS-02 proved separate workspace resources and targeted single-root verticals; it did
not prove a complete multi-piece CAD assembly or hierarchical assembly evidence.
