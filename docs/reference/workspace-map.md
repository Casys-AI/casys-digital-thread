# Reference: workspace map and local ports

## Source map

| Location                                                                                                       | Owns                                                           |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`docker-compose.yml`](../../docker-compose.yml)                                                               | Provider containers, networks, volumes and loopback ports      |
| [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                                         | Desired MCP endpoints, tools, views and trust posture          |
| [`config/thread-workflows/`](../../config/thread-workflows/)                                                   | Reviewed typed causal DAGs                                     |
| [`config/thread-subjects/`](../../config/thread-subjects/)                                                     | Reviewed provider-to-product identity bindings                 |
| [`config/verification-plans/`](../../config/verification-plans/)                                               | Provisional scenario comparisons                               |
| [`config/projects/`](../../config/projects/)                                                                   | Versioned engineering intent, work and decisions               |
| [`src/domain/thread-snapshot.ts`](../../src/domain/thread-snapshot.ts)                                         | Canonical linked product state                                 |
| [`src/domain/engineering-project.ts`](../../src/domain/engineering-project.ts)                                 | Immutable project intent and execution-state contract          |
| [`src/domain/engineering-project-validation.ts`](../../src/domain/engineering-project-validation.ts)           | Strict project and exact thread-reference validation           |
| [`src/workflow/`](../../src/workflow/)                                                                         | Validation, compilation, execution and normalization           |
| [`src/adapters/http-mcp-tool-client.ts`](../../src/adapters/http-mcp-tool-client.ts)                           | Backend-only provider calls                                    |
| [`src/adapters/live-thread-update-store.ts`](../../src/adapters/live-thread-update-store.ts)                   | Cross-process append-only live activity journal                |
| [`src/adapters/recording-mcp-tool-client.ts`](../../src/adapters/recording-mcp-tool-client.ts)                 | Browser-safe running/fresh/failed MCP projections              |
| [`src/adapters/file-thread-snapshot-store.ts`](../../src/adapters/file-thread-snapshot-store.ts)               | Immutable local snapshot persistence                           |
| [`src/adapters/engineering-project-store.ts`](../../src/adapters/engineering-project-store.ts)                 | Tracked seed plus immutable active project revision store      |
| [`src/domain/engineering-project-command-service.ts`](../../src/domain/engineering-project-command-service.ts) | Project transitions, authority, CAS and receipts               |
| [`src/adapters/engineering-project-command-runtime.ts`](../../src/adapters/engineering-project-command-runtime.ts) | Shared BFF/MCP command runtime and exact evidence readers    |
| [`src/adapters/engineering-project-command-http.ts`](../../src/adapters/engineering-project-command-http.ts)   | Same-origin human command contract                             |
| [`src/adapters/engineering-project-completion-evidence-validator.ts`](../../src/adapters/engineering-project-completion-evidence-validator.ts) | Completion evidence existence and change gate |
| [`src/adapters/thread-snapshot-lineage.ts`](../../src/adapters/thread-snapshot-lineage.ts)                     | Exact `previous`-chain ancestry proof                          |
| [`src/tools/project-control.ts`](../../src/tools/project-control.ts)                                           | Agent MCP project and run-lifecycle tools                      |
| [`src/adapters/engineering-workbench-projector.ts`](../../src/adapters/engineering-workbench-projector.ts)     | Project/thread presentation composition and alignment          |
| [`src/adapters/thread-workbench-projector.ts`](../../src/adapters/thread-workbench-projector.ts)               | Canonical-state to Workbench projection                        |
| [`src/ui/src/thread/`](../../src/ui/src/thread/)                                                               | Native lineage feed, graph, inspectors, SSE and command client |
| [`src/ui/src/project/`](../../src/ui/src/project/)                                                             | Project cockpit, Decision Center, approval and run journal     |
| [`src/ui/dist/console/index.html`](../../src/ui/dist/console/index.html)                                       | Generated Console MCP App bundle                               |
| [`scripts/console-browser-harness.ts`](../../scripts/console-browser-harness.ts)                               | Loopback Console preview                                       |
| [`scripts/serve-native-workbench.ts`](../../scripts/serve-native-workbench.ts)                                 | Passive reads/SSE plus bounded human project command BFF       |
| [`scripts/materialize-coffee-machine-thread.ts`](../../scripts/materialize-coffee-machine-thread.ts)           | Read-only CM-01 branch assembler                               |
| [`scripts/run-coffee-machine-build.ts`](../../scripts/run-coffee-machine-build.ts)                             | Explicit SysON to build123d MCP runner                         |
| [`scripts/attach-coffee-machine-build-run.ts`](../../scripts/attach-coffee-machine-build-run.ts)               | Capture validation, canonical publication and reconciliation   |
| [`scripts/capture-syson-model-inventory.ts`](../../scripts/capture-syson-model-inventory.ts)                   | Explicit read-only SysON inventory capture                     |
| [`state/fixtures/`](../../state/fixtures/)                                                                     | Explicitly labelled demo evidence                              |
| `state/local/engineering-projects/`                                                                            | Ignored immutable active project revisions and CAS claims      |

## Local endpoints

| Endpoint                    | Owner                       | Purpose                                           |
| --------------------------- | --------------------------- | ------------------------------------------------- |
| `http://127.0.0.1:8180`     | SysON                       | SysML web modeler                                 |
| `http://127.0.0.1:3009/mcp` | `mcp-syson`                 | Model, constraints and evaluations                |
| `http://127.0.0.1:3012/mcp` | `mcp-erpnext`               | Provider-native ERP data                          |
| `http://127.0.0.1:3014/mcp` | `mcp-build123d`             | CAD execution and exports                         |
| `http://127.0.0.1:3015/mcp` | `mcp-calculix`              | Meshing and static FEA                            |
| `http://127.0.0.1:3016/mcp` | `mcp-modelica`              | Approved simulations and run records              |
| `http://127.0.0.1:3020/mcp` | `deno task start`           | Fleet reads plus agent project control            |
| `http://127.0.0.1:3021/`    | `deno task preview:browser` | Console MCP App browser harness                   |
| `http://127.0.0.1:5173/`    | `deno task preview:thread`  | Native cockpit, passive reads/SSE, human commands |

Docker Compose starts the provider topology only. Product composition occurs in the
backend workflow and linked state, not in the container orchestrator.

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

`deno task preview:thread` seeds the tracked CM-01 project as active revision 1 only
when `state/local/engineering-projects/coffee-machine-cm01/` is absent. Browser GET and
SSE requests remain passive. An explicit same-origin `POST /api/project/commands` can
append only a human proposal, approval, rejection, or queue transition. It never invokes
a provider tool.

`deno task start` exposes the complementary MCP project surface. Agents can inspect the
same active project, propose an input, and claim or advance a human-queued run. They
cannot approve, reject, or queue work. Provider execution remains a separate tool
orchestration step, and completion requires exact canonical result evidence.

## Runtime ownership

| Data                         | Owner                       | Workspace access                                   |
| ---------------------------- | --------------------------- | -------------------------------------------------- |
| SysML and requirements       | SysON                       | Provider MCP; no automatic mutation                |
| CAD exports                  | `exports` volume            | Hash-attested build123d to CalculiX exchange       |
| Modelica runs                | `modelica-runs` volume      | Read through `modelica_run_list/get`               |
| ERP data                     | External ERPNext database   | Provider-native MCP from backend only              |
| Native `ThreadSnapshot`      | Immutable local file store  | Read-only projection in the native Workbench       |
| `EngineeringProjectSnapshot` | Immutable active file store | Human gate plus agent run lifecycle; CAS revisions |
| Live engineering activity    | Append-only local JSONL     | SSE projection; never canonical authority          |

The Console browser harness forwards only reviewed Console tools. It is not a generic
MCP proxy. The native browser receives ordinary linked JSON and no MCP credentials.
