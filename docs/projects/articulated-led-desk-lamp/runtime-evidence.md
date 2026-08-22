# Articulated LED desk lamp — local runtime evidence

Audience: both · Diátaxis: none · Kind: tracking evidence

Dated observation from the primary local atelier on **2026-08-23**. The underlying
`state/local/` files are gitignored runtime state; this page records their exact
identities without turning them into portable proof, provider truth, physical safety,
compliance, lifetime, brightness, manufacturing, or vendor validity.

Workbench `GET /api/thread/workbench` on this atelier returned
`engineering-workbench/0.3`, surface `evidence`, header
`X-Casys-Data-Source: canonical-thread-snapshot`, `thread.source` `observed`,
alignment `aligned` 26/26. `GET /api/thread/workbench/events` emitted SSE
`event: workbench-snapshot` with id `articulated-led-desk-lamp-al01:227:26:13`. Those
reads executed no engineering operation. UI is not proof.

## Current heads

| Authority         | Exact identity                                                                                                                                        | Meaning                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Project           | `articulated-led-desk-lamp-al01:project:r227:3c3d0ae99e26a887`                                                                                        | Latest durable project revision after X11 mechanical preservation                                |
| Approved brief    | `articulated-led-desk-lamp-al01:brief:r4:5d0f13901f366866`                                                                                            | Brief V2; three sibling success criteria remain separate                                         |
| Brief fingerprint | `sha256:034e08dbd08378a1db0eb177e9bc791aa4029245a6ed70af8f8b4acc526e1178`                                                                             | Exact approved brief r4 input used by the impact recross                                         |
| Thread            | `project:articulated-led-desk-lamp-al01:r26:analyze-evaluate-mechanical-preservation-run:al01-queue-mechanical-preservation-r25-20260823`             | Current evidence head after provider-free X11                                                    |
| Cockpit focus     | workspace `primary` revision 5; target `articulated-led-desk-lamp-al01`                                                                               | Projection routing only                                                                          |

Project `generatedAt` is `2026-08-22T22:02:35.288Z`. Human MRTRs on this atelier used
origin `human` / `local-yolo:startup-opt-in`. YOLO is not a physical measurement.

## Completed chain

| Thread revision | Registered operation                                      | Run                                                          | Persisted artifact / fact |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------- |
| r1              | `baseline.from-approved-brief@1`                          | `run:lamp-queue-baseline-20260822`                           | Documentary brief r1 baseline |
| r2              | `architecture.seed-syson-model@2`                         | `run:lamp-queue-syson-seed-20260822`                         | SysON container identity only |
| r3              | `model.write-architecture@1`                              | `run:lamp-queue-write-architecture-20260822`                 | Renderer-authored structure |
| r4              | `model.capture-part-definitions@1`                        | `run:lamp-queue-part-definitions-capture-20260822`           | Exact PartDefinition subgraph |
| r5              | `model.write-requirements@1`                              | arm requirements                                             | `ArticulatedArm` integer scalars |
| r6              | `compile.seal-admission@1`                                | `run:al01-queue-arm-cad-admission-r5-20260822`               | Arm CAD admission |
| r7              | `design.write-geometry@1`                                 | geometry-part seal                                           | Canonical STEP `sha256:493af847b313a56308af1dd064e52c5ba8a8d371de85fa1663b95c889d23b173` |
| r9              | `verify.seal-proof-case@1`                                | `run:al01-queue-fea-proof-seal-r2-20260822`                  | Sealed static proof r2 (AABB correction of r8) |
| r10             | `verify.run-fea-static-proof@3`                           | `run:al01-queue-fea-isolated-r2-20260822`                    | CalculiX L3 + SysON L4 on that STEP |
| r11             | `decide.accept-evaluation-closeout@1`                     | `run:al01-queue-mechanical-closeout-r10-20260822`            | Human mechanical L5 accept |
| r12             | `compile.seal-admission@1`                                | `run:al01-queue-modelica-admission-r11-20260822`             | Admitted `LampHeadThermal` |
| r13             | `simulate.run-admitted-modelica@1`                        | `run:al01-queue-admitted-modelica-run-r12-20260822`          | OMC 1.27.0 / DASSL documentary L3 |
| r14             | `model.write-requirements@1`                              | LampHead temperature                                         | `temperature <= 313 K` |
| r15             | `verify.seal-modelica-thermal-method-sheet@1`             | `run:al01-queue-thermal-method-sheet-r14-20260822`           | Thermal method sheet seal |
| r16             | `verify.evaluate-admitted-modelica-observations@1`        | `run:al01-queue-admitted-modelica-evaluation-r15c-20260823`  | Thermal L4 `pass` |
| r17             | `decide.accept-admitted-modelica-evaluation@1`            | `run:al01-queue-admitted-modelica-closeout-r16-20260823`     | Human thermal L5 accept |
| r18             | `compile.seal-admission@1`                                | `run:al01-queue-spice-admission-r17-20260823`                | Circuit-only SPICE admission |
| r19             | `simulate.run-admitted-spice@1`                           | `run:al01-queue-admitted-spice-run-r18c-20260823`            | ngspice 42 documentary L3 |
| r20             | `verify.seal-electrical-observation-method-sheet@1`       | `run:al01-queue-electrical-method-sheet-r19-20260823`        | Electrical method sheet seal |
| r21             | `verify.evaluate-admitted-spice-observations@1`           | `run:al01-queue-admitted-spice-evaluation-r20b-20260823`     | Electrical L4; all named G5 criteria `pass` |
| r22             | `decide.accept-admitted-spice-evaluation@1`               | `run:al01-queue-admitted-spice-closeout-r21-20260823`        | Human electrical L5 accept |
| r23             | `verify.seal-cross-domain-impact-manifest@1`              | `run:al01-queue-impact-manifest-seal-r22b-20260823`          | Sealed G6 manifest |
| r24             | `analyze.evaluate-cross-domain-impact@1`                  | `run:al01-queue-cross-domain-impact-evaluation-r23-20260823` | Proposed electrical `invalidated`, thermal `invalidated`, mechanical `carried-forward`; `rerunProposals: none` |
| r25             | `decide.accept-cross-domain-impact@1`                     | `run:al01-queue-impact-decision-r24-20260823`                | Human YOLO X09 applied those exact gate statuses; `reruns: none` |
| r26             | `analyze.evaluate-mechanical-preservation@1`              | `run:al01-queue-mechanical-preservation-r25-20260823`        | Mechanical `carried-forward`; no solver, provider, rerun, or new work |

r8 is the superseded first proof seal. Work items
`work-al01-admitted-modelica-evaluation-r15`,
`work-al01-admitted-modelica-evaluation-r15b`,
`work-al01-admitted-spice-run-r18`, and
`work-al01-admitted-spice-run-r18b` are leftover **ready** work items from failed
attempts; they are not the current head.

## Branch facts (literal)

### Mechanical (L3 r10, L4 r10, L5 r11)

Canonical STEP digest
`493af847b313a56308af1dd064e52c5ba8a8d371de85fa1663b95c889d23b173`. Isolated CalculiX
observations: `maxDisplacement` `0.27238935341620824 mm` (limit `<= 2 mm`, L4 `pass`,
margin `1.7276106465837917 mm`); `maxVonMises` `6.876467452777839 MPa` (limit
`<= 80 MPa` / `80000000 Pa`, L4 `pass`). Human accept closeout artifact
`evaluation-closeout-954325170cc343d3c6fcbaa34ce55c30e69b165c6af6f46310bbe791f9d4c36e`.
No fail-only correction ran: G3 did not fire.

### Thermal (L3 r13, L4 r16, L5 r17)

Admitted OMC `OpenModelica 1.27.0`, solver `dassl`. Isolated parameters
`electricalPower = 5 W`, `lampHeadThermalState = 298.15 K`. Observation
`temperature.final` / `temperature.max_abs` `305.1378579691034 K`. SysON L4 `pass`
against `<= 313 K`, margin `7.862142030896621 K`. Human accept closeout
`modelica-admitted-observation-evaluation-closeout-bf184d8d2d70782ae2ce16a9c593afc00c767d98cf14eb66c1beee9b66659420`.
This is the isolated lumped scalar model. It is not a spatial lamp-head thermal proof.

### Electrical (L3 r19, L4 r21, L5 r22)

Admitted ngspice `42` operating point. Native `i(v1) = -0.028827 A`. L4 derives
`criterion-delivered-current` `0.028827 A` (`>= 0.02 A` and `<= 0.04 A`, both `pass`)
and `criterion-source-delivered-power` `0.345924 W` (`<= 0.5 W`, `pass`). Comparator is
the server-owned electrical method sheet, not ngspice and not SysON. Human accept
closeout
`spice-admitted-observation-evaluation-closeout-0b7866266962f7dad56b2502d5a3e35ec28c180da8b91650bc78bd6b74f6db5b`.
This is not mcp-spice and not a safety, EMC, optical, or vendor claim.

### Impact (r23–r26)

G6 adopts that accepted G5 `0.345924 W` observation as a **proposed shared coupling
input for a future re-run**. It is not a thermal result and does not mutate the current
G4 `5 W` admission. Manifest id `al01-g6-power-coupling-impact-r22`. X07/X08 limits
`rerunProposals: none`. X09 applied `success-electrical-driver` `invalidated`,
`success-thermal-head` `invalidated`, `success-mechanical-arm` `carried-forward` onto
work item `work-al01-impact-manifest-seal-r22`. X10 stays `unavailable`. X11
`preservation.status` `carried-forward` with
`limits.solverCalls/providerCalls/rerunProposals/newWorkItems: none`. No hidden rerun.

## Literal stops that remain

- Generic X10 rerun planner is `unavailable`. Invalidated electrical/thermal branches
  were not re-executed.
- G3 fail-only correction did not run (mechanical L4 `pass`).
- G7 has per-branch L5 records; there is no whole-lamp verdict.
- Workbench mechanical closeout family projects as `historical` after the impact
  decision; X11 still reread the unique accepted closeout of that FEA execution.
- Typed/value architecture attributes remain `unresolved` (probe 2026-08-21).
- `mcp-spice` integration remains `unresolved` preflight; it is not this product run.
