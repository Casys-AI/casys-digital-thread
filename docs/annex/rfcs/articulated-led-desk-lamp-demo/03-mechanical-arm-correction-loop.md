# RFC: articulated LED desk-lamp mechanical arm correction loop

Status: active · Audience: implementer and reviewer · Kind: execution brief

## Outcome

Implement one bounded Behave loop for the **single canonical arm** of the fresh
articulated LED desk-lamp project:

```text
approved brief → renderer-backed structure/requirements → admitted arm source
  → canonical arm STEP → static proof → literal L4 evaluation
  → (fail only) sensitivity → correction document → corrected source → reseal
  → successor canonical STEP → static rerun → replay without redispatch
```

The loop preserves authority while a human decides how to react to a real mechanical
failure. It is not optimisation, thermal analysis, electronics selection, full assembly
CAD or a mechanism for forcing a correction.

## Scope and non-goals

### One canonical subject

There is exactly one mechanical CAD subject: the fresh project's isolated
`ArticulatedArm` PartDefinition. It has one canonical STEP at a time, sealed by
`design.write-geometry@1` from an exact admitted parameterized source. A successor STEP
explicitly supersedes its predecessor; every proof, evaluation and human decision stays
tied to its own revision.

The base, lamp head, LED driver and power supply may exist in product structure, but are
outside this proof subject. No assembly mapping, mass transfer, joint/contact/support
hardware model, thermal load or electrical load is implied.

### CA02 may educate; it may never supply truth

`cantilever-arm-ca02` is a technical specimen of the static catalogue and `@3` evidence
shape only. It cannot supply the fresh lamp's
project/subject/SysON/requirement/base-snapshot/source/STEP/proof/MRTR/run/observation/evaluation/sensitivity/correction
identities.

Before reuse of any declaration, the server reopens the fresh project's current Thread
and proves all joins. If the fresh arm does not fit existing `mechanical-proof-case/1.0`
and static admission contracts exactly, record the gap and stop. Do not hand-copy CA02
values, units, selections, material assumptions or identities.

### Explicit non-goals

- Modal, buckling, thermal, creep, coupled physics, dynamics, fatigue and stability.
- Correction after `pass`, solver exit, historical evaluation or proof-run observation
  in place of exact study-base failure.
- Automatic optimisation, arbitrary source rewriting, direct CAD edit, manual solver
  deck, caller-selected runtime or provider call.
- Requirement-semantic change, metric alias, historical relabel/delete, Make/Buy,
  certification or full-lamp mechanical conclusion.

## Authority and persisted evidence

| Stage              | Human decides                                  | Server owns                                            | Persisted proof                                         |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Frame              | Isolated-arm question, exclusions and unknowns | Brief provenance/grammar                               | Approved brief + project revision                       |
| Structure/criteria | Derived architecture/requirement proposal      | SysON rendering/reread, requirement identity           | Architecture/requirements captures                      |
| Admission          | Technical compilation proposal                 | Source analysis and joins                              | Analysis, admission and MRTR                            |
| Geometry           | Exact canonical geometry decision              | Reopen admission, export/seal one STEP                 | Geometry capture, assets, successor snapshot            |
| Static proof       | Proof seal and separate run approval           | Fixed lowering/profile, WAL, output validation, oracle | Proof, receipt, complete batch, observations/evaluation |
| Sensitivity        | Exact generated offer                          | Causal admission/proof join and bounded study          | Offer, study capture, receipt, study-base observations  |
| Correction         | Only reviewed correction after literal failure | Exact failure join and corrected-source capture        | Evaluation, correction document, corrected source       |
| Reseal/rerun       | Each successor admission/geometry/proof/run    | Immutable lineage and replay                           | New evidence family; predecessor remains visible        |

Agent proposes/queues/executes registered operations after MRTR. It does not choose
provider/tool/image/shell/solver input/recovery/units. Workbench reads only.

## Verified starting surface

| Surface       | Available today                                                                               | Not implied                                                           |
| ------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| CAD admission | Closed parameterized source → admission → canonical STEP                                      | General Python, full assembly or private isolated output as authority |
| Static FEA    | `verify.run-fea-static-proof@3` on sealed `mechanical-proof-case/1.0` and canonical part STEP | Native modal/thermal capability, arbitrary CalculiX or human decision |
| Sensitivity   | Separate study/data and exact study-base evaluation joins                                     | Proof-run evaluation authorising correction or metric alias           |
| Correction    | Failed study-base evaluation can lead to correction capture then readmission                  | Parent admission mutation or in-place STEP mutation                   |
| Replay        | Completed run reopens durable CAS/WAL/Thread evidence without redispatch                      | Adoption/relabel of pre-boundary historical run                       |

These are repository contracts. They are not evidence that the fresh lamp already exists
or passes.

## Atomic lots

Each lot has an individual commit. Continue only when its gate passes and no stop
condition fires.

### M01 — make fresh-arm identity mandatory

- **Depends on:** product-contract P01/P02.
- **Implement:** fixture/test corpus that distinguishes fresh lamp project, subject and
  current basis from CA02/DL04/DL05. Reviews must reject project/subject/base/STEP
  mismatch rather than choose by label.
- **Likely seams:** FEA review support, proof-case/catalog reader, isolated bindings and
  tests.
- **Output / commit:** exact-identity refusals;
  `test: refuse historical arm identities for fresh lamp proof`.
- **Stop:** filename/label selects truth or tests use historic identities as fresh
  truth.

### M02 — preserve one canonical geometry lane

- **Depends on:** M01 and reviewable fresh arm source.
- **Implement:** exercise/strengthen checks that FEA accepts only a
  `design.write-geometry@1` canonical part STEP from exact fresh admission. Keep
  isolated Build123d documentary.
- **Likely seams:** CAD source analysis, admission, canonical sealer, isolated binding
  resolver.
- **Output / commit:** accepted canonical binding plus refused
  cad-model/draft/isolated/stale siblings;
  `test: require canonical fresh-arm STEP for static proof`.
- **Stop:** assembly artifact needed, source/join unresolved, multiple part ambiguity or
  export cannot prove exact admission.

### M03 — compile static proof with no solver envelope

- **Depends on:** M02 and human-reviewed fresh declaration that fits existing schema.
- **Implement:** `project_fea_proof_seal_review` must reopen current fresh snapshot and
  emit only server-derived proposal. Add absent/ambiguous
  target/requirements/STEP/catalog adversarial tests.
- **Likely seams:** FEA seal-case use case/domain, FEA review tools and tests.
- **Output / commit:** resolved next hops or literal diagnostics, never
  material/mesh/load/selection/hash/SysON UUID inputs;
  `test: compile fresh-arm proof only from exact joins`.
- **Stop:** schema extension, missing value/unit or caller-selected CalculiX arguments
  required.

### M04 — seal method; keep proof and run MRTRs separate

- **Depends on:** M03.
- **Implement:** test fresh-arm fixture with one approval for proof declaration and
  another for execution proposal; cross-bind case authorization to work item/current
  basis.
- **Likely seams:** proof proposal/parser/capture, seal executor, registry/proposal
  validation.
- **Output / commit:** sealed proof only, no dispatch;
  `test: preserve separate fresh-arm proof and run MRTRs`.
- **Stop:** one MRTR serves both, catalog is treated approved, or human writes technical
  payload.

### M05 — bind `@3` run to exact STEP and complete evidence

- **Depends on:** M04.
- **Implement:** focused `project_fea_isolated_run_review` and
  `verify.run-fea-static-proof@3` fixtures for proof, STEP, profile, receipt and all
  output roles. Refuse historical `@1`/`@2`.
- **Likely seams:** isolated bindings/use case, fixed profile, output inspector,
  executor.
- **Output / commit:** server-owned run proposal, complete evidence or terminal literal
  failure; `test: cross-bind static run to fresh arm and output manifest`.
- **Stop:** missing output role/hash/count, changed basis, nonreconstructible worker
  result or external MCP CalculiX proposal.

### M06 — make L4 a separate mechanical fact

- **Depends on:** M05.
- **Implement:** prove oracle maps only declared proof criteria to exact current
  requirement identities, persists request/response and literal
  `pass`/`fail`/`unresolved`/`error`. Cover wrong
  metric/requirement/unit-normalisation/stale-STEP cases appropriate to contract.
- **Likely seams:** FEA oracle adapter/executor, proof-case/unit contracts.
- **Output / commit:** zero solver exit is never verdict;
  `test: preserve literal fresh-arm oracle evaluations`.
- **Stop:** missing exact requirement, ambiguous response, unsupported metric/unit or
  borrowed CA02 result.

### M07 — harden replay and uncertain outcome

- **Depends on:** M05/M06.
- **Implement:** completed replay must reopen exact CAS batch, execution evidence,
  evaluation capture and successor Thread without redispatch; ambiguous oracle remains
  terminal/quarantined under WAL contract.
- **Likely seams:** FEA WAL/attempt/evidence stores, executor, Thread store/validation.
- **Output / commit:** no-redispatch replay corpus;
  `test: replay fresh-arm static evidence without redispatch`.
- **Stop:** recovery uses `latest`, reruns a completed provider call, adopts pre-WAL
  state or relabels history.

### M08 — admit sensitivity only from exact causal offer

- **Depends on:** M04 and one unique fresh admission lever joined to proof target.
- **Implement:** preserve false-by-default opt-in and readiness only through exact fresh
  admission/proof join; offer seals with proof, never project name.
- **Likely seams:** sensitivity catalog/offer join, proof-seal review, sensitivity-study
  seal review.
- **Output / commit:** exact offer or literal `unresolved`/`unavailable`;
  `test: require fresh-arm causal join for sensitivity offer`.
- **Stop:** more than one/no lever, old offer reused, or new physics/schema required.

### M09 — bind study metrics before base evaluation

- **Depends on:** M08 and separately sealed/run study in real walk.
- **Implement:** enforce Object.is-equality from fresh study metric to current Thread
  requirement; refuse missing/ambiguous observations; preserve `UNLINKED` history.
- **Likely seams:** sensitivity base-evaluation domain/use case/executor.
- **Output / commit:** exact `sensitivity-base-<metric>-<digest>` or literal unlinked
  state; `test: refuse alias metrics in fresh-arm study evaluation`.
- **Stop:** alias mapping, proof-run evaluation substitute, or incomplete metric join.

### M10 — unlock correction only on real study-base failure

- **Depends on:** M09 and literal failed fresh study-base evaluation.
- **Implement:** refusal matrix: pass/unresolved/error/proof-run/foreign/stale failure
  never grants correction. Valid correction is a Thread document with `grants: none`.
- **Likely seams:** base evaluation, vector correction, correction-source capture.
- **Output / commit:** fail-only eligibility;
  `test: make fresh-arm correction fail-only`.
- **Stop:** demo passes, fake product failure, or direct CAD/source mutation proposed.

### M11 — reseal, supersede and rerun

- **Depends on:** M10 plus actual approved correction only when eligible.
- **Implement:** corrected-source capture is not admission. Require new admission,
  canonical geometry with exact predecessor, new proof/run/L4. Keep old evidence
  inspectable/stale.
- **Likely seams:** correction-source, admission, canonical CAD, static FEA, lineage
  tests.
- **Output / commit:** successor-only evidence family;
  `test: require fresh-arm reseal after correction`.
- **Stop:** predecessor absent/ambiguous, supersession nonexact, isolated geometry used,
  or old decision carried to successor.

### M12 — record bounded human mechanical decision

- **Depends on:** M06 or M11 successor L4.
- **Implement:** use product-contract L5 mechanism, binding one current
  STEP/proof/execution/evaluation/limitations to explicit signed human accept/reject.
  Acceptance requires all declared criteria pass.
- **Likely seams:** decision ledger/grammar, provider-free decision review or registered
  record operation, snapshot validation.
- **Output / commit:** narrow mechanical L5 only;
  `feat: record fresh-arm mechanical closeout by exact lineage`.
- **Stop:** inferred disposition, thermal/electrical inclusion, historical result read
  current or noncurrent successor basis.

### M13 — publish only verified contracts

- **Depends on:** M01–M12 actually merged.
- **Implement:** update living docs only for shared proven mechanical capability; a
  static instance does not expand physics. Preserve modal and every still-open
  mechanical gap without prejudging the separately owned thermal/electrical RFCs.
- **Likely seams:** FEA/CAD/sensitivity docs, agent workspace, operation-reference
  tests.
- **Output / commit:** code/docs agree on current/historical/unavailable/unresolved;
  `docs: close verified articulated-arm correction loop`.
- **Stop:** docs outrun evidence, CA02 is renamed fresh truth, or inventory promoted to
  coverage.

## Definition of done

| Level | Required persisted proof                                                                          |
| ----- | ------------------------------------------------------------------------------------------------- |
| L1    | Fresh project, approved isolated-arm question, exclusions and unknowns                            |
| L2    | Derived structure/requirements/admission/proof/run proposals with separate signed MRTRs           |
| L3    | Admission, canonical STEP, proof, fixed execution, complete outputs, WAL and no-redispatch replay |
| L4    | Literal exact evaluation for every declared static criterion on that STEP                         |
| L5    | Explicit human mechanical accept/reject bound to L4 basis and limitations                         |

After a correction, repeat L2–L5 for its successor STEP. Predecessor remains history.
Thermal/electrical do not block this mechanical vertical, but RFC 10 cannot close the
full demo until their core verticals and RFC 06 are complete.

## Validation and global stops

Run nearest domain/adapter/use-case tests, then registry/tool/snapshot tests. Run
`deno task check` for Deno TypeScript changes and `deno task check:ui` only for UI
changes. At M13, run integration gates appropriate to changed paths. Do not invoke a
runtime provider merely because a test resembles a product operation.

Stop and preserve literal state if identities cannot reopen, MRTR is absent, fresh
declaration lies outside coverage, proof/STEP/output join is missing, recovery is
ambiguous, metric is `UNLINKED`, L4 is `unresolved`/`error`, or scope enters
thermal/electrical/Make/Buy. Never escape a stop by project-specific branch, CA02/DL05
copy, invented values/units, provider selection or silent historic relabel.
