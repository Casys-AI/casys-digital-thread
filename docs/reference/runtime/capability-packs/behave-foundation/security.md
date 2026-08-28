# Behave Foundation security boundary

Review date: 2026-08-28.

This is a local developer candidate, not an internet-facing production topology.

- Compose ports selected by the pack are explicitly loopback-only.
- SysON and `mcp-syson` can mutate a system model and remain privileged local services.
- `mcp-build123d-sandbox` executes admitted CAD source in a bounded container with a
  private export volume, dropped capabilities and `no-new-privileges`; it is not a
  general remote code-execution service.
- The CalculiX worker runs through the fixed Microsandbox profile with deny-all network,
  `pullPolicy: never`, fixed executables and server-owned limits.
- The pack and its diagnostic expose no provider, endpoint, image, tool or argument
  selection to an engineering agent.
- Installation planning reads local state only. It does not pull, start, stop, bind,
  dispatch or qualify anything.

This review does not approve public MCP exposure, remote Docker access, host networking,
Docker-socket mounting, arbitrary Compose input, hidden install hooks or production
secrets. Those conditions remain blockers for a production pack.
