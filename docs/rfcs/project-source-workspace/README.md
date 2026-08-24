# RFC: modular project source workspace

Status: accepted for implementation · Owner: Digital Thread architecture

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

The first proving vehicle is `motorized-camera-slider-mcs01`. Its architecture has
separate rail, carriage, mount, transmission, motor, driver and controller identities.
Its CAD, FEA, Modelica and SPICE sources must therefore remain separate resources.
