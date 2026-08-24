# RFCs

Audience: both · Diátaxis: none · Kind: RFC

A file in `docs/rfcs/` is a **session brief** or a **study** (sometimes rejected). It is
not Diátaxis. Once the lot has merged, the living truth is the how-to or the reference.
Do not treat an RFC as the product contract.

## Status legend

| Status        | Means                                                               |
| ------------- | ------------------------------------------------------------------- |
| `active`      | Session brief still open; implement only what it names              |
| `implemented` | Lot is on the branch; read the living page, keep the RFC as archive |
| `rejected`    | Negative decision; kept so the rejected design is not relitigated   |
| `study`       | Architecture or inventory study; not a how-to and not a contract    |

## Catalogue

| RFC                                                                                                    | Status        | Read instead                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [qualified-build123d 1.4.0](build123d/qualified-build123d-1.4.0-placement-grammar.md)                  | `implemented` | [compilation and isolation](../reference/pipeline/compilation-and-isolation.md), [closed-language compilation](../explanations/product/closed-language-compilation.md)                                                                 |
| [qualified-build123d 1.5.0](build123d/qualified-build123d-1.5.0.md)                                    | `implemented` | [compilation and isolation](../reference/pipeline/compilation-and-isolation.md)                                                                                                                                                        |
| [qualified-build123d 1.6.0](build123d/qualified-build123d-1.6.0.md)                                    | `implemented` | [compilation and isolation](../reference/pipeline/compilation-and-isolation.md) (analyzer `build123d-qualified-lezer` 1.6.0)                                                                                                           |
| [build123d full-compilation plan](build123d/build123d-full-compilation-plan.md)                        | `study`       | [closed-language compilation](../explanations/product/closed-language-compilation.md)                                                                                                                                                  |
| [selector grammar study](build123d/qualified-build123d-selector-grammar-study.md)                      | `study`       | [closed-language compilation](../explanations/product/closed-language-compilation.md)                                                                                                                                                  |
| [selector grammar counterstudy](build123d/qualified-build123d-selector-grammar-counterstudy.md)        | `study`       | [closed-language compilation](../explanations/product/closed-language-compilation.md)                                                                                                                                                  |
| [CAD admission two-level evidence](cad-admission/cad-admission-two-level-evidence.md)                  | `rejected`    | [closed-language compilation](../explanations/product/closed-language-compilation.md)                                                                                                                                                  |
| [CAD admission two-level counterstudy](cad-admission/cad-admission-two-level-evidence-counterstudy.md) | `study`       | [closed-language compilation](../explanations/product/closed-language-compilation.md)                                                                                                                                                  |
| [acpx 0.13.1 elicitation alignment](desktop/acpx-0.13.1-elicitation-alignment.md)                      | `implemented` | [embedded acpx chat](desktop/embedded-acpx-chat.md); exact fork commit `3c927fc` is packaged by Desktop Lot 4                                                                                                                          |
| [Deno Desktop product shell](desktop/deno-desktop-product-shell.md)                                    | `active`      | [workspace map](../reference/runtime/workspace-map.md); Lots 1–4 are implemented, while native distribution proof remains macOS-only                                                                                                   |
| [embedded acpx chat](desktop/embedded-acpx-chat.md)                                                    | `implemented` | Desktop Lot 4 host, DTO IPC, Workbench UI, elicitation, retention, and server-validated MRTR gates                                                                                                                                     |
| [private cross-project sensitivity reuse](sensitivity/private-cross-project-experience-reuse.md)       | `implemented` | [current sensitivity domain reference](../reference/domains/sensitivity/README.md)                                                                                                                                                     |
| [modular project source workspace](project-source-workspace/README.md)                                  | `active`      | [living workspace reference](../reference/domains/project-source-workspace/README.md) and [coverage](../reference/domains/project-source-workspace/coverage.md). Core workspace plus attachment-rooted single-source bridge are implemented and MCS-02-proven; the large-assembly extension remains open. |
| [inspection-drone v4 architecture slice](vehicles/inspection-drone-v4-architecture-slice.md)           | `implemented` | [author architecture SysML](../how-to/compile/author-architecture-sysml.md)                                                                                                                                                            |
| [articulated LED desk-lamp demo queue](articulated-led-desk-lamp-demo/README.md)                       | `active`      | [AL01 tracking](../projects/articulated-led-desk-lamp/status.md); [Behave decision roadmap](../explanations/product/behave-decision-roadmap.md). Core 01–07 observed locally; X10 `unavailable`; refactor 08–09 and closeout 10 remain |

Human and agent reading plans: [docs/README.md](../README.md).
