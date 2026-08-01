# Casys Digital Thread

**An executable digital thread** — requirement → system model → geometry → physics →
proof, traversed and verified by AI agents instead of maintained by hand.

Everywhere else, the digital thread is often a traceability _concept_: document links,
exports, and a spreadsheet a systems engineer keeps alive. This workspace is building an
executable alternative in which an agent walks the thread, derives each artifact from
the previous one, and proves the result against model-owned requirements — with units,
margins, and named conflicts.

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

The target chain answers, continuously and in minutes, the question that today takes
weeks between requirement freeze and design review: **does this design hold every
requirement it traces to — with computed proof?** The repository currently proves the
individual transports, computations, artifact attestation, and presentation concepts. A
read-only CoffeeMachine CM-01 snapshot now aggregates observed evidence from all five
providers; the closed verification and correction loop remains under construction
because the SysON model has no mechanical criterion to evaluate.

## Positioning

The research community is converging on this pattern under the name
**physics-in-the-loop** (generate-and-verify / LLM-Modulo family): the agent proposes,
sound physical tools dispose. See [docs/positioning.md](docs/positioning.md) for the
full analysis and references. What distinguishes this implementation:

- **Model-driven** — the thread starts from a SysML v2 model with traced requirements,
  not from a prompt.
- **Units are values** — 2.5 kg against a 4 lb budget _fails_; unit-blind comparison is
  the false positive this stack exists to prevent.
- **Composable at protocol level** — each engineering capability remains an independent
  MCP server; one reviewed backend orchestrator owns cross-tool data flow, attestation,
  and canonical publication.
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
# 1. Bring up SysON + the engineering and ERP MCP services
docker compose up -d          # SysON UI: http://localhost:8180

# 2. Start the read-only Console when you need its MCP App.
npm --prefix src/ui ci
npm --prefix src/ui run build
deno task start
```

The active interface is stateless MCP `2026-07-28` over `/mcp`; this workspace no longer
ships a stdio configuration or compatibility path.

ERPNext has one provider-native MCP interface on port `3012`. The backend invokes only
the reviewed read tools required by a workflow and projects their data into the linked
thread; the browser never receives ERP credentials or calls ERPNext directly. The bridge
joins the existing ERPNext Docker network rather than owning that database.

The `cad-exports` named volume is shared between build123d and CalculiX, but a shared
path is not provenance. The native thread contract requires `build123d_export` to hash
the exact STEP bytes and `calculix_solve_static` to attest the hash it consumed. This
was proved against the local provider checkouts on 2026-08-01, including fail-fast
rejection of a false expected hash, but those provider changes are not yet a published
release. `casys-digital-thread-modelica-runs` is separate and retains bounded, hashed
OpenModelica run records for `modelica_run_list` and `modelica_run_get`.

## Console and native Workbench

The console exposes one MCP App at `ui://casys-digital-thread/console`. Fleet and Runs
compare the declared fleet with live MCP and Docker observations; all actions are
read-only. Runs also discovers persisted Modelica records through its two read-only
tools; it never reads the sidecar's Docker volume. It shows simulation execution
separately from a requirement verdict, so a `succeeded` simulation is never displayed as
a `passed` requirement.

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
# Assemble the observed CM-01 branches, then serve the native shell:
deno task thread:assemble
deno task preview:thread
```

The browser host relays the Console's read-only tools to the live MCP server. It is a
local MCP Apps test harness, not the product Workbench.

The product direction is one native Preact shell reading a persisted, versioned
`ThreadSnapshot` from a backend-for-frontend. Engineering `tools/call` requests remain
backend-only and occur only after an explicit execution command; opening or refreshing
the UI never launches CAD, FEA, or Modelica. `thread:assemble` bootstraps a local CM-01
revision from read-only SysON inventory, one persisted Modelica run, and reviewed
ERPNext reads. The explicit build runner then adds the current SysON-derived CAD
artifacts. It is real observed evidence, not a new FEA solve and not a closed SysON
verification loop. See the
[native preview how-to](docs/how-to/preview-native-workbench.md) and the
[ThreadSnapshot reference](docs/reference/thread-snapshot.md).

The current live CoffeeMachine model contains two `RequirementUsage` elements but zero
`ConstraintUsage` elements. The mechanical DAG may produce evidence only after an
explicit material/support/load case is reviewed; with no extracted constraint it
produces no product verdict. Adding a model-owned criterion is a domain step, not a UI
workaround.

[`config/thread-workflows/`](config/thread-workflows/) describes typed causal DAGs. No
dashboard-layout YAML, iframe host, or presentation-only MCP sits between the backend
and provider-native MCP tools. See the
[workflow reference](docs/reference/thread-workflows.md).

The five branches share the system subject only through
[`config/thread-subjects/coffee-machine-cm01.json`](config/thread-subjects/coffee-machine-cm01.json):
reviewed SysON project ID, build123d STEP path, Modelica run ID, and ERPNext item code.
Matching labels never create a join. The current assembly observes `94 degC` maximum
water temperature, the canonical whole-machine STEP, and ERPNext's active default BOM
for `CASYS-CM01`; it does not assert that the CAD branch caused the Modelica result, or
that zero Bin rows means zero inventory.

The shared visual baseline now lives in `@casys/mcp-view`, extracted from the ERPNext
BOM palette: restrained cards, compact uppercase titles, dense metrics and tables,
semantic badges, selection state, and container-aware layout. Domain viewers add only
their specialized diagram, CAD, physics, or evidence rendering. See
[The mcp-view component language](docs/explanations/mcp-view-component-language.md).

When the engineering services are stopped, the console reports them as unavailable and
keeps the checked-in bracket run explicitly labelled as demo. The documentation is
organized with [Diátaxis](https://diataxis.fr/): start at the
[documentation map](docs/README.md), follow the
[CoffeeMachine run tutorial](docs/tutorials/coffee-machine-nominal.md), use the
[browser-preview how-to](docs/how-to/preview-console.md), use the
[native Workbench preview](docs/how-to/preview-native-workbench.md), or follow the
[CM-01 assembly guide](docs/how-to/assemble-coffee-machine-thread.md) and the
[CoffeeMachine workflow guide](docs/how-to/view-coffee-machine-cm01.md). Look up exact
paths and ports in the [workspace reference](docs/reference/workspace-map.md). The
[console reference](docs/console.md) retains the observer contract, evidence model, and
security boundary.

## Repository map

| Path                                | Contents                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `docker-compose.yml`                | The full stack: SysON + MCP servers over HTTP                            |
| `server.ts`, `src/`                 | Console plus native thread contracts and orchestration prototypes        |
| `config/mcp-fleet.json`             | Desired fleet, topology, tools, views, and trust boundaries              |
| `config/thread-workflows/`          | Reviewed YAML authoring prototypes compiled into typed causal DAGs       |
| `config/thread-subjects/`           | Reviewed explicit provider-to-product identity bindings                  |
| `config/verification-plans/`        | Versioned provisional scenario-contract plans                            |
| `state/fixtures/`                   | Canonical, explicitly labelled console and run fixtures                  |
| `docs/README.md`                    | Diátaxis documentation map                                               |
| `docs/tutorials/`                   | End-to-end learning paths, including the real CoffeeMachine run          |
| `docs/how-to/`                      | Focused operating guides for native workflows and MCP Apps               |
| `docs/reference/`                   | Exact workspace ownership, contracts, and port lookup                    |
| `docs/console.md`                   | Console resource, tools, truth model, limitations, and security boundary |
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
| [`@casys/mcp-view`](https://jsr.io/@casys/mcp-view)                                    | JSR      | Pure shared components plus optional MCP App runtime        |
| [`engineering-toolchain`](https://github.com/Casys-AI/engineering-toolchain)           | GHCR     | one image bundling the chain + system backends              |
| [`mcp-modelica`](https://github.com/Casys-AI/mcp-modelica/pkgs/container/mcp-modelica) | GHCR     | pinned OpenModelica + MSL simulation sidecar                |
| [`@casys/mcp-erpnext`](https://jsr.io/@casys/mcp-erpnext)                              | JSR      | costing side: part structure → ERPNext BOM with real prices |

## License

MIT (this workspace). Each building block carries its own license (all MIT).
