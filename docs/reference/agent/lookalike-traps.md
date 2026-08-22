# Reference: lookalike traps

Audience: agent · Diátaxis: reference · Kind: contract

These pairs look related and are **not** substitutes. Agent tools, operations, and
grants stay on [agent workspace](agent-workspace.md). Pattern for admitted source in a
microVM: [admitted source isolated execution](../pipeline/admitted-source-isolated-execution.md).

![Two SysML authorities: renderer path writes SysON; agent-authored path seals a Thread document only.](../../assets/sysml-two-paths.svg)

## SysML

| This                                             | Is                                                           | Is not                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `model.write-architecture@1`                     | Server-rendered SysML inserted into SysON                    | An agent-authored SysML parser path                                     |
| `model.seal-architecture-sysml@1`                | Provider-free Thread-document seal of closed-subset analysis | SysON insertion, `@2` architecture write, or `compile.seal-admission@1` |
| `sysml-source-capture/1.0`                       | Renderer envelope for the SysON write                        | Agent-authored UTF-8 authority                                          |
| `architecture.author-inspection-drone@3`         | Product-specific SysON insert of the reviewed V4 drone recipe | Generic `model.write-architecture@1`                                    |
| `model.capture-inspection-drone-part-definitions@1` | Product-specific r4 read of the exact drone architecture   | Generic `model.capture-part-definitions@1`                              |
| `architecture-sysml-source-analysis-capture/1.0` | Agent-authored closed-subset CAS                             | A renderer manifest                                                     |

## CAD and compile

Domain contracts: [closed subset](../domains/cad/build123d-closed-subset-v1.md) and
[execution paths](../domains/cad/execution-paths.md).

| This                                                      | Is                                                                                                            | Is not                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `project_geometry_preview` + `design.write-geometry@1`    | Retired product entry. Preview is not registered. `write-geometry` refuses a draft without an admission stamp | Isolated compiler execution or a photo STEP                  |
| `design.preview-geometry@1`                               | Retired identity. Not registered                                                                              | A product CAD verb or sandbox entry                          |
| `parser.status` on a technical capture                    | Closed-subset parser fact                                                                                     | Admission, a named lever, or a SysML bind                    |
| `levers.status` on a technical capture                    | Reachable named numeric literals                                                                              | A SysML `parameterizes` bind or `compile.seal-admission@1`   |
| `source.no-named-numeric-lever`                           | No reachable named literal (constructor photo or dead assignment)                                             | Missing `parameterizes` (`binding.missing`)                  |
| `compile.seal-admission@1` + `design.execute-build123d@1` | Provider-free admission then local microVM draft execution                                                    | Canonical geometry promotion                                 |
| `design.seal-isolated-geometry@1`                         | Provider-free Thread-document seal of isolated execution                                                      | Canonical STEP, cad-model, `write-geometry`, or FEA geometry |

## Modelica

Domain contracts: [language](../domains/modelica/language.md) and
[execution](../domains/modelica/execution.md).

| This                                    | Is                                                                             | Is not                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `simulate.seal-simulation-case@1` / `@2` and `simulate.run-modelica-scenario@1` / `@2` | Retired recorded-provider route. Not registered | Admitted `@1`, the pinned kit, L4, or L5 |
| Port 3016 `mcp-modelica` sidecar / `ModelicaRunObserver` | Retired fleet/Compose observed-run surface. Not required. | Local admitted/kit microVM Modelica |
| `simulate.run-qualified-modelica-kit@1` | Separate code-owned LinearThermalRamp qualified-kit V1 smoke in the local microVM | Admitted `.mo` execution or recorded `@2`                                  |
| `simulate.run-admitted-modelica@1`      | Reopen `compile.seal-admission@1` Modelica bytes and run them in isolation     | The pinned kit, `@2`, or caller `modelicaText`                                |
| `project_admitted_modelica_evaluation_review` | Provider-free L4 MRTR prep from unique sheet + admitted evidence | L5 closeout, an L4 verdict, or OMC/SysON |
| `project_admitted_modelica_evaluation_closeout_review` | Provider-free L5 accept/reject of the unique current L4 | L4 evaluation, implicit L5 from an L4 `pass`, or a provider grant |

Product Modelica: capture (`modelica-closed-subset-v2`) → compilation preview →
`compile.seal-admission@1` → `project_admitted_modelica_run_review` →
`simulate.run-admitted-modelica@1`. How-to:
[run admitted Modelica](../../how-to/run/run-admitted-modelica.md). The kit is image smoke, not
the product `.mo`. Same image family `casys/modelica-microsandbox-worker`; kit
`ENTRYPOINT` pins one `.mo`, admitted worker runs `/input/source.mo`.

## Cross-domain impact

| This | Is | Is not |
| ---- | -- | ------ |
| `verify.seal-cross-domain-impact-manifest@1` | Provider-free seal of the closed manifest identities | An impact evaluation or a gate-claim transition |
| `analyze.evaluate-cross-domain-impact@1` | Provider-free documentary recross that **proposes** claim statuses | A human decision, claim mutation, or rerun |
| `decide.accept-cross-domain-impact@1` | Human-only application of those already-proposed gate-claim statuses onto existing claims | Work-item invalidation/rerun (X07 records those as `none`), X10, or X11 |
| `analyze.evaluate-mechanical-preservation@1` | Provider-free recross of the exact X09 decision, X08 evaluation, independence assertion, and the unique accepted closeout that names that asserted mechanical execution. Canonical STEP is the cad-asset sibling owned by the cad-model attached to a completed `design.write-geometry@1` run | A CalculiX rerun, X10 work-item, global unique closeout, isolated/draft/preview STEP, a STEP treated as write-geometry evidence, thermal/electrical verdict, or implicit pass/fail |
| `project_cross_domain_impact_decision_review` | Read-only recross of the unique current evaluation capture | A Workbench command or caller-selected branch/claim |

## FEA, sensitivity, correction

Domain contracts: [mechanical proof case](../domains/fea/mechanical-proof-case-v1.md)
and [CalculiX static proof V3](../domains/fea/calculix-static-proof-v3.md).

| This                                         | Is                                                                                               | Is not                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `verify.run-fea-static-proof@1` / `@2`       | Historical MCP FEA. Not registered                                                               | Product isolated `@3`                                        |
| `verify.run-fea-static-proof@3`              | Isolated local CalculiX + separate SysON oracle                                                  | MCP CalculiX, agent `.inp`, or a cad-model as `geometry`     |
| `project_fea_proof_seal_review`              | Catalog id → `fea.proof.*` for `verify.seal-proof-case@1`                                        | Case authoring or a `fea.run.*` grammar                      |
| `project_sensitivity_study_seal_review`      | Catalog id or signed catalog-offer → `sensitivity.case.*` for `analyze.seal-sensitivity-study@1` | Case authoring, a solve, or inventing `cadSource`            |
| `project_fea_isolated_run_review`            | Sealed proof document → `@3` bindings (`proofCase` document + STEP)                              | Binding the assembly cad-model as `geometry`                 |
| Isolated `geometry` binding                  | Canonical part STEP (`kind: step`, `mediaType: model/step`)                                      | The sibling `cad-model`                                      |
| `analyze.seal-sensitivity-study@1`           | Provider-free Thread-document seal of a 2.0 study case                                           | `verify.seal-proof-case@1` or a solve                        |
| `analyze.run-fea-sensitivity@1`              | Two attested CalculiX observations, no verdict                                                   | `verify.run-fea-static-proof@1` / `@2` / `@3`                |
| `verify.evaluate-sensitivity-base@1`         | SysON evaluations of those study-base observations                                               | A proof-run evaluation or an invented metric mapping         |
| STEP inside a sensitivity-study capture      | Isolated solver input for that study only                                                        | Canonical geometry or a proof-run `geometry` binding         |
| `model.write-sensitivity-edges@1`            | Server-rendered derivative PartDef inserted into SysON                                           | `model.write-architecture@1`                                 |
| `renderSensitivityEdgeSetSysml`              | Flat PartDef renderer for measured edges                                                         | `renderSensitivityRelationsSysml`                            |
| `sensitivity-study-case/2.0` `cadSource`     | Sealed compilation-admission artifact URI + sha256                                               | `recipeSource` 1.0 or a STEP artifact                        |
| `design.apply-vector-correction@1`           | Provider-free Thread-document seal of a bounded correction proposal (`grants: none`)             | CAD write, SysON insert, provider run, or execution admission |
| `compile.capture-corrected-source@1`         | Substitute sealed z* into the parent admission source                                            | `compile.seal-admission@1` or `design.execute-build123d@1`   |
| Binding `studyCapture`                       | `sensitivity-study-capture/1.0`                                                                  | `sensitivity-edges-capture/1.0` or a SysON PartDef           |

CalculiX `@3` is not the admitted-source pattern: the agent never writes `.inp`.

## DFM and print

| This                                   | Is                                                                              | Is not                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `industrialize.observe-printability@1` | Documentary FDM observations (`estimate` path); no evaluation                   | Measured DFM verdicts                           |
| `industrialize.run-dfm-checks@1`       | Measured mcp-dfm envelope/thickness/overhang verdicts                           | `observe-printability` or a print-time estimate |
| `printability-check-case/1.0`          | Documentary estimate case; no attested STEP, no Z-min filter                    | `dfm-check-case/1.0`                            |
| `dfm-check-case/1.0`                   | Sealed measured case: attested STEP, build-volume object, declared Z-min filter | A STL target or a hidden executor heuristic     |

## Other

| This                                    | Is                                                                                        | Is not                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `project_work_item_reconcile_successor` | Retired MCP identity. Recovery is `deno task recover:work-item-successor`                 | A canonical project-control tool                                  |
| `planning-only` operation               | Descriptor only; `queueRun` refuses it with `invalid_transition`                          | A trusted Thread writer                                           |
| CM-01 / `state/fixtures/retired/`       | Historical golden record                                                                  | A live project, fallback, or provider admission                   |
| `desk-lamp-dl04` / `desk-lamp-dl05`     | Generic / Heron vehicles. A reread `@2` receipt may exist under gitignored `state/local/` | A committed golden, a clone-true proof, or an `@1` relabel        |
| `config/*-api/` inventory JSON          | Documentary pinned-language ground truth                                                  | A compiler driver or generated qualification table                |
| `console_*` on `:3020/mcp`              | Control-plane fleet and indexed-run reads                                                 | The native cockpit (`preview:thread` / `preview:cockpit`)         |
| `preview:browser` / `ui://casys-digital-thread/console` | Retired Console MCP App. The task refuses                                      | A product page or a registered MCP resource                       |
| `project_led_driver_source_capture` | Draft CAS write of exact `led-driver-human-source/1.0` UTF-8. Pass `result.reference` only | The review envelope, D1, ngspice, or a Thread write |
| `project_led_driver_source_review` | Reference-only reopen of one `led-driver-source-capture/1.0` locator | A capture command, `sourceText`, or the capture review object |
