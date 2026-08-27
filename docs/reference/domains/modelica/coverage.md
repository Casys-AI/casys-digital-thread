# Reference: Modelica coverage

Audience: both · Diátaxis: reference · Kind: inventory

This is the current worktree surface of the admitted product path, not a claim of
general Modelica support. The source profile is `modelica-closed-subset-v2` / `2.0.0`.
The exact grammar and execution contracts remain [Language](language.md) and
[Execution](execution.md); this page does not restate them.

## Supported now

| Surface                     | Current contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source capture              | One canonical UTF-8 `.mo` root is analyzed by `modelica-qualified-mo-subset@2.0.0`. The same v2 authorizer is used again by the worker, so a captured source cannot be admitted if the worker would reject it.                                                                                                                                                                                                                                                                                             |
| Executable model            | Scalar `parameter Real` and `output Real`; one `equation` section; one equation per output; at least one `der(output) = expression`; algebraic output equations may be mixed in. Expressions use declared scalar names, finite literals, parentheses and `+ - * /`.                                                                                                                                                                                                                                        |
| Scenario                    | The exact source-owned `annotation(experiment(...))` supplies start, stop, interval and tolerance. The bounded time/grid rules are enforced by the authorizer and rechecked against OMC output.                                                                                                                                                                                                                                                                                                            |
| Source analysis             | The analysis bundle contains model, parameter, output and equation symbols plus structural-incidence and static-value-flow dependencies. Parameter bindings are joined by the compiler; names and labels are not the authority.                                                                                                                                                                                                                                                                            |
| Admission                   | The immutable technical-compilation catalogue has one `modelica-source-qualification` profile. Admission requires unique `parameterizes` bindings for every parameter symbol; the root artifact does not need `represents`. `compile.seal-admission@3` seals the analyzed source and its exact compilation identity.                                                                                                                                                                                       |
| Execution                   | `simulate.run-admitted-modelica@1` reopens those sealed bytes, runs direct OMC/DASSL in the server-owned, digest-pinned local microVM, and publishes only `evidence.json` and normalized `result.csv`. This is admitted L3.                                                                                                                                                                                                                                                                                |
| Evidence                    | Per declared output, in source order, `final` and `max_abs` are validated against the reopened model, scenario, parameter defaults, result bytes and isolated-run receipt. The Thread successor is documentary, not a requirement verdict.                                                                                                                                                                                                                                                                 |
| Conditional evaluation (L4) | `verify.evaluate-admitted-modelica-observations@1` is registered and conditional: the reviewed thermal sheet signs `requirementElementId` **and** `requirementMetric`, and the server requires one exact current Thread requirement for that pair before evidence, SysON or MRTR. SysON then compares the exact admitted observation. A unit-identity mismatch stays `unresolved`. An L4 `pass` is not a product verdict, not L5, and not a whole-lamp proof. A local AL01 walk is tracking evidence only. |
| Human closeout (L5)         | `project_admitted_modelica_evaluation_closeout_review` is the provider-free read of the unique current L4 and recrosses that same `(requirementElementId, requirementMetric)` pair. `decide.accept-admitted-modelica-evaluation@1` and `decide.reject-admitted-modelica-evaluation@1` are human-only documentary closeout of that exact capture. They never call SysON or OMC. Both accept and reject name the same identities and differ only in consequence. L4 `pass` is never implicit L5.             |
| Recovery                    | A durable attempt/WAL controls generation 0, at most one proven-absent generation-1 redispatch, and replay without another OMC call.                                                                                                                                                                                                                                                                                                                                                                       |

Within that surface, a new model is data, not an implementation project: capture a new
source, provide the necessary architecture bindings, seal it, obtain the separate human
MRTR, and run it. No parser, worker, image or registry change is needed.

Named runtime proof: MCS-02 admitted an attachment-rooted scalar carriage-motion model,
executed it through OMC/DASSL, evaluated the exact delivered observation and reached L5
at Thread r16. See
[MCS-02 Modelica](../../../project-dossiers/motorized-camera-slider-mcs02/domains/modelica.md).
That example proves generic scalar motion inside v2; it does not widen the language or
turn the historically thermal-named method sheet into a thermal-only contract.

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

These are possible _new closed-language versions_, each requiring the runbook below;
none is silently enabled by an OpenModelica capability or an installed MSL package.

| Candidate family           | Closed object to define before implementation                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Richer scalar equations    | Exact unary/binary operators and a finite, versioned intrinsic-function table, including numerical and determinism expectations.                               |
| Declarative initialization | An exact `initial equation` form and an unambiguous initialization/evidence contract.                                                                          |
| Vector or record data      | Fixed shapes, indexing and result-column normalisation, with bounded memory/output semantics.                                                                  |
| Component composition      | A finite catalogue of component classes, parameters and connectors, derived from a pinned MSL/image inventory with a declared flattening and provenance model. |
| More experiment semantics  | A finite set of additional annotation fields only when their OMC lowering, output-grid effects and evidence meaning are fixed.                                 |
| Physical-model families    | Versioned, maintained qualified kits or a broader closed product grammar with corpus/proof coverage; executability alone is insufficient.                      |

## Explicitly refused architectural substitutions

The following are not extension shortcuts:

- General or arbitrary Modelica, arbitrary MSL imports, and worker-only parsing.
  Coverage grows by a versioned common grammar, not by allowing whatever OMC accepts.
- Caller-selected source bytes at execution, solver, image, provider, command, runtime
  alias or scenario. The server reopens the sealed admission and owns those choices.
- Treating raw CAS as Modelica source ingress. A `.mo` file enters through
  `project_resource_capture`, a workspace file + attachment, then
  `project_technical_source_capture` (`projectId` + `workspaceRevision` +
  `attachmentId` + `attachmentRevision`). A thermal method sheet may be interpreted at
  upload through the existing typed store.
  Admitted execution still starts from `compile.seal-admission@3`.
- Treating the image-owned qualified kit as a fallback for admitted source.
- Claiming a desk-lamp thermal proof from admitted L3, kit smoke, or an L4 comparator.
- Calling a successful simulation a product/FEA requirement verdict, or bypassing the
  human MRTR and the sealed admission.

## Retired route (tombstone)

Historical `simulate.seal-simulation-case@1`/`@2` and
`simulate.run-modelica-scenario@1`/`@2` are not registered and are not fallbacks for
admitted L3, the qualified kit, L4, or L5. Internal planning history for that retired
route is intentionally not exported.

For the shared authority boundary, see
[admitted source isolated execution](../../pipeline/admitted-source-isolated-execution.md).
