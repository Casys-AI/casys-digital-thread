# Reference: lookalike traps

Audience: agent · Diátaxis: reference · Kind: contract

These pairs look related and are **not** substitutes. Agent tools, operations, and
grants stay on [agent workspace](agent-workspace.md). Pattern for admitted source in a
microVM:
[admitted source isolated execution](../pipeline/admitted-source-isolated-execution.md).

![Two SysML authorities: renderer path writes SysON; agent-authored path seals a Thread document only.](../../media/sysml-two-paths.svg)

## SysML

| This                                                | Is                                                           | Is not                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `model.write-architecture@1`                        | Server-rendered SysML inserted into SysON                    | An agent-authored SysML parser path                                     |
| `model.seal-architecture-sysml@1`                   | Provider-free Thread-document seal of closed-subset analysis | SysON insertion, `@2` architecture write, or `compile.seal-admission@3` |
| `sysml-source-capture/1.0`                          | Renderer envelope for the SysON write                        | Agent-authored UTF-8 authority                                          |
| `architecture.author-inspection-drone@3`            | Retired product-specific SysON insert. Not registered        | Generic `model.write-architecture@1`                                    |
| `model.capture-inspection-drone-part-definitions@1` | Retired product-specific r4 read. Not registered             | Generic `model.capture-part-definitions@1`                              |
| `architecture-sysml-source-analysis-capture/1.0`    | Agent-authored closed-subset CAS                             | A renderer manifest                                                     |

## Product navigation

SysML-first reads share one application port. Workbench GET/SSE is a projection, not a
command surface. Graphology is a disposable index, never domain or authority.

| This                      | Is                                                                                                                                                                                                  | Is not                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `project_product_explore` | Stateless walk from the unique root `PartDefinition` **element** or one exact `PartUsage` occurrence pinned to the published basis                                                                  | A persisted focus, empty-path root occurrence, or `project_source_tree` |
| `project_product_search`  | Exact-id or token discovery returning exact element refs. Labels never join                                                                                                                         | Occurrence expansion, a join key, or SysON search                       |
| `project_product_inspect` | One exact element or occurrence: definition-scoped Thread evidence, element-level authoring heads, ready/blocked actions                                                                            | Reducing a usage to its typed definition, or merging attachment lists   |
| `project_source_closure`  | Technical DAG of one versioned authoring attachment (`attachmentId` + `attachmentRevision` at an exact workspace revision). One `entries` stream of files and edges. `PartUsage` keeps its usage id | Product structure, a free `fileId`/`fileRevision` root, or admission    |
| Graphology                | Disposable algorithmic index reconstructed from exact `architecture-capture/4.0`                                                                                                                    | Domain authority, persistence, or a second Workbench product browser    |

## Engineering Case catalog

The Workbench read-side `engineering-cases/1.0` catalog is the typed id+revision case
families that seal a case document with authority artifacts and producer run IDs. CAD
admissions, isolated CAD execution, admitted Modelica and admitted SPICE are not members
of that catalog.

| This                                                                         | Is                                                                              | Is not                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `mechanical-proof-case/1.0`                                                  | Exact FEA proof-case identity (`verify.seal-proof-case@1`)                      | A CalculiX solve or evaluation closeout      |
| `sensitivity-study-case/2.0`                                                 | Exact sensitivity-study identity (`analyze.seal-sensitivity-study@1`)           | A proof-run or a CAD admission               |
| `printability-check-case/1.0`                                                | Exact FDM printability-case identity (`industrialize.seal-printability-case@1`) | A DFM payload or a STEP                      |
| `print-estimate-case/1.0`                                                    | Exact FFF print-estimate identity (`industrialize.seal-print-estimate-case@1`)  | A price, slicer log, or CAD admission        |
| `dfm-check-case/1.0`                                                         | Exact measured DFM-case identity (`industrialize.seal-dfm-case@1`)              | Printability thresholds or mcp-dfm by itself |
| `compile.seal-admission@3` / `technical-compilation-admission-capture/4.0`   | Closed-subset admission bytes                                                   | An Engineering Case                          |
| `design.execute-build123d@1` / `design.seal-isolated-geometry@1`             | Isolated CAD execution / documentary seal of that execution                     | An Engineering Case or canonical STEP        |
| `simulate.run-admitted-modelica@1` / `simulate.run-qualified-modelica-kit@1` | Admitted `.mo` run or pinned kit                                                | An Engineering Case                          |
| `simulate.run-admitted-spice@1`                                              | Circuit-only admitted SPICE                                                     | An Engineering Case or mcp-spice             |
| Historical `simulate.seal-simulation-case@1`/`@2`                            | Retired recorded-provider route. Not registered                                 | An Engineering Case family                   |

## CAD and compile

Domain contracts: [closed subset](../domains/cad/build123d-closed-subset-v1.md) and
[execution paths](../domains/cad/execution-paths.md).

| This                                                      | Is                                                                                                                            | Is not                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `project_geometry_preview` + `design.write-geometry@1`    | Retired product entry. Preview is not registered. `write-geometry` refuses a draft without an admission stamp                 | Isolated compiler execution or a photo STEP                                  |
| `design.preview-geometry@1`                               | Retired identity. Not registered                                                                                              | A product CAD verb or sandbox entry                                          |
| `parser.status` on a technical capture                    | Closed-subset parser fact                                                                                                     | Admission, a named lever, or a SysML bind                                    |
| `levers.status` on a technical capture                    | Reachable named numeric literals                                                                                              | A SysML `parameterizes` bind or `compile.seal-admission@3`                   |
| `source.no-named-numeric-lever`                           | No reachable named literal (constructor photo or dead assignment)                                                             | Missing `parameterizes` (`binding.missing`)                                  |
| `compile.seal-admission@3` + `design.execute-build123d@1` | Provider-free admission then local microVM draft execution                                                                    | Canonical geometry promotion                                                 |
| `design.seal-isolated-geometry@1`                         | Provider-free Thread-document seal of isolated execution                                                                      | Canonical STEP, cad-model, `write-geometry`, or FEA geometry                 |
| `cad-immediate-placement-source/1.0`                      | Closed JSON of exact immediate `PartUsage` transforms. File role `cad-placement-source`; attachments stay `design-source@1`   | A CAD script, compiler profile, assembly manifest, or new attachment role    |
| `project_cad_placement_capture`                           | Same-file coverage recross. Opaque `cad-placement-analysis-capture` locator only when fully resolved                          | `project_technical_source_capture`, module export, or a verdict              |
| `project_geometry_module_export`                          | Accepted public draft from exact project, Thread, PartDefinition and placement identities; grants none                        | Placement capture or `design.write-geometry@1`                               |
| Isolated Build123d worker (`/input/source.py`)            | Untrusted admitted CAD source executed in the existing image                                                                  | The module assembler; it never execs agent Python                            |
| `geometry-module-input-bundle/1.0` assembler image        | Code-owned one-level STEP compound from a closed child-STEP bundle                                                            | Concatenated CAD scripts, `design.execute-build123d@1`, or collision freedom |
| `geometry-part-capture/1.0`                               | One exact PartDefinition; no assembly, occurrence, or placement claim                                                         | `geometry-module-capture/1.0` or a v2 bundle                                 |
| `geometry-module-capture/1.0`                             | One composite PartDefinition and only its immediate child capture references                                                  | A flat descendant manifest or `geometry-manifest/2.0`                        |
| `geometry-module-draft-capture/1.0`                       | Review-only module draft: complete input-bundle identity, isolated receipt, reopened child STEP identities, produced STEP+GLB | Child source text, a generated program, a provider call, or Thread evidence  |

## Modelica

Domain contracts: [language](../domains/modelica/language.md) and
[execution](../domains/modelica/execution.md).

| This                                                                                   | Is                                                                                | Is not                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `simulate.seal-simulation-case@1` / `@2` and `simulate.run-modelica-scenario@1` / `@2` | Retired recorded-provider route. Not registered                                   | Admitted `@1`, the pinned kit, L4, or L5                           |
| Port 3016 `mcp-modelica` sidecar / `ModelicaRunObserver`                               | Retired fleet/Compose observed-run surface. Not required.                         | Local admitted/kit microVM Modelica                                |
| `simulate.run-qualified-modelica-kit@1`                                                | Separate code-owned LinearThermalRamp qualified-kit V1 smoke in the local microVM | Admitted `.mo` execution or recorded `@2`                          |
| `simulate.run-admitted-modelica@1`                                                     | Reopen `compile.seal-admission@3` Modelica bytes and run them in isolation        | The pinned kit, `@2`, or caller `modelicaText`                     |
| Historical `compile.seal-admission@3` creation snapshot                                | Artifact birth Thread revision                                                    | The `operation` returned by `project_admitted_modelica_run_review` |
| `project_admitted_modelica_evaluation_review`                                          | Provider-free L4 MRTR prep from unique sheet + admitted evidence                  | L5 closeout, an L4 verdict, or OMC/SysON                           |
| `project_admitted_modelica_evaluation_closeout_review`                                 | Provider-free L5 accept/reject of the unique current L4                           | L4 evaluation, implicit L5 from an L4 `pass`, or a provider grant  |

Product Modelica: capture (`modelica-closed-subset-v2`) → compilation preview →
`compile.seal-admission@3` → `project_admitted_modelica_run_review` →
`simulate.run-admitted-modelica@1`. How-to:
[run admitted Modelica](../../how-to/run/run-admitted-modelica.md). The kit is image
smoke, not the product `.mo`. Same image family `casys/modelica-microsandbox-worker`;
kit `ENTRYPOINT` pins one `.mo`, admitted worker runs `/input/source.mo`.

## Electrical

Domain contracts: [electrical index](../domains/electrical/README.md) and
[circuit-only SPICE closed subset v1](../domains/electrical/spice-circuit-closed-subset-v1.md).

| This                                                                                      | Is                                                                                | Is not                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `project_led_driver_source_capture`                                                       | Draft CAS write of exact `led-driver-human-source/1.0` UTF-8                      | Circuit-only SPICE, D1, ngspice, or a Thread write              |
| `project_led_driver_source_review`                                                        | Reference-only reopen of one `led-driver-source-capture/1.0` locator              | A capture command, `sourceText`, or the capture review object   |
| `simulate.run-admitted-spice@1`                                                           | Reopen `compile.seal-admission@3` circuit-only bytes and run ngspice in isolation | mcp-spice, the LED-driver fiche, L4, or L5                      |
| Historical `compile.seal-admission@3` creation snapshot                                   | Artifact birth Thread revision                                                    | The `operation` returned by `project_admitted_spice_run_review` |
| `verify.seal-electrical-observation-method-sheet@1`                                       | Provider-free seal of the reviewed method sheet                                   | An admitted run, L4, or ngspice                                 |
| `verify.evaluate-admitted-spice-observations@1`                                           | Server-owned comparator of exact admitted observations against that sheet         | ngspice, SysON, or L5                                           |
| `decide.accept-admitted-spice-evaluation@1` / `decide.reject-admitted-spice-evaluation@1` | Human closeout of that exact L4                                                   | Implicit L5 from an L4 `pass`, mcp-spice, or a safety claim     |
| `mcp-spice` / `probe:spice-contract`                                                      | Maintainer-only preflight; integration `unresolved`                               | The product admitted run                                        |

How-to: [run admitted SPICE](../../how-to/run/run-admitted-spice.md).

## Cross-domain impact

| This                                               | Is                                                                                                                                                                                                                                                                                            | Is not                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Causal `changeKinds`                               | Document-defined `safeId` tokens from the manifest/source anchors; lexicographically canonical                                                                                                                                                                                                | A code catalog (`electrical-power`/`brightness`) or free prose                                                                                                                     |
| Manifest branch IDs                                | Document-defined `safeId` tokens declared on `cross-domain-impact-manifest/2.0`; nonempty unique lexicographic list; exact set equality at capture                                                                                                                                            | A global `electrical\|thermal\|mechanical` catalogue, or an undeclared extra/missing branch                                                                                        |
| `project_cross_domain_impact_manifest_capture`     | Draft CAS write of closed `cross-domain-impact-manifest/2.0` JSON without fingerprint. Pass `result.reference` only                                                                                                                                                                           | Seal, MRTR, Thread artifact, evaluation, caller-computed fingerprint, path, or URI                                                                                                 |
| `project_cross_domain_impact_manifest_seal_review` | Read-only recross of one opaque capture fingerprint plus `projectId`                                                                                                                                                                                                                          | Capture of manifest bytes, an evaluation, or a claim mutation                                                                                                                      |
| `verify.seal-cross-domain-impact-manifest@2`       | Provider-free seal of the closed manifest identities                                                                                                                                                                                                                                          | An impact evaluation, a gate-claim transition, or public draft capture                                                                                                             |
| `analyze.evaluate-cross-domain-impact@2`           | Provider-free documentary recross that **proposes** claim statuses                                                                                                                                                                                                                            | A human decision, claim mutation, or rerun                                                                                                                                         |
| `decide.accept-cross-domain-impact@2`              | Human-only application of those already-proposed gate-claim statuses onto existing claims                                                                                                                                                                                                     | Work-item invalidation/rerun (X07 records those as `none`), X10, or X11                                                                                                            |
| `analyze.evaluate-mechanical-preservation@2`       | Provider-free recross of the exact X09 decision, X08 evaluation, independence assertion, and the unique accepted closeout that names that asserted mechanical execution. Canonical STEP is the cad-asset sibling owned by the cad-model attached to a completed `design.write-geometry@1` run | A CalculiX rerun, X10 work-item, global unique closeout, isolated/draft/preview STEP, a STEP treated as write-geometry evidence, thermal/electrical verdict, or implicit pass/fail |
| `project_cross_domain_impact_decision_review`      | Read-only recross of the unique current evaluation capture                                                                                                                                                                                                                                    | A Workbench command or caller-selected branch/claim                                                                                                                                |

## FEA, sensitivity, correction

Domain contracts:
[mechanical proof-case source](../domains/fea/mechanical-proof-case-source.md),
[mechanical proof case](../domains/fea/mechanical-proof-case-v1.md) and
[CalculiX static proof V3](../domains/fea/calculix-static-proof-v3.md).

| This                                     | Is                                                                                                  | Is not                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `verify.run-fea-static-proof@1` / `@2`   | Historical MCP FEA. Not registered                                                                  | Product isolated `@3`                                                                             |
| `verify.run-fea-static-proof@3`          | Isolated local CalculiX + separate SysON oracle                                                     | MCP CalculiX, agent `.inp`, or a cad-model as `geometry`                                          |
| `project_fea_proof_case_capture`         | Draft CAS write of exact `mechanical-proof-case-source/1.0` JSON. Pass `result.reference` only      | The compiled `mechanical-proof-case/1.0`, MRTR, or a solve                                        |
| `project_fea_proof_seal_review`          | Opaque source fingerprint → `fea.proof.*` for `verify.seal-proof-case@1`                            | Case authoring, a catalog id, or a `fea.run.*` grammar                                            |
| `project_sensitivity_study_seal_review`  | Catalog id or signed catalog-offer → `sensitivity.case.*` for `analyze.seal-sensitivity-study@1`    | Case authoring, a solve, or inventing `cadSource`                                                 |
| `project_fea_isolated_run_review`        | Sealed proof document → `@3` bindings (`proofCase` document + STEP)                                 | Binding the assembly cad-model as `geometry`                                                      |
| Isolated `geometry` binding              | Canonical part STEP (`kind: step`, `mediaType: model/step`)                                         | The sibling `cad-model`                                                                           |
| `analyze.seal-sensitivity-study@1`       | Provider-free Thread-document seal of a 2.0 study case                                              | `verify.seal-proof-case@1` or a solve                                                             |
| `analyze.run-fea-sensitivity@1`          | Two attested CalculiX observations, or an exact server-selected private reuse result; no verdict    | Caller-selected experience/key/provider/runtime, or `verify.run-fea-static-proof@1` / `@2` / `@3` |
| `verify.evaluate-sensitivity-base@1`     | SysON evaluations of those study-base observations                                                  | A proof-run evaluation or an invented metric mapping                                              |
| STEP inside a sensitivity-study capture  | Isolated solver input for that study only                                                           | Canonical geometry or a proof-run `geometry` binding                                              |
| `model.write-sensitivity-edges@1`        | Server-rendered derivative PartDef inserted into SysON                                              | `model.write-architecture@1`                                                                      |
| `renderSensitivityEdgeSetSysml`          | Flat PartDef renderer for measured edges                                                            | `renderSensitivityRelationsSysml`                                                                 |
| `sensitivity-study-case/2.0` `cadSource` | Sealed compilation-admission artifact URI + sha256                                                  | `recipeSource` 1.0 or a STEP artifact                                                             |
| `design.apply-vector-correction@1`       | Provider-free Thread-document seal of a bounded correction proposal (`grants: none`)                | CAD write, SysON insert, provider run, or execution admission                                     |
| `compile.capture-corrected-source@1`     | Not registered. Corrections return through `AgentResource` plus a successor workspace file revision | `compile.seal-admission@3` or `design.execute-build123d@1`                                        |
| Binding `studyCapture`                   | Fresh `sensitivity-study-capture/1.0` or target-local `sensitivity-study-reuse-result/1.0`          | Source-project capture, `sensitivity-edges-capture/1.0`, or a SysON PartDef                       |

CalculiX `@3` is not the admitted-source pattern: the agent never writes `.inp`.

## DFM and print

| This                                   | Is                                                                              | Is not                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `industrialize.observe-printability@1` | Documentary FDM observations (`estimate` path); no evaluation                   | Measured DFM verdicts                           |
| `industrialize.run-dfm-checks@1`       | Measured mcp-dfm envelope/thickness/overhang verdicts                           | `observe-printability` or a print-time estimate |
| `printability-check-case/1.0`          | Documentary estimate case; no attested STEP, no Z-min filter                    | `dfm-check-case/1.0`                            |
| `dfm-check-case/1.0`                   | Sealed measured case: attested STEP, build-volume object, declared Z-min filter | A STL target or a hidden executor heuristic     |

## Other

| This                                                    | Is                                                                                                       | Is not                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `project_work_item_reconcile_successor`                 | Retired MCP identity. Recovery is `deno task recover:work-item-successor`                                | A canonical project-control tool                                                         |
| `planning-only` operation                               | Descriptor only; `queueRun` refuses it with `invalid_transition`                                         | A trusted Thread writer                                                                  |
| CM-01 / `state/fixtures/retired/`                       | Historical golden record                                                                                 | A live project, fallback, or provider admission                                          |
| `desk-lamp-dl04` / `desk-lamp-dl05`                     | Generic / Heron vehicles. A reread `@2` receipt may exist under gitignored `state/local/`                | A committed golden, a clone-true proof, or an `@1` relabel                               |
| `config/*-api/` inventory JSON                          | Documentary pinned-language ground truth                                                                 | A compiler driver or generated qualification table                                       |
| `console_*` on `:3020/mcp`                              | Control-plane fleet and indexed-run reads                                                                | The native cockpit (`preview:thread` / `preview:cockpit`)                                |
| `preview:browser` / `ui://casys-digital-thread/console` | Retired Console MCP App. The task refuses                                                                | A product page or a registered MCP resource                                              |
| `project_resource_capture` (`tools/call`)               | Client-to-server ingestion of exact bytes into draft CAS                                                 | `resources/read`, MCP roots, a per-domain capture tool, admission, or microVM input      |
| `resources/read`                                        | Server-to-client projection of a minted URI                                                              | Client upload; MCP roots (URI only, no bytes)                                            |
| Public `resourceRef`                                    | Full `AgentResourceReference` from `project_resource_capture`                                            | Inline `sourceText`, URI alone, digest alone, or `resources/read` upload                 |
| Project source workspace                                | Draft file identities, paths and revisions for one project                                               | Engineering Project ledger, Thread evidence, admission, or a compilation/runtime profile |
| `captureRequest` on a workspace file revision           | Caller-authored requested parser/source identity. Vertical 1 stores it inertly; not a registered profile | Compilation profile, provider, tool, image, or runtime selection                         |
