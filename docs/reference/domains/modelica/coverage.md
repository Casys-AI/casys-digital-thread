# Reference: Modelica coverage

Audience: both · Diátaxis: reference · Kind: inventory

This is the current worktree surface of the admitted product path, not a claim of
general Modelica support. The source profile is `modelica-closed-subset-v2` / `2.0.0`.
The exact grammar and execution contracts remain [Language](language.md) and
[Execution](execution.md); this page does not restate them.

## Supported now

| Surface | Current contract |
| --- | --- |
| Source capture | One canonical UTF-8 `.mo` root is analyzed by `modelica-qualified-mo-subset@2.0.0`. The same v2 authorizer is used again by the worker, so a captured source cannot be admitted if the worker would reject it. |
| Executable model | Scalar `parameter Real` and `output Real`; one `equation` section; one equation per output; at least one `der(output) = expression`; algebraic output equations may be mixed in. Expressions use declared scalar names, finite literals, parentheses and `+ - * /`. |
| Scenario | The exact source-owned `annotation(experiment(...))` supplies start, stop, interval and tolerance. The bounded time/grid rules are enforced by the authorizer and rechecked against OMC output. |
| Source analysis | The analysis bundle contains model, parameter, output and equation symbols plus structural-incidence and static-value-flow dependencies. Parameter bindings are joined by the compiler; names and labels are not the authority. |
| Admission | The immutable technical-compilation catalogue has one `modelica-source-qualification` profile. `compile.seal-admission@1` seals the analyzed source and its exact compilation identity. |
| Execution | `simulate.run-admitted-modelica@1` reopens those sealed bytes, runs direct OMC/DASSL in the server-owned, digest-pinned local microVM, and publishes only `evidence.json` and normalized `result.csv`. |
| Evidence | Per declared output, in source order, `final` and `max_abs` are validated against the reopened model, scenario, parameter defaults, result bytes and isolated-run receipt. The Thread successor is documentary, not a requirement verdict. |
| Recovery | A durable attempt/WAL controls generation 0, at most one proven-absent generation-1 redispatch, and replay without another OMC call. |

Within that surface, a new model is data, not an implementation project: capture a new
source, provide the necessary architecture bindings, seal it, obtain the separate human
MRTR, and run it. No parser, worker, image or registry change is needed.

## Outside the current executable surface

These forms are rejected rather than partially interpreted: packages or multiple root
models; `within`, `import`, `extends`; MSL or other component instances; connectors and
`connect`; inputs, states other than declared outputs, arrays, records, enumerations and
other types; functions, algorithms, `when`/events, `initial equation`, assertions and
external code; extra sections or annotations; and expression operators/functions beyond
the scalar arithmetic listed in [Language](language.md).

The profile also does not establish physical unit compatibility, parameter calibration,
telemetry/state estimation, requirement evaluation, product compliance, or an FEA
verdict. A syntactically valid unit is carried as declared text; it is not dimensional
reasoning.

## Extension candidates — not commitments

These are possible *new closed-language versions*, each requiring the runbook below;
none is silently enabled by an OpenModelica capability or an installed MSL package.

| Candidate family | Closed object to define before implementation |
| --- | --- |
| Richer scalar equations | Exact unary/binary operators and a finite, versioned intrinsic-function table, including numerical and determinism expectations. |
| Declarative initialization | An exact `initial equation` form and an unambiguous initialization/evidence contract. |
| Vector or record data | Fixed shapes, indexing and result-column normalisation, with bounded memory/output semantics. |
| Component composition | A finite catalogue of component classes, parameters and connectors, derived from a pinned MSL/image inventory with a declared flattening and provenance model. |
| More experiment semantics | A finite set of additional annotation fields only when their OMC lowering, output-grid effects and evidence meaning are fixed. |
| Physical-model families | Versioned, maintained qualified kits or a broader closed product grammar with corpus/proof coverage; executability alone is insufficient. |

## Explicitly refused architectural substitutions

The following are not extension shortcuts:

- General or arbitrary Modelica, arbitrary MSL imports, and worker-only parsing. Coverage
  grows by a versioned common grammar, not by allowing whatever OMC accepts.
- Caller-selected source bytes at execution, solver, image, provider, command, runtime
  alias or scenario. The server reopens the sealed admission and owns those choices.
- Treating the image-owned qualified kit or historical recorded Modelica operations as
  a fallback for admitted source.
- Calling a successful simulation a product/FEA requirement verdict, or bypassing the
  human MRTR and the sealed admission.

For the shared authority boundary, see
[admitted source isolated execution](../../pipeline/admitted-source-isolated-execution.md).
