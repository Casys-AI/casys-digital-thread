# Reference: workspace map and local ports

This page is the lookup reference for the control-plane workspace. It names the source
of each fact so that desired configuration, observed runtime state, demo evidence, and a
scenario contract cannot be confused.

## Source map

| Location                                                                                                                     | Owns                                                                                                  | Read it when you need                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`.mcp.json`](../../.mcp.json)                                                                                               | Direct stdio configuration for Claude-compatible hosts                                                | The local developer MCP wiring                                              |
| [`docker-compose.yml`](../../docker-compose.yml)                                                                             | Full HTTP topology, image references, networks, volumes, and loopback port mappings                   | What `docker compose up -d` actually starts                                 |
| [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                                                       | Desired MCP fleet: endpoints, expected tools/resources, trust notes, and Workbench panel declarations | The expected fleet, never proof that it is running                          |
| [`config/compose/manifests/casys-digital-thread.json`](../../config/compose/manifests/casys-digital-thread.json)             | Explicit Console source transport and browser-callable tool grants for the local Compose host         | What the embedded Console panel may call                                    |
| [`config/compose/dashboards/console.yaml`](../../config/compose/dashboards/console.yaml)                                     | One-panel Console Compose layout                                                                      | Which Console tool instantiates the first composed dashboard                |
| [`config/verification-plans/coffee-machine-nominal-v1.json`](../../config/verification-plans/coffee-machine-nominal-v1.json) | The versioned, provisional CoffeeMachine scenario-contract plan                                       | The only condition currently eligible for the live CoffeeMachine comparison |
| [`server.ts`](../../server.ts)                                                                                               | Console process, default address, registered viewer, and assembly of observers                        | How the read-only console is started                                        |
| [`src/adapters/manifest.ts`](../../src/adapters/manifest.ts)                                                                 | Manifest loading and validation                                                                       | How declared fleet data enters the console                                  |
| [`src/adapters/http-mcp-probe.ts`](../../src/adapters/http-mcp-probe.ts)                                                     | HTTP MCP health/tool/resource observations                                                            | Live MCP observations                                                       |
| [`src/adapters/docker-observer.ts`](../../src/adapters/docker-observer.ts)                                                   | Read-only Compose/container/image observation                                                         | Live Docker observations                                                    |
| [`src/adapters/modelica-run-observer.ts`](../../src/adapters/modelica-run-observer.ts)                                       | Read-only Modelica run discovery through `modelica_run_list` and `modelica_run_get`                   | Persisted simulation evidence without mounting the Modelica volume          |
| [`src/adapters/scenario-contract-verifier.ts`](../../src/adapters/scenario-contract-verifier.ts)                             | Exact identity check and units-aware SysON call for the plan                                          | Why only a matching CoffeeMachine run receives a contract result            |
| [`src/adapters/scenario-verified-run-catalog.ts`](../../src/adapters/scenario-verified-run-catalog.ts)                       | Read-only overlay that projects the SysON response into a console run                                 | How simulation evidence and comparison stay separate                        |
| [`src/domain/`](../../src/domain/)                                                                                           | Control-plane types, drift rules, and aggregation                                                     | The stable console data contract                                            |
| [`src/tools/register.ts`](../../src/tools/register.ts)                                                                       | Console MCP tools and their read-only annotations                                                     | The public console tool surface                                             |
| [`src/ui/src/`](../../src/ui/src/)                                                                                           | TypeScript/CSS source for the fixed MCP App                                                           | The editable console UI                                                     |
| [`src/ui/dist/console/index.html`](../../src/ui/dist/console/index.html)                                                     | Generated single-file viewer registered by the console                                                | The built artifact; rebuild it, do not hand-edit it                         |
| [`scripts/console-browser-harness.ts`](../../scripts/console-browser-harness.ts)                                             | Loopback browser host for the existing console resource                                               | Local visual preview only                                                   |
| [`state/fixtures/`](../../state/fixtures/)                                                                                   | Explicitly labelled demo evidence                                                                     | Demo state, never a live observation                                        |
| [`scripts/verify-console-evidence.ts`](../../scripts/verify-console-evidence.ts)                                             | Read-only fixture/hash consistency check                                                              | Verifying checked-in bracket evidence                                       |

## Local endpoints

All bindings below are loopback-only on the host. Container services listen on their
internal ports only so that Compose can route between them.

| Host endpoint                      | Process or service                  | Purpose                                                                                 |
| ---------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `http://127.0.0.1:8180`            | `syson-app` (container port `8080`) | SysON web modeler                                                                       |
| `http://127.0.0.1:3009/mcp`        | `mcp-syson`                         | SysML model, constraints, and units-aware evaluation                                    |
| `http://127.0.0.1:3014/mcp`        | `mcp-build123d`                     | Parametric CAD execution and export                                                     |
| `http://127.0.0.1:3015/mcp`        | `mcp-calculix`                      | Meshing and static FEA                                                                  |
| `http://127.0.0.1:3016/mcp`        | `mcp-modelica`                      | Approved dynamic system simulation and persisted evidence                               |
| `http://127.0.0.1:3020/mcp`        | `deno task start`                   | Read-only digital-thread console MCP server                                             |
| `http://127.0.0.1:3021/`           | `deno task preview:browser`         | Local browser host for `ui://casys-digital-thread/console`                              |
| Dynamic `http://127.0.0.1:<port>/` | `composeAndServeDashboard()`        | Local Compose parent dashboard; it also creates one distinct loopback origin per iframe |

The console defaults to `MCP_HOSTNAME=127.0.0.1` and `MCP_PORT=3020`; the server also
accepts `--hostname` and `--port`. The preview harness defaults to `3021` and targets
the console on `3020`.

## Runtime data ownership

| Data                                 | Owner                                                         | Console access                                                                       |
| ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| SysON model and product requirements | SysON                                                         | Through its MCP endpoint; the console itself performs no model mutation              |
| CAD export                           | `exports` Docker volume, shared by build123d and CalculiX     | The console observes metadata/evidence; it does not use the volume as a run store    |
| Modelica runs                        | `casys-digital-thread-modelica-runs` Docker volume at `/runs` | Only `modelica_run_list` and `modelica_run_get`; the console never mounts the volume |
| Bracket demo                         | Checked-in `state/fixtures/` and `examples/` data             | Explicitly displayed as demo                                                         |
| CoffeeMachine comparison plan        | Checked-in JSON under `config/verification-plans/`            | Loaded and hash-bound before a matching SysON evaluation                             |

## Console resource and tools

The console resource URI is `ui://casys-digital-thread/console`.

| Tool                    | Audience       | Meaning                                                                                 |
| ----------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `console_snapshot`      | Any MCP client | Desired versus observed fleet, run summaries, and Workbench declarations                |
| `console_server_detail` | Any MCP client | Desired data, observation, drift, Docker/image evidence, and trust notes for one server |
| `console_run_list`      | Any MCP client | Run summaries with execution and comparison states kept separate                        |
| `console_run_detail`    | Any MCP client | Stages, measurements, comparison result, provenance, and hashed artifacts for one run   |
| `console_refresh`       | MCP App only   | Re-probe the read-only control plane                                                    |

The browser harness intentionally forwards only `console_snapshot`,
`console_run_detail`, and `console_refresh`. It is not a general MCP proxy. It supplies
the MCP Apps host capability needed by the fixed view to make those read-only server
calls.

The Compose manifest declares the same three as `appCallable`, which is a
deny-by-default browser capability grant. Its generic local host can use only those
declared tools and the exact Console resource URI. It resolves the view with MCP
`resources/read`, not a source-specific `/ui` HTTP endpoint. See the
[Compose Console how-to](../how-to/compose-console.md) for the runnable local
development path.

## CoffeeMachine scenario-contract binding

The plan `coffee-machine-nominal-v1` is provisional and contains exactly one condition:

```text
water_temperature_max >= 90 degC
```

The evaluator attaches it only when all of the following match the persisted Modelica
evidence:

| Binding          | Expected value                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Model            | `coffee-machine-v1` version `0.1.0`, SHA-256 `a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec` |
| Scenario         | `heat-up-nominal`, SHA-256 `5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941`                   |
| Scenario source  | `mcp-modelica/scenarios/heat-up-nominal.json`                                                                   |
| Scenario target  | `90 degC`                                                                                                       |
| Scenario horizon | `900 s` provenance only                                                                                         |

The plan is raw-byte hashed. At this revision its SHA-256 is
`2208a36ee6c2bae10422550ad032f43e7720fe25833152840bc9b80da2ed8b7d`. The live call is
`syson_constraint_evaluate`. A mismatch causes no comparison to be attached
(`not_evaluated`); malformed or unavailable evaluation becomes an `error`, never an
optimistic pass.

This is not a product requirement and is not a requirement stored in a SysON project.
The threshold comes from the scenario itself, while the horizon only identifies the
scenario. Product requirements must be modelled and traced separately in SysON.

## Status vocabulary

- **`demo`**: checked-in fixture, not live execution.
- **`observed`**: data discovered from a running server.
- **`succeeded` / `failed` / `timed_out`**: simulation execution state.
- **`not_evaluated`**: execution evidence exists but no eligible comparison is attached.
- **`passed` / `failed` / `unresolved` / `error`**: comparison state. It never changes
  the fact of whether the simulation executed.

## Composition boundary

The current console is one fixed MCP App built with `@casys/mcp-view`.
`@casys/mcp-compose` now provides a separate, local host path for its explicit Console
manifest/template: generated layouts, MCP resource resolution, and manifest-bounded App
calls. The existing browser preview remains the smaller, fixed-view harness. The
one-panel Compose template does not yet make the whole Workbench a composed dashboard or
activate cross-panel events.
