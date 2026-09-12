# G2 — mechanical arm input sheet

Audience: human · Diátaxis: how-to · Kind: decision input

Status: `reviewed for the AL01 YOLO concept run` on 2026-08-22. These are
delegated demonstration choices, not measurements of a manufactured lamp.

## Subject and geometry

| Required fact                                                    | Human/source entry                       |
| ---------------------------------------------------------------- | ---------------------------------------- |
| Product revision                                                 | Decision basis: project r34 / Thread r4; each operation must bind the later exact current tip |
| Canonical subject                                                | `ArticulatedArm` only                    |
| Geometry source identity, revision, media type, and fingerprint  | Exact Build123d source below; capture fingerprint must be copied from `project_technical_source_capture` |
| Named parameter controlled by `armLever`                         | Rectangular-section thickness = `8 mm`  |
| All other geometry dimensions needed to regenerate the same part | Length `200 mm`; width `20 mm`; centred `Box(200, 20, armLever)` |

Exact reviewed source text:

```python
from build123d import Box
armLever = 8
result = Box(200, 20, armLever)
```

## Material and case

| Required fact                                       | Human/source entry |
| --------------------------------------------------- | ------------------ |
| Material identity and property source               | 6061-T6 aluminium, linear isotropic concept assumption; NASA MAPTIS record 28416 / NTRS 20120014854 |
| Elastic modulus and unit                            | `68,300 MPa`       |
| Poisson ratio                                       | `0.33`             |
| Density and unit, if the declared case uses it      | Not used by this force-only static case |
| Canonical STEP AABB                                 | Observed `[-100,-10,-4]` to `[100,10,4] mm`; Build123d `Box` is centred by default |
| Support region and rationale                        | Fixed root box `[-101,-11,-5]` to `[-99,11,5] mm`, enclosing the x=-100 end face |
| Load region, direction, magnitude, unit, and source | Tip box `[99,-11,-5]` to `[101,11,5] mm`; delegated concept load `[0,0,-10] N` |
| Applicability assumptions and exclusions            | Small-displacement linear static, tetrahedral target size `4 mm`; isolated arm only; no joint, contact, buckling, fatigue, stability, certification, or full-assembly claim |

## Criteria and consequence

| Required fact                                            | Human/source entry |
| -------------------------------------------------------- | ------------------ |
| Displacement metric, operator, threshold, and unit       | `maxDisplacement <= 2 mm` |
| Stress metric, operator, threshold, and unit             | `maxVonMises <= 80 MPa` (compiled to `80,000,000 Pa`) |
| Intended consequence of `pass`, `fail`, and `unresolved` | `pass`: accept only this concept case; `fail`: preserve evidence and consider sensitivity; `unresolved`: no mechanical conclusion |
| Responsible reviewer                                     | `local-yolo:startup-opt-in`, explicitly delegated in the paired conversation on 2026-08-22 |

Material source: NASA MAPTIS sheet record 28416, mirrored by NTRS document
`20120014854`, reports longitudinal modulus `6.83e10 Pa` and Poisson ratio `0.33`
for 6061-T6 sheet. Geometry, load, mesh and acceptance limits are explicit product
demonstration decisions from the paired conversation; they are not supplier facts.

The earlier revision-1 boxes assumed a `0..200 mm` X range. A real isolated run
rejected that case because the centred canonical STEP contains neither end face
there. Revision 2 corrects only the AABB selections; it does not alter the canonical
geometry, material, mesh, load or requirements.

Do not provide a CalculiX payload, mesh command, provider name, image, path, or runtime
option. After review, the server compiles the facts into the registered CAD and FEA
operations. A solver success remains L3 until the separate criterion evaluation.
