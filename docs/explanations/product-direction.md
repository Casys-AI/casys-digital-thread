# Explanation: product direction and delivery boundary

This page is the product compass for Casys Digital Thread. It separates the verified
workspace from the intended V1 product and from later possibilities. Tutorials and
reference pages describe exact commands and schemas; this page explains what the product
is trying to make simple for a person who is not already a CAD, SysML, FEA, or ERP
specialist.

## Product promise

Casys Digital Thread is an agent-assisted industrial design cockpit. A person explains
what they want to build, reviews consequential choices, and inspects evidence. The agent
prepares technical proposals, uses engineering tools, links outputs, and reports what a
change affects. Deterministic modelers, solvers, and constraint evaluators produce the
facts; the language model does not certify its own work.

The product is not a dashboard of MCP applications. MCP is the provider protocol behind
the product. The user-facing object is one linked project:

```text
intent -> system model -> geometry -> physics -> requirements -> evidence -> review
                          ^                                      |
                          +------------- correction -------------+
```

The human owns intent, expensive or safety-relevant decisions, and authorization. The
agent owns preparation and orchestration. The interface should not ask a beginner to
invent solver payloads, legal categories, material properties, mesh controls, or
acceptance limits when tools or sourced guidance can prepare them for review.

## Three entry points, one engineering loop

V1 should accept three starting conditions without becoming three separate products:

1. **Start from an idea.** Guided discovery turns plain-language intent into an
   approved, fingerprinted brief before a technical project exists.
2. **Start from existing CAD.** An imported artifact becomes sourced input to recover
   structure, dimensions, assumptions, and missing intent before verification or change.
3. **Start from an existing product.** Drawings, measurements, supplier evidence, and
   available geometry seed a reverse-engineering project. Unknowns stay explicit.

Generated parametric CAD, imported STEP, and reconstructed geometry are not equivalent.
Every source must retain its identity, fingerprint, license or usage basis, conversion
history, and any lost design intent. Passing a physics check does not by itself make an
imported model editable, complete, manufacturable, or legally reusable.

The same loop follows every entry point: identify the current truth, propose the
smallest change, derive or import exact artifacts, run the relevant physics, evaluate
named requirements with units and margins, expose downstream impact, and ask the human
only for the review that matters.

## Beginner-first interface contract

The primary experience is a shared workspace for a person and an agent, not an expert
tool launcher.

- Show the project stage, the agent's current work, the next consequential review, and
  the latest evidence before exposing provider or protocol details.
- Keep one primary navigation layer. Avoid nested rails, repeated section chrome, and
  multiple panels competing for the same task.
- Use the activity feed as the chronological work surface. Selecting an event or product
  element reveals its exact evidence and impact.
- Show contextual lineage by default. A large complete graph belongs in an expandable,
  zoomable workspace; it must not be squeezed into a small dashboard card.
- Keep SysON, build123d, CalculiX, Modelica, ERPNext, hashes, and raw tool records
  available under inspection, but do not require those names to understand progress.
- Use one visual language and one set of design tokens across project, activity,
  product, evidence, and execution views.

Complexity may exist in the engineering record. It should appear progressively, when it
answers the user's current question.

## Independence from engineering vendors

The strategic boundary is the linked project, provenance, orchestration, and evidence
contract. The default stack uses open components such as SysON, OpenCascade/build123d,
CalculiX, OpenModelica, and ERPNext so the core loop can run without a proprietary
design suite. Proprietary CAD, CAE, PLM, or ERP systems may later be optional providers;
they must not own the canonical product state or be required by the UI architecture.

Open tooling does not eliminate hard geometry work. Robust assemblies, feature recovery,
tolerancing, surfacing, drawings, manufacturing process planning, and domain-specific
physics remain product work. The thread makes evidence portable and gaps visible; it
does not claim that every commercial authoring capability has already been replaced.

## Delivery boundary

| Horizon               | Honest scope                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verified now**      | One native engineering cockpit plus a separate guided Discovery Workbench with a live human handoff; exact SysON, CAD, Modelica, ERPNext, and CalculiX evidence; one approved CM-01 DripTray mechanical proof loop. |
| **V1 product target** | A beginner can move from idea or imported product evidence to a reviewable project, agent-orchestrated proof cases, visible change impact, correction proposals, and inspectable BOM/cost evidence.                 |
| **V2 candidate**      | Operational digital-twin instances fed by real telemetry, time-series storage, state estimation, model calibration, contextual scenario testing, and service-life decisions.                                        |

The current Modelica branch is design-time simulation evidence. `syson_value_set` and
constraint tools are useful primitives, but they do not constitute telemetry ingestion,
an operational asset identity, calibration, or a Digital Twin Instance. Operational twin
claims remain out of V1 until those boundaries exist and are demonstrated with measured
data.

## Demo criterion

The convincing demonstration is not the number of connected tools. It is one visible
loop in which a beginner states an objective, the agent prepares a model and a bounded
decision, geometry appears, physics runs in the activity feed, named requirements pass
or fail with margins, a correction updates the affected chain, and cost or manufacturing
evidence remains inspectable. Anything that does not make that loop clearer is secondary
to V1.
