# HS01 — CAD

Canonical subject is isolated `HeatedStagePlate` only (heater envelope
110.65 × 70.45 × 1.54 mm). Not an assembly.

## Worked

- Source [hs01-heated-stage-plate.py](../sources/hs01-heated-stage-plate.py)
  matches admitted CAS `ed2c3346…bfad`.
- Admission r6 `technical-compilation-admission-e1b155a3…9fd5f`
  (`compile.seal-admission@1`, run `hs01-queue-cad-admission-r41`).
- Canonical seal r7 `geometry-e92f9ee5…57e9`: STEP
  `5aa7179c52bda583467c227e4a32e50001f080b25836cdc60b3728e51a9a1d74`, GLB
  `31c3323fee962fff88b343009c1947529ded42b0a792cb82f62121afdbfb6fff`.
  Thread names the second file GLTF; the digest is the published GLB bytes.
- One `represents` join on `HeatedStagePlate`
  (`a8c7f3e5-dfb3-4219-94d7-e7ec21770a2f`) and one `parameterizes` join on
  `stageThickness`.

## Pending

No further CAD revision. Assembly-complete CAD is a brief exclusion.

## Ingress boundary

Isolated sandbox export is not canonical STEP. The exact source entered through
the generic resource capture then `resourceRef`; its raw digest is
`ed2c3346…bfad`. This proves byte reread and admission lineage, not geometry
for `MicroscopeSlide` or `HeaterPad`, which remain absent.
