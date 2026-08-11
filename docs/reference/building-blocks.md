# Reference: building blocks and artifact ownership

## Responsibility map

| Building block         | Owns                                                                             | Does not own                                                           |
| ---------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `mcp-server`           | Stateless MCP tools, resources and HTTP transport                                | Engineering truth or product layout                                    |
| `mcp-view`             | Shared presentation primitives and individual rich-result App runtime            | Workflow execution or evidence authority                               |
| `mcp-syson`            | SysML model, requirements, constraints and explicit verdicts                     | Physical calculations                                                  |
| `mcp-build123d`        | CAD programs, geometry metrics and content-addressed exports                     | FEA results or product verdicts                                        |
| `mcp-calculix`         | Recorded static runs and identity-bound solver resources                         | CAD authoring, material authority or human verdict                     |
| `mcp-modelica`         | Qualified-kit resumable simulations and immutable resources/runs                 | SysML requirements or arbitrary agent source                           |
| `mcp-erpnext`          | Provider-native manufacturing, inventory, operations and costing data            | SysML, CAD, simulation or the product shell                            |
| `constraint-solver`    | Units-aware evaluation and satisfiability                                        | Requirement ownership                                                  |
| `casys-digital-thread` | Project control, ROP2 sealing, linked `ThreadSnapshot`, projection and Workbench | Provider implementations, raw provider calls or invented design limits |

## Authoritative artifacts

| Artifact                     | Location                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider topology            | [`docker-compose.yml`](../../docker-compose.yml)                                                                                                                                                         |
| Desired fleet                | [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                                                                                                                                   |
| CM-01 subject binding        | [`config/thread-subjects/coffee-machine-cm01.json`](../../config/thread-subjects/coffee-machine-cm01.json)                                                                                               |
| Native workflow (frozen)     | [`experiments/thread-workflow/`](../../experiments/thread-workflow/)                                                                                                                                     |
| Canonical linked state       | [`src/domain/thread-snapshot.ts`](../../src/domain/thread-snapshot.ts)                                                                                                                                   |
| Workflow compiler/executor   | [`experiments/thread-workflow/`](../../experiments/thread-workflow/) (frozen prototype)                                                                                                                  |
| Workbench projection         | [`src/adapters/projectors/thread-workbench-projector.ts`](../../src/adapters/projectors/thread-workbench-projector.ts)                                                                                   |
| Native Workbench UI          | [`src/ui/src/thread/`](../../src/ui/src/thread/)                                                                                                                                                         |
| Modelica evidence            | `casys-digital-thread-modelica-runs` Docker volume, read through its MCP                                                                                                                                 |
| Recorded-analysis ROP2 state | `state/local/recorded-analysis/`: fixed directories for plans, Modelica qualification/run capture, CalculiX run/evaluation capture and WAL; fixed CAS namespaces where applicable; not a provider volume |
| CAD/FEA exchange             | `exports` Docker volume, with producer and consumer SHA-256 attestation                                                                                                                                  |
| ERP manufacturing truth      | ERPNext database, reached only through `mcp-erpnext`                                                                                                                                                     |
| FEA proof (seal)             | [`src/adapters/executors/verify-seal-proof-case-run-executor.ts`](../../src/adapters/executors/verify-seal-proof-case-run-executor.ts)                                                                   |
| FEA proof (run)              | [`src/adapters/executors/verify-run-fea-static-proof-run-executor.ts`](../../src/adapters/executors/verify-run-fea-static-proof-run-executor.ts)                                                         |
| Modelica scenario (seal)     | [`src/adapters/executors/simulate-seal-simulation-case-run-executor.ts`](../../src/adapters/executors/simulate-seal-simulation-case-run-executor.ts)                                                     |
| Modelica scenario (run)      | [`src/adapters/executors/simulate-run-modelica-scenario-run-executor.ts`](../../src/adapters/executors/simulate-run-modelica-scenario-run-executor.ts)                                                   |
| Recorded Modelica `@2`       | [`src/adapters/executors/simulate-run-modelica-scenario-v2-run-executor.ts`](../../src/adapters/executors/simulate-run-modelica-scenario-v2-run-executor.ts)                                             |
| Recorded CalculiX `@2`       | [`src/adapters/executors/verify-run-fea-static-proof-v2-run-executor.ts`](../../src/adapters/executors/verify-run-fea-static-proof-v2-run-executor.ts)                                                   |

The CM-01 manifest is the sole cross-provider join authority. It binds a SysON project,
build123d artifact path, persisted Modelica run, and ERPNext item to one product
subject. Provider display names and matching labels are evidence for people, not a
machine join key.

## Product boundary

The browser reads linked product data from the digital-thread backend. It never connects
to provider MCP endpoints. Provider MCP Apps remain useful for one rich tool result in
an agent host, but the Workbench imports trusted components directly and owns one
layout, selection state and navigation model.
