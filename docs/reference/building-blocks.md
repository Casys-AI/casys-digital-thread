# Reference: building blocks and artifact ownership

> **Diátaxis category: reference.** Use this map to locate the authoritative repository
> and artifact for a concern. It does not prescribe an orchestration sequence; see
> [proofs and verdicts](../explanations/proofs-and-verdicts.md) for the reasoning behind
> the split.

## Responsibility map

| Building block          | Code and runtime responsibility                                                                                                          | Produces / owns                                                                                                 | Does not own                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `mcp-server`            | Shared MCP server layer. The workspace currently imports `@casys/mcp-server@0.24.0`; the target transport is stateless MCP `2026-07-28`. | Tool/resource registration, HTTP contract, structured MCP results.                                              | Engineering models, solver outputs, dashboards, or requirement verdicts.                 |
| `mcp-view`              | Browser-side MCP Apps primitives and the standard result-viewer scaffold. `@casys/mcp-view@0.4.0` is published on JSR.                   | App source, built single-HTML resource, structured-result rendering.                                            | Server tools, a dashboard host, and evidence authority.                                  |
| `mcp-compose`           | Manifest/template-driven local MCP Apps host and iframe/capability boundary.                                                             | Composed dashboard layout and host-side, declared tool grants.                                                  | A source server's resources, evidence, or hidden cross-server access.                    |
| `mcp-modelica`          | Approved Modelica kit/scenario execution. The Compose service is `mcp-modelica` on port `3016`.                                          | Dynamic multi-physics runs, metrics, time-series artifacts, hashes, and immutable `/runs` records.              | SysML requirements or `pass`/`fail` verdicts.                                            |
| `mcp-build123d`         | Parametric CAD execution and export. The Compose service is `mcp-build123d` on port `3014`.                                              | Geometry programs, exact geometry metrics, and CAD exports in `/exports`.                                       | FEA solve results, dynamic system simulation, or product verdicts.                       |
| `mcp-calculix`          | Meshing and linear static FEA. The Compose service is `mcp-calculix` on port `3015`.                                                     | Mechanical-solve evidence derived from geometry exports.                                                        | CAD authoring, Modelica time series, or requirements authority.                          |
| `mcp-syson`             | SysML model access, requirements/traceability, units-aware constraint evaluation. The Compose service is `mcp-syson` on port `3009`.     | Requirement/constraint data, traceability, and explicit comparison outcomes.                                    | Physical calculation or an evidence artifact it did not receive.                         |
| `engineering-toolchain` | Release/build repository for the shared engineering image used by SysON MCP, build123d, and CalculiX.                                    | Pinned toolchain image and native engineering executables.                                                      | The Modelica sidecar image, workspace layout, or Console data model.                     |
| `casys-digital-thread`  | This control-plane workspace: read-only Console, fleet configuration, Compose declarations, scenario plan, and docs.                     | Console source and bundle, manifests, dashboard templates, observation/projection code, labelled demo fixtures. | Direct solver execution, persistent Modelica data, CAD exports, or SysON model mutation. |

With Deno 2.9, a JSR package published less than 24 hours ago may be held by the default
minimum dependency age. If `@casys/mcp-view@0.4.0` is temporarily affected, use an
exception scoped to that exact package/version; do not disable the age gate globally.

## Where each artifact lives

| Artifact                          | Authoritative location                                                                                                                                                                              | Consumer / boundary                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Shared MCP HTTP/server code       | `mcp-server` repository; this workspace's [`deno.json`](../../deno.json) pins its imported server layer                                                                                             | Every local MCP server; stateless wire contract is transport, not a dashboard feature.                             |
| MCP App source and built resource | `mcp-view` scaffold output or a server's `src/ui/`; the Console source is [`src/ui/src/`](../../src/ui/src/) and bundle is [`src/ui/dist/console/index.html`](../../src/ui/dist/console/index.html) | Served as a resource by the source MCP server. Build output is generated; do not hand-edit it.                     |
| Source-server registration        | The owning MCP server code, where a tool declares an output schema and `ui.resourceUri`                                                                                                             | An MCP Apps host reads the resource from that same source server.                                                  |
| Dashboard manifest                | [`config/compose/manifests/`](../../config/compose/manifests/)                                                                                                                                      | `mcp-compose` uses it to bind a panel to one source transport and explicit `appCallable` tools.                    |
| Dashboard template                | [`config/compose/dashboards/`](../../config/compose/dashboards/)                                                                                                                                    | `mcp-compose` chooses panel layout and initiating calls; it never creates evidence.                                |
| Desired fleet                     | [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                                                                                                                              | Console comparison of declared endpoints against live observations.                                                |
| CAD exports                       | Named Docker volume `exports`, mounted at `/exports` for build123d and CalculiX                                                                                                                     | CalculiX may consume an exported STEP; Console observes only evidence metadata.                                    |
| Modelica evidence                 | Named Docker volume `casys-digital-thread-modelica-runs`, mounted at `/runs` in Modelica                                                                                                            | Read through `modelica_run_list` / `modelica_run_get`, not through a Console volume mount.                         |
| Scenario comparison plan          | [`config/verification-plans/`](../../config/verification-plans/)                                                                                                                                    | Console binds exact identities and sends the comparison to SysON; it does not promote it to a product requirement. |

## Local endpoints

All four engineering MCP endpoints are loopback-only on the host:

| Server    | Endpoint                    | Main result type                                                |
| --------- | --------------------------- | --------------------------------------------------------------- |
| SysON     | `http://127.0.0.1:3009/mcp` | SysML/constraint/trace response and explicit evaluation outcome |
| build123d | `http://127.0.0.1:3014/mcp` | Geometry metrics and export evidence                            |
| CalculiX  | `http://127.0.0.1:3015/mcp` | Static FEA evidence                                             |
| Modelica  | `http://127.0.0.1:3016/mcp` | Structured simulation run envelope (`schemaVersion: "1.0"`)     |

The Console endpoint is `http://127.0.0.1:3020/mcp`; its browser preview is
`http://127.0.0.1:3021/`. The exhaustive source/port lookup remains the
[workspace map](workspace-map.md).

## Compatibility boundary

The active contract is stateless MCP `2026-07-28`: POST requests to `/mcp` carry the
protocol header and client metadata; there is no session identifier, initialize
exchange, or SSE stream. Do not add a legacy compatibility adapter to a new App,
dashboard, or engineering service. If an existing configuration still names stdio or
older `--http` behaviour, treat it as migration work rather than proof that a legacy
path is supported.
