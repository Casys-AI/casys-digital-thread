# Reference: Modelica execution

Audience: both · Diátaxis: reference · Kind: contract

`simulate.run-admitted-modelica@1` reopens the exact bytes sealed by
`compile.seal-admission@3` under `modelica-closed-subset-v2` / `2.0.0`. Callers supply
neither source text, scenario, solver, image, nor provider choice.

## Direct OMC worker

For local execution, the server invokes a digest-pinned Modelica microVM worker. The
worker reauthorizes `/input/source.mo`, writes its server-owned `.mos` script, then
calls `omc` directly with DASSL. It is not an MCP Modelica-provider call. Network, image
pull, worker identity, executable allow-list, paths, and timeout are server-owned.

The source `annotation(experiment(...))` supplies start time, stop time, interval and
tolerance. The worker derives the number of intervals, fixes DASSL, and restricts OMC
CSV columns to the declared outputs in source order. It rejects non-finite values, wrong
columns, invalid starts, or incomplete experiment-grid coverage.

## Evidence and metric contract

The worker emits exactly `evidence.json` (`modelica-isolated-evidence/2.0`) and
`result.csv`. For every declared output, in declared order, evidence contains:

| Statistic | Meaning                           | Unit                        |
| --------- | --------------------------------- | --------------------------- |
| `final`   | Value at the annotation stop time | That output's declared unit |
| `max_abs` | Maximum absolute sampled value    | That output's declared unit |

The executor cross-checks the reopened source, scenario, resolved parameters, metrics,
output manifest, and isolated-run receipt before publishing the execution capture and
observations. It does not create a requirement, evaluation, violation, or product
verdict: success remains `documentary`.

## Replay and authority

Completed replay reopens the durable claim, WAL, CAS outputs, capture and exact Thread
successor without calling OMC again. An uncertain generation-0 result may allow one
generation-1 dispatch only after exact absence and cleanup are proven. There is no
generation 2, and pre-WAL development runs are not adopted as current authority.

`simulate.run-qualified-modelica-kit@1` is a separate image-owned conformance path;
historical `simulate.seal-simulation-case@1`/`@2` and
`simulate.run-modelica-scenario@1`/`@2` are retired and not registered; they are not
fallbacks for admitted source.
