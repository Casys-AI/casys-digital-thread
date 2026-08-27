# Provider reference: SysON

Audience: both · Diátaxis: reference · Kind: provider map

SysON is a provider, not a Digital Thread bounded context. It serves several domains:
architecture writes system structure and requirements, FEA and sensitivity ask it to
evaluate reviewed scalar constraints, and presentation projects the resulting Thread
evidence without connecting to SysON.

Read:

1. [Modelling surface](modeling-surface.md) — container seed, generic architecture,
   PartDefinition capture, requirements and the separate agent-authored SysML path.
2. [Evaluation surface](evaluation-surface.md) — scalar constraints, qualified units,
   FEA and sensitivity evaluations, and unsupported solver features.
3. [Authority and runtime boundary](authority-and-runtime.md) — registered operations,
   the fixed provider-call subset, WAL/recovery and Workbench projection.

The provider advertises a wider fleet inventory than the product uses. A tool present in
that inventory is not automatically a registered engineering capability. The agent
cannot select a SysON endpoint, raw tool, AQL expression, UUID or SysML payload.

Shared references:

- [SysML boundedness](../../domains/sysml/boundedness.md) — proposal/live-graph
  cardinality; no SysON capacity in this repo justifies a number
- [SysML lookalike traps](../../agent/lookalike-traps.md#sysml)
- [Engineering project contract](../../contracts/engineering-project.md)
- [Provider responsibility map](../building-blocks.md)
- [Oracle units](../oracle-units.md)

The implementation of `mcp-syson` is delivered as a published image and is outside this
repository. These pages describe the Digital Thread adapters, contracts and configured
provider interface that are reviewable here; they do not claim the full native SysON
feature set.
