# Explanation: product direction and delivery boundary

Audience: both · Diátaxis: explanation · Kind: contract

This page is the product compass for Casys Digital Thread. It separates the verified
workspace from the intended V1 product and from later possibilities. Tutorials and
reference pages describe exact commands and schemas; this page explains what the product
is trying to make simple for a person who is not already a CAD, SysML, FEA, or ERP
specialist.

## Product promise

Casys Digital Thread is an agent-assisted industrial design cockpit. A person explains
what they want to build and makes consequential choices in conversation with the agent.
The agent prepares technical proposals, orchestrates engineering tools, links outputs,
and reports what a change affects. The cockpit is the live, organized dossier where the
person inspects the resulting project, activity, lineage, and evidence. Deterministic
modelers, solvers, and constraint evaluators produce the facts; the language model does
not certify its own work.

The product is not a dashboard of MCP applications. MCP is the provider protocol behind
the product. The user-facing object is one linked project:

```text
intent -> system model -> geometry -> physics -> requirements -> evidence -> review
                          ^                                      |
                          +------------- correction -------------+
```

The human owns intent and expensive, safety-relevant, or release decisions. They express
that authority in the paired conversation, including explicit MCP elicitation when a
decision must be bound to an exact revision. The agent owns preparation, orchestration,
and bounded tool execution. The cockpit is not a second command channel. It should not
ask a beginner to invent solver payloads, legal categories, material properties, mesh
controls, or acceptance limits when tools or sourced guidance can prepare them for
review.

Traceability is not the product's end state. It gives the agent a reliable feedback
surface: observe what a change affects, evaluate named requirements, propose the
smallest bounded correction, request recomputation, and bring only the consequential
impact back to the person for review. The agent is therefore useful because it can work
through bounded feedback loops; the durable trace makes those loops inspectable,
repeatable, and safe.

## Three entry points, one engineering loop

V1 should accept three starting conditions without becoming three separate products:

1. **Start from an idea.** The project exists from the first plain-language intent; its
   living brief is refined and fingerprinted in place before technical work begins.
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
only for the review that matters. A published project path is the first durable input to
that loop, not proof that a provider has run or that a technical conclusion is true.

## Beginner-first interface contract

The primary experience is a paired agent conversation plus a shared read-only dossier,
not an expert tool launcher or a collection of forms.

- Show the project stage, the agent's current work, the next consequential review, and
  the latest evidence before exposing provider or protocol details.
- Ask and answer in the conversation. When exact human authority is required, present
  the bounded choice there through signed MCP elicitation and project the result into
  the dossier.
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

| Horizon               | Honest scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Verified now**      | One native read-only project cockpit from first intent onward. Schema-`3.0` project revisions own guided questions, sourced answers, proposed and canonical brief truth, the reviewed path, runs and evidence references. The MCP surface creates a project only through its explicit project flow; the cockpit is focus-only and never substitutes a default project. Signed MRTR binds an accepted host response to the exact brief or decision request. `baseline.from-approved-brief@1` records documentary r1 and `architecture.seed-syson-model@2` records a brief-bound SysON container capture `2.0` at r2. Generic proof sealing and isolated CalculiX `@3` have distinct admissions. Historical MCP FEA `@1`/`@2` are rejected identities, not routes. A reread historical `@2` Thread revision may exist locally for `desk-lamp-dl04` / `desk-lamp-dl05` under gitignored `state/local/`; the repo does not ship that snapshot. Absence is `unavailable`, not an `@1` relabel, and is not current L3/L4/L5 evidence. |
| **V1 product target** | A beginner can move from idea or imported product evidence to a reviewable project, agent-orchestrated proof cases, visible change impact, bounded correction/recompute loops, and inspectable BOM/cost evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **V2 candidate**      | Operational digital-twin instances fed by real telemetry, time-series storage, state estimation, model calibration, contextual scenario testing, and service-life decisions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The current Modelica branch is design-time simulation evidence. `syson_value_set` and
constraint tools are useful primitives, but they do not constitute telemetry ingestion,
an operational asset identity, calibration, or a Digital Twin Instance. Operational twin
claims remain out of V1 until those boundaries exist and are demonstrated with measured
data.

For a new idea or specification, the first V3 operation deliberately creates only an
immutable documentary r1: the exact approved brief, reviewed project path, operation
revision, and a SHA-256 fingerprint. The agent queues and runs that bounded recording
step; if a consequential human decision is required, it is elicited in the conversation.
The cockpit follows the public milestones. It is useful provenance, not technical
evidence: it creates no SysML model, CAD geometry, simulation, measurement, requirement
result, compliance conclusion, or certification claim.

The first implemented provider-backed V3 operation, `architecture.seed-syson-model@2`,
accepts only that exact r1 after an additive project change has named it. Its
server-fixed sequence creates a blank SysON project container, blank SysML document, and
root package, reads the root back, normalizes the identities, binds them to the exact
approved brief and documentary artifact in a `syson-model-seed-capture/2.0` record, and
publishes the SHA-256-addressed r2 descendant. The agent cannot choose provider calls,
arguments, SysML text, or output; an uncertain non-idempotent write is held for review
rather than blindly retried. r2 is not a system architecture, requirement, CAD model,
simulation, measurement, verification result, or certification claim. Those operations
still need their own inputs, output validators, and evidence contracts.

The r2 container identity is not a system architecture, CAD artifact, physical model,
cost estimate, compliance conclusion, or verified verdict. Every later capability needs
its own sourced inputs, reviewed operation and evidence contract.

Historic schema-`1.0` and schema-`2.0` projects remain readable references. They are not
silently converted into V3 projects, and a V3 project never borrows a convenient
existing thread head as its first baseline. The cockpit shows the project as planning
until its declared documentary record exists, then shows that record as a distinct
surface rather than an empty evidence graph.

## Demo criterion

The convincing demonstration is not the number of connected tools. It is one visible
loop in which a beginner states an objective, the agent prepares a model and a bounded
decision, geometry appears, physics runs in the activity feed, named requirements pass
or fail with margins, a correction updates the affected chain, and cost or manufacturing
evidence remains inspectable. Anything that does not make that loop clearer is secondary
to V1.

## Three judgement branches

One dossier, three questions. They share brief, architecture, part identities and the
canonical `design.write-geometry@1` STEP. They do not share verdicts.

| Branch     | Question                            | What judges it today                                                                            | What a fail may do                                                                       |
| ---------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Behave** | Does this design behave?            | Isolated CalculiX proof `@3`, Modelica simulation, study-base join, and assembly-integrity L3 → L4 → L5 over one canonical assembly STEP | Only a study-base `fail` may authorize `design.apply-vector-correction@1` then a new CAD; assembly-integrity is limited to its named gate |
| **Make**   | Can we fabricate this STEP?         | Measured DFM (`industrialize.run-dfm-checks@1`); printability / print-estimate stay documentary | Named violation only. Does not authorize a `z*` or a geometry write                      |
| **Buy**    | What is the configuration and cost? | Intended ERPNext / BOM / cost evidence                                                          | No registered BOM seal yet. A missing binding is a missing binding                       |

A new canonical STEP supersedes prior behave / make / buy evidence of that geometry.
Re-runs are new reviewed operations. One branch's `pass` never proves another.

New behave CAD is born parameterized. The technical compiler admits a `build123d-source`
under the current profile 2.0 only when at least one finite module-level numeric
parameter is parser-reported, bound through `parameterizes`, and causally reaches the
unique `result` artifact. A dead assignment or a hash-sealed photo of constructor
literals is not a dimensioned drawing and cannot feed the sensitivity grid. This is the
behave CAD compiler invariant for every new admission, not a project-specific rule.
Embedded profile-1 compilation documents retain their historical replay semantics;
already-sealed STEP photos, including Heron `design.write-geometry@1`, are not
rewritten. New canonical STEP comes only from `project_admitted_geometry_export`
after a parameterized admission. `design.write-geometry@1` refuses a preview
photo draft (`admission_required`). Modelica qualification is out of this rule.

The sensitivity catalog is a reviewed, server-owned JSON manifest, not a TypeScript
project map. A new catalogued vehicle adds one manifest entry and one exact JSON
template; the review and seal reopen that same entry through the application reader,
never a caller-selected path. A catalog match wins. When the human instead validates a
project's FEA proof case, the server may offer one false-by-default signed-offer route
compiled from the exact proof facts plus the unique causally joined admission lever. The
offer requires the admission source fingerprint and bytes to match the proof CAD
definition and its `result` binding to represent the proof target. The same FEA-seal
MRTR signs the offer digest and admission identity. Execution reopens and recompiles
both authorities before publishing a separate catalog-offer artifact derived from the
proof and admission. No exact join → no checkbox. No opt-in → no artifact. The offer
still leaves `step` uncompiled. When the JSON catalog is absent or ambiguous,
`project_sensitivity_study_seal_review` may reopen that unique signed offer and copy the
sealed proof mesh target size as the first-order-forward step. Mesh, loads and metric
ids stay copied facts; neither route lets an agent invent them.

The constrained vehicles (`desk-lamp-dl04` / `desk-lamp-dl05`) have played **behave**.
Make and buy stay later V1 work. Do not open those branches to make the current head
look complete. A missing DFM or BOM card means that work was not run. A new live project
follows [Run the behave loop from zero](../../how-to/verify-design/verify-a-new-design-from-scratch.md).
