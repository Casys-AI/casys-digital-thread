# Reference: workspace map and local ports

## Source map

| Location                                                                                             | Owns                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`docker-compose.yml`](../../docker-compose.yml)                                                     | Provider containers, networks, volumes and loopback ports    |
| [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                               | Desired MCP endpoints, tools, views and trust posture        |
| [`config/thread-workflows/`](../../config/thread-workflows/)                                         | Reviewed typed causal DAGs                                   |
| [`config/thread-subjects/`](../../config/thread-subjects/)                                           | Reviewed provider-to-product identity bindings               |
| [`config/verification-plans/`](../../config/verification-plans/)                                     | Provisional scenario comparisons                             |
| [`src/domain/thread-snapshot.ts`](../../src/domain/thread-snapshot.ts)                               | Canonical linked product state                               |
| [`src/workflow/`](../../src/workflow/)                                                               | Validation, compilation, execution and normalization         |
| [`src/adapters/http-mcp-tool-client.ts`](../../src/adapters/http-mcp-tool-client.ts)                 | Backend-only provider calls                                  |
| [`src/adapters/live-thread-update-store.ts`](../../src/adapters/live-thread-update-store.ts)         | Cross-process append-only live activity journal              |
| [`src/adapters/recording-mcp-tool-client.ts`](../../src/adapters/recording-mcp-tool-client.ts)       | Browser-safe running/fresh/failed MCP projections            |
| [`src/adapters/file-thread-snapshot-store.ts`](../../src/adapters/file-thread-snapshot-store.ts)     | Immutable local snapshot persistence                         |
| [`src/adapters/thread-workbench-projector.ts`](../../src/adapters/thread-workbench-projector.ts)     | Canonical-state to Workbench projection                      |
| [`src/ui/src/thread/`](../../src/ui/src/thread/)                                                     | Native lineage feed, graph, inspectors, ledgers, SSE client  |
| [`src/ui/dist/console/index.html`](../../src/ui/dist/console/index.html)                             | Generated Console MCP App bundle                             |
| [`scripts/console-browser-harness.ts`](../../scripts/console-browser-harness.ts)                     | Loopback Console preview                                     |
| [`scripts/serve-native-workbench.ts`](../../scripts/serve-native-workbench.ts)                       | Read-only native Workbench BFF                               |
| [`scripts/materialize-coffee-machine-thread.ts`](../../scripts/materialize-coffee-machine-thread.ts) | Read-only CM-01 branch assembler                             |
| [`scripts/run-coffee-machine-build.ts`](../../scripts/run-coffee-machine-build.ts)                   | Explicit SysON to build123d MCP runner                       |
| [`scripts/attach-coffee-machine-build-run.ts`](../../scripts/attach-coffee-machine-build-run.ts)     | Capture validation, canonical publication and reconciliation |
| [`scripts/capture-syson-model-inventory.ts`](../../scripts/capture-syson-model-inventory.ts)         | Explicit read-only SysON inventory capture                   |
| [`state/fixtures/`](../../state/fixtures/)                                                           | Explicitly labelled demo evidence                            |

## Local endpoints

| Endpoint                    | Owner                       | Purpose                                   |
| --------------------------- | --------------------------- | ----------------------------------------- |
| `http://127.0.0.1:8180`     | SysON                       | SysML web modeler                         |
| `http://127.0.0.1:3009/mcp` | `mcp-syson`                 | Model, constraints and evaluations        |
| `http://127.0.0.1:3012/mcp` | `mcp-erpnext`               | Provider-native ERP data                  |
| `http://127.0.0.1:3014/mcp` | `mcp-build123d`             | CAD execution and exports                 |
| `http://127.0.0.1:3015/mcp` | `mcp-calculix`              | Meshing and static FEA                    |
| `http://127.0.0.1:3016/mcp` | `mcp-modelica`              | Approved simulations and run records      |
| `http://127.0.0.1:3020/mcp` | `deno task start`           | Read-only operational Console             |
| `http://127.0.0.1:3021/`    | `deno task preview:browser` | Console MCP App browser harness           |
| `http://127.0.0.1:5173/`    | `deno task preview:thread`  | Native snapshot and SSE lineage Workbench |

Docker Compose starts the provider topology only. Product composition occurs in the
backend workflow and linked state, not in the container orchestrator.

`deno task thread:assemble` reads the declared CM-01 manifest, the latest captured SysON
inventory, one persisted Modelica run, and reviewed ERPNext list/detail/balance
responses. It writes immutable local snapshots and an ERP capture; it does not start
CAD, FEA, Modelica, mutate SysON, or mutate ERPNext.

`deno task thread:run-coffee-machine-build` is the explicit execution path. It calls
SysON and build123d through backend MCP clients and appends redacted progress to
`state/local/live-thread-updates/`. `deno task thread:attach-coffee-machine-build`
validates the persisted capture, publishes the next immutable snapshot, then reconciles
that run's provisional feed nodes.

## Runtime ownership

| Data                      | Owner                      | Workspace access                             |
| ------------------------- | -------------------------- | -------------------------------------------- |
| SysML and requirements    | SysON                      | Provider MCP; no automatic mutation          |
| CAD exports               | `exports` volume           | Hash-attested build123d to CalculiX exchange |
| Modelica runs             | `modelica-runs` volume     | Read through `modelica_run_list/get`         |
| ERP data                  | External ERPNext database  | Provider-native MCP from backend only        |
| Native `ThreadSnapshot`   | Immutable local file store | Read-only projection in the native Workbench |
| Live engineering activity | Append-only local JSONL    | SSE projection; never canonical authority    |

The Console browser harness forwards only reviewed Console tools. It is not a generic
MCP proxy. The native browser receives ordinary linked JSON and no MCP credentials.
