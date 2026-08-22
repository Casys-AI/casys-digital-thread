# Articulated LED desk lamp — status

Audience: both · Diátaxis: none · Kind: tracking status

Truth columns: [projects README](../README.md). This page is not a project snapshot.

## What this is not

- **Not a completed product proof.** A live project now exists, but its current Thread
  head is structure only. The RFC remains an implementation brief, not runtime proof
  ([RFC README](../../rfcs/articulated-led-desk-lamp-demo/README.md)).
- **Not a repair of dl05.** From-zero Behave work starts a **new** project and must not
  clone or pin `desk-lamp-dl05`
  ([from-zero how-to](../../how-to/behave/run-the-behave-loop-from-zero.md)).
- **Not CA02.** `cantilever-arm-ca02` may educate the static catalogue; it must not
  supply lamp identities
  ([RFC 03](../../rfcs/articulated-led-desk-lamp-demo/03-mechanical-arm-correction-loop.md)).

## Local runtime (2026-08-22, primary atelier, local)

`state/local/` is gitignored ([`.gitignore`](../../../.gitignore);
[workspace source map](../../reference/runtime/workspace-source-map.md)). Active
revisions appear as directory names under `state/local/engineering-projects/`
([engineering-project contract](../../reference/contracts/engineering-project.md)).

Primary atelier listing **2026-08-22**, local:

- `articulated-led-desk-lamp-al01`
- `cantilever-arm-ca02`
- `modelica-ramp-mr01`
- `modelica-ramp-mr02`
- `heated-mug-coaster-hc01`

The fresh lamp project is `articulated-led-desk-lamp-al01`; it is not the RFC folder,
fixture identity, historical `desk-lamp-dl04` / `desk-lamp-dl05`, or CA02. Exact local
heads and artifacts: [runtime evidence](runtime-evidence.md).

## Tracked project and capture identities

| Identity                                                                                                  | What it is                                                                                         | What it is not                                                |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `articulated-led-desk-lamp-al01`                                                                          | Live local EngineeringProject; approved brief r2; project r34 / Thread r4 on the dated observation | A portable fixture, a physical proof, or a whole-lamp verdict |
| RFC queue `docs/rfcs/articulated-led-desk-lamp-demo/`                                                     | Session brief and progress journal                                                                 | Runtime project truth                                         |
| `src/testing/articulated-led-desk-lamp-brief-fixture.ts` (`articulated-led-desk-lamp`)                    | Test identity; file comment: not a live project, not a dl05 relabel                                | Signed brief, SysON, or Thread                                |
| `src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl*.json` and related sensitivity catalog rows | Historical specimens                                                                               | The fresh RFC lamp                                            |

The live lamp captures are local and gitignored. Their exact dated identities are
recorded in [runtime-evidence.md](runtime-evidence.md); the other vehicles remain
separate authorities.

## Status by surface

Literals only. No completion percentage. Checkboxes appear only where the fact is
evidenced in-repo or by the dated local listing.

| Surface                                                                      | Code capability available                                                                                                                                                                                                                                                                                                      | Project/capture written                                                                                                                   | Live runtime observed (2026-08-22, primary atelier, local) | Persisted proof                                              | Human decision                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Project lifecycle (`project_start` → brief → change append)                  | Yes. Generic tools: [agent workspace](../../reference/agent/agent-workspace.md)                                                                                                                                                                                                                                                | Live AL01 brief r2 and append-only changes through project r34                                                                            | Observed                                                   | Documentary baseline r1 only                                 | Brief r2 approved through local YOLO human origin; G2 question open |
| SysML renderer `model.write-architecture@1` / PartDefinition reread          | Yes. [SysML coverage](../../reference/domains/sysml/coverage.md). Typed/value architecture attributes remain `unresolved` (probe 2026-08-21)                                                                                                                                                                                   | AL01 architecture artifact plus PartDefinitions bundle                                                                                    | SysON insert and exact reread observed                     | Thread r3/r4 structure artifacts; no requirement verdict     | Architecture MRTR approved; no physical value approved              |
| Canonical CAD `project_admitted_geometry_export` → `design.write-geometry@1` | Yes. [CAD coverage](../../reference/domains/cad/coverage.md), [execution paths](../../reference/domains/cad/execution-paths.md)                                                                                                                                                                                                | No lamp admission/source in git as live project data                                                                                      | Not observed                                               | Isolated execution is not canonical STEP                     | Gate G2 geometry remains human-owned                                |
| Static FEA `verify.run-fea-static-proof@3`                                   | Yes. [FEA coverage](../../reference/domains/fea/coverage.md). Historical MCP `@1`/`@2` are not registered                                                                                                                                                                                                                      | RFC 03 M01: catalog-absent / project-subject mismatch vs dl05/CA02 (RFC journal). Preinstalled desk-lamp Git cases are not live authority | Not observed                                               | None for a fresh lamp                                        | Gate G2 / mechanical L5 not recorded here. An L4 `pass` is never L5 |
| Admitted Modelica `simulate.run-admitted-modelica@1` plus L4/L5 ops          | Yes, generic. [Modelica coverage](../../reference/domains/modelica/coverage.md). Kit `@1` is not this path                                                                                                                                                                                                                     | RFC 04: code lots exist; T08–T10 **real product proof absent** (RFC journal)                                                              | Not observed                                               | None for a lamp head. L3 remains documentary until evaluated | Gate G4 / Modelica L5 not recorded here                             |
| Electrical / ngspice                                                         | **No product run.** Electrical owns a provider-free LED-driver fiche only ([electrical](../../reference/domains/electrical/README.md)). `mcp-spice` is preflight; integration `unresolved` ([spice](../../reference/providers/spice/README.md)). No registered ngspice operation in `src/orchestration/operations/registry.ts` | RFC 05 E01 capture is reference-only; D2 non-executable preflight (RFC journal)                                                           | Fleet probe is not a lamp circuit                          | None                                                         | Gate G5 remains human-owned. Do not invent a netlist                |
| Cross-domain impact                                                          | Generic X04–X09 and X11 supported; X10 `unavailable` ([impact coverage](../../reference/domains/impact/coverage.md)). X11 is not a CalculiX call                                                                                                                                                                               | RFC 06: generic recross/tests; **not a real lamp run** (RFC journal)                                                                      | Not observed                                               | None for a lamp power/brightness change                      | Gate G6 is human origin (`decide.accept-cross-domain-impact@1`)     |
| Workbench projection                                                         | Generic read-only Workbench exists                                                                                                                                                                                                                                                                                             | RFC 07 blocked: three-branch lamp story, persisted demo, and SSE/manual proof absent (RFC journal)                                        | Not observed                                               | UI is not proof                                              | Workbench must not receive commands                                 |

RFC journal (handoff index, not persisted evidence): lots 01–06 in progress, 07 blocked,
08–10 pending ([RFC README](../../rfcs/articulated-led-desk-lamp-demo/README.md)).
Updating that journal does not create a project.

## Evidenced checkboxes

- [x] Generic Behave operations exist in
      [`src/orchestration/operations/registry.ts`](../../../src/orchestration/operations/registry.ts)
      (SysML renderer, admission, canonical geometry, isolated FEA `@3`, admitted
      Modelica, impact recross).
- [x] RFC queue exists and is `active` ([docs/rfcs/README.md](../../rfcs/README.md)).
- [x] Test fixture exists and declares it is not a live project
      ([`articulated-led-desk-lamp-brief-fixture.ts`](../../../src/testing/articulated-led-desk-lamp-brief-fixture.ts)).
- [x] Fresh `articulated-led-desk-lamp-al01` EngineeringProject exists locally with
      approved brief r2.
- [x] SysON seed, renderer-backed architecture, exact replay, and PartDefinition reread
      are persisted through Thread r4; see [runtime evidence](runtime-evidence.md).
- [ ] Canonical lamp CAD and physical branch evidence.
- [ ] Signed lamp L5 / MRTR on exact live identities.

## Human-owned remainder

Gates G0–G7 stay human
([00-human-input-gates.md](../../rfcs/articulated-led-desk-lamp-demo/00-human-input-gates.md)).
Missing physical inputs park live evidence; they do not justify defaults. A CalculiX,
OpenModelica, or ngspice success is not an oracle and not L5.
