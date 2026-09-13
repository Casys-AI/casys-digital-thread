# RFC: articulated LED desk-lamp demonstration contract

Status: active · Audience: implementer and reviewer · Kind: execution brief

## Outcome

Build a **fresh** project whose demonstrator is an articulated LED desk lamp. It must
carry a reviewer from a human-confirmed brief to three explicitly separate Behave
questions, then through one reviewed cross-domain change. Mechanics starts from the most
mature existing surface; thermal evaluation, electrical execution and selective impact
are implementation work owned by RFCs 04, 05 and 06. They are core demo outcomes, not
optional labels or claims that the current repository already provides them.

This is not a repair, replay, clone, or relabel of `desk-lamp-dl05` or any historical
desk-lamp vehicle. The fresh project needs its own project id, brief, SysON identities,
Thread revisions, admissions, MRTRs and evidence. Similar geometry or a reused filename
is never identity evidence.

## Product story and scenes

| Scene           | Reviewer sees                                                                 | Durable truth required                                                                    | Must not claim                                                     |
| --------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S0 — intent     | Fresh lamp project, sourced brief and explicit unknowns                       | Project revision and human-confirmed brief                                                | Selected LED, arm geometry, material, thermal/circuit result       |
| S1 — structure  | One system and named product components in renderer-backed SysON              | Reread architecture capture and requirement identities                                    | Full assembly CAD, ports, wiring or value-flow semantics           |
| S2 — questions  | Three distinct cards with scope, status and next authority                    | Separate requirements/unknowns and branch labels                                          | A combined “lamp passed” badge                                     |
| S3 — mechanics  | One canonical arm STEP, static evidence and literal oracle result             | Exact STEP/proof/receipt/output/evaluation lineage                                        | Joints, head, base, whole assembly, fabrication or certification   |
| S4 — correction | Fail-only sensitivity/correction/reseal route                                 | Exact failed study-base evaluation and causal lever                                       | Correction after `pass`, invented failure or direct source edit    |
| S5 — thermal    | One admitted thermal model is executed and separately evaluated               | Exact source/admission/run/observation/evaluation lineage                                 | General Modelica, coupled thermal FEA or solver success as verdict |
| S6 — electrical | One reviewed LED-driver circuit question is executed and separately evaluated | Exact circuit/method/run/observation/evaluation lineage                                   | General SPICE, compliance, safety or ngspice as oracle             |
| S7 — impact     | One reviewed power/brightness change affects only proven dependent branches   | Exact change, impact manifest, invalidation/carry-forward decision and successor evidence | Hidden cascade or mechanical preservation by omission              |
| S8 — closeout   | Human acceptance/rejection of the stated branch consequences                  | Signed decisions bound to exact L4 bases and limitations                                  | Inferred approval or a decision silently carried to a successor    |

Workbench is a read-only projection. Conversation/MCP commands own mutations; no scene
is an authority source.

## Proposed structure, deliberately bounded

Use only the renderer path. Exact labels are proposed in the fresh brief then
server-derived by `project_brief_architecture_review`; never author SysML text.

| Component / structural handle | Demonstration role                              | Boundary                                                          |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `ArticulatedLedDeskLamp`      | Product container                               | Renderer-backed package/root only                                 |
| `Base`                        | Grounds the product story                       | No stability, ballast or mounting proof                           |
| `ArticulatedArm`              | Sole canonical CAD and mechanical-proof subject | Single isolated part, never assembly mapping                      |
| `LampHead`                    | Carries LED/light story                         | No mechanical, optical or thermal CAD authority                   |
| `LedDriver`                   | Electrical behaviour boundary                   | No circuit topology or component model implied                    |
| `PowerSupply`                 | Reviewed electrical source boundary             | Structural only: no port, connector, voltage or netlist semantics |
| `LampHead`                    | Thermal behaviour boundary                      | No material path, temperature model or simulation implied         |

A bare attribute may name a review handle only if the approved brief and renderer
grammar allow it. It carries no value, type, unit, equation, flow or solver binding.
Record unsupported meaning as `unresolved`; do not hide it in a label.

## Three Behave questions

This RFC specifies no value, unit, material, load, circuit topology, thermal resistance
or component selection. They must be sourced in the fresh brief and admitted by existing
bounded grammars before a human signs them.

| Branch               | Question                                                                                                                  | Target evidence family                                                                                                          | Starting gap / hard stop                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanical arm       | Under reviewed isolated-arm assumptions, does the exact canonical `ArticulatedArm` STEP satisfy declared static criteria? | Parameterized CAD admission → canonical STEP → `mechanical-proof-case/1.0` → `verify.run-fea-static-proof@3` → SysON evaluation | Existing static surface is reusable only when fresh identities and reviewed physical inputs join exactly; excludes joints and assembly behaviour. |
| Thermal LED/head     | Under a separately reviewed thermal scenario, does the named thermal criterion hold at its stated boundary?               | Admitted Modelica v2 source → fixed microVM execution → observations → separate qualified SysON evaluation                      | Current admitted execution is L3 documentary until RFC 04 closes the generic L4/L5 path; FEA remains linear-static only.                          |
| Electrical LED/power | Under a separately reviewed circuit scenario, do named electrical criteria hold?                                          | Reviewed closed circuit → server-owned ngspice execution → V/A/W/s observations → separate qualified evaluation                 | Fleet inventory is not a product operation, WAL/replay contract or verdict path; RFC 05 must close that boundary before any claim.                |

Mechanical evidence never establishes thermal/electrical behaviour. Native solver
availability never establishes product coverage.

## Non-goals

- Make: DFM, printability, manufacturing route, tolerances and fabrication claims.
- Buy: BOM, price, sourcing and make/buy recommendation.
- Certification, safety compliance, fatigue, stability, optical performance, EMC, mains
  safety, reliability or full-assembly physics.
- Full CAD assembly, joints/contact, circuit/netlist authoring, thermal composition,
  general Modelica, general SysML and Workbench command authority.
- Repairing, replaying or renaming DL05; copying its state; treating a historical
  locally reread run as fresh evidence.

## Human decision sheet

| Decision            | Human decides / confirms                                                          | Server derives / displays                                                    | Forbidden shortcut                                               |
| ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Demo framing        | Desk-use story, scope/exclusions and first question                               | Exact fresh brief revision, sources and unknowns                             | Copy historical brief or fill assumptions                        |
| Structure/criteria  | Proposed components and declared mechanical criterion                             | Renderer parameters, target identities, accepted unit form, provenance       | Raw SysML/AQL/UUIDs or invented values/units                     |
| Canonical arm       | Reviewed source represents isolated arm                                           | Admission, represented part, canonical draft/STEP identities                 | Isolated output as canonical geometry; assembly substitute       |
| Static proof        | Proof case and separately execution run                                           | Catalog case, exact STEP, fixed profile/runtime/lowering                     | Deck, mesh/load/material payload or provider selection           |
| Failure correction  | Whether literal failure merits correction                                         | Exact study-base failure and causal lever join                               | `z*` after pass, aliases, source edit                            |
| Mechanical closeout | Accept/reject stated consequence with rationale                                   | Exact L4 proof/evaluation/STEP lineage and limits                            | Treat oracle pass as human acceptance                            |
| Thermal method      | Sources, assumptions, parameter bindings, scenario, criteria and consequence      | Closed Modelica source authority, exact run/evaluation proposals and lineage | Ask the human for OMC arguments or invent missing thermal values |
| Electrical method   | Circuit source/topology choice, models, test condition, criteria and consequence  | Closed case, provider lowering, WAL/replay and exact evaluation proposals    | Ask the human for ngspice commands or invent components/values   |
| Impact              | Meaning of the reviewed power/brightness change and justified causal independence | Exact affected claims, proposed reruns and preserved historical evidence     | Infer dependencies from labels or preserve mechanics by omission |

## Initial state to verify before every lot

Repository facts, not a claim about a fresh live project:

- `verify.run-fea-static-proof@3` is the registered linear-static product operation;
  historical FEA operations are not substitutes.
- The static catalog contains historical desk-lamp and CA02 declarations. A row proves
  neither fresh-project compatibility nor a completed fresh run.
- Canonical geometry is admitted-source export sealed by `design.write-geometry@1`;
  isolated Build123d output is documentary only.
- Renderer-backed SysML supports bounded structure and scalar requirements, not ports,
  values or flows.
- Admitted Modelica v2 output is documentary until a separate evaluation path is
  qualified; no registered ngspice product operation/electrical evaluation chain exists.

Before a mutation, reread the fresh current snapshot and resolve identities from it.
`latest`, labels, old revisions, filenames, inventories and UI cards are never
substitutes.

## Atomic lots

Every lot ends at its own commit boundary. Continue only after the listed gate passes
and no stop fires.

### P01 — freeze fresh demo framing

- **Depends on:** none.
- **Implement:** source-backed fresh-lamp brief/fixture only where repo conventions
  retain fixtures; state questions/exclusions without values or units.
- **Likely seams:** project brief domain/use cases, fixtures, product docs.
- **Output / commit:** reviewable brief proposal;
  `docs/fixture: frame articulated LED desk-lamp demo`.
- **Stop:** prose needs a solver input, threshold, unit, identity or component choice.

### P02 — compile bounded structure and criteria

- **Depends on:** P01; human-confirmed brief for real walk.
- **Implement:** focused tests that compiler emits only renderer-supported components
  and sourced scalar criteria; preserve unresolved diagnostics.
- **Likely seams:** architecture/requirements preparation use cases, renderer adapters
  and tests.
- **Output / commit:** reviewable `model.write-architecture@1` /
  `model.write-requirements@1` proposals;
  `test: compile fresh lamp structure from approved brief`.
- **Stop:** ports, flows, value-bearing attributes, unsupported criteria or unsourced
  requirement needed.

### P03 — keep question branches visible and separate

- **Depends on:** P02.
- **Implement:** only if current read model cannot distinguish branches without a
  verdict implication, add read-only classification/projection and tests.
- **Likely seams:** Thread read model/presentation tests; never provider adapters.
- **Output / commit:** mechanical fact state plus thermal/electrical `unresolved`;
  `feat: separate lamp Behave questions in read model`.
- **Stop:** missing run, fixture or inventory becomes `pass`.

### P04 — qualify fresh canonical arm admission

- **Depends on:** P02; fresh architecture identities and reviewed arm source.
- **Implement:** existing capture → preview → `compile.seal-admission@1` → admitted
  export → `design.write-geometry@1`; add generic regression only for identified defect.
- **Likely seams:** CAD source analysis, compilation admission, canonical
  exporter/sealer.
- **Output / commit:** one exact fresh canonical arm STEP;
  `test: preserve fresh-arm canonical geometry lineage` if code changes.
- **Stop:** closed grammar/join fails, multiple part ambiguity, or any DL05/CA02
  artifact is proposed.

### P05 — seal/run static proof

- **Depends on:** P04; separate signed proof-seal/run MRTRs in real walk.
- **Implement:** generic fresh-identity tests for proof-seal review, isolated-run review
  and `@3` binding.
- **Likely seams:** FEA seal-case, isolated-v3, FEA review tools and tests.
- **Output / commit:** sealed proof, complete evidence, literal evaluation capture and
  replayable completion; `test: bind static proof to fresh canonical arm`.
- **Stop:** noncanonical geometry, caller solver envelope, missing MRTR, output
  mismatch, ambiguous oracle outcome or thermal/electrical need.

### P06 — record human mechanical closeout

- **Depends on:** P05 and exact L4 evaluation on current STEP.
- **Implement:** if decision ledger cannot make linkage inspectable, add bounded
  server-derived L5 review/record that binds proof, STEP, evaluation, statuses,
  limitations and human disposition without solver/SysON mutation.
- **Likely seams:** project decision grammar/service, provider-free review/record use
  case, registry only if a Thread artifact is necessary, snapshot tests.
- **Output / commit:** explicit human accepted/rejected consequence; acceptance only
  when every declared L4 criterion is `pass`;
  `feat: bind mechanical demo decision to exact evidence`.
- **Stop:** approval inferred from pass, prior STEP bound, historic decision silently
  migrated, or thermal/electrical labelled closed.

### P07 — prove correction eligibility only

- **Depends on:** P05; enter operational correction only on genuine static fail and
  exact sensitivity offer.
- **Implement:** fresh-arm-shaped tests for fail-only study-base evaluation, correction
  capture, reseal and successor proof.
- **Likely seams:** sensitivity, compilation, FEA rerun/replay tests.
- **Output / commit:** immutable predecessor and failure-only successor route;
  `test: enforce fresh-arm fail-only correction boundary`.
- **Stop:** L4 pass, unlinked metric, absent causal lever/offer, replay gap or direct
  sealed-source edit.

### P08 — hand off the product contract to the vertical RFCs

- **Depends on:** P01–P07 as applicable.
- **Implement:** reconcile this framing with RFCs 02–07. Update living docs only for
  merged/proven capability; keep every unfinished vertical at its literal state.
- **Likely seams:** coverage/how-to/reference, operation-reference and Markdown checks.
- **Output / commit:** auditable hand-off separating fresh runtime evidence from Git;
  `docs: hand off articulated lamp demonstration boundary`.
- **Stop:** docs promise full assembly, Make/Buy/certification, an unimplemented
  thermal/electrical result or historical compatibility relabel.

## Completion and validation

| Level | Required persisted proof                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| L1    | Fresh project, approved brief, isolated-arm question, exclusions and unknowns                                |
| L2    | Server-derived structure/requirements/admission/proof/run proposals and separate signed MRTRs                |
| L3    | Replayable mechanical, thermal and electrical observations from their own sealed inputs and fixed methods    |
| L4    | Exact separate evaluation capture for every declared criterion in each branch                                |
| L5    | Explicit human records bound to exact L4 bases, plus reviewed impact disposition for the cross-domain change |

This RFC closes product framing, not the vertical implementations. Full demo completion
is defined jointly by RFCs 03–07 and the integration closeout in RFC 10.

Run nearest domain/adapter/use-case tests, then relevant operation/registry/snapshot
tests. Run `deno task check` for Deno TypeScript changes and `deno task check:ui` only
for UI work. Use global checks only at P08. Do not start a provider or execute a product
run merely to make code tests pass.

Stop and preserve literal state when MRTR is absent, identities cannot be reread, joins
are ambiguous, evidence/replay is incomplete, evaluation is `unresolved`/`error`, a
concept is outside coverage, or scope crosses Make/Buy/certification. Never use project
branches, raw solver payloads, historical migration or invented values/units to escape a
stop.
