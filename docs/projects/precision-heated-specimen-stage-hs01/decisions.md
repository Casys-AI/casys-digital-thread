# HS01 — decisions

Audience: both · Diátaxis: none · Kind: tracking decisions

Not an MRTR store. Origin on recorded approvals is `local-yolo:startup-opt-in`
(`human`). YOLO is not an execution shortcut and does not turn L3 into L5.

Brief confirm fingerprint
`sha256:685d576f5c7d36e02e08a89fc97459a01807878a8b706d27149a1ae7b07bd318`.
Identity `precision-heated-specimen-stage-hs01:brief:r1:b4b44a635134d819`.

## Recorded

| Decision | Input fingerprint | Bound Thread | Not granted |
| -------- | ----------------- | ------------ | ----------- |
| Brief confirm | `685d576f…bd318` | Documentary r1 | Technical model or verdict |
| `decision-hs01-seed-syson` | `7ce596ca…cf659` | r2 blank SysON container | Architecture |
| `decision-hs01-write-architecture` | `6fd216b0…bc30b` | r3 renderer structure + handles | Values, CAD, proof |
| `decision-hs01-write-plate-requirements` | `44877056…d1f13` | r4 `maxDisplacement`/`maxVonMises`/`temperature` | FEA or thermal run |
| `decision-hs01-write-electrical-requirements` | `5803ceb5…246de` | r5 `heaterCurrent`/`electricalPower` | SPICE run or L4 |
| `decision-hs01-seal-cad-admission` | `17bff712…07d56` | r6 CAD admission | Canonical STEP |
| `decision-hs01-write-canonical-geometry` | `270d10d1…a8ae0` | r7 STEP/GLB | FEA |
| `decision-hs01-seal-modelica-admission` | `6710405f…d96d4` | r8 Modelica admission | L3 |
| `decision-hs01-run-admitted-modelica` | `718aef5a…8a73f` | r9 L3 observations | Method sheet, L4, L5 |
| `decision-hs01-seal-spice-admission` | `7c1350b7…bae92` | r10 SPICE admission | L3 |
| `decision-hs01-run-admitted-spice` | `61bb8d8e…061ef` | r11 L3 observations | Method sheet, L4, L5 |
| `decision-hs01-seal-agent-sysml` | recorded approval | r12 documentary closed-subset seal | SysON write or renderer authority |
| `dec-proof-seal-hs01-heated-stage-plate-static-r1` | recorded approval | r13 FEA proof seal | Solver result |
| `decision-fea-isolated-ce78bde4c050d073-r13` | recorded approval | r14 isolated CalculiX evidence and L4 | Mechanical L5 |
| `decision-hs01-accept-mechanical-closeout-r14` | recorded approval | r15 mechanical L5 accept | Whole-product verdict |
| `decision-hs01-thermal-method-sheet-r15` | recorded approval | r16 thermal method-sheet seal | Modelica L4 or L5 |
| `decision-hs01-evaluate-modelica-r16` | recorded approval | r17 initial Modelica L4 capture | Thermal L5; initial capture is `unresolved` |
| `decision-hs01-electrical-method-sheet-r17` | recorded approval | r18 electrical method-sheet seal | Electrical L4 or L5 |
| `decision-hs01-evaluate-spice-r18` | recorded approval | r19 electrical L4 | Electrical L5 |
| `decision-hs01-accept-spice-r19` | recorded approval | r20 electrical L5 accept | Whole-product verdict |
| `decision-hs01-seal-impact-r20` | recorded approval | r21 impact-manifest seal | Impact decision or X11 |

## Pending

| Decision | Operation | Forbidden shortcut |
| -------- | --------- | ------------------ |
| Thermal correction / replay | AX bounded correction, then new L4 review | Calling r17 a failure or an L5 |
| Impact decision | X09 review after a valid impact evaluation | Treating r22 initial claims as a decision |
| X11 mechanical preservation | Only after a resolved X09 | Inventing X10 or preservation by omission |
| Make / Buy | Out of Behave | Opening DFM or BOM to “finish” |

Queue remains `project_change_append` → `project_decision_propose` → approve →
queue → execute. The resource ingress is now part of the recorded HS01 lineage;
it does not grant a provider, solver or verdict.
