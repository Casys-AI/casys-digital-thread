# MCS-02 — project source workspace

Workspace r15 contains five modules, four active files and three active attachments.
Its event fingerprint is
`0cb8b448174c7bb18af9584d7a2b03a1af1dc23219437f118dcc892252806092`.

| File | Revision | Role / profile | Attachment target |
| ---- | -------- | -------------- | ----------------- |
| `mcs02.rail-frame` | r2 | CAD / `build123d-closed-subset-v1` | RailFrame, attachment r1 declared on Thread r3 |
| `mcs02.slider-motion` | r1 | Modelica / `modelica-closed-subset-v2` | MotionController, attachment r2 declared on Thread r4 |
| `mcs02.motor-phase` | r1 | SPICE / `spice-circuit-closed-subset-v1` | MotorDriver, attachment r2 declared on Thread r5 |
| `mcs02.design-basis` | r1 | Supporting design basis | Unattached; not executable |

RailFrame r1 declared an executable two-file dependency. Capture preserved the exact
closure, then preview refused it as `source.dependency-lowering-unavailable` because the
Build123d profile has no deterministic multi-file lowering. RailFrame r2 removed that
dependency explicitly and reused the stable attachment; no file was silently dropped.

CAD, Modelica and SPICE then entered through attachment-rooted v3 technical captures and
admissions. The FEA proof-case JSON used generic resource ingress and downstream exact
STEP/SysML joins; it was not a workspace file.
