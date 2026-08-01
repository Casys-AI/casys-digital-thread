# Reference: building blocks and artifact ownership

## Responsibility map

| Building block         | Owns                                                                   | Does not own                                       |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| `mcp-server`           | Stateless MCP tools, resources and HTTP transport                      | Engineering truth or product layout                |
| `mcp-view`             | Shared presentation primitives and individual rich-result App runtime  | Workflow execution or evidence authority           |
| `mcp-syson`            | SysML model, requirements, constraints and explicit verdicts           | Physical calculations                              |
| `mcp-build123d`        | CAD programs, geometry metrics and content-addressed exports           | FEA results or product verdicts                    |
| `mcp-calculix`         | Meshing, static solve evidence and exact input-artifact attestation    | CAD authoring or material authority                |
| `mcp-modelica`         | Approved dynamic simulations and immutable run evidence                | SysML requirements                                 |
| `mcp-erpnext`          | Provider-native manufacturing, inventory, operations and costing data  | SysML, CAD, simulation or the product shell        |
| `constraint-solver`    | Units-aware evaluation and satisfiability                              | Requirement ownership                              |
| `casys-digital-thread` | Workflow DAG, linked `ThreadSnapshot`, projection and native Workbench | Provider implementations or invented design limits |

## Authoritative artifacts

| Artifact                   | Location                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Provider topology          | [`docker-compose.yml`](../../docker-compose.yml)                                                 |
| Desired fleet              | [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                           |
| CM-01 subject binding      | [`config/thread-subjects/coffee-machine-cm01.json`](../../config/thread-subjects/coffee-machine-cm01.json) |
| Native workflow            | [`config/thread-workflows/`](../../config/thread-workflows/)                                     |
| Canonical linked state     | [`src/domain/thread-snapshot.ts`](../../src/domain/thread-snapshot.ts)                           |
| Workflow compiler/executor | [`src/workflow/`](../../src/workflow/)                                                           |
| Workbench projection       | [`src/adapters/thread-workbench-projector.ts`](../../src/adapters/thread-workbench-projector.ts) |
| Native Workbench UI        | [`src/ui/src/thread/`](../../src/ui/src/thread/)                                                 |
| Modelica evidence          | `casys-digital-thread-modelica-runs` Docker volume, read through its MCP                         |
| CAD/FEA exchange           | `exports` Docker volume, with producer and consumer SHA-256 attestation                          |
| ERP manufacturing truth    | ERPNext database, reached only through `mcp-erpnext`                                             |

The CM-01 manifest is the sole cross-provider join authority. It binds a SysON
project, build123d artifact path, persisted Modelica run, and ERPNext item to
one product subject. Provider display names and matching labels are evidence
for people, not a machine join key.

## Product boundary

The browser reads linked product data from the digital-thread backend. It never
connects to provider MCP endpoints. Provider MCP Apps remain useful for one rich
tool result in an agent host, but the Workbench imports trusted components
directly and owns one layout, selection state and navigation model.
