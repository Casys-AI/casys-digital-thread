# HS01 — SysML

Live path is the **renderer**, not the documentary closed subset.

## Worked

- Seed r2: SysON container `syson-model-seed-6461b80b…1128`, editing context
  `31d1567c-db69-422d-aa5a-e84b8309c60e`.
- Architecture r3 `architecture-bb819de5…0fe3`: package
  `PrecisionHeatedSpecimenStageArchitecture`; system
  `PrecisionHeatedSpecimenStage`; parts `HeatedStagePlate`, `HeaterPad`,
  `MicroscopeSlide`; bare AttributeUsage handles only (`stageThickness`,
  thermal four-tuple, `supplyVoltage`, `heaterResistance`).
- Plate requirements r4 (`1 mm`, `276000000 Pa`, `313 K`) and heater
  requirements r5 (`5 W`, `1 A`).

`model.capture-part-definitions@1` was not run.

## Documentary closed subset

The resource-backed [hs01-architecture.sysml](../sources/hs01-architecture.sysml)
was analysed and sealed at r12 by `model.seal-architecture-sysml@1`. It remains
a dossier specimen: one accepted **package** form, one empty `part def`, no
import, attributes or numbers. It is documentary only: it never wrote SysON
and is not the r3 renderer envelope (`sysml-source-capture/1.0` ≠
`architecture-sysml-source-analysis-capture/1.0`).

## Friction

Closed subset: **one write form per source**, tokenizer rejects comments /
strings / numbers / `attribute`. Multi-file and `import` are outside the
profile. The resource-backed one-file seal proves this boundary, not a
multi-file SysML authoring workflow. See [platform/frictions.md](../platform/frictions.md).
