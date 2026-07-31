# Explanation: why proofs and verdicts are separate

> **Diátaxis category: explanation.** This page explains the architectural boundary. For
> file locations, use the [building-block reference](../reference/building-blocks.md);
> for a first run, use the
> [CoffeeMachine tutorial](../tutorials/coffee-machine-nominal.md).

A tool succeeding means it completed the work it owns. It does not mean a product is
compliant. Geometry, FEA, and dynamic simulation answer different physical questions; a
requirement/constraint evaluation decides whether a named condition is satisfied by
named, unit-bearing evidence.

```mermaid
flowchart LR
  R["SysML requirements and constraints\nmcp-syson"] --> V["Units-aware evaluation\nverdict + margin"]
  G["Parametric CAD\nmcp-build123d"] --> P["Geometry proof\nmetrics + STEP export"]
  P --> F["Static FEA\nmcp-calculix"]
  F --> E["Mechanical evidence"]
  M["Dynamic physical simulation\nmcp-modelica"] --> S["Time-series evidence\nmetrics + artifact hashes"]
  E --> V
  S --> V
  V --> C["Read-only Console / MCP App\nshows proof and verdict separately"]
```

## Four questions, four owners

| Question                                                                                 | Owner                                | A successful response proves                                                               | It does not prove                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| What shape, volume, mass, or export was produced?                                        | `mcp-build123d`                      | A parametric geometry execution and its exact geometry/export evidence.                    | Local stress, transient behaviour, or requirement compliance.                              |
| Does this geometry withstand a stated static load model?                                 | `mcp-calculix`                       | A mesh/solver result for that geometry, load case, material assumptions, and solver setup. | That the CAD is the only valid design or that an unrelated requirement passed.             |
| What happens over time in coupled thermal, hydraulic, electrical, and control behaviour? | `mcp-modelica`                       | A versioned model/scenario run, observations, and hashed artifacts.                        | A SysML requirement verdict; its `succeeded` run intentionally has no `pass`/`fail` field. |
| Is a named, unit-bearing condition satisfied by supplied evidence?                       | `mcp-syson` and the constraint layer | A comparison with the condition, values, units, and margin visible.                        | That the input evidence is broader, newer, or more applicable than its provenance says.    |

This separation prevents a common but dangerous shortcut: treating a green solver exit
code as a product claim. A solver is authoritative about its own execution and result.
It is not authoritative about the business meaning, scope, identity, unit conversion, or
traceability of a requirement.

## A verdict is a join, not a field added by a solver

To make a verdict, the evaluator needs all of the following:

- a named constraint or requirement, including its expression and units;
- evidence whose metric identity and units are understood;
- provenance tying the evidence to the model, scenario, geometry, load case, artifacts,
  and versions that were actually used;
- a policy for insufficient or incompatible evidence.

The result may be `passed` or `failed`, but it may also be `unresolved` or `error`.
Those latter states are evidence that the comparison could not be made reliably, not
concealed successes. Keeping this result in a separate stage makes its inputs
inspectable and prevents accidental reuse of a verdict for a merely similar run.

For CoffeeMachine, the current `water_temperature_max >= 90 degC` check is a versioned
**provisional scenario contract**. It is applied only after exact model/scenario
identity binding. It demonstrates the evidence-to-constraint path; it is not a product
requirement stored in SysON, and the `900 s` horizon is provenance rather than an
invented heat-up-time limit.

## Why MCP Apps do not collapse the boundary

`mcp-server` transports tools and resources using the stateless `2026-07-28` contract.
`mcp-view` renders the structured result from one source server. `mcp-compose` lays out
source-bound panels and relays only declared App calls. The Console observes and
projects those stages read-only.

None of these presentation or transport layers may turn an evidence payload into an
unstated verdict. A view can make the relationship legible—stage, metric, limit, margin,
hashes, and provenance—but it cannot supply missing requirements, infer a unit, or
override an `unresolved` state. This is why a dashboard is useful for navigation and
review but is not itself the engineering authority.

## Structured results make the separation usable

A v1 `structuredContent` envelope gives the view an explicit, testable contract instead
of requiring it to scrape human text. The Modelica example has a `schemaVersion: "1.0"`,
a `kind`, and a run payload; a comparison is another typed stage with its own status and
provenance. This supports standard views without normalising away domain meaning:

- a CAD viewer can show dimensions and exported artifacts;
- an FEA viewer can show load assumptions and solver evidence;
- a Modelica viewer can show metrics and time-series artifacts;
- a verification view can show the exact condition, units, margin, and result.

The common rendering shell is not a common physical model or a universal verdict schema.
Standardise the transport and visible evidence discipline; keep calculation semantics
with the server that owns them.
