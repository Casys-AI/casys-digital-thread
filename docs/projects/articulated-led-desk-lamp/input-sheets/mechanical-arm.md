# G2 — mechanical arm input sheet

Audience: human · Diátaxis: how-to · Kind: decision input

Status: `unknown` until every required row has an exact value and source.

## Subject and geometry

| Required fact                                                    | Human/source entry                       |
| ---------------------------------------------------------------- | ---------------------------------------- |
| Product revision                                                 | `unknown`                                |
| Canonical subject                                                | `ArticulatedArm` only; confirm or reject |
| Geometry source identity, revision, media type, and fingerprint  | `unknown`                                |
| Named parameter controlled by `armLever`                         | `unknown`                                |
| All other geometry dimensions needed to regenerate the same part | `unknown`                                |

## Material and case

| Required fact                                       | Human/source entry |
| --------------------------------------------------- | ------------------ |
| Material identity and property source               | `unknown`          |
| Elastic modulus and unit                            | `unknown`          |
| Poisson ratio                                       | `unknown`          |
| Density and unit, if the declared case uses it      | `unknown`          |
| Support region and rationale                        | `unknown`          |
| Load region, direction, magnitude, unit, and source | `unknown`          |
| Applicability assumptions and exclusions            | `unknown`          |

## Criteria and consequence

| Required fact                                            | Human/source entry |
| -------------------------------------------------------- | ------------------ |
| Displacement metric, operator, threshold, and unit       | `unknown`          |
| Stress metric, operator, threshold, and unit             | `unknown`          |
| Intended consequence of `pass`, `fail`, and `unresolved` | `unknown`          |
| Responsible reviewer                                     | `unknown`          |

Do not provide a CalculiX payload, mesh command, provider name, image, path, or runtime
option. After review, the server compiles the facts into the registered CAD and FEA
operations. A solver success remains L3 until the separate criterion evaluation.
