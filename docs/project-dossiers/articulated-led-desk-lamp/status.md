# Articulated LED desk lamp — status

Audience: both · Diátaxis: none · Kind: tracking status

Truth columns: [projects README](../README.md). This page is not a project snapshot.

## What this is not

- **Not a physical product proof.** Local AL01 now has distinct mechanical, thermal,
  electrical L3–L5 records plus one reviewed impact recross. That is not safety,
  compliance, lifetime, brightness, manufacturing, vendor validity, or a whole-lamp
  verdict.
- **Not a repair of dl05.** From-zero Behave work starts a **new** project and must not
  clone or pin `desk-lamp-dl05`
  ([from-zero how-to](../../how-to/verify-design/verify-a-new-design-from-scratch.md)).
- **Not CA02.** `cantilever-arm-ca02` may educate the static catalogue; it must not
  supply lamp identities. Its internal planning history is not exported here.
- **Not X10.** G6 proposed a shared coupling input for a future re-run. Generic X10
  remains `unavailable`. There was no hidden solver rerun.

## Local runtime (2026-08-23, primary atelier, local)

`state/local/` is gitignored ([`.gitignore`](../../../.gitignore);
[persistence roots](../../reference/codebase/persistence-roots.md)). Active
revisions appear as directory names under `state/local/engineering-projects/`
([engineering-project contract](../../reference/contracts/engineering-project.md)).

Primary atelier listing **2026-08-23**, local:

- `articulated-led-desk-lamp-al01` (project r227 / Thread r26)
- `cantilever-arm-ca02`
- `modelica-ramp-mr01`
- `modelica-ramp-mr02`
- `heated-mug-coaster-hc01`

The fresh lamp project is `articulated-led-desk-lamp-al01`; it is not internal planning
history, a fixture identity, historical `desk-lamp-dl04` / `desk-lamp-dl05`, or CA02.
Exact local heads and artifacts: [runtime evidence](runtime-evidence.md).

## Tracked project and capture identities

| Identity                                                                                                  | What it is                                                                                         | What it is not                                                |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `articulated-led-desk-lamp-al01`                                                                          | Live local EngineeringProject; approved brief r4; project r227 / Thread r26 on the dated observation | A portable fixture, a physical proof, or a whole-lamp verdict |
| Internal planning history (not exported)                                                                  | Session brief and progress journal                                                                 | Runtime project truth                                         |
| `src/testing/articulated-led-desk-lamp-brief-fixture.ts` (`articulated-led-desk-lamp`)                    | Test identity; file comment: not a live project, not a dl05 relabel                                | Signed brief, SysON, or Thread                                |
| `src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl*.json` and related sensitivity catalog rows | Historical specimens                                                                               | The fresh lamp project                                        |

The live lamp captures are local and gitignored. Their exact dated identities are
recorded in [runtime-evidence.md](runtime-evidence.md); the other vehicles remain
separate authorities.

## Status by surface

Literals only. No completion percentage. Checkboxes appear only where the fact is
evidenced in-repo or by the dated local listing.

| Surface                                                                      | Code capability available                                                                                                                                                                                                                                                                                                      | Project/capture written                                                                                                                   | Live runtime observed (2026-08-23, primary atelier, local) | Persisted proof                                              | Human decision                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Project lifecycle (`project_start` → brief → change append)                  | Yes. Generic tools: [agent workspace](../../reference/agent/agent-workspace.md)                                                                                                                                                                                                                                                | Live AL01 brief r4 and append-only changes through project r227                                                                           | Observed                                                   | Documentary baseline r1; current brief r4                    | Brief approved through local YOLO human origin                      |
| SysML renderer `model.write-architecture@1` / PartDefinition reread          | Yes. [SysML coverage](../../reference/domains/sysml/coverage.md). Typed/value architecture attributes remain `unresolved` (probe 2026-08-21)                                                                                                                                                                                   | AL01 architecture plus PartDefinitions and later requirements                                                                             | SysON insert and exact reread observed                     | Thread r3/r4 structure; r5 arm and r14 LampHead requirements | Architecture and requirement MRTRs approved; no physical value invented |
| Canonical CAD `project_admitted_geometry_export` → `design.write-geometry@1` | Yes. [CAD coverage](../../reference/domains/cad/coverage.md), [execution paths](../../reference/domains/cad/execution-paths.md)                                                                                                                                                                                                | Arm admission r6; canonical STEP r7                                                                                                       | Observed                                                   | STEP digest `493af847…d23b173`                               | G2 geometry reviewed; isolated execution is not this STEP           |
| Static FEA `verify.run-fea-static-proof@3`                                   | Yes. [FEA coverage](../../reference/domains/fea/coverage.md). Historical MCP `@1`/`@2` are not registered                                                                                                                                                                                                                      | Proof seal r9, isolated run r10, closeout r11                                                                                             | Observed                                                   | Displacement `0.27238935341620824 mm`; stress `6.876467452777839 MPa`; L4 `pass` vs `2 mm` / `80 MPa` | Human L5 accept r11. An L4 `pass` is never L5. G3 correction did not fire |
| Admitted Modelica `simulate.run-admitted-modelica@1` plus L4/L5 ops          | Yes, generic. [Modelica coverage](../../reference/domains/modelica/coverage.md). Kit `@1` is not this path                                                                                                                                                                                                                     | Admission r12, L3 r13, sheet r15, L4 r16, L5 r17                                                                                          | Observed                                                   | OMC 1.27.0/DASSL `305.1378579691034 K`; L4 `pass` margin `7.862142030896621 K` vs `313 K` | Human L5 accept r17. Isolated `5 W` assumption; not a spatial thermal proof |
| Electrical / admitted SPICE                                                  | Yes: `simulate.run-admitted-spice@1` plus method-sheet, L4, L5. [Electrical](../../reference/domains/electrical/README.md). `mcp-spice` remains preflight `unresolved` ([spice](../../reference/providers/spice/README.md))                                                                                                    | Admission r18, L3 r19, sheet r20, L4 r21, L5 r22                                                                                          | Observed                                                   | ngspice 42 `i(v1)=-0.028827 A`; L4 derives `0.028827 A` and `0.345924 W`; all named G5 criteria `pass` | Human L5 accept r22. Not mcp-spice, not safety/EMC/optical          |
| Cross-domain impact                                                          | Generic X04–X09 and X11 supported; X10 `unavailable` ([impact coverage](../../reference/domains/impact/coverage.md)). X11 is not a CalculiX call                                                                                                                                                                               | Manifest r23, X07/X08 r24, X09 r25, X11 r26                                                                                               | Observed                                                   | Electrical `invalidated`, thermal `invalidated`, mechanical `carried-forward`; `rerunProposals: none` | Human local-yolo X09 r25 applied those exact statuses. G6 is a proposed future coupling input, not a thermal result |
| Workbench projection                                                         | Generic read-only Workbench exists                                                                                                                                                                                                                                                                                             | AL01 project r227 and Thread r26 projected                                                                                                | GET `engineering-workbench/0.3` evidence, `canonical-thread-snapshot`, `source observed`, `aligned` 26/26; SSE `articulated-led-desk-lamp-al01:227:26:13` | UI is not proof                                              | Workbench must not receive commands                                 |

Internal planning history (not persisted evidence) recorded core lots 01–07 and
closeout lot 10 as complete on this atelier with X10 still `unavailable`; lot 08 was an
independent refactor lane and lot 09 was complete. That history is not exported, and
updating it does not create a project.

## Evidenced checkboxes

- [x] Generic Behave operations exist in
      [`src/orchestration/operations/registry.ts`](../../../src/orchestration/operations/registry.ts)
      (SysML renderer, admission, canonical geometry, isolated FEA `@3`, admitted
      Modelica, admitted SPICE, impact recross).
- [x] Internal planning history was kept separate from this public source export.
- [x] Test fixture exists and declares it is not a live project
      ([`articulated-led-desk-lamp-brief-fixture.ts`](../../../src/testing/articulated-led-desk-lamp-brief-fixture.ts)).
- [x] Fresh `articulated-led-desk-lamp-al01` EngineeringProject exists locally with
      approved brief r4.
- [x] SysON seed, renderer-backed architecture, exact replay, and PartDefinition reread
      are persisted; later requirements, CAD, FEA, Modelica, SPICE, and impact follow.
      See [runtime evidence](runtime-evidence.md).
- [x] Canonical arm STEP and mechanical L3/L4/L5 on that exact STEP.
- [x] Admitted Modelica L3/L4/L5 on the isolated lumped head model.
- [x] Admitted ngspice L3/L4/L5 on the circuit-only netlist.
- [x] Impact seal, X07 proposal, human X09, and X11 mechanical `carried-forward` with
      no hidden rerun.
- [x] Read-only Workbench GET + SSE aligned on project r227 / Thread r26.
- [ ] Generic X10 thermal/electrical rerun planner.
- [ ] Fail-only mechanical correction (G3; L4 `pass`, so it did not fire).
- [ ] Signed whole-lamp G7 verdict / physical safety, compliance, lifetime, brightness,
      manufacturing, or vendor validity.

## Human-owned remainder

Gates G0–G7 stay human. AL01 recorded per-branch L5 accepts and one impact decision
through local YOLO. Those records do not fill G7 as a combined lamp verdict. Missing
physical inputs still do not justify defaults. A CalculiX, OpenModelica, or ngspice
success is not an oracle and not L5.

Use the small [domain input sheets](input-sheets/README.md) to prepare G2, G4, G5, and
G6 without mixing them into one document. A completed sheet remains source material; the
exact project proposal still requires its own MRTR.
