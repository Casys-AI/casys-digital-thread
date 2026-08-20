# Reference: Modelica domain

Audience: both · Diátaxis: reference · Kind: index

The Modelica bounded context owns closed-subset source analysis and admission, local
execution evidence and documentary observations. Its code keeps `source/`, `admitted/`,
`qualified-kit/` and historical `recorded/` authorities separate. It does not own
requirement evaluation or a product verdict.

Start with:

- [Closed subset v1](closed-subset-v1.md) — the exact `.mo` form that the admitted
  worker can execute, its fixed scenario, and the known frontend/worker gap.
- [Execution profiles](execution-profiles.md) — qualified kit versus admitted source,
  authority, outputs and replay.

To operate the product path, follow
[Run admitted Modelica](../../../how-to/run/run-admitted-modelica.md). The shared
reopen-to-microVM contract lives in
[Admitted source isolated execution](../../pipeline/admitted-source-isolated-execution.md).
The wider compiler doctrine lives in
[Closed-language compilation](../../../explanations/product/closed-language-compilation.md).
