# G4 — thermal head input sheet

Audience: human · Diátaxis: how-to · Kind: decision input

Status: `unknown` until the boundary, equations, parameters, experiment, observations,
and criterion share one reviewed source set.

## Model boundary and sources

| Required fact                                             | Human/source entry |
| --------------------------------------------------------- | ------------------ |
| Product revision and subject `LampHead`                   | `unknown`          |
| Physical boundary represented by the scalar model         | `unknown`          |
| Equation source and revision                              | `unknown`          |
| Assumptions, exclusions, and applicability range          | `unknown`          |
| Initial-state meaning owned by `lampHeadThermalState`     | `unknown`          |
| Electrical-power input meaning owned by `electricalPower` | `unknown`          |

## Parameters, experiment, and criteria

For every parameter, record its stable name, meaning, value, unit, source, and whether
it is an input, initial state, coefficient, or output. Then record:

| Required fact                                                        | Human/source entry |
| -------------------------------------------------------------------- | ------------------ |
| Experiment start, stop, and output grid                              | `unknown`          |
| Requested output names and observation method (`final` or `max_abs`) | `unknown`          |
| Requirement metric, operator, threshold, and unit                    | `unknown`          |
| Intended consequence of `pass`, `fail`, and `unresolved`             | `unknown`          |
| Responsible reviewer                                                 | `unknown`          |

The human supplies engineering semantics, not `.mo` provider envelopes, OMC arguments,
paths, or images. The admitted-source path can compile agent-authored closed-subset
Modelica only from the reviewed sheet. Execution success is not an L4 verdict, and L4 is
not L5.
