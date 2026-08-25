# Reference: Modelica domain

Audience: both · Diátaxis: reference · Kind: index

The Modelica bounded context owns the generic admitted source path: bounded source
analysis, admission, direct OpenModelica execution in a local microVM, and documentary
observations. Its current product profile is `modelica-closed-subset-v2` / `2.0.0`;
there is no admitted-source v1 fallback.

Start with:

- [Language](language.md) defines the bounded, family-free Modelica grammar and the
  source-owned experiment annotation.
- [Boundedness](boundedness.md) inventories enforced IR/runtime ceilings and missing
  token, expression-node, and identifier-length caps.
- [Execution](execution.md) defines server-owned execution, OMC/DASSL, evidence and the
  documentary boundary.
- [Coverage](coverage.md) inventories the current executable surface, the deliberately
  unsupported surface, and extension candidates.
- [Extension runbook](../../../how-to/extend/extend-admitted-modelica-coverage.md) is the implementation
  and proof checklist for a new language/profile version. A new model instance within
  the current grammar needs no code change.

Operate the path with
[Run admitted Modelica](../../../how-to/run/run-admitted-modelica.md). Its shared
reopen-to-microVM contract is
[Admitted source isolated execution](../../pipeline/admitted-source-isolated-execution.md).
