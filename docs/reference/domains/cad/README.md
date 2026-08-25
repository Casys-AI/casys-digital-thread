# CAD domain reference

Audience: both · Diátaxis: reference · Kind: contract

This directory is the living reference for the CAD domain. It separates the source
language the atelier can currently understand from the two ways admitted source can
produce geometry. RFCs describe delivered work or future direction; they are not the
runtime contract.

Read:

1. [CAD coverage](coverage.md) — current product surface, unsupported constructs,
   candidates, and explicit non-goals.
2. [Build123d closed subset v1](build123d-closed-subset-v1.md) — D4, the analyzer,
   supported forms, explicit gaps, and admission limits.
3. [CAD boundedness](boundedness.md) — H01 inventory of enforced source/token/runtime
   ceilings and missing AST cardinality.
4. [CAD execution paths](execution-paths.md) — canonical admitted export versus the
   documentary isolated microVM path.
5. Immediate placement capture lives under `src/domain/cad/placement/`. It is not a CAD
   script, not technical-source admission, and not module export.
6. [Extension runbook](../../../how-to/extend/extend-cad-closed-subset.md) — the required end-to-end
   work to add a construct without widening authority.

Shared contracts:

- [Source analysis and authority pipeline](../../pipeline/analysis-authority-pipeline.md)
  for capture → analysis → MRTR → dispatch.
- [Admitted source isolated execution](../../pipeline/admitted-source-isolated-execution.md)
  for the reusable local-microVM pattern.
- [Run the behave loop from zero](../../../how-to/verify-design/verify-a-new-design-from-scratch.md)
  for the product walk.

The project may capture source inside the closed language; that does not grant the agent
authority to invent unreviewed CAD text for a renderer path. The server owns the
analyzer, compilation profile, provider/runtime, command, paths, formats, limits,
validation, and recovery. A human signs each consequential MRTR. No successful CAD
execution is a requirement verdict.
