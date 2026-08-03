# Reference: workspace map and local ports

## Source map

| Location                                                                                                                                       | Owns                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`docker-compose.yml`](../../docker-compose.yml)                                                                                               | Provider containers, networks, volumes and loopback ports         |
| [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                                                                         | Desired MCP endpoints, tools, views and trust posture             |
| [`config/thread-workflows/`](../../config/thread-workflows/)                                                                                   | Reviewed typed causal DAGs                                        |
| [`config/thread-subjects/`](../../config/thread-subjects/)                                                                                     | Reviewed provider-to-product identity bindings                    |
| [`config/verification-plans/`](../../config/verification-plans/)                                                                               | Provisional scenario comparisons                                  |
| [`config/projects/`](../../config/projects/)                                                                                                   | Versioned engineering intent, work and decisions                  |
| [`config/mechanical-proof-cases/`](../../config/mechanical-proof-cases/)                                                                       | Candidate mechanical declarations; not execution receipts         |
| [`src/contracts/thread-workbench.ts`](../../src/contracts/thread-workbench.ts)                                                                 | Browser-safe thread presentation DTOs shared by backend and UI    |
| [`src/domain/thread-snapshot.ts`](../../src/domain/thread-snapshot.ts)                                                                         | Canonical linked product state                                    |
| [`src/domain/engineering-project.ts`](../../src/domain/engineering-project.ts)                                                                 | Immutable project intent and execution-state contract             |
| [`src/domain/syson-model-seed.ts`](../../src/domain/syson-model-seed.ts)                                                                         | Closed r1-to-r2 SysON container identity capture and materializer |
| [`src/domain/mechanical-proof-case.ts`](../../src/domain/mechanical-proof-case.ts)                                                             | Declaration validation and limited identity matching              |
| [`src/domain/project-discovery.ts`](../../src/domain/project-discovery.ts)                                                                     | Immutable pre-project discovery and review contract               |
| [`src/adapters/project-discovery-store.ts`](../../src/adapters/project-discovery-store.ts)                                                     | Immutable discovery revision store                                |
| [`src/tools/project-discovery.ts`](../../src/tools/project-discovery.ts)                                                                       | Agent MCP discovery-authoring tools                               |
| [`src/domain/project-discovery-handoff-service.ts`](../../src/domain/project-discovery-handoff-service.ts)                                     | Human-only approved discovery to project transition               |
| [`src/adapters/project-discovery-handoff-command-http.ts`](../../src/adapters/project-discovery-handoff-command-http.ts)                       | Same-origin discovery handoff command contract                    |
| [`src/domain/engineering-project-validation.ts`](../../src/domain/engineering-project-validation.ts)                                           | Strict project and exact thread-reference validation              |
| [`src/workflow/`](../../src/workflow/)                                                                                                         | Validation, compilation, execution and normalization              |
| [`src/adapters/http-mcp-tool-client.ts`](../../src/adapters/http-mcp-tool-client.ts)                                                           | Backend-only provider calls                                       |
| [`src/adapters/live-thread-update-store.ts`](../../src/adapters/live-thread-update-store.ts)                                                   | Cross-process append-only live activity journal                   |
| [`src/adapters/recording-mcp-tool-client.ts`](../../src/adapters/recording-mcp-tool-client.ts)                                                 | Browser-safe running/fresh/failed MCP projections                 |
| [`src/adapters/file-thread-snapshot-store.ts`](../../src/adapters/file-thread-snapshot-store.ts)                                               | Immutable local snapshot persistence                              |
| [`src/adapters/engineering-project-store.ts`](../../src/adapters/engineering-project-store.ts)                                                 | Tracked seed plus immutable active project revision store         |
| [`src/domain/engineering-project-command-service.ts`](../../src/domain/engineering-project-command-service.ts)                                 | Project transitions, authority, CAS and receipts                  |
| [`src/adapters/engineering-project-command-runtime.ts`](../../src/adapters/engineering-project-command-runtime.ts)                             | Shared BFF/MCP command runtime and exact evidence readers         |
| [`src/adapters/engineering-project-command-http.ts`](../../src/adapters/engineering-project-command-http.ts)                                   | Same-origin human command contract                                |
| [`src/adapters/engineering-project-completion-evidence-validator.ts`](../../src/adapters/engineering-project-completion-evidence-validator.ts) | Completion evidence existence and change gate                     |
| [`src/adapters/registered-project-run-executor.ts`](../../src/adapters/registered-project-run-executor.ts)                                     | Server-owned dispatch for exact reviewed V2 operations            |
| [`src/adapters/syson-model-seed-run-executor.ts`](../../src/adapters/syson-model-seed-run-executor.ts)                                         | Fixed SysON project/document/root-package seed executor           |
| [`src/adapters/file-syson-model-seed-capture-store.ts`](../../src/adapters/file-syson-model-seed-capture-store.ts)                             | Content-addressed normalized SysON container capture              |
| [`src/adapters/file-syson-model-seed-attempt-store.ts`](../../src/adapters/file-syson-model-seed-attempt-store.ts)                             | Write-ahead no-blind-retry state for non-idempotent SysON writes  |
| [`src/adapters/thread-snapshot-lineage.ts`](../../src/adapters/thread-snapshot-lineage.ts)                                                     | Exact `previous`-chain ancestry proof                             |
| [`src/tools/project-control.ts`](../../src/tools/project-control.ts)                                                                           | Agent MCP planning plus registered V2 baseline/seed execution     |
| [`src/adapters/engineering-workbench-projector.ts`](../../src/adapters/engineering-workbench-projector.ts)                                     | Project/thread presentation composition and alignment             |
| [`src/adapters/thread-workbench-projector.ts`](../../src/adapters/thread-workbench-projector.ts)                                               | Canonical-state to Workbench projection                           |
| [`src/ui/src/thread/`](../../src/ui/src/thread/)                                                                                               | Native lineage feed, graph, inspectors, SSE and command client    |
| [`src/ui/src/project/`](../../src/ui/src/project/)                                                                                             | Project cockpit, review notifications, approval and run journal   |
| [`src/ui/dist/console/index.html`](../../src/ui/dist/console/index.html)                                                                       | Generated Console MCP App bundle                                  |
| [`scripts/console-browser-harness.ts`](../../scripts/console-browser-harness.ts)                                                               | Loopback Console preview                                          |
| [`scripts/serve-native-workbench.ts`](../../scripts/serve-native-workbench.ts)                                                                 | Passive reads/SSE plus bounded human project command BFF          |
| [`scripts/serve-discovery-workbench.ts`](../../scripts/serve-discovery-workbench.ts)                                                           | Discovery reads/SSE, human review, and approved-brief handoff BFF |
| [`scripts/materialize-coffee-machine-thread.ts`](../../scripts/materialize-coffee-machine-thread.ts)                                           | Read-only CM-01 branch assembler                                  |
| [`scripts/run-coffee-machine-build.ts`](../../scripts/run-coffee-machine-build.ts)                                                             | Explicit SysON to build123d MCP runner                            |
| [`scripts/attach-coffee-machine-build-run.ts`](../../scripts/attach-coffee-machine-build-run.ts)                                               | Capture validation, canonical publication and reconciliation      |
| [`scripts/run-coffee-machine-mechanical.ts`](../../scripts/run-coffee-machine-mechanical.ts)                                                   | Human-authorized SysON to CAD to FEA verification runner          |
| [`src/adapters/coffee-machine-mechanical-run-extension.ts`](../../src/adapters/coffee-machine-mechanical-run-extension.ts)                     | Strict mechanical capture to canonical evidence projection        |
| [`scripts/attach-coffee-machine-mechanical-run.ts`](../../scripts/attach-coffee-machine-mechanical-run.ts)                                     | Durable mechanical publication and live-feed reconciliation       |
| [`scripts/capture-syson-model-inventory.ts`](../../scripts/capture-syson-model-inventory.ts)                                                   | Explicit read-only SysON inventory capture                        |
| [`state/fixtures/`](../../state/fixtures/)                                                                                                     | Explicitly labelled demo evidence                                 |
| `state/local/engineering-projects/`                                                                                                            | Ignored immutable active project revisions and CAS claims         |
| `state/local/engineering-project-run-leases/`                                                                                                  | Empty local OS lock targets for one trusted V2 run; not evidence  |
| `state/local/syson-model-seed-captures/`                                                                                                       | Content-addressed normalized r2 container captures                |
| `state/local/syson-model-seed-attempts/`                                                                                                       | Recovery control state for uncertain SysON writes; not evidence   |

## Local endpoints

| Endpoint                    | Owner                         | Purpose                                             |
| --------------------------- | ----------------------------- | --------------------------------------------------- |
| `http://127.0.0.1:8180`     | SysON                         | SysML web modeler                                   |
| `http://127.0.0.1:3009/mcp` | `mcp-syson`                   | Model, constraints and evaluations                  |
| `http://127.0.0.1:3012/mcp` | `mcp-erpnext`                 | Provider-native ERP data                            |
| `http://127.0.0.1:3014/mcp` | `mcp-build123d`               | CAD execution and exports                           |
| `http://127.0.0.1:3015/mcp` | `mcp-calculix`                | Meshing and static FEA                              |
| `http://127.0.0.1:3016/mcp` | `mcp-modelica`                | Approved simulations and run records                |
| `http://127.0.0.1:3020/mcp` | `deno task start`             | Fleet reads plus agent project control              |
| `http://127.0.0.1:3021/`    | `deno task preview:browser`   | Console MCP App browser harness                     |
| `http://127.0.0.1:5173/`    | `deno task preview:thread`    | Native cockpit, passive reads/SSE, human commands   |
| `http://127.0.0.1:5174/`    | `deno task preview:discovery` | Guided discovery, review, and project-shell handoff |

Docker Compose starts the provider topology only. Product composition occurs in the
backend workflow and linked state, not in the container orchestrator.

`config/mechanical-proof-cases/` is not wired into the CM-01 runner. Its files declare
candidate inputs for review; they neither authorize execution nor attest the effective
provider arguments or results. See the
[candidate mechanical-analysis declaration](mechanical-proof-case.md) reference.

The Console MCP server and native Workbench entry point reject non-loopback hostnames.
Loopback is a deployment guard, not operator authentication; the Workbench actor ID is
self-declared.

`deno task thread:assemble` reads the declared CM-01 manifest, the latest captured SysON
inventory, one persisted Modelica run, and reviewed ERPNext list/detail/balance
responses. It writes immutable local snapshots and an ERP capture; it does not start
CAD, FEA, Modelica, mutate SysON, or mutate ERPNext.

`deno task thread:run-coffee-machine-build` is the explicit execution path. It calls
SysON and build123d through backend MCP clients and appends redacted progress to
`state/local/live-thread-updates/`. `deno task thread:attach-coffee-machine-build`
validates the persisted capture, publishes the next immutable snapshot, then reconciles
that run's provisional feed nodes.

`deno task thread:run-coffee-machine-mechanical --run-id=<id>` executes only an exact
CM-01 run already queued by a human and claimed by an agent. It derives geometry,
material, mesh, load, and limits from the approved proposal, ensures the two model-owned
DripTray constraints exist, generates a content-addressed STEP, then runs the reviewed
CalculiX-to-SysON workflow through recorded backend clients. Its deterministic capture
is written under `state/local/coffee-machine-mechanical-runs/`. A same-ID retry is
allowed only when prior live activity is limited to the exact SysON constraint preflight
for the same base revision; any CAD, FEA, normalization, evaluation, reconciliation,
unknown operation, or existing capture fails closed. After the project run has
explicitly entered `publishing`, use
`deno task thread:attach-coffee-machine-mechanical --run-id=<id>`. That command
fail-closes on authorization, effective arguments, constraints, provider results and the
exact STEP consumption hash; saves the immutable canonical snapshot; reads it back; and
only then reconciles the run's provisional feed nodes. It returns the exact result
snapshot and entity references needed for the separate MCP `completed` transition, but
never mutates the project lifecycle itself.

The completed local reference path publishes thread r6
`coffee-machine-cm01:r6:coffee-machine-mechanical-run:erwan-authorize-cm01-mechanical-run-v1-extension`;
active project r10 records the same run and verification work item as `completed`. Its
proof boundary is the isolated concept DripTray, not the whole machine, a fabrication
release, or certification.

`deno task preview:thread` seeds the tracked CM-01 project as active revision 1 only
when `state/local/engineering-projects/coffee-machine-cm01/` is absent. Browser GET and
SSE requests remain passive. An explicit same-origin `POST /api/project/commands` can
append only a human proposal, approval, rejection, or queue transition. It never invokes
a provider tool.

`deno task start` exposes the complementary MCP project surface. Agents can inspect the
same active project, propose an input, and execute only an exact human-queued registered
V2 operation. They cannot approve, reject, or queue work. The server-owned baseline
executor creates the immutable, pre-technical approved-discovery r1. The first
provider-backed executor, `architecture.seed-syson-model@1`, accepts only that exact r1
and uses fixed SysON calls to create a blank project, document, and root package; it
reads the root back, normalizes its identities, and publishes r2. Callers supply no
arbitrary arguments or SysML text; uncertain writes are not blindly retried. r2 is a
container identity, not an architecture, requirements, CAD, simulation, measurement, or
verdict. The source tree also contains the guarded r3
`architecture.author-inspection-drone@1` operation: it requires exact r2, an empty root,
and exact approved inspection-drone discovery choices. It must be in the initial plan
and is not released. Its separate disposable local parser/translator and model-tree
check passed against loopback `mcp-syson 0.5.2` on 2026-08-03, but it was not an r3
project run and makes no CAD, physics, flight, cost, compliance, or
verified-requirement claim.

## Runtime ownership

| Data                         | Owner                       | Workspace access                                          |
| ---------------------------- | --------------------------- | --------------------------------------------------------- |
| SysML and requirements       | SysON                       | Provider MCP; no automatic mutation                       |
| CAD exports                  | `exports` volume            | Hash-attested build123d to CalculiX exchange              |
| Modelica runs                | `modelica-runs` volume      | Read through `modelica_run_list/get`                      |
| ERP data                     | External ERPNext database   | Provider-native MCP from backend only                     |
| Native `ThreadSnapshot`      | Immutable local file store  | Read-only projection in the native Workbench              |
| `EngineeringProjectSnapshot` | Immutable active file store | Human gate plus bounded V2 r1 baseline, r2 SysON seed, and source-only guarded r3 architecture; CAS revisions |
| `ProjectDiscoverySnapshot`   | Immutable active file store | Agent-authored discovery plus human review; CAS revisions |
| Live engineering activity    | Append-only local JSONL     | SSE projection; never canonical authority                 |

The Console browser harness forwards only reviewed Console tools. It is not a generic
MCP proxy. The native browser receives ordinary linked JSON and no MCP credentials.
