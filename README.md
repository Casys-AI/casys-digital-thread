# Casys Digital Thread

**An executable digital thread** — requirement → system model → geometry → physics →
proof, traversed and verified by AI agents instead of maintained by hand.

Everywhere else, the digital thread is a traceability _concept_: document links,
exports, a spreadsheet a systems engineer keeps alive. This one executes: an agent walks
the thread, derives each artifact from the previous one, and proves the result against
the model's own requirements — with units, margins, and named conflicts.

```
SysML v2 model          mcp-syson         requirements, constraints, part structure
      │
      ▼
generated geometry      mcp-build123d     CAD as code — exact mass properties, STEP
      │
      ▼
computed physics        mcp-calculix      Gmsh mesh + CalculiX FEA — stress, displacement
      │
      ▼
verified verdict        constraint-solver units-aware evaluation, z3 satisfiability
```

The CoffeeMachine dynamics branch is complementary: `mcp-modelica` runs approved
Modelica scenarios to produce time, temperature and energy evidence; SysON and the
constraint solver evaluate that evidence against requirements. It does not replace the
CAD → FEA branch.

The chain answers, continuously and in minutes, the question that today takes weeks
between requirement freeze and design review: **does this design hold every requirement
it traces to — with computed proof?**

## Positioning

The research community is converging on this pattern under the name
**physics-in-the-loop** (generate-and-verify / LLM-Modulo family): the agent proposes,
sound physical tools dispose. See [docs/positioning.md](docs/positioning.md) for the
full analysis and references. What distinguishes this implementation:

- **Model-driven** — the thread starts from a SysML v2 model with traced requirements,
  not from a prompt.
- **Units are values** — 2.5 kg against a 4 lb budget _fails_; unit-blind comparison is
  the false positive this stack exists to prevent.
- **Composable at protocol level** — each link is an independent MCP server; the agent
  composes them, no glue code between packages.
- **The computation is the oracle, not the product** — no LLM inside any tool; OCCT,
  OpenModelica and CalculiX produce evidence, then the constraint solver evaluates
  requirement verdicts.

## Working in this repo

This is the **workspace and its read-only control console**. The engineering servers
still live in their own repos and run from their published container images — you clone
only this workspace.

Requirements: Docker (Desktop on macOS) for the engineering stack, and Deno + Node.js
for rebuilding the console.

```bash
# 1. Bring up SysON + the five stateless MCP servers (optional, for the full stack)
docker compose up -d          # SysON UI: http://localhost:8180

# 2. Start the read-only Console when you need its MCP App.
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task start
```

The active interface is stateless MCP `2026-07-28` over `/mcp`; this workspace no longer
ships a stdio configuration or compatibility path.

The fifth server is a scoped ERP engineering bridge on port `3012`. Its manufacturing,
inventory and generic-operation tools let an agent create Items and BOM documents from
zero, so the MCP itself is privileged; the dashboard still grants only BOM reads. For
now it builds the clean sibling `mcp-erpnext` checkout so it can use `@casys/mcp-server`
0.24 before the next package release. Credentials stay in an ignored env file, and the
bridge joins the existing ERPNext Docker network rather than owning that database. See
the [BOM how-to](docs/how-to/show-erpnext-bom.md).

The `cad-exports` named volume is shared between build123d and calculix: a STEP exported
by `build123d_export` is immediately readable by `calculix_solve_static` at
`/exports/<name>.step`. `casys-digital-thread-modelica-runs` is separate and retains
bounded, hashed OpenModelica run records for `modelica_run_list` and `modelica_run_get`.

## MCP control console

The console exposes one MCP App at `ui://casys-digital-thread/console`, with Fleet,
Runs, and Workbench views. It compares the declared fleet with live MCP and Docker
observations; all actions are read-only. The Runs view also discovers persisted Modelica
records through those two read-only Modelica tools; it never reads the sidecar's Docker
volume. It shows simulation execution separately from a requirement verdict, so a
`succeeded` simulation is never displayed as a `passed` requirement.

For the exact, version-bound CoffeeMachine nominal run, the console also sends the
measured temperature to `syson_constraint_evaluate` and displays the live result as a
**provisional scenario contract**. The sole current condition is the scenario's declared
`90 degC` target. It is intentionally not a product requirement, not a SysON project
requirement, and the `900 s` scenario horizon remains provenance rather than an invented
performance limit.

```bash
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task start                  # http://127.0.0.1:3020/mcp
# In a second terminal, browser host for the existing MCP App:
deno task preview:browser        # http://127.0.0.1:3021/
```

The browser host relays the console's three read-only tools to the live MCP server. It
is a local MCP Apps test harness, explicitly not an `mcp-compose`-generated dashboard.

The repository also carries an explicit one-panel Compose manifest and YAML template
under `config/compose/`. It is exercised from the sibling `mcp-server` checkout through
the local interactive host; this route resolves the Console with MCP `resources/read`
and grants only the declared read-only App calls. It does not replace the fixed harness.
See the [Compose Console how-to](docs/how-to/compose-console.md).

The first product dashboard is now a separate saved recipe: `deno task compose:cm01`
renders the live SysON internal structure, interactive build123d GLB assembly, submitted
ERPNext BOM, and Modelica heat-up run in one 2×2 layout. The YAML stores layout and
calls; it does not freeze their results. See
[View the CoffeeMachine CM-01 digital thread](docs/how-to/view-coffee-machine-cm01.md).

When the engineering services are stopped, the console reports them as unavailable and
keeps the checked-in bracket run explicitly labelled as demo. The documentation is
organized with [Diátaxis](https://diataxis.fr/): start at the
[documentation map](docs/README.md), follow the
[CoffeeMachine run tutorial](docs/tutorials/coffee-machine-nominal.md), use the
[browser-preview how-to](docs/how-to/preview-console.md), use the
[Compose Console how-to](docs/how-to/compose-console.md), the
[CM-01 dashboard how-to](docs/how-to/view-coffee-machine-cm01.md), or look up exact
paths and ports in the [workspace reference](docs/reference/workspace-map.md). The
[console reference](docs/console.md) retains the data contract, evidence model, security
boundary, and local `mcp-compose` path.

## Repository map

| Path                                | Contents                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `docker-compose.yml`                | The full stack: SysON + MCP servers over HTTP                            |
| `server.ts`, `src/`                 | Read-only console control plane and MCP App                              |
| `config/mcp-fleet.json`             | Desired fleet, topology, tools, views, and trust boundaries              |
| `config/compose/`                   | Reviewed MCP manifests, saved dashboard YAML, and runtime-arg examples   |
| `config/verification-plans/`        | Versioned provisional scenario-contract plans                            |
| `state/fixtures/`                   | Canonical, explicitly labelled console and run fixtures                  |
| `docs/README.md`                    | Diátaxis documentation map                                               |
| `docs/tutorials/`                   | End-to-end learning paths, including the real CoffeeMachine run          |
| `docs/how-to/`                      | Focused operating guides: fixed browser preview and local Compose host   |
| `docs/reference/`                   | Exact workspace ownership, contracts, and port lookup                    |
| `docs/console.md`                   | Console resource, tools, truth model, limitations, and Compose boundary  |
| `docs/positioning.md`               | Explanation: industry & SOTA positioning and references                  |
| `docs/verification-architecture.md` | Explanation: CoffeeMachine verification boundaries and Modelica decision |
| `examples/bracket/`                 | The end-to-end walkthrough with real numbers                             |
| `experiments/oracle/`               | The oracle experiment — the project's decisive measurement               |

## The ecosystem (public building blocks)

| Package                                                                                | Registry | Role                                                        |
| -------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| [`@casys/mcp-syson`](https://jsr.io/@casys/mcp-syson)                                  | JSR      | SysML v2 models, constraints, part structure                |
| [`@casys/mcp-build123d`](https://jsr.io/@casys/mcp-build123d)                          | JSR      | parametric CAD as code                                      |
| [`@casys/mcp-calculix`](https://jsr.io/@casys/mcp-calculix)                            | JSR      | FEA — mesh + linear static solve                            |
| [`@casys/mcp-modelica`](https://jsr.io/@casys/mcp-modelica)                            | JSR      | approved OpenModelica simulation kits and evidence          |
| [`@casys/constraint-solver`](https://jsr.io/@casys/constraint-solver)                  | JSR      | units-aware evaluation + z3 solving                         |
| [`@casys/mcp-server`](https://jsr.io/@casys/mcp-server)                                | JSR      | the MCP framework all servers build on                      |
| [`@casys/mcp-view`](https://jsr.io/@casys/mcp-view)                                    | JSR      | MCP App view runtime used by the console                    |
| [`@casys/mcp-compose`](https://jsr.io/@casys/mcp-compose)                              | JSR      | deterministic multi-view dashboard composition              |
| [`engineering-toolchain`](https://github.com/Casys-AI/engineering-toolchain)           | GHCR     | one image bundling the chain + system backends              |
| [`mcp-modelica`](https://github.com/Casys-AI/mcp-modelica/pkgs/container/mcp-modelica) | GHCR     | pinned OpenModelica + MSL simulation sidecar                |
| [`@casys/mcp-erpnext`](https://jsr.io/@casys/mcp-erpnext)                              | JSR      | costing side: part structure → ERPNext BOM with real prices |

## License

MIT (this workspace). Each building block carries its own license (all MIT).
