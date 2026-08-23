# HS01 — FEA

Static linear-isotropic single-part question on the r7 STEP. Product run is
`verify.run-fea-static-proof@3`. Historical MCP `@1`/`@2` are not registered.

## Worked

CAS holds `mechanical-proof-case-source/1.0` digest `3b270469…9d01`. Dossier
copy: [hs01-static-proof-case.json](../sources/hs01-static-proof-case.json).
Body has no caller-chosen authorization, provider, runtime, solver or Thread
basis. Declared criteria: `maxDisplacement <= 1 mm`,
`maxVonMises <= 276000000 Pa`. Load `0.024808 N` downward; negative-X face
fixed; 6061-T6 concept `E = 68300 MPa`, `ν = 0.33`.

The source was resource-captured, sealed at r13 and executed with
`verify.run-fea-static-proof@3` at r14. CalculiX 2.21 / Gmsh 4.12.1 produced
5,098 nodes and 14,835 elements. The literal L4 results were
`maxDisplacement = 0.002477938657233549 mm` against `1 mm`, and
`maxVonMises = 0.17146309861278747 MPa` against `276 MPa`; both passed. The
mechanical closeout was accepted at r15.

## Boundary

Also excluded by the source `evidenceBoundary`: slide, contact, fixtures,
self-weight, buckling, fatigue, thermal stress, safety, certification.
