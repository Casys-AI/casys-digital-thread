# Reference: SysML domain

Audience: both · Diátaxis: reference · Kind: index

This domain is a deliberately small architecture and evidence surface, not general SysML
v2 authoring. It has two non-interchangeable paths:

- `model.write-architecture@1` parses a human-approved flat proposal, renders
  deterministic SysML, inserts it into the seeded SysON model, and rereads
  `architecture-capture/4.0`.
- `model.seal-architecture-sysml@1` seals a previously captured closed-subset analysis
  as a documentary Thread document only. It never calls SysON. Public ingress is
  `project_resource_capture` → full `resourceRef` →
  `project_architecture_sysml_source_capture`; preview is `sourceRef` only.

Read:

- [Language](language.md) — textual UTF-8 `sysml-v2`, closed-subset tokens/forms,
  262144-byte bound, resource immutability.
- [Paths](paths.md) — renderer/SysON versus agent-authored seal; distinct identities.
- [Coverage](coverage.md) — implemented surface, exclusions, extension candidates.
- [Boundedness](boundedness.md) — proposal/live-graph cardinality inventory (H01).
- [Extension runbook](../../../how-to/extend/extend-generic-sysml-surface.md) — required path for a new
  generic SysML concept.
- [SysON provider reference](../../providers/syson/README.md) — configured provider-call
  subset, runtime, WAL and recovery.
- [Author and seal architecture SysML](../../../how-to/compile/author-architecture-sysml.md)
  — operational guide for the provider-free source path.

The shared authority rules remain in the
[agent workspace](../../agent/agent-workspace.md): an agent can propose registered
operations, while server code fixes language profiles, rendering, provider calls,
parsing and recovery.
