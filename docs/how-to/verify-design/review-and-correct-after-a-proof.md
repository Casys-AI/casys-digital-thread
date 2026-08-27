# How-to: review and correct a design after a proof

Audience: both · Diátaxis: how-to · Kind: how-to

Use this after architecture, requirements, geometry and a recorded FEA proof exist. The
constrained vehicle is `desk-lamp-dl05` (Heron arm). `desk-lamp-dl04` is the generic
twin. Both live only under gitignored `state/local/`.

This page is the A–Z continuation after
[Walk through a dated engineering project](walk-through-an-engineering-project.md) §4.
It does not start a second proof. It walks the **behave** branch: join → correction
document → corrected source → reseal. Measured DFM on canonical STEP is the separate
**make** branch. Buy (BOM / cost) has no registered seal yet. See
[Three judgement branches](../../explanations/product/product-direction.md#three-judgement-branches).

The person never types a provider tool. The agent never invents a metric alias, a `z*`,
a unit, or a DFM limit.

## Preconditions

```bash
docker compose up -d syson-db syson-app mcp-syson mcp-build123d mcp-build123d-sandbox mcp-calculix
deno task start
deno task preview:thread --project-id=desk-lamp-dl05
```

ERPNext is an optional sibling integration; start it separately only when its checkout
and environment file are available.

Connect the agent to `http://127.0.0.1:3020/mcp`. The cockpit is read-only.

A local reread `@2` proof must already exist. Absence is `unavailable`. Do not relabel
`@1`.

## What one local atelier already showed

This block is **historical**. It is the r16 capture that first published the `UNLINKED`
join. A later isolated reseal on the same atelier can reach a joined `pass` (Thread
r19). Do not treat r16 as the current head. Do not rewrite it. A **new** from-zero
project is [Verify a new design from scratch](verify-a-new-design-from-scratch.md).

On a machine that already ran that isolated loop, Thread
`project:desk-lamp-dl05:r16:model-write-sensitivity-edges-run:cmd-dl05-queue-sens2-edges`
held:

| Fact                    | Exact identity                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Requirements            | `maxDisplacement` (`<= 1 mm`), `maxVonMises` (`<= 60_000_000 Pa`)                                           |
| Proof-run evaluations   | `dl05-arm-*-evaluation-2615d730…` status `pass`, citing `calculix-observation-*`                            |
| Study capture           | `sensitivity-study-af03a2612141b6ae4f0cca69a7f0c602139c5fac6914fcd3b560fd933f57db9b`                        |
| Study-base observations | `sensitivity-base-assembly_max_displacement-af03a261…`, `sensitivity-base-assembly_max_von_mises-af03a261…` |
| Canonical STEP          | `design.write-geometry@1` assets `cad-asset-c2b5fa88…` (`model/step`)                                       |
| Isolated geometry       | `design.seal-isolated-geometry@1` document only — not a DFM target                                          |

Those study metric ids do **not** match the Thread requirements. The join is `UNLINKED`.
The proof-run `pass` cannot authorize `design.apply-vector-correction@1`. Both facts are
published truth. Do not hide them.

The isolated template
[`config/sensitivity-study-cases/dl05-arm-thickness-isolated.json`](../../../config/sensitivity-study-cases/dl05-arm-thickness-isolated.json)
now declares `maxDisplacement` / `maxVonMises`. The live CalculiX method admits those
Thread ids (same solver fields as `assembly_max_*`). A **new** seal + run can join. The
already-captured r15 study cannot be rewritten and stays `UNLINKED`. Do not reseal from
`dl05-arm-thickness-sensitivity.json`: that sibling still declares `assembly_max_*`.
Same case id `dl05-arm-thickness-isolated` on r14/r15 is the **old** metric set;
identity of the case id is not identity of the template bytes.

## Sequence

```text
project_sensitivity_study_seal_review   # JSON manifest case or signed offer → sensitivity.case.*; cadSource = admission
  → analyze.seal-sensitivity-study@1
  → analyze.run-fea-sensitivity@1          # observations only
  → project_sensitivity_base_evaluation_review
  → verify.evaluate-sensitivity-base@1     # only if review is ready
  → project_vector_correction_review       # only if a study-base evaluation fails
  → design.apply-vector-correction@1       # grants: none; not CAD
  → project_resource_capture               # successor CAD bytes
  → project_source_file_put                # successor workspace file revision
  → project_technical_source_capture       # quadruplet at the common workspace
  → project_technical_compilation_preview
  → compile.seal-admission@3
  → design.execute-build123d@1
  → verify.seal-proof-case@1 + verify.run-fea-static-proof@3

industrialize.seal-dfm-case@1
  → industrialize.run-dfm-checks@1         # write-geometry STEP only
```

Do not type `sensitivity.case.*` by hand. Call `project_sensitivity_study_seal_review`
first. Name `caseId` when the project has more than one template (`desk-lamp-dl05`
does). `desk-lamp-dl06` is `catalog-absent` until a reviewed template exists. Restart
`:3020` after the tool is added so the running process lists it. Probe:

```bash
deno task mcp:call --name=project_sensitivity_study_seal_review \
  --args='{"projectId":"desk-lamp-dl05","caseId":"dl05-arm-thickness-isolated"}'
```

How-to:
[Compile sensitivity-study parameters](../compile/compile-sensitivity-parameters.md).

Authorities stay in sibling folders — do not merge them:

| Operation                            | Folder                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `analyze.seal-sensitivity-study@1`   | [`src/adapters/sensitivity/study/`](../../../src/adapters/sensitivity/study)                         |
| `analyze.run-fea-sensitivity@1`      | [`src/adapters/sensitivity/live-fea/`](../../../src/adapters/sensitivity/live-fea)                   |
| `verify.evaluate-sensitivity-base@1` | [`src/adapters/sensitivity/base-evaluation/`](../../../src/adapters/sensitivity/base-evaluation)     |
| `model.write-sensitivity-edges@1`    | [`src/adapters/sensitivity/edges/`](../../../src/adapters/sensitivity/edges)                         |
| `design.apply-vector-correction@1`   | [`src/adapters/sensitivity/vector-correction/`](../../../src/adapters/sensitivity/vector-correction) |

`compile.seal-admission@3` stays under `src/adapters/compile/`. A proof-run evaluation
does not authorize the vector-correction folder. Corrections return through
`AgentResource` plus a successor workspace file revision.

Every consequential step is still: append work + decision → propose → human MRTR → queue
→ execute.

## 1. Check the join before queueing an evaluation

Call `project_sensitivity_base_evaluation_review` with the exact project, Thread basis
and study artifact id. It writes nothing.

| Review status                          | Meaning                                                                                                            | Next step                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `ready-for-review`                     | Each study metric Object.is-equals one Thread requirement and its `sensitivity-base-<metric>-<digest>` observation | Queue `verify.evaluate-sensitivity-base@1` bound to `studyCapture`   |
| `unresolved` / `study-metric-unlinked` | Metric ids do not match. That is `UNLINKED`                                                                        | Seal a new study from the matching template. Do not invent a mapping |
| `unresolved` / `observation-unlinked`  | The study-base observation is missing                                                                              | Re-run `analyze.run-fea-sensitivity@1` on this exact case            |

On the local r16 capture the honest result is `study-metric-unlinked`.

## 2. Evaluate the study base

`verify.evaluate-sensitivity-base@1` asks SysON to evaluate those `sensitivity-base-*`
observations. It is not `@2`, not `@3`, and not a remap of the proof-run observations.

A `pass` is published truth. A `fail` is a named violation. Neither is omitted.

On this vehicle, even a joined re-run is expected to `pass`: the captured base was 0.307
mm / 6.34 MPa against 1 mm / 60 MPa. Correction does not fire on `pass`. Do not invent a
fail to exercise `z*`.

## 3. Correction document, then z* source

Only a **fail** evaluation that cites `sensitivity-base-<metric>-<digest>` can feed
`project_vector_correction_review`.

| This                                                 | Is                                             | Is not                                  |
| ---------------------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| `design.apply-vector-correction@1`                   | Thread document, `grants: none`                | A CAD write or an admission             |
| `project_resource_capture` + successor file revision | Exact new source bytes on the common workspace | A registered corrected-source operation |
| `project_technical_source_capture`                   | Opaque locator at that workspace file revision | Admission                               |

Then reseal and execute through the **existing** admission / isolated CAD / proof
operations. Each stays its own MRTR. `compile.capture-corrected-source@1` is not
registered.

## 4. Measured DFM on canonical STEP

`industrialize.run-dfm-checks@1` consumes a sealed `dfm-check-case/1.0` and one
`design.write-geometry@1` STEP. Isolated execution and `design.seal-isolated-geometry@1`
are **not** a DFM target.

There is no DFM brief-compiler yet. The case must name sourced limits (build volume
object, thickness, overhang, declared Z-min filter) plus the exact STEP
`thread-artifact://…` URI and sha256. Do not copy fixture numbers from
`dfm-case_test.ts` onto this vehicle. Do not use `observe-printability` as a stand-in.

A measured fail is publishable with a named violation. The Activity card label is
`measured DFM`.

## 5. Read the cockpit, do not command it

On **Activity**, leave Follow live on. After a later joined evaluation, a correction
capture, or a DFM run, the feed promotes:

| Artifact id prefix             | Card label            |
| ------------------------------ | --------------------- |
| `dfm-check-`                   | measured DFM          |
| `sensitivity-base-evaluation-` | study-base evaluation |

On **Evidence**, `UNLINKED`, `pass`, `fail`, `unresolved` and `unavailable` stay
literal. A missing DFM card means DFM was not run, not that it passed.

## What this walk does not prove

- A joined evaluation on the current r16 capture. The metric ids do not match.
- A correction. Local physics `pass`.
- Canonical geometry from isolated execution.
- A committed golden. `state/local/` is gitignored.
- Compiler F1 (inventory-driven qualification tables). That seam stays later.
- The **make** or **buy** branches. A missing DFM or BOM card is not a gap in this walk.
  Do not run them to complete a behave `pass`.

When two operations look similar, read
[agent workspace](../../reference/agent/agent-workspace.md) before calling either.
