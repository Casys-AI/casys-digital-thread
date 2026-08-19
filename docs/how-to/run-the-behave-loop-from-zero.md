# How-to: run the behave loop from zero

Start a **new** project and walk the **behave** branch only: intent → brief → SysON →
canonical CAD → CalculiX `@2` → optional joined sensitivity. Stop on `pass`. Do not open
make (DFM / printability) or buy (BOM). Do not "repair" `desk-lamp-dl05`. Optional
product Modelica is a separate capture → admission → admitted microVM walk
([run admitted Modelica](run-admitted-modelica.md)), never the pinned kit.

The paired conversation commands. The Workbench is read-only. The person never types a
provider tool. The agent never invents a metric, a unit, a `z*`, or an operation id.

This page is the live from-zero script. The first walk-through of the five spaces is
[Follow the engineering loop](../tutorials/first-engineering-loop.md). After a proof
exists, join and fail-only correction are
[Walk the post-proof loop](walk-the-post-proof-loop.md).

## Why the harness exists

Without it an agent typically: picks CalculiX/`latest`, writes SysML by hand, aliases
`assembly_max_*` onto `maxDisplacement`, treats isolated execution as canonical STEP,
applies a correction on a `pass`, or runs printability to "finish" the demo. Each row
below is a **typed refusal** or a lookalike. Surface it. Do not work around it.

| Unharnessed move                          | Harness                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Seed in `project_plan_publish`            | Seed only via `project_change_append` ([sequence the seed](sequence-seed-work-item.md))                |
| Agent-authored SysML on the renderer path | `model.write-architecture@1` / `model.write-requirements@1`                                            |
| Isolated seal as FEA geometry             | `design.seal-isolated-geometry@1` is a Thread **document**. Proof binds `design.write-geometry@1` STEP |
| `@1` / `@2` / `@3` swapped                | Distinct authorities. Current recorded path is `@2`                                                    |
| Study metrics aliased to requirement ids  | `UNLINKED`. Reseal from a template whose metric ids Object.is-equal. Never map                         |
| `z*` after a `pass`                       | `design.apply-vector-correction@1` accepts only a study-base **fail**                                  |
| Printability or DFM to complete the loop  | Other judgement branch. Stop.                                                                          |
| Kit `@1` for product Modelica `.mo`       | [Run admitted Modelica](run-admitted-modelica.md). Kit worker pins image source                        |

## 0. Surfaces

```bash
docker compose up -d
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task start
deno task preview:thread
```

Connect the agent to `http://127.0.0.1:3020/mcp`. Open `http://127.0.0.1:5173/`.
`deno task preview:thread` already follows cockpit focus (`--workspace-id=primary`). Do
not pass `--project-id=desk-lamp-dl05` (that pins the old vehicle). Loopback writes:
`deno task mcp:call --name=<tool> --args='{}'`.

## 1. Create the project

`project_start` with the person's plain-language intent. Then `cockpit_focus_set` to
that project id. `expectedRevision` may be omitted.

Do not clone dl04/dl05. Those are local, gitignored vehicles. A missing reread `@2`
elsewhere is `unavailable`, not an `@1` relabel.

## 2. Brief, then freeze it

One question at a time (`project_question_propose` / `project_answer_record`).
`project_brief_propose` when the framing is reviewable. The person confirms the
**exact** brief (`project_brief_confirm`, signed MRTR).

`project_plan_publish` may contain only unexecuted **non-seed** planning work.

## 3. Documentary r1, then the seed

1. `baseline.from-approved-brief@1` — Thread r1, no provider.
2. `project_change_append` — seed work item **and** its required decision in the
   **same** append. `dependsOnWorkItemIds` must name the unique
   `baseline.from-approved-brief@1` work item; append refuses the omission. Human
   approves. Queue. Execute `architecture.seed-syson-model@2`. r2 is a blank container,
   not an architecture.

## 4. Architecture and requirements

`project_brief_architecture_review` then `model.write-architecture@1`.
`project_brief_requirements_review` then `model.write-requirements@1`. Thresholds are
safe integers (SysON 0.5.1). One code-owned rescale exists: brief `MPa` → stored `Pa`,
recorded in provenance. Do not invent another.

## 5. Geometry

Two paths. They are not substitutes.

| Path                    | Ops                                                                                                                         | What a success is        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Canonical (proof input) | capture → compilation preview → `compile.seal-admission@1` → `project_admitted_geometry_export` → `design.write-geometry@1` | Thread STEP / cad-model  |
| Isolated draft          | `compile.seal-admission@1` + `design.execute-build123d@1` + `design.seal-isolated-geometry@1`                               | Thread **document** only |

The proof case must name the canonical STEP. A successful isolated run is not Product
authority and not a DFM target.

## 5b. Product Modelica (optional)

Not required to close behave. When walked, it is the CAD analog for `.mo`, not the kit:

```text
project_technical_source_capture          # modelica-closed-subset-v1
  → project_technical_compilation_preview
  → compile.seal-admission@1
  → project_admitted_modelica_run_review
  → simulate.run-admitted-modelica@1
```

How-to: [run admitted Modelica](run-admitted-modelica.md). Do not walk it on a vehicle
that already has a joined `pass`.

If a later geometry **replaces** an earlier one, the writer emits `supersedes` (exact
predecessor artifact). Evidence then photographs the tip. Activity keeps the old card
and marks it superseded. No `supersedes` means two current events — do not invent the
family from timestamps.

## 6. Proof, then stop or join

```text
project_fea_proof_seal_review          # catalog id → fea.proof.*; optional signed catalog offer
  → verify.seal-proof-case@1
project_fea_isolated_run_review        # sealed document → proofCase + STEP
  → verify.run-fea-static-proof@3
```

Do not type `fea.proof.*` by hand. Do not invent `fea.run.*`. Do not bind the assembly
`cad-model` as `geometry` — the isolated-run review names the canonical part STEP.
How-to: [Compile FEA parameters](compile-fea-parameters.md).

For a new parameterized project, set `sensitivityCatalogOptIn: true` only when the
review returns `sensitivityCatalog.status = ready-for-opt-in`. The same MRTR then signs
the exact admission join and the seal publishes a separate catalog-offer artifact.
Omission is proof-only. `project_geometry_preview` and `design.preview-geometry@1` are
not product entries. `project_technical_source_capture` returns `parser` and `levers` as
separate facts. `parser.status: passed` is not admission. A constructor photo is
`levers.status: unresolved`. Pass `projectId` and `result.reference` only to
`project_technical_compilation_preview`. The server joins the current Thread tip and
unique SysML names. Unresolved previews name those joins in `gaps`. It does not invent a
lever or an AttributeUsage. `design.write-geometry@1` refuses a draft that was not
exported from a parameterized `compile.seal-admission@1`.

Oracle `pass` or publishable `fail` stay literal.

Optional experience, not a second proof:

```text
project_sensitivity_study_seal_review   # signed offer or catalog id → sensitivity.case.*
  → analyze.seal-sensitivity-study@1
  → analyze.run-fea-sensitivity@1
  → project_sensitivity_base_evaluation_review
  → verify.evaluate-sensitivity-base@1   # only if ready
```

The signed catalog offer is the precursor. The same review tool compiles the missing
`step` from the sealed proof mesh; it does not invent the case and it is not retired.
How-to: [Compile sensitivity-study parameters](compile-sensitivity-parameters.md).
Without that unique offer, `desk-lamp-dl06` stays `catalog-absent`. Restart `:3020` so a
newly registered compiler is listed.

Study metric ids must Object.is-equal Thread requirement metrics. The live lesson on
historical **dl05 r16** is `assembly_max_*` vs `maxDisplacement` / `maxVonMises` →
`UNLINKED`. The later isolated template uses the Thread ids; a **new** seal can join. Do
not map. Do not reseal the old r16 capture.

A joined `pass` **ends the behave demo**. Do not propose
`design.apply-vector-correction@1`. Do not queue DFM, printability, or print-estimate.

## 7. Read the two surfaces

- **Activity** is the journal. Old attempts stay. A superseded geometry review is
  marked; it is not deleted.
- **Evidence** is the current photograph. Version families fold. Campaign instruments
  fold. Solver envelopes fold.

They must not be the same view.

## What this walk does not do

- Make or buy. See
  [three judgement branches](../explanations/product-direction.md#three-judgement-branches).
- Replay `desk-lamp-dl05`. Its head may already be a joined `pass` (Thread r19 on the
  atelier that ran the isolated join). That is a contrast vehicle, not this script.
- Modelica. Other product family. Product Modelica is admitted `@1`, not a recorded
  scenario.

When two operations look similar, read
[agent workspace](../reference/agent-workspace.md) before calling either.
