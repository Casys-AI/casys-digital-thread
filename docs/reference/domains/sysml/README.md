# Reference: SysML domain

Audience: both · Diátaxis: reference · Kind: index

This domain is a deliberately small architecture and evidence surface, not general SysML
v2 authoring. It has two non-interchangeable paths:

- `model.write-architecture@1` parses a human-approved flat proposal, renders
  deterministic SysML and writes the exact seeded SysON model.
- `model.seal-architecture-sysml@1` captures and analyses agent-authored SysML in a
  locked closed subset, then seals it only as a documentary Thread document. It never
  calls SysON.

Architecture seeding, exact PartDefinition capture and scalar requirements use the same
bounded provider-backed evidence path; requirements are not a free-form SysML authoring
escape hatch.

- [Coverage](coverage.md) separates the implemented language and evidence surface from
  candidates and explicit exclusions.
- [Boundedness](boundedness.md) inventories proposal/live-graph cardinality: uniqueness
  is enforced; no upper count exists, and SysON capacity in this repo does not supply
  one.
- [Extension runbook](../../../how-to/extend/sysml-surface.md) is the required path for
  a new generic SysML concept.
- [SysON provider reference](../../providers/syson/README.md) owns the configured
  provider-call subset, runtime, WAL and recovery details.
- [Author and seal architecture SysML](../../../how-to/compile/author-architecture-sysml.md)
  is the operational guide for the provider-free source path.

The shared authority rules remain in the
[agent workspace](../../agent/agent-workspace.md): an agent can propose registered
operations, while server code fixes language profiles, rendering, provider calls,
parsing and recovery.
