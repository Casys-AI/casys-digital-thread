# Reference: engineering providers

Audience: both · Diátaxis: reference · Kind: index

Providers are outer-ring capabilities, not bounded contexts. CAD, Modelica, FEA,
architecture and sensitivity own the engineering meaning; a provider supplies one
versioned implementation surface behind server-owned ports.

Start with:

- [Capability-oriented provider architecture](capability-oriented-provider-architecture.md)
  — application ports, provider adapters and the Digital Thread evidence boundary.
- [Building blocks and artifact ownership](building-blocks.md) — responsibility map
  across the provider fleet and Digital Thread.
- [Engines, analyses, evidence and evaluations](provider-analysis-oracle-taxonomy.md) —
  why an engine, an observation and a verdict are different authorities.
- [SysON](syson/README.md) — the SysON capability actually composed by registered
  Digital Thread operations.
- [mcp-spice](spice/README.md) — pinned provider surface, D2 preflight and literal
  electrical gaps; not an executable product adapter.
- [Oracle units](oracle-units.md) — probed unit round trips and explicit gaps.

The desired provider inventory in `config/mcp-fleet.json` is a deployment and drift
contract. It is not agent authority. Agents call registered Digital Thread operations;
the server owns provider selection, tool names and arguments.
