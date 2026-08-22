# Articulated LED desk lamp — status

Audience: both · Diátaxis: none · Kind: tracking status

Truth columns: [projects README](../README.md). This page is not a project snapshot.

## What this is not

- **Not a live project.** The RFC says it is an execution brief, not a product contract
  or proof that a named capability already exists
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

- `cantilever-arm-ca02`
- `modelica-ramp-mr01`
- `modelica-ramp-mr02`
- `heated-mug-coaster-hc01`

None of those names is an articulated LED desk-lamp project. The RFC queue is still
not a runtime project. Historical `desk-lamp-dl04` / `desk-lamp-dl05` rereads, if
present elsewhere, remain different identities
([product direction](../../explanations/product/product-direction.md)).

## Project / capture written (git)

| Identity | What it is | What it is not |
| -------- | ---------- | -------------- |
| RFC queue `docs/rfcs/articulated-led-desk-lamp-demo/` | Session brief and progress journal | A runtime project |
| `src/testing/articulated-led-desk-lamp-brief-fixture.ts` (`articulated-led-desk-lamp`) | Test identity; file comment: not a live project, not a dl05 relabel | Signed brief, SysON, or Thread |
| `src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl*.json` and related sensitivity catalog rows | Historical specimens | The fresh RFC lamp |

No live capture for a fresh articulated-lamp project is written. The primary-atelier
names above are other vehicles.

## Status by surface

Literals only. No completion percentage. Checkboxes appear only where the fact is
evidenced in-repo or by the dated local listing.

| Surface | Code capability available | Project/capture written | Live runtime observed (2026-08-22, primary atelier, local) | Persisted proof | Human decision |
| ------- | ------------------------- | ----------------------- | ---------------------------------------------------------- | --------------- | -------------- |
| Project lifecycle (`project_start` → brief → plan) | Yes. Generic tools: [agent workspace](../../reference/agent/agent-workspace.md) | Fixture + RFC only | Four named projects; none is the articulated lamp | None | None on a live lamp project |
| SysML renderer `model.write-architecture@1` / `model.write-requirements@1` | Yes. [SysML coverage](../../reference/domains/sysml/coverage.md). Typed/value architecture attributes remain `unresolved` (probe 2026-08-21) | RFC 02 in progress; fixture structure only | Not observed | None for a fresh lamp | Architecture MRTR not recorded here. Gate G1 remains human-owned |
| Canonical CAD `project_admitted_geometry_export` → `design.write-geometry@1` | Yes. [CAD coverage](../../reference/domains/cad/coverage.md), [execution paths](../../reference/domains/cad/execution-paths.md) | No lamp admission/source in git as live project data | Not observed | Isolated execution is not canonical STEP | Gate G2 geometry remains human-owned |
| Static FEA `verify.run-fea-static-proof@3` | Yes. [FEA coverage](../../reference/domains/fea/coverage.md). Historical MCP `@1`/`@2` are not registered | RFC 03 M01: catalog-absent / project-subject mismatch vs dl05/CA02 (RFC journal). Preinstalled desk-lamp Git cases are not live authority | Not observed | None for a fresh lamp | Gate G2 / mechanical L5 not recorded here. An L4 `pass` is never L5 |
| Admitted Modelica `simulate.run-admitted-modelica@1` plus L4/L5 ops | Yes, generic. [Modelica coverage](../../reference/domains/modelica/coverage.md). Kit `@1` is not this path | RFC 04: code lots exist; T08–T10 **real product proof absent** (RFC journal) | Not observed | None for a lamp head. L3 remains documentary until evaluated | Gate G4 / Modelica L5 not recorded here |
| Electrical / ngspice | **No product run.** Electrical owns a provider-free LED-driver fiche only ([electrical](../../reference/domains/electrical/README.md)). `mcp-spice` is preflight; integration `unresolved` ([spice](../../reference/providers/spice/README.md)). No registered ngspice operation in `src/orchestration/operations/registry.ts` | RFC 05 E01 capture is reference-only; D2 non-executable preflight (RFC journal) | Fleet probe is not a lamp circuit | None | Gate G5 remains human-owned. Do not invent a netlist |
| Cross-domain impact | Generic X04–X09 and X11 supported; X10 `unavailable` ([impact coverage](../../reference/domains/impact/coverage.md)). X11 is not a CalculiX call | RFC 06: generic recross/tests; **not a real lamp run** (RFC journal) | Not observed | None for a lamp power/brightness change | Gate G6 is human origin (`decide.accept-cross-domain-impact@1`) |
| Workbench projection | Generic read-only Workbench exists | RFC 07 blocked: three-branch lamp story, persisted demo, and SSE/manual proof absent (RFC journal) | Not observed | UI is not proof | Workbench must not receive commands |

RFC journal (handoff index, not persisted evidence): lots 01–06 in progress, 07
blocked, 08–10 pending
([RFC README](../../rfcs/articulated-led-desk-lamp-demo/README.md)). Updating that
journal does not create a project.

## Evidenced checkboxes

- [x] Generic Behave operations exist in
  [`src/orchestration/operations/registry.ts`](../../../src/orchestration/operations/registry.ts)
  (SysML renderer, admission, canonical geometry, isolated FEA `@3`, admitted Modelica,
  impact recross).
- [x] RFC queue exists and is `active`
  ([docs/rfcs/README.md](../../rfcs/README.md)).
- [x] Test fixture exists and declares it is not a live project
  ([`articulated-led-desk-lamp-brief-fixture.ts`](../../../src/testing/articulated-led-desk-lamp-brief-fixture.ts)).
- [x] Primary atelier `state/local/engineering-projects/` names on 2026-08-22:
      `cantilever-arm-ca02`, `modelica-ramp-mr01`, `modelica-ramp-mr02`,
      `heated-mug-coaster-hc01`. None is the articulated lamp.
- [ ] Fresh articulated-lamp `EngineeringProject` on that runtime.
- [ ] Persisted Thread/CAS proof for that fresh project.
- [ ] Signed lamp L5 / MRTR on exact live identities.

## Human-owned remainder

Gates G0–G7 stay human
([00-human-input-gates.md](../../rfcs/articulated-led-desk-lamp-demo/00-human-input-gates.md)).
Missing physical inputs park live evidence; they do not justify defaults. A CalculiX,
OpenModelica, or ngspice success is not an oracle and not L5.
