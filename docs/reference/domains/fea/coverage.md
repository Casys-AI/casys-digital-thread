# Reference: FEA coverage

Audience: both · Diátaxis: reference · Kind: scope

This is the product surface currently admitted by the FEA bounded context. A native
CalculiX feature, a historical Git fixture row, or a successful local experiment is not
a product capability by itself.

## Current surface

| Surface     | Current product boundary                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | `mechanical-proof-case-source/1.0`: agent-authored linear-static intent. Public capture is `project_fea_proof_case_capture`.                            |
| Declaration | Compiled `mechanical-proof-case/1.0`: server recross of Thread STEP, CAD provenance, SysON requirements, and derived identities.                       |
| Seal        | `verify.seal-proof-case@1` rereads the exact source capture, Thread joins, and signed seal MRTR, then publishes a proof document without calling a solver. |
| Run         | `verify.run-fea-static-proof@3` rereads that sealed proof and the exact canonical part STEP, then uses the fixed isolated Gmsh/CalculiX profile.        |
| Result      | Evidence, declared criterion observations, and separately captured SysON constraint evaluations on the exact proof/STEP lineage.                        |
| Closeout    | `project_evaluation_closeout_review` then `decide.accept-evaluation-closeout@1` / `decide.reject-evaluation-closeout@1` record a human L5 over that exact `@3` branch. Accept is offered only when every L4 criterion is literal `pass`. An L4 `pass` is never L5. How-to: [review static-mechanical closeout](../../../how-to/verify-design/close-out-a-static-mechanical-proof.md). |
| Preservation | After a cross-domain impact decision, `analyze.evaluate-mechanical-preservation@2` rereads that exact FEA proof, its consumptions, and the L5 closeout. `carried-forward` requires a current independence assertion covering those exact inputs; otherwise the result stays `impact-unresolved`. No CalculiX call. Impact inventory: [impact coverage](../impact/coverage.md). |

After one evidence-free terminal `isolated_output_validation_failed` attempt on the
unique current leaf of the compiled isolated-run activity,
`project_fea_isolated_run_review` may compile a successor revision of that same
activity. It does not retry the failed work item or run. Completed, cancelled,
uncertain, evidenced, reconciled, forked, stale, foreign, or operation-mismatched
leaves stay refused. This is lifecycle recovery, not new physics.

### Admitted V1 mechanics

| Aspect   | Admitted inventory                                                                        |
| -------- | ----------------------------------------------------------------------------------------- |
| Analysis | `linear-static` only                                                                      |
| Geometry | Exact canonical solid part STEP                                                           |
| Material | One isotropic linear-elastic material: positive `E` and `0 < nu < 0.5`                    |
| Mesh     | Tetrahedral volume mesh with a positive target size                                       |
| Supports | Fully fixed selections defined by closed AABB boxes                                       |
| Loads    | Non-zero force vectors on selections defined by closed AABB boxes                         |
| Criteria | Maximum displacement and/or maximum von Mises stress                                      |
| Verdict  | SysON constraint oracle evaluates declared criteria; solver output alone is not a verdict |

The detailed source, declaration and execution contracts remain
[Mechanical proof-case source](mechanical-proof-case-source.md),
[Mechanical proof case V1](mechanical-proof-case-v1.md) and
[CalculiX static proof V3](calculix-static-proof-v3.md). The historical `@1` and `@2`
MCP FEA operations are not registered product alternatives. Preinstalled desk-lamp, dl,
CA or cantilever Git cases are not live production authority. A local AL01 static
walk is tracking evidence, not a catalog specimen:
[AL01 runtime evidence](../../../project-dossiers/articulated-led-desk-lamp/runtime-evidence.md).

MCS-02 is the current-contract part-level proving run: its attachment-rooted canonical
RailFrame STEP fed `verify.run-fea-static-proof@3`, both declared criteria passed, and
the exact branch reached L5 at Thread r12. See
[MCS-02 FEA](../../../project-dossiers/motorized-camera-slider-mcs02/domains/fea.md). It does not
advance assembly FEA coverage.

## Outside the current surface

- Arbitrary CalculiX decks, solver arguments, containers, images, paths, or provider
  calls supplied by an agent or a case file.
- A `cad-model` used where the run requires the canonical part STEP.
- A seal MRTR used as the separate `@3` run MRTR.
- A second attempt of a failed isolated-run work item. Recovery is a successor revision
  of that activity after one evidence-free `isolated_output_validation_failed` leaf, not
  a retry of the failed work or run.
- Modal, buckling, thermal, dynamic, creep, or coupled analysis.
- Contact; nonlinear geometry or material; plastic or orthotropic material models.
- Pressure, gravity/body-force, prescribed-displacement, moment, or temperature loads.
- Shells, beams, non-tetrahedral models, or non-fixed support families.
- Fatigue, reaction-force, eigenvalue/eigenmode, principal-stress, factor-of-safety, or
  lifetime metrics.
- A solver exit code presented as a requirement verdict without the exact SysON oracle
  evaluation.
- Cross-domain mechanical preservation by omission of a causal edge, or by reinterpreting
  a thermal/electrical capture as a FEA verdict. Preservation is
  `analyze.evaluate-mechanical-preservation@2` only, after
  `decide.accept-cross-domain-impact@2`. It is not X10 and not a CalculiX rerun.
  Operator walk: [walk cross-domain impact judgement](../../../how-to/verify-design/review-cross-domain-impact.md).

## Candidates are not fixture rows

Future method candidates may include another analysis family, another material model,
another element formulation, or a new requirement metric. They remain candidates until
they pass the [extension runbook](../../../how-to/extend/extend-fea-product-surface.md). Capturing a
JSON source is sufficient only when it stays entirely inside the current source schema,
compiled declaration, MRTR grammar, qualified lowering, worker contract, output
validation, and oracle projection.
