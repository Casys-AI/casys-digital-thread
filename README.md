# Casys Digital Thread

**An executable digital thread** — requirement → system model → geometry → physics →
proof, traversed and verified by AI agents instead of maintained by hand.

Everywhere else, the digital thread is often a traceability _concept_: document links,
exports, and a spreadsheet a systems engineer keeps alive. This workspace is building an
executable alternative in which an agent walks the thread, derives each artifact from
the previous one, and proves the result against model-owned requirements — with units,
margins, and named conflicts.

The intended user does not need to begin as a CAD, SysML, FEA, or ERP specialist. They
state intent and review consequential choices; the agent prepares the technical work and
the cockpit exposes its evidence progressively. The canonical V1/V2 boundary, including
idea-first, CAD-first, and reverse-engineering entry points, is recorded in
[the product direction](docs/explanations/product-direction.md).

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

The target product should answer after each meaningful change the question that today
often takes weeks between requirement freeze and design review: **does this design hold
every requirement it traces to — with computed proof?** The clean, tracked CoffeeMachine
CM-01 baseline aggregates observed SysON, Modelica, ERPNext and whole-machine build123d
evidence at revision 5, before any mechanical criterion exists. The first approved
component loop has now also run end to end: approved, SysON-owned `1 mm` / `20 MPa`
DripTray constraints, a content-addressed build123d STEP, CalculiX evidence, unit
normalization, and SysON verdicts were published as canonical thread revision 6. That is
a concept proof for one isolated DripTray, not whole-machine, release, manufacturing, or
certification evidence.

## Positioning

The research community is converging on this pattern under the name
**physics-in-the-loop** (generate-and-verify / LLM-Modulo family): the agent proposes,
sound physical tools dispose. See [docs/positioning.md](docs/positioning.md) for the
full analysis and references. What distinguishes this implementation:

- **Model-grounded** — the verified CM-01 loop starts from a SysML v2 model. CAD-first
  and product-first entries must recover and review missing intent before they can make
  equivalent requirement claims.
- **Units are values** — 2.5 kg against a 4 lb budget _fails_; unit-blind comparison is
  the false positive this stack exists to prevent.
- **Composable at protocol level** — each engineering capability remains an independent
  MCP server; one reviewed backend orchestrator owns cross-tool data flow, attestation,
  and canonical publication.
- **The computation is the oracle, not the product** — no LLM inside any tool; OCCT,
  OpenModelica and CalculiX produce evidence, then the constraint solver evaluates
  requirement verdicts.

## Working in this repo

This is the **workspace, fleet observer, and engineering-project control plane**. The
engineering servers still live in their own repos and run from their published container
images — you clone only this workspace.

Requirements: Docker (Desktop on macOS) for the engineering stack, and Deno + Node.js
for rebuilding the console.

```bash
# 1. Bring up SysON + the engineering and ERP MCP services
docker compose up -d          # SysON UI: http://localhost:8180

# 2. Start the Console and project-control MCP server.
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
the exact STEP bytes and `calculix_solve_static` to attest the hash it consumed. This is
now supplied by published `@casys/mcp-build123d@0.4.1` and `@casys/mcp-calculix@0.4.0`
contracts, including fail-fast rejection of a false expected hash. Compose pins their
released engineering-toolchain image by digest. `casys-digital-thread-modelica-runs` is
separate and retains bounded, hashed OpenModelica run records for `modelica_run_list`
and `modelica_run_get`.

## Console and native Workbench

The console exposes one MCP App at `ui://casys-digital-thread/console`. Fleet and Runs
compare the declared fleet with live MCP and Docker observations; those Console actions
remain read-only. Runs also discovers persisted Modelica records through its two
read-only tools; it never reads the sidecar's Docker volume. The same MCP server now
exposes a separate, revision-bound project-control surface for agents. It can read a
project, propose a decision, and advance a run which a human already queued; it cannot
approve, reject, or queue work.

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
# The native shell can open the checked-in observed CM-01 baseline directly.
deno task preview:thread
# A separate calm surface guides a new idea before a technical project exists.
deno task preview:discovery       # http://127.0.0.1:5174/?discovery=drone-concept
# Reassemble only when deliberately producing new local evidence:
deno task thread:assemble
```

The browser host relays the Console's read-only tools to the live MCP server. It is a
local MCP Apps test harness, not the product Workbench.

The main engineering surface is one native Preact cockpit reading an
`engineering-workbench/0.1` document from a Deno backend-for-frontend. Guided discovery
remains a separate loopback Preact surface that hands an approved brief into an empty
project shell. The cockpit's atomic document combines project intent
(`EngineeringProjectSnapshot`), the current technical projection (`ThreadSnapshot` plus
provisional live overlay), and an explicit `aligned`/`thread-ahead` signal. The cockpit
is organized as **Project**, **Activity**, **Product**, **Evidence**, and **Execution**
so project objective and review, agent activity, physical structure, technical proof,
and execution records no longer compete in one lineage screen.

`GET /api/thread/workbench` and its SSE stream are passive. The same-origin Decision
Center may send an explicit `POST /api/project/commands` to propose, approve, reject, or
queue project work. Every command names the expected project revision and writes a new
immutable revision under `state/local/engineering-projects/`; the displayed local
operator identity is self-declared and is not authentication. Neither this POST nor an
MCP project-control command invokes SysON, CAD, FEA, Modelica, or ERPNext by itself.
Engineering provider `tools/call` requests remain backend-only and require a separately
orchestrated agent execution.

The browser never receives generic MCP authority. Agents use the Console MCP server's
project tools to observe the same project, record proposals, and claim or advance only
human-queued runs. Completion is refused until an exact canonical descendant
`ThreadSnapshot` exists and its named evidence is new or content-changed from the run's
exact base. Agents never receive project approval, rejection, or queue authority through
MCP.

New product ideas begin in a separate immutable `ProjectDiscoverySnapshot`, not in an
empty engineering project. Agents can start a discovery, prepare one bounded question at
a time, record a sourced answer, and propose a brief through `project_discovery_*` MCP
tools. The normal exchange happens in the paired agent conversation; the loopback
Discovery Workbench receives the resulting snapshots live as the shared project record.
Direct browser correction is a deliberate recovery path, while brief approval or
revision remains a human review action. The domain handoff can now create an
intentionally empty engineering project from the exact approved brief while retaining
its fingerprint. The local Discovery Workbench exposes that handoff as one explicit
same-origin human action: it creates only the immutable project shell under
`state/local/engineering-projects/`. It does not fabricate a SysON model,
`ThreadSnapshot`, or technical proof, and it does not claim that agent planning is
already published through the current MCP runtime.

Opening or refreshing the UI never launches CAD, FEA, or Modelica. `thread:assemble`
bootstraps a local CM-01 revision from read-only SysON inventory, one persisted Modelica
run, and reviewed ERPNext reads. The explicit build runner adds the current
SysON-derived CAD artifacts. A separately human-approved and agent-claimed mechanical
runner can then add exact DripTray CAD, CalculiX observations, and SysON evaluations.
Provider execution, canonical attachment, and project completion remain separate
operations. See the [native preview how-to](docs/how-to/preview-native-workbench.md) and
the [ThreadSnapshot reference](docs/reference/thread-snapshot.md).

The tracked project under
[`config/projects/coffee-machine-cm01.project.json`](config/projects/coffee-machine-cm01.project.json)
references an exact observed r5 capture under `config/projects/baselines/`. On a fresh
clone, it seeds active project revision 1 so the BFF can show the reviewed project,
thread and exact STL without running a provider. That clean CM-01 state has one bundled
mechanical proof-case decision, no approval, and zero agent runs; the agent must prepare
its part, material, support, load, and acceptance proposal instead of asking the
operator to invent those values. Later commands append immutable active project
revisions. Technical snapshots and assets also prefer active local state when present,
but a baseline is accepted only for the same exact ID or filename—never as a substitute
for `latest` or for missing evidence.

The tracked r5 SysON inventory contains two `RequirementUsage` elements and zero
mechanical `ConstraintUsage` elements, so the clean baseline honestly has no mechanical
verdict. The approved CM-01 runner may add only the two proposal-derived DripTray limits
(`1 mm` and `20 MPa`) to SysON, then re-extract and evaluate them. The completed
reference run published both passing evaluations in r6 and completed the bound work item
and agent run in active project revision 10. Adding those model-owned criteria is an
explicit domain mutation authorized by the reviewed case, never a UI workaround.

[`config/thread-workflows/`](config/thread-workflows/) describes typed causal DAGs. No
dashboard-layout YAML, iframe host, or presentation-only MCP sits between the backend
and provider-native MCP tools. See the
[workflow reference](docs/reference/thread-workflows.md).

The four tracked r5 branches share the system subject only through
[`config/thread-subjects/coffee-machine-cm01.json`](config/thread-subjects/coffee-machine-cm01.json):
reviewed SysON project ID, build123d STEP path, Modelica run ID, and ERPNext item code.
Matching labels never create a join. The r6 mechanical branch consumes and attests its
exact content-addressed DripTray STEP; it does not claim that the historical
whole-machine r5 STEP was solved. The current assembly observes `94 degC` maximum water
temperature, the canonical whole-machine STEP, and ERPNext's active default BOM for
`CASYS-CM01`; it does not assert that the CAD branch caused the Modelica result, or that
zero Bin rows means zero inventory.

The shared visual baseline now lives in `@casys/mcp-view`, extracted from the ERPNext
BOM palette: restrained cards, compact uppercase titles, dense metrics and tables,
semantic badges, selection state, and container-aware layout. Domain viewers add only
their specialized diagram, CAD, physics, or evidence rendering. See
[The mcp-view component language](docs/explanations/mcp-view-component-language.md).

When the engineering services are stopped, the console reports them as unavailable and
keeps the checked-in bracket run explicitly labelled as demo. The documentation is
organized with [Diátaxis](https://diataxis.fr/): start at the
[documentation map](docs/README.md), follow the
[product direction](docs/explanations/product-direction.md), follow the
[CoffeeMachine run tutorial](docs/tutorials/coffee-machine-nominal.md), use the
[browser-preview how-to](docs/how-to/preview-console.md), use the
[native Workbench preview](docs/how-to/preview-native-workbench.md), or follow the
[CM-01 assembly guide](docs/how-to/assemble-coffee-machine-thread.md) and the
[CoffeeMachine workflow guide](docs/how-to/view-coffee-machine-cm01.md). Look up exact
paths and ports in the [workspace reference](docs/reference/workspace-map.md). The
[console reference](docs/console.md) retains the observer contract, evidence model, and
security boundary.

## Repository map

| Path                                     | Contents                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `docker-compose.yml`                     | The full stack: SysON + MCP servers over HTTP                            |
| `server.ts`, `src/`                      | Console, project control plane, thread contracts, and orchestration      |
| `config/mcp-fleet.json`                  | Desired fleet, topology, tools, views, and trust boundaries              |
| `config/projects/`                       | Versioned project intent plus exact observed baseline captures           |
| `config/thread-workflows/`               | Reviewed YAML authoring prototypes compiled into typed causal DAGs       |
| `config/thread-subjects/`                | Reviewed explicit provider-to-product identity bindings                  |
| `config/verification-plans/`             | Versioned provisional scenario-contract plans                            |
| `state/fixtures/`                        | Canonical, explicitly labelled console and run fixtures                  |
| `state/local/engineering-projects/`      | Ignored immutable active project revisions and command receipts          |
| `docs/README.md`                         | Diátaxis documentation map                                               |
| `docs/tutorials/`                        | End-to-end learning paths, including the real CoffeeMachine run          |
| `docs/how-to/`                           | Focused operating guides for native workflows and MCP Apps               |
| `docs/reference/`                        | Exact workspace ownership, contracts, and port lookup                    |
| `docs/explanations/product-direction.md` | Canonical verified-now, V1, and V2 product boundary                      |
| `docs/console.md`                        | Console resource, tools, truth model, limitations, and security boundary |
| `docs/positioning.md`                    | Explanation: industry & SOTA positioning and references                  |
| `docs/verification-architecture.md`      | Explanation: CoffeeMachine verification boundaries and Modelica decision |
| `examples/bracket/`                      | The end-to-end walkthrough with real numbers                             |
| `experiments/oracle/`                    | The oracle experiment — the project's decisive measurement               |

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
