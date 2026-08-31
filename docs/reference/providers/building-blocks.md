# Reference: building blocks and artifact ownership

Audience: both · Diátaxis: reference · Kind: contract

The cross-provider port and adapter boundary is defined in
[Capability-oriented provider architecture](capability-oriented-provider-architecture.md).
This page remains the responsibility and artifact index.

## Responsibility map

| Building block         | Owns                                                                             | Does not own                                                           |
| ---------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `mcp-server`           | Stateless MCP tools, resources and HTTP transport                                | Engineering truth or product layout                                    |
| `mcp-view`             | Optional provider result-viewer runtime (other repos). Not this atelier cockpit  | Workflow execution, evidence authority, or the native Workbench        |
| `mcp-syson`            | SysML model, requirements, constraints and explicit verdicts                     | Physical calculations                                                  |
| `mcp-build123d`        | CAD programs, geometry metrics and content-addressed exports                     | FEA results or product verdicts                                        |
| `mcp-calculix`         | Recorded static runs and identity-bound solver resources                         | CAD authoring, material authority or human verdict                     |
| `mcp-chrono`           | Factual prescribed-kinematics observations for one exact server-lowered case     | Collision, clearance, forces, product verdicts or caller-selected runtime |
| Local Modelica microVM | Admitted closed-subset and qualified-kit isolated execution                      | The retired port 3016 `mcp-modelica` sidecar or `modelica-runs` volume |
| `mcp-erpnext`          | Provider-native manufacturing, inventory, operations and costing data            | SysML, CAD, simulation or the product shell                            |
| `constraint-solver`    | Units-aware evaluation and satisfiability                                        | Requirement ownership                                                  |
| `casys-digital-thread` | Project control, ROP2 sealing, linked `ThreadSnapshot`, projection and Workbench | Provider implementations, raw provider calls or invented design limits |

## Authoritative artifacts

| Artifact                     | Location                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sealed CapabilityRuntime launch topology | [`src/adapters/control-plane/first-party-capability-runtime-launch-groups.ts`](../../../src/adapters/control-plane/first-party-capability-runtime-launch-groups.ts) — server-owned H1 descriptors; root `docker-compose.yml` is only a maintainer diagnostic topology |
| Desired fleet                | [`config/mcp-fleet.json`](../../../config/mcp-fleet.json)                                                                                                                                      |
| Native workflow (frozen)     | [`experiments/thread-workflow/`](../../../experiments/thread-workflow)                                                                                                                         |
| Canonical linked state       | [`src/domain/thread/thread-snapshot.ts`](../../../src/domain/thread/thread-snapshot.ts)                                                                                                        |
| Workflow compiler/executor   | [`experiments/thread-workflow/`](../../../experiments/thread-workflow) (frozen prototype)                                                                                                      |
| Workbench projection         | [`src/adapters/thread/thread-workbench-projector.ts`](../../../src/adapters/thread/thread-workbench-projector.ts)                                                                              |
| Native Workbench UI          | [`src/ui/src/thread/`](../../../src/ui/src/thread)                                                                                                                                             |
| Modelica evidence            | Recorded-analysis CAS/WAL under `state/local/recorded-analysis/` from the local Modelica microVM. The historical `casys-digital-thread-modelica-runs` volume and port 3016 sidecar are retired |
| Recorded-analysis ROP2 state | `state/local/recorded-analysis/`: fixed directories for plans, admitted/kit Modelica, CalculiX run/evaluation capture and WAL; fixed CAS namespaces where applicable; not a provider volume    |
| CAD/FEA exchange             | `exports` Docker volume, with producer and consumer SHA-256 attestation                                                                                                                        |
| ERP manufacturing truth      | ERPNext database, reached only through `mcp-erpnext`                                                                                                                                           |
| FEA proof (seal)             | [`src/adapters/fea/seal-case/verify-seal-proof-case-run-executor.ts`](../../../src/adapters/fea/seal-case/verify-seal-proof-case-run-executor.ts)                                              |
| FEA proof (run)              | [`src/adapters/fea/isolated-v3/verify-run-fea-static-proof-v3-run-executor.ts`](../../../src/adapters/fea/isolated-v3/verify-run-fea-static-proof-v3-run-executor.ts)                          |
| Admitted Modelica run        | [`src/adapters/modelica/admitted/run-executor.ts`](../../../src/adapters/modelica/admitted/run-executor.ts)                                                                                    |
| Qualified Modelica kit       | [`src/adapters/modelica/qualified-kit/run-executor.ts`](../../../src/adapters/modelica/qualified-kit/run-executor.ts)                                                                          |

A reviewed subject manifest is the sole cross-provider join authority for its project.
Provider display names and matching labels are evidence for people, not a machine join
key.

## Product boundary

The browser reads linked product data from the digital-thread backend. It never connects
to provider MCP endpoints. The Workbench is a React + Vite SPA that imports trusted
local components and owns one layout, selection state and navigation model. It is not an
MCP App.

`GET /api/project/capabilities` is available to the native helper as the read-only
`project-capability-workbench/1.0` projection. In the current lot the UI does not render
a capability card for it; endpoint availability is not a rendered-control claim.
