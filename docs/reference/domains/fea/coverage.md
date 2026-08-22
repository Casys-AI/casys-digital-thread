# Reference: FEA coverage

Audience: both · Diátaxis: reference · Kind: scope

This is the product surface currently admitted by the FEA bounded context. A native
CalculiX feature, a row in a Git catalog, or a successful local experiment is not a
product capability by itself.

## Current surface

| Surface     | Current product boundary                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Declaration | `mechanical-proof-case/1.0`: one reviewed linear-static part proof with the V1 material, mesh, support, load, and criterion vocabulary.                 |
| Catalog     | Versioned `mechanical-proof-case-catalog/1.0` Git manifest plus one validated JSON declaration per case.                                                |
| Seal        | `verify.seal-proof-case@1` rereads the exact declaration, Thread joins, and signed seal MRTR, then publishes a proof document without calling a solver. |
| Run         | `verify.run-fea-static-proof@3` rereads that sealed proof and the exact canonical part STEP, then uses the fixed isolated Gmsh/CalculiX profile.        |
| Result      | Evidence, declared criterion observations, and separately captured SysON constraint evaluations on the exact proof/STEP lineage.                        |
| Closeout    | `decide.accept-evaluation-closeout@1` / `decide.reject-evaluation-closeout@1` record a human L5 over that exact `@3` branch. An L4 `pass` is never L5. |
| Preservation | After a cross-domain impact decision, `analyze.evaluate-mechanical-preservation@1` rereads that exact FEA proof, its consumptions, and the L5 closeout. `carried-forward` requires a current independence assertion covering those exact inputs; otherwise the result stays `impact-unresolved`. No CalculiX call. |

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

The detailed declaration and execution contracts remain
[Mechanical proof case V1](mechanical-proof-case-v1.md) and
[CalculiX static proof V3](calculix-static-proof-v3.md). The historical `@1` and `@2`
MCP FEA operations are not registered product alternatives.

## Outside the current surface

- Arbitrary CalculiX decks, solver arguments, containers, images, paths, or provider
  calls supplied by an agent or a case file.
- A `cad-model` used where the run requires the canonical part STEP.
- A seal MRTR used as the separate `@3` run MRTR.
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
  `analyze.evaluate-mechanical-preservation@1` only, after
  `decide.accept-cross-domain-impact@1`. It is not X10 and not a CalculiX rerun.

## Candidates are not catalog rows

Future method candidates may include another analysis family, another material model,
another element formulation, or a new requirement metric. They remain candidates until
they pass the [extension runbook](../../../how-to/extend/fea-surface.md). Adding a JSON
case and manifest entry is sufficient only when it stays entirely inside the current
declaration schema, MRTR grammar, qualified lowering, worker contract, output
validation, and oracle projection.
