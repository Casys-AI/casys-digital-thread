# Casys Digital Thread

**An executable digital thread** — requirement → system model → geometry → physics →
proof, traversed and verified by AI agents instead of maintained by hand.

Everywhere else, the digital thread is often a traceability _concept_: document links,
exports, and a spreadsheet a systems engineer keeps alive. This workspace is building an
executable alternative in which an agent walks the thread, derives each artifact from
the previous one, and proves the result against model-owned requirements — with units,
margins, and named conflicts.

The intended user does not need to begin as a CAD, SysML, FEA, or ERP specialist. They
state intent and make consequential choices in the paired agent conversation. The agent
prepares and orchestrates bounded technical work; the cockpit projects the resulting
dossier, activity, lineage, and evidence live. The canonical V1/V2 boundary, including
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
evidence at revision 5, before any mechanical criterion exists. Its r6 DripTray loop is
retained as historical evidence. A distinct local CM-01 V3 path then records a reviewed
`28 mm → 30 mm` correction: a failed R2 attempt remains evidence-free history, a
correctly identified R3 successor carries the mechanical handoff and evaluations, and
R12 explicitly closes the requirement family. This is a concept proof for one isolated
DripTray, not whole-machine, release, manufacturing, or certification evidence.

## Positioning

The research community is converging on this pattern under the name
**physics-in-the-loop** (generate-and-verify / LLM-Modulo family): the agent proposes,
sound physical tools dispose. See
[docs/explanations/positioning.md](docs/explanations/positioning.md) for the full
analysis and references. What distinguishes this implementation:

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

Human confirmations use MCP multi-round-trip requests (MRTR): the tool asks for an
explicit decision through `elicitation/create` in the same conversation, then accepts
only the framework-verified retry. Set the server-only `MCP_MRTR_SIGNING_KEY` to a
stable high-entropy key in a persistent deployment. Without it, loopback development
generates a process-ephemeral key; any pending confirmation becomes invalid after a
restart. The current replay protection is process-local, so this configuration is
single-instance only. A scaled or restart-safe deployment additionally needs a shared,
durable, atomic replay store; sharing only the signing key is insufficient. The signed
retry proves request integrity, not who answered it: the paired MCP host and transport
authentication remain the human-facing trust boundary.

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
read-only tools; it never reads the sidecar's Docker volume. The same MCP server exposes
a separate, revision-bound project-control surface for agents. It can read a project,
publish its bounded path, propose decisions, request the person's exact confirmation in
the conversation, and queue or execute only registered, server-owned operations.
Elicitation preserves human authority without moving command input into the cockpit; it
exposes no direct self-approval mutation. The MCP host must still present the
elicitation to the person; signed MRTR state does not authenticate human presence by
itself.

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
# Canonical product shell: one Project tab from first brief to technical proof.
deno task preview:cockpit --port=5175  # http://127.0.0.1:5175/
# Direct thread preview remains available for development and diagnosis.
deno task preview:thread              # http://127.0.0.1:5173/
```

The browser host relays the Console's read-only tools to the live MCP server. It is a
local MCP Apps test harness, not the product Workbench.

The product surface is one native Preact cockpit. Its **Project** tab begins as the
living project brief and evolves into the project path and current engineering record;
there is no separate Discovery page in the product. Project creation, brief review and
every consequential confirmation remain in the paired conversation. The project exists
from the first plain-language intent; its questions, sourced answers, proposed brief and
approved canonical brief are immutable revisions of that same project. The cockpit's
atomic engineering document has an explicit surface: `planning` carries durable project
intent before any technical baseline exists, while `evidence` combines that intent with
the current technical projection (`ThreadSnapshot` plus provisional live overlay) and an
explicit `aligned`/`thread-ahead` signal. The cockpit is organized as **Project**,
**Activity**, **Product**, **Evidence**, and **Execution** so project objective and
review, agent activity, physical structure, technical proof, and execution records no
longer compete in one lineage screen.

`GET /api/thread/workbench` and its SSE stream are passive. The cockpit has no command
or provider authority: it reads immutable project revisions and live projections only.
Agents use the Console MCP server's project tools to observe the same project, record
proposals, obtain consequential human decisions through signed MRTR elicitation, and
orchestrate registered operations. Provider `tools/call` requests remain backend-only;
the agent cannot choose an unregistered provider call, confirm its own proposal, or turn
a raw provider response into canonical thread truth. A technical run completes only
after its exact evidence has been persisted, read back, and attached.

New product ideas begin immediately as schema-`3.0` `EngineeringProjectSnapshot`
revisions, not as a separate intake aggregate and never as fabricated technical
evidence. Agents use `project_start`, `project_question_propose`,
`project_answer_record`, and `project_brief_propose` to build the living brief inside
the project. `project_brief_confirm` uses signed MRTR elicitation in the paired
conversation. A proposal never replaces the canonical brief until the exact revision and
fingerprint are human-approved. The same **Project** tab follows this framing, the later
path, activity, lineage, and evidence without a Discovery handoff or page.

For an idea/specification project, the first ready work item is the reviewed
`baseline.from-approved-brief@1` operation. The agent presents the exact bounded run and
obtains any consequential human authorization in the conversation through signed
elicitation; the backend then captures the exact approved brief and reviewed plan as an
immutable, SHA-256-addressed document, then records the root `ThreadSnapshot` r1. This
is a **documentary, pre-technical baseline**: it proves the brief and plan provenance,
not a SysML model, CAD geometry, FEA result, measurement, requirement verdict,
conformity, or certification.

The first implemented provider-backed V3 operation is `architecture.seed-syson-model@2`.
It accepts only that exact documentary r1 and uses a server-fixed SysON sequence to
create a blank project container, blank SysML document, and root package, then reads the
root package back. Its `syson-model-seed-capture/2.0` record preserves the exact
approved brief, project change, documentary artifact, and normalized provider identities
before publishing descendant `ThreadSnapshot` r2. The caller supplies no provider name,
tool name, arguments, SysML text, or result. Non-idempotent SysON writes are journaled
before dispatch; an unknown outcome stops for review rather than blindly retrying. This
r2 is an editable container identity, **not** a system architecture, requirement, CAD
artifact, simulation, measurement, or verdict. CAD, physics, measurement, and
verification loops still need their own later reviewed operations, provider evidence,
and exact bindings.

Opening or refreshing the UI never launches CAD, FEA, or Modelica. In the product path,
calculation, modeling, ERP, and evidence publication belong to agent orchestration
through bounded backend tools, with chat elicitation where human authority is
consequential. Only registered operations are executable today; a missing executor stays
an explicit capability gap. Provider execution, canonical attachment, and project
completion remain separate operations. See the
[native preview how-to](docs/how-to/preview-native-workbench.md) and the
[ThreadSnapshot reference](docs/reference/thread-snapshot.md).

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
verdict. The historical r6 reference added only two proposal-derived DripTray limits
(`1 mm` and `20 MPa`) through an explicit reviewed mutation. The separate V3 correction
path retains that history rather than treating it as current: its R2 failure has no
substitute evidence, its recovered R3 successor is the current bounded proof, and its
R12 requirement lineage is what lets the project close. Adding or replacing model-owned
criteria is always an explicit domain mutation, never a UI workaround.

[`experiments/thread-workflow/`](experiments/thread-workflow/) holds the frozen YAML
DAG authoring prototype (spec and engine; no production caller). No dashboard-layout
YAML, iframe host, or presentation-only MCP sits between the backend and
provider-native MCP tools. See the
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
[CM-01 V3 local golden-path guide](docs/how-to/run-cm01-v3-golden-local.md) and its
[reviewed reference](docs/reference/cm01-v3-golden-reference.md). Look up exact paths
and ports in the [workspace reference](docs/reference/workspace-map.md). The
[console reference](docs/reference/console.md) retains the observer contract, evidence
model, and security boundary.

## Repository map

| Path                                          | Contents                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `docker-compose.yml`                          | The full stack: SysON + MCP servers over HTTP                                      |
| `server.ts`, `src/`                           | Console, project control plane, thread contracts, and orchestration                |
| `config/mcp-fleet.json`                       | Desired fleet, topology, tools, views, and trust boundaries                        |
| `config/projects/`                            | Versioned project intent plus exact observed baseline captures                     |
| `experiments/thread-workflow/`                | Frozen YAML authoring prototype (reviewed spec + engine, no production caller)     |
| `config/thread-subjects/`                     | Reviewed explicit provider-to-product identity bindings                            |
| `config/verification-plans/`                  | Versioned provisional scenario-contract plans                                      |
| `config/mechanical-proof-cases/`              | Candidate mechanical proof-case declarations; authoring only — execution authority belongs to the sealed thread artifact |
| `config/simulation-cases/`                    | Candidate simulation-case declarations (kit, scenario, parameter overrides); authoring only — execution authority belongs to the sealed thread artifact |
| `state/fixtures/`                             | Canonical, explicitly labelled console and run fixtures                            |
| `state/local/engineering-projects/`           | Ignored immutable active project revisions and command receipts                    |
| `state/local/engineering-project-run-leases/` | Empty local OS lock targets that serialize one trusted project run; never evidence |
| `docs/README.md`                              | Diátaxis documentation map                                                         |
| `docs/tutorials/`                             | End-to-end learning paths, including the real CoffeeMachine run                    |
| `docs/how-to/`                                | Focused operating guides for native workflows and MCP Apps                         |
| `docs/reference/`                             | Exact workspace ownership, contracts, and port lookup                              |
| `docs/explanations/product-direction.md`      | Canonical verified-now, V1, and V2 product boundary                                |
| `docs/reference/console.md`                   | Console resource, tools, truth model, limitations, and security boundary           |
| `docs/explanations/positioning.md`            | Explanation: industry & SOTA positioning and references                            |
| `docs/reference/verification-architecture.md` | Explanation: CoffeeMachine verification boundaries and Modelica decision           |
| `examples/bracket/`                           | The end-to-end walkthrough with real numbers                                       |
| `experiments/oracle/`                         | The oracle experiment — the project's decisive measurement                         |

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
