# CL01 — runtime evidence

Audience: both · Diátaxis: reference · Kind: dated tracking evidence

Local primary-atelier observation on **2026-09-05** (Asia/Taipei). Runtime state is
gitignored and may drift; these identities record the reread local evidence used for
this dossier. They do not grant a portable provider, engineering, or product claim.

## Heads and workspace

| Authority | Exact local identity | Meaning |
| --- | --- | --- |
| Project | `capability-lamp-cl01:project:r195:0018953cf08e8947` | Local EngineeringProject head after the SPICE L5 closeout |
| Thread | `project:capability-lamp-cl01:r26:decide-accept-admitted-spice-evaluation-run:cl01-queue-spice-closeout-r192` | Current recorded evidence head |
| Workspace r40 | `project-source-workspace-event/4.0`, `capability-lamp-cl01`, r40 | Chrono source recross basis |
| Workspace r41 | `project-source-workspace-event/4.0`, `capability-lamp-cl01`, r41 | SPICE source recross basis |

## Thread chain

| Thread revision | Registered operation | Persisted result |
| --- | --- | --- |
| r13 | `design.write-geometry@1` | Canonical immediate `ArticulatedDeskLamp` assembly; STEP `35daf99164323b79bcef1cc840182743da18746f2ca8269d007bfe8a5fa20ac5` |
| r14 | `verify.observe-assembly-integrity@1` | L3 `assembly-integrity-observation-170849979c496c77f97d5e35e254c8ab60e6543e0d7567f01ccb0f0631362279` |
| r15 | `verify.evaluate-assembly-integrity@1` | L4 `assembly-integrity-evaluation-6be22b92467a45e6ab12993b7201486416eeed8e3feed60a2ef0a7048da43a7f` |
| r16 | `decide.accept-assembly-integrity-evaluation@1` | L5 `assembly-integrity-evaluation-closeout-1abe863284c54f3ebb2bb2a04043eae190eca1ebc653ee5c65721c675e241438` |
| r17 | `prescribed-kinematics-run@1` | L1 `prescribed-kinematics-case-ac37cfb506e4653bb9ecf9f2be9f503f8f38a7381b07119a3b4d19632c5e02f0` |
| r18 | `prescribed-kinematics-run@1` | L3 `prescribed-kinematics-observation-8ab22a4615f5be5d951cbb42055f3bac320893f4cc597bc59eb37a4a2570d914` |
| r19 | `prescribed-kinematics-run@1` | Method `prescribed-kinematics-method-0afbd234eb16af63cccb9860c65d14e81ef5e8d5033ff2a2600f0ca801f5072b` |
| r20 | `verify.evaluate-prescribed-kinematics@1` | L4 `prescribed-kinematics-evaluation-0ca78477a6ff9ec0b065db4415007e83586bf66459461cd33ea2aaadda6542f4` |
| r21 | `decide.accept-prescribed-kinematics-evaluation@1` | L5 `prescribed-kinematics-closeout-6261023686d8e72ede0c75c322e0804fd08534f1cb8d382675fa55c613c7261f` |
| r22 | `compile.seal-admission@3` | Circuit-only SPICE admission `30ef23087a36422c00ff4d8bcdbf814f552625ad6fe5371d618ff730104f5581` |
| r23 | `simulate.run-admitted-spice@1` | L3 capture `f33132653924abfe16e77421265155a445b59f4a21b21a3326cd8a4206834183`; evidence `fbaeac21502f81184b0b80745653b4798ea04f2861b2189b4fd1e56125c18579` |
| r24 | `verify.seal-electrical-observation-method-sheet@1` | Method seal `fd72206531dc2b8504dd02a7c7892dd8df0c7db624e389439b69713840874021` |
| r25 | `verify.evaluate-admitted-spice-observations@1` | L4 `spice-admitted-observation-evaluation-951b44028cdc846f5e4ebc4ba9e2e06ac98a66af2b3a0a373e2ee74a510dda54` |
| r26 | `decide.accept-admitted-spice-evaluation@1` | L5 `spice-admitted-observation-evaluation-closeout-dc406a8f7fe4e794a9d3483f050bc5b28c54acb70d8dbd91b5340ef6812ea836` |

The r23 result identity is
`spice-admitted-result-471c40db0161581c9764bd1387efbb23ea288bcec00148a683789b1299b3955d`.
Its observations are interpreted only by the r24 method and r25 evaluation.
