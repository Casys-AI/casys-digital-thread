# Reference: agent workspace

This page is the working contract for coding agents and project-control agents in this
repository. It is not a product tutorial. For the first human loop, see
[Follow the engineering loop](../tutorials/first-engineering-loop.md). For file
locations and ports, see [the workspace map](workspace-map.md).

The page is written so an agent can parse it: tables over prose, exact IDs, explicit
grants, and lookalike pairs that must not be merged.

## 1. What this repo owns

This repo is the atelier: Console MCP, project-control MCP, native Workbench, registered
operations, CAS, WAL, and immutable project/thread state.

Engineering providers live in other repos and run from published images. Do not clone
`mcp-syson`, `mcp-build123d`, `mcp-calculix`, or `mcp-modelica` here to “fix” an
operation. Change a provider only in its own repo.

![Authority split: human confirms, agent proposes registered operations, server owns sequences, Workbench is read-only.](../assets/authority-and-surfaces.svg)

```mermaid
flowchart LR
  human["Human in paired chat"]
  agent["Agent MCP client"]
  dt["This repo: Digital Thread MCP :3020"]
  ui["Workbench GET/SSE :5173"]
  providers["Private provider MCP / local microVM"]

  human -->|"intent + signed MRTR"| agent
  agent -->|"project_* tools, registered ops only"| dt
  dt -->|"immutable revisions"| ui
  dt -->|"server-owned sequence"| providers
  providers -->|"hashed resources"| dt
  human -->|"inspect only"| ui
```

## 2. Authority

Three actors. None may take another’s role.

| Actor     | May                                                                                               | May not                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Agent     | Author reviewed artefacts, select a **registered** operation, queue, execute the exact queued run | Choose provider name, tool, endpoint, path, envelope, recovery graph, or plan JSON; self-approve MRTR; invent units or omitted unresolved |
| Human     | Confirm exact brief/decision/cancel via MCP elicitation                                           | Be asked to invent solver decks, SysON AQL, or provider arguments                                                                         |
| Server    | Own sequences, profiles, parsers, lowering, CAS, WAL                                              | Treat `latest`, labels, or UI selection as join keys                                                                                      |
| Workbench | Project persisted revisions                                                                       | Mutate project state or call providers                                                                                                    |

Analysis is never authority. A `source-analysis/1.0` bundle, a preview, a
`ready-for-review` draft, or a Graphology edge does not authorize dispatch.

A queued run is not a published result. Only a captured, reread Thread revision is true.

## 3. Lookalike traps

These pairs look related and are **not** substitutes.

![Two SysML authorities: renderer path writes SysON; agent-authored path seals a Thread document only.](../assets/sysml-two-paths.svg)

| This                                                      | Is                                                                                        | Is not                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `model.write-architecture@1`                              | Server-rendered SysML inserted into SysON                                                 | An agent-authored SysML parser path                                     |
| `model.seal-architecture-sysml@1`                         | Provider-free Thread-document seal of closed-subset analysis                              | SysON insertion, `@2` architecture write, or `compile.seal-admission@1` |
| `sysml-source-capture/1.0`                                | Renderer envelope for the SysON write                                                     | Agent-authored UTF-8 authority                                          |
| `architecture-sysml-source-analysis-capture/1.0`          | Agent-authored closed-subset CAS                                                          | A renderer manifest                                                     |
| `project_geometry_preview` + `design.write-geometry@1`    | Historical MCP sandbox preview then hash seal                                             | Isolated compiler execution                                             |
| `compile.seal-admission@1` + `design.execute-build123d@1` | Provider-free admission then local microVM draft execution                                | Canonical geometry promotion                                            |
| `design.seal-isolated-geometry@1`                         | Provider-free Thread-document seal of isolated execution                                  | Canonical STEP, cad-model, `write-geometry`, or FEA geometry            |
| `verify.run-fea-static-proof@1`                           | Historical generic MCP FEA                                                                | The current recorded or isolated successors                             |
| `verify.run-fea-static-proof@2`                           | Recorded CalculiX MCP plan (`resolved-operation-plan/2.0`)                                | The local microVM `@3` executor                                         |
| `verify.run-fea-static-proof@3`                           | Isolated local CalculiX + separate SysON oracle                                           | A reinterpretation of `@2` plans                                        |
| `simulate.run-modelica-scenario@2`                        | Recorded provider Modelica                                                                | `simulate.run-qualified-modelica-kit@1` (one local kit)                 |
| `planning-only` operation                                 | Descriptor only; `queueRun` refuses it with `invalid_transition`                          | A trusted Thread writer                                                 |
| CM-01 / `state/fixtures/retired/`                         | Historical golden record                                                                  | A live project, fallback, or provider admission                         |
| `desk-lamp-dl04` / `desk-lamp-dl05`                       | Generic / Heron vehicles. A reread `@2` receipt may exist under gitignored `state/local/` | A committed golden, a clone-true proof, or an `@1` relabel              |
| `analyze.seal-sensitivity-study@1`                        | Provider-free Thread-document seal of a 2.0 study case                                    | `verify.seal-proof-case@1` or a solve                                   |
| `analyze.run-fea-sensitivity@1`                           | Two attested CalculiX observations, no verdict                                            | `verify.run-fea-static-proof@1` / `@2` / `@3`                           |
| `verify.evaluate-sensitivity-base@1`                      | SysON evaluations of those study-base observations                                        | A proof-run evaluation or an invented metric mapping                    |
| STEP inside a sensitivity-study capture                   | Isolated solver input for that study only                                                 | Canonical geometry or a proof-run `geometry` binding                    |
| `model.write-sensitivity-edges@1`                         | Server-rendered derivative PartDef inserted into SysON                                    | `model.write-architecture@1`                                            |
| `renderSensitivityEdgeSetSysml`                           | Flat PartDef renderer for measured edges                                                  | `renderSensitivityRelationsSysml`                                       |
| `sensitivity-study-case/2.0` `cadSource`                  | Sealed compilation-admission artifact URI + sha256                                        | `recipeSource` 1.0 or a STEP artifact                                   |
| `design.apply-vector-correction@1`                        | Provider-free Thread-document seal of a bounded correction proposal (`grants: none`)      | CAD write, SysON insert, provider run, or execution admission           |
| `compile.capture-corrected-source@1`                      | Substitute sealed z* into the parent admission source                                     | `compile.seal-admission@1` or `design.execute-build123d@1`              |
| Binding `studyCapture`                                    | `sensitivity-study-capture/1.0`                                                           | `sensitivity-edges-capture/1.0` or a SysON PartDef                      |
| `config/*-api/` inventory JSON                            | Documentary pinned-language ground truth                                                  | A compiler driver or generated qualification table                      |
| `industrialize.observe-printability@1`                    | Documentary FDM observations (`estimate` path); no evaluation                             | Measured DFM verdicts                                                   |
| `industrialize.run-dfm-checks@1`                          | Measured mcp-dfm envelope/thickness/overhang verdicts                                     | `observe-printability` or a print-time estimate                         |
| `printability-check-case/1.0`                             | Documentary estimate case; no attested STEP, no Z-min filter                              | `dfm-check-case/1.0`                                                    |
| `dfm-check-case/1.0`                                      | Sealed measured case: attested STEP, build-volume object, declared Z-min filter           | A STL target or a hidden executor heuristic                             |

## 4. Surfaces an agent actually calls

The agent talks **only** to this repo’s MCP server (`http://127.0.0.1:3020/mcp`).
Provider MCP ports are private backend dependencies. Loopback CLI:
`deno task mcp:call --name=<tool> --args='{}'`. It fills omitted `issuedAt` only
when the arguments already include `commandId`. `cockpit_focus_set` may omit
`expectedRevision`. `deno task preview:thread` follows cockpit focus unless
`--project-id=` pins a vehicle.

### Project lifecycle

| Tool                                                               | Authority        | Effect                                                         |
| ------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------- |
| `project_start`                                                    | Agent mutation   | Create schema-3.0 project from plain-language intent           |
| `project_snapshot`                                                 | Read             | Current project, decisions, runs, receipts                     |
| `project_question_propose`                                         | Agent mutation   | One framing question                                           |
| `project_answer_record`                                            | Agent or human   | Sourced answer or explicit unknown                             |
| `project_brief_propose`                                            | Agent mutation   | Living brief revision; not canonical                           |
| `project_brief_confirm`                                            | Human MRTR       | Promote exact brief revision                                   |
| `project_plan_publish`                                             | Agent mutation   | Unexecuted plan from approved brief only                       |
| `project_change_append`                                            | Agent mutation   | Append-only next change; never rewrite history                 |
| `project_decision_propose`                                         | Agent mutation   | Typed proposal                                                 |
| `project_decision_approve` / `project_decision_reject`             | Human MRTR       | Exact proposal only                                            |
| `project_agent_run_queue`                                          | Bounded mutation | Server derives run id, basis, summary                          |
| `project_agent_run_execute`                                        | Server dispatch  | One queued registered operation                                |
| `project_agent_run_cancel`                                         | Human MRTR       | Still-queued run only                                          |
| `project_agent_run_plan_get`                                       | Read             | Inspect sealed `resolved-operation-plan/2.0`; does not execute |
| `project_work_item_reconcile_successor`                            | Recovery         | Close an orphan after a real successor                         |
| `project_work_item_supersede_unstarted`                            | Recovery         | Replace unstarted work                                         |
| `cockpit_focus_set` / `cockpit_focus_snapshot`                     | UI routing       | Point the cockpit at one durable project                       |
| `project_review_intent_list` / `project_review_intent_acknowledge` | Review outbox    | Receipt of a Workbench intent; never an approval               |

### Architecture SysML frontend (agent-authored)

| Tool                                        | Writes               | Grant                                                         |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------- |
| `project_architecture_sysml_source_capture` | Draft CAS only       | Opaque reference. No project, Thread, MRTR, or SysON          |
| `project_architecture_sysml_preview`        | None (or reopen CAS) | Diagnostics + optional `decisionParameters`. Not Thread state |

How-to: [Author architecture SysML](../how-to/author-architecture-sysml.md).

### Brief compilation (approved brief → proposal grammar)

| Tool                                | Writes | Grant                                                      |
| ----------------------------------- | ------ | ---------------------------------------------------------- |
| `project_brief_architecture_review` | None   | `decisionParameters` for `model.write-architecture@1` only |
| `project_brief_requirements_review` | None   | `decisionParameters` for `model.write-requirements@1` only |

The server reopens the exact human-approved canonical brief itself; no brief bytes,
parameter keys, structural admissibility or unit admissibility come from the caller.
Every emitted parameter carries the brief item it was traced to.

Provenance rules differ by what is being stated. A requirement threshold is normative,
so it may only cite a gate item (`success-criterion` or `verification-activity`). An
architecture element is not a gate and only has to be sourced — but it may never cite an
`exclusion` or an `open-question`, which declare what is out of scope or still
undecided. The requirements container component only has to be sourced.

An absent, non-normative, non-committing or unsourced item, a duplicate slug, or an
envelope the grammar refuses — unsupported unit, non-integer threshold, unknown parent,
cycle — yields `unresolved` with diagnostics and **no** parameters, never a partially
compiled proposal.

One code-owned normalisation exists: a threshold declared in `MPa` is rescaled to `Pa`
and the provenance entry names the transformation (see [Oracle units](oracle-units.md)).
SysON cannot round-trip `MPa` (probe
`deno task probe:requirement-units --unit=MPa --type=PressureValue`, 2026-08-14,
`type_mismatch`), and refusing outright would only move the same conversion into the
agent's head where nothing records it.

Its limit is contractual: the brief carries free-text statements, so the server never
reads the prose and never asserts that a declared value restates its statement. It
records where the value came from; the signing human confirms what it says.

How-to: [Compile brief parameters](../how-to/compile-brief-parameters.md).

### Technical compilation / isolated CAD

| Tool                                        | Writes                   | Grant                                                              |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `project_technical_source_capture`          | Draft CAS                | Opaque source+analysis reference                                   |
| `project_technical_compilation_preview`     | Review draft CAS         | `decisionParameters` for `compile.seal-admission@1` only           |
| `project_admitted_geometry_export`          | Geometry **draft**       | Parameters for `design.write-geometry@1`. Not isolated execution   |
| `project_build123d_execution_review`        | None                     | Parameters for `design.execute-build123d@1`. No capability         |
| `project_isolated_geometry_seal_review`     | None                     | Parameters for `design.seal-isolated-geometry@1`. No STEP bytes    |
| `project_vector_correction_review`          | None                     | Parameters for `design.apply-vector-correction@1`. No Thread write |
| `project_sensitivity_base_evaluation_review` | None                    | Ready only if study metrics join Thread requirements exactly       |
| `project_corrected_admission_review`        | None                     | Parameters for `compile.seal-admission@1` from a corrected source  |
| `project_modelica_qualified_kit_run_review` | None                     | Parameters for the one local Modelica kit                          |
| `project_geometry_preview`                  | Geometry draft (sandbox) | Historical MCP path; registered only if sandbox is composed        |

## 5. Registered operations

Source of truth:
[`src/orchestration/operations/registry.ts`](../../src/orchestration/operations/registry.ts).
Unknown ids/versions are indistinguishable from absent.

| Operation                                           | Execution                 | Provider                     | What a success is                                                 | What it is not                                                       |
| --------------------------------------------------- | ------------------------- | ---------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `baseline.from-approved-brief@1`                    | trusted                   | none                         | Documentary Thread r1                                             | A model or proof                                                     |
| `architecture.seed-syson-model@2`                   | trusted                   | SysON                        | Blank container identity (r2); closed seed MRTR                   | Architecture or requirements                                         |
| `model.write-architecture@1`                        | trusted                   | SysON                        | `architecture-capture/3.0` after renderer + readback              | Agent-supplied SysML                                                 |
| `model.capture-part-definitions@1`                  | trusted                   | SysON                        | Sealed architecture subgraph bundle                               | Quantity, CAD, or a new design fact                                  |
| `model.seal-architecture-sysml@1`                   | trusted                   | none                         | Thread document of closed-subset analysis                         | SysON write or compilation admission                                 |
| `model.write-requirements@1`                        | trusted                   | SysON                        | Integer scalar requirements (SysON 0.5.1)                         | A verdict                                                            |
| `compile.seal-admission@1`                          | trusted                   | none                         | Admission capture                                                 | Execution authority                                                  |
| `compile.capture-corrected-source@1`                | trusted                   | none                         | Substituted source document + preview reference                   | Admission, CAD execution, or rewriting apply-vector-correction       |
| `design.execute-build123d@1`                        | trusted                   | local microVM                | Documentary capture + noncanonical draft                          | Canonical STEP in Thread                                             |
| `design.seal-isolated-geometry@1`                   | trusted                   | none                         | Thread document of isolated execution identities                  | STEP artifact, cad-model, or FEA                                     |
| `design.preview-geometry@1`                         | planning-only             | sandbox MCP                  | Draft bundle                                                      | Thread write                                                         |
| `design.write-geometry@1`                           | trusted                   | none (seal)                  | Canonical geometry capture                                        | Re-execution of CAD                                                  |
| `verify.seal-proof-case@1`                          | trusted                   | none                         | Sealed proof-case artifact                                        | A solve                                                              |
| `verify.run-fea-static-proof@1`                     | trusted                   | CalculiX MCP + SysON         | Historical verdict                                                | `@2` or `@3`                                                         |
| `verify.run-fea-static-proof@2`                     | trusted                   | recorded CalculiX + SysON    | Current MCP qualification path                                    | Isolated `@3`                                                        |
| `verify.run-fea-static-proof@3`                     | trusted                   | local microVM + SysON oracle | Isolated successor                                                | Reroute of `@2` plans                                                |
| `simulate.seal-simulation-case@1`                   | trusted                   | none                         | V1 case artifact                                                  | A run                                                                |
| `simulate.run-modelica-scenario@1`                  | trusted                   | Modelica MCP                 | Observations only                                                 | A verdict                                                            |
| `simulate.seal-simulation-case@2`                   | trusted                   | Modelica resources           | Planless V2 seal                                                  | A simulation                                                         |
| `simulate.run-modelica-scenario@2`                  | trusted                   | recorded Modelica            | Observations via ROP 2.0                                          | Local kit `@1`                                                       |
| `simulate.run-qualified-modelica-kit@1`             | trusted                   | local microVM                | One fixed linear-ramp kit                                         | Arbitrary Modelica                                                   |
| `analyze.seal-sensitivity-study@1`                  | trusted                   | none                         | Sealed 2.0 study-case document                                    | A solve or a verdict                                                 |
| `analyze.run-fea-sensitivity@1`                     | trusted                   | isolated CAD + CalculiX MCP  | Dimensioned observations + study capture                          | A verdict or `@2` ROP plan                                           |
| `verify.evaluate-sensitivity-base@1`                | trusted                   | SysON                        | Evaluations that cite `sensitivity-base-<metric>-<digest>`        | A solve, a proof `@2`, or a metric alias                             |
| `model.write-sensitivity-edges@1`                   | trusted                   | SysON                        | Server-rendered derivative PartDef                                | Architecture write or agent SysML                                    |
| `industrialize.seal-printability-case@1`            | trusted                   | none                         | Sealed printability-check-case/1.0 document                       | A DFM dispatch or verdict                                            |
| `industrialize.observe-printability@1`              | trusted                   | mcp-dfm                      | Unit-carrying FDM observations                                    | A verdict or evaluation                                              |
| `industrialize.seal-dfm-case@1`                     | trusted                   | none                         | Sealed dfm-check-case/1.0 document                                | A DFM dispatch or the estimate path                                  |
| `industrialize.run-dfm-checks@1`                    | trusted                   | mcp-dfm                      | Measured observations + fail-closed evaluations                   | `observe-printability` or a quote                                    |
| `industrialize.seal-print-estimate-case@1`          | trusted                   | none                         | Sealed print-estimate-case/1.0 document                           | A slice or a price                                                   |
| `industrialize.observe-print-estimate@1`            | trusted                   | mcp-prusaslicer              | Time and material observations                                    | A cost quote or verdict                                              |
| `design.apply-vector-correction@1`                  | trusted                   | none                         | Thread document of a bounded correction proposal (`grants: none`) | CAD, SysON, provider, admission, or a join of proof-run observations |
| `record.reconcile-uncertain-writer@1`               | trusted, **human origin** | none                         | Release or inspect an uncertain write                             | Agent inspection of a provider                                       |
| `record.archive-lineage@1`                          | trusted                   | none                         | Append-only archive change                                        | SysML deletion                                                       |
| `architecture.author-inspection-drone@3`            | trusted                   | SysON                        | Product-specific drone r3                                         | A generic architecture op                                            |
| `model.capture-inspection-drone-part-definitions@1` | trusted                   | SysON                        | Product-specific r4                                               | Generic product structure                                            |

### Measured DFM (`industrialize.seal-dfm-case@1` + `industrialize.run-dfm-checks@1`)

This pair is the measured authority. It does not replace
`industrialize.observe-printability@1`, which stays the documentary estimate path
(observations only, no evaluation).

Live mcp-dfm 0.1.0 tools take `step_path` + `expected_step_sha256`, not STL.
`build_volume_mm` is an object `{x, y, z}`. The sealed case must declare the Z-min
bed-contact filter; the executor applies that signed filter and traces it. It must not
invent a min-Z heuristic. A check fail is publishable with a named violation.

Queueing sequence for any trusted consequential op:

```text
project_change_append (work item + required decision together)
  -> project_decision_propose
  -> project_decision_approve   # human MRTR
  -> project_agent_run_queue    # server stamps basis
  -> project_agent_run_execute  # no payload
```

`architecture.seed-syson-model@2` **must** arrive via `project_change_append`, never the
initial `project_plan_publish`. See
[sequence a SysON seed](../how-to/sequence-seed-work-item.md).

### Live-run lessons (`desk-lamp-dl05`)

Observed on the real agent path. Contract facts, not style.

| Lesson                                            | Exact rule                                                                                                                                                                                                                                     | When it fails                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every SysON write names its predecessor work item | Seed `dependsOnWorkItemIds` **must** include the `baseline.from-approved-brief@1` work item. Later SysON writes should name their predecessor the same way for sequencing.                                                                     | Seed only: the executor refuses at `project_agent_run_execute` with `The SysON model seed must explicitly depend on the approved-brief documentary baseline work item.` Append, propose and queue accept the omission. Architecture and requirements resolve the predecessor from the Thread (seed capture / architecture tip), not from `dependsOnWorkItemIds`. |
| Requirement thresholds are integers               | `requirement.<slug>.threshold` is a safe integer. SysON 0.5.1 cannot round-trip a decimal literal through `syson_constraint_extract` (`LiteralRational`).                                                                                      | Grammar rejects at `project_decision_propose`. Message: threshold must be a safe integer because SysON 0.5.1 cannot round-trip decimal literals through `syson_constraint_extract`.                                                                                                                                                                              |
| Seed MRTR is closed                               | Allowed keys: `seed.schemaVersion`, `seed.scope`, `seed.operation`, `model.name`. `model.name` is pinned to the server-owned role `system model`. `fingerprintSysonModelSeedProposal` is the envelope digest, not the MRTR `inputFingerprint`. | Grammar rejects a free-form key or any other `model.name` at `project_decision_propose`.                                                                                                                                                                                                                                                                         |
| Study metric ids must Object.is-equal Thread requirement metrics | `analyze.run-fea-sensitivity@1` publishes `sensitivity-base-<metric>-<digest>`. `verify.evaluate-sensitivity-base@1` joins only when `metric` is the Thread requirement metric. | Historical dl05 r16: study `assembly_max_*` vs requirements `maxDisplacement` / `maxVonMises` → `UNLINKED`. A later isolated reseal on that atelier joined. Do not invent a mapping. Do not replay r16. New project: [run the behave loop from zero](../how-to/run-the-behave-loop-from-zero.md). |
| Proof-run evaluations do not authorize a correction | `design.apply-vector-correction@1` accepts only a fail that cites `sensitivity-base-<metric>-<digest>`. | A `@2` `pass` on `calculix-observation-*` is a different authority. A joined study-base `pass` also does not apply a correction. |

Limit of the seed grammar: `assertProposalMatchesOperationGrammar` is project-agnostic.
It cannot pin `model.name` to `projectId` or `project.project.name`. The executor does
**not** consume the proposal: it names the SysON document
`${project.project.name} system model` and the SysON project
`${project.project.name} · system model seed · ${run.id}`. The hypothesis « nom =
projectId » is false. The signed `model.name` is therefore the role token, not the
provider display name.

## 6. Implemented language frontends

Same outer contract (`source-analysis/1.0`). Different parsers. Unresolved is
first-class and never omitted.

**Direction — closed-language compilation.** Every frontend targets a _closed_ language
(finite, pinned by version) and the goal is _complete_ coverage of that language,
derived from its introspected inventory — never hand-enumerated idiom by idiom, and
never an "attested but not understood" mode as a destination. For build123d 0.11.1 the
ground truth is the 473-name inventory in `config/build123d-api/inventory-0.11.1.json`
(regenerated by `scripts/probes/capture-build123d-api-inventory.ts`); constructs whose
result depends on engine-internal ordering are compiled too and carry a determinism
_class_ in the evidence instead of being excluded. Why and how:
[closed-language compilation](../explanations/closed-language-compilation.md).

| Profile / analyzer                                                     | Language               | Qualifies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Leaves unresolved                                                       |
| ---------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `sysml-architecture-closed-subset-v1`                                  | SysML v2 closed subset | `package { part def }`, empty-or-block `part def`, `part usage : Type;`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Comments, strings, numbers, attributes, `requirement`, anything else    |
| Rendered architecture companion                                        | Server-rendered SysML  | Manifest-attested PartUsage→target only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Arbitrary SysML                                                         |
| `build123d-closed-subset-v1` (`build123d-qualified-lezer` **1.6.0**)   | Python / build123d     | `Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Ellipsoid`, `Wedge`, `Rectangle`, `Circle`, `Ellipse`, `RegularPolygon`, `Pos`, `Rot`, `Compound`; `+`/`-` same-kind; named `Pos`/`Rot` bindings and left-associative `Pos`/`Rot`/`Plane.XY\|XZ\|YZ\|YX\|ZX\|ZY` * solid or sketch; `scale(solid, scalar)`; `fillet(solid, scalar)` or `fillet(solid.edges(), radius=scalar or positional)`; `chamfer(solid, scalar)` or `chamfer(solid.edges(), scalar)`; `extrude(sketch, amount=scalar or positional, optional taper=scalar)`; `offset(solid, amount)`; `revolve(sketch, Axis.X\|Y\|Z)`; math scalars `pi`/`e`/`tau`; numeric params; one solid `result` | D4-allowed but unproven syntax; a sketch is never a valid result; `&`/` |
| `modelica-closed-subset-v1` (`modelica-qualified-mo-subset` **1.0.0**) | Modelica               | LinearThermalRamp closed subset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Everything else; 0 of 286 MSL packages                                  |
| Python CAD frontend (legacy preview)                                   | Python                 | Conservative bindings into `result`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Calls, imports, branches, functions…                                    |
| Project-brief frontend                                                 | Canonical brief JSON   | Item ids + explicit V2 gate dependencies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Prose inference, V1 gates                                               |

Bindings published by the architecture SysML analyzer are **symbol ids**, never labels.
Labels are display data.

Qualified Build123d 1.6.0 extends the 1.5.0 subset with named `Pos`/`Rot` bindings,
`Plane.XY|XZ|YZ|YX|ZX|ZY *` shape, `offset(solid, amount)`,
`revolve(sketch, Axis.X|Y|Z)`, and extrude `taper=`. Previously qualified bundles stay
bit-identical; the public analysis identity does not change for existing sources. A
sketch is never a valid `result`. `shell` is not a 0.11.1 algebra function and stays
unresolved. Same-kind `&` is parsed in the frontend but D4 rejects the token before
analysis. `Ellipsoid` is in this hand table and in D4; it is **absent** from the 0.11.1
inventory — a phantom, not a next idiom.

There is no Next AST lock. The accepted next family is **F1** in
[the full-compilation plan](../rfcs/build123d-full-compilation-plan.md): generate
qualification tables from the inventory (plus type methods), replace this hand `Map`,
and bump the analyzer to 2.0.0. Do not add `Polygon` / `filter_by` / another 1.7.0 lot
by hand. Inventories under `config/*-api/` are documentary ground truth until that
generator (or the equivalent for SysML / Modelica / CalculiX) consumes them.

## 7. Golden path (generic V3)

```mermaid
flowchart TD
  intent["project_start + living brief"] --> confirm["project_brief_confirm MRTR"]
  confirm --> r1["baseline.from-approved-brief@1 → Thread r1"]
  r1 --> seed["architecture.seed-syson-model@2 → r2 container"]
  seed --> arch["model.write-architecture@1 → SysON architecture"]
  seed --> sealSysml["model.seal-architecture-sysml@1 → Thread document only"]
  arch --> req["model.write-requirements@1"]
  arch --> geomA["legacy: preview + design.write-geometry@1"]
  arch --> geomB["compile.seal-admission@1 → design.execute-build123d@1 draft"]
  geomB --> sealGeom["design.seal-isolated-geometry@1 → Thread document only"]
  geomA --> proof["verify.seal-proof-case@1"]
  geomB --> proof
  proof --> fea2["verify.run-fea-static-proof@2"]
  proof --> fea3["verify.run-fea-static-proof@3"]
  fea2 --> verdict["SysON oracle: pass or publishable fail"]
  fea3 --> verdict
  fea2 --> sens["analyze.seal + run-fea-sensitivity@1"]
  fea3 --> sens
  sens --> join["verify.evaluate-sensitivity-base@1"]
  join --> passNode["joined pass: no correction"]
  join --> failNode["joined fail"]
  failNode --> corr["design.apply-vector-correction@1"]
  corr --> zsrc["compile.capture-corrected-source@1"]
  zsrc --> reseal["compile.seal-admission@1"]
  geomA --> dfm["industrialize.run-dfm-checks@1"]
```

Three judgement branches hang off that same canonical STEP. Exact ops above;
do not invent a fourth join.

| Branch | Played on dl05? | Independent verdict | Shared cause |
| --- | --- | --- | --- |
| Behave (CalculiX / Modelica / study-base) | Yes | A `@2` `pass` is not a DFM `pass` | Same STEP; a later CAD write retires the old proof |
| Make (measured DFM; printability is documentary) | No | A DFM `fail` is not a `z*` grant | Same STEP only. Isolated geometry is not a DFM target |
| Buy (BOM / ERP / cost) | No registered seal | — | Same part identities when a binding exists |

A documentary r1 or a SysON container r2 is **not** an architecture, a CAD model, a
measurement, or a verdict.

## 8. Where to put code

Hexagonal. Dependencies point inward. Adapters never become domain authority.

| Layer       | Path                                                  | May import       | Must not                                     |
| ----------- | ----------------------------------------------------- | ---------------- | -------------------------------------------- |
| Domain      | `src/domain/`                                         | domain + kernel  | `Deno.*`, `fetch`, MCP, UI, Graphology       |
| Application | `src/application/`                                    | domain + ports   | Concrete adapters                            |
| Adapters    | `src/adapters/`                                       | ports + domain   | Become the public contract                   |
| Operations  | `src/orchestration/operations/`                       | domain contracts | Provider tool names in the planning registry |
| Tools       | `src/tools/`                                          | inbound ports    | Own CAS/provider clients                     |
| Composition | `server.ts`                                           | everything       | Leak handles into domain                     |
| UI          | `src/ui/src/`                                         | `src/contracts/` | Command authority, MCP credentials           |
| Tests       | `*_test.ts` colocated; UI tests at `src/ui/*_test.ts` | `@std/assert`    | Preact render tests                          |

New non-test module → add it to the `deno.json` `check` file list. The omission is
silent.

UI change under `src/ui/src/` → rebuild the affected bundle (`build` / `build:thread`)
and commit `src/ui/dist/**`.

## 9. Persistence roots that matter

| Path                                                                        | Content                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `state/local/engineering-projects/`                                         | Immutable project revisions                                |
| `state/local/thread-snapshots/`                                             | Canonical Thread revisions                                 |
| `state/local/recorded-analysis/`                                            | Compilation, isolated CAD, recorded Modelica/CalculiX, ROP |
| `state/local/recorded-analysis/architecture-sysml/{sources,analyses,seals}` | Agent-authored SysML CAS                                   |
| `state/local/sysml-source-captures/`                                        | Renderer `sysml-source-capture/1.0`                        |
| `state/local/architecture-captures/`                                        | `architecture-capture/3.0` (SysON write)                   |
| `state/local/dfm-case-captures/`                                            | Sealed `dfm-case-capture/1.0` documents                    |
| `state/local/dfm-check-captures/`                                           | Measured `dfm-check-capture/1.0` (evaluations included)    |
| `state/local/dfm-check-attempts/`                                           | WAL for `industrialize.run-dfm-checks@1`                   |
| `state/local/sensitivity-base-evaluation-captures/`                         | SysON join of study-base observations                      |
| `state/local/corrected-source-captures/`                                    | `compile.capture-corrected-source@1` documents             |
| `state/fixtures/retired/`                                                   | CM-01 only. Never replay                                   |

Do not treat a directory listing or “latest file” as authority. Reopen by content
address.

## 10. Verification

Targeted while implementing. Full suites at integration milestones.

```bash
# one colocated test — copy permissions, do not pass a path to deno task test
deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env \
  src/domain/engineering/architecture-sysml-parse_test.ts

deno task check          # type-check listed non-test modules
deno task lint
deno task fmt            # --check only; write with: deno fmt <path>
deno task test
deno task check:ui
deno task verify:thread:presentation
deno task verify:evidence
```

Never report a green suite obtained with `--no-check`.

## 11. Labels that stay literal

`succeeded` = a simulation completed. `passed` / `failed` = a comparison is attached.
`unavailable`, `unresolved`, `error`, `provisional`, `documentary`, `unverified`,
`demo`, `TRACE GAP`, `UNLINKED` are evidence states. Do not strip them for readability.
