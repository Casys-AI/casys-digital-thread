# Reference: source map — Workbench, control plane, and desktop

Audience: agent · Diátaxis: reference · Kind: contract

Census of read-only Workbench projections, Console control-plane files, and Desktop
packaging. The Workbench receives no commands.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`src/presentation/workbench/thread/`](../../../src/presentation/workbench/thread)

Browser-safe Thread graph, evidence, Engineering Case catalog (`engineering-cases/1.0`),
architecture and component read models for BFF GET + SSE. Presentation only; no command
authority. CAD/Modelica/SPICE admissions are not Engineering Cases.

#### [`src/presentation/workbench/engineering/`](../../../src/presentation/workbench/engineering)

Planning, documentary, evidence and live-overlay Workbench projections. Domain
dependencies are erased type imports only.

#### [`src/presentation/workbench/fleet/`](../../../src/presentation/workbench/fleet)

Declared-only cockpit fleet projection and its runtime decoder. Live health remains a
Control Plane observation.

#### [`src/application/control-plane/read-model/`](../../../src/application/control-plane/read-model)

Application-owned fleet, drift, run and Console query models used by `console_*`; not a
Workbench presentation contract.

#### [`src/application/control-plane/`](../../../src/application/control-plane)

Console application service (`console_*`) and probe / container-observation ports. Not a
human page; `preview:browser` refuses. HTTP probe lives in `adapters/shared/mcp/`;
Docker observer is `adapters/shared/docker-observer.ts`. The retired
`ObservedRunCatalog` / `ModelicaRunObserver` merge is gone.

#### [`src/adapters/control-plane/`](../../../src/adapters/control-plane)

Control-plane adapters: fleet-manifest loader and checked-in run-fixture catalog. Not
Thread projectors. Shared MCP/CAS/WAL helpers live under `adapters/shared/`

#### [`src/tools/control-plane.ts`](../../../src/tools/control-plane.ts)

MCP `console_snapshot`, `console_server_detail`, `console_run_list`,
`console_run_detail`, and leftover App-only `console_refresh`. Must not register
`ui://casys-digital-thread/console`

#### [`src/adapters/thread/architecture-sysml-seal-workbench-enricher.ts`](../../../src/adapters/thread/architecture-sysml-seal-workbench-enricher.ts)

Post-projection BFF enricher: reopens seal + source-analysis to attach documentary
symbol ids. Never invents part-definition/part-usage nodes

#### [`src/adapters/thread/sealed-cad-lever-graph.ts`](../../../src/adapters/thread/sealed-cad-lever-graph.ts)

Pure Evidence overlay: `cad-lever` nodes and `parameterizes` edges onto existing
AttributeUsage nodes

#### [`src/adapters/thread/sealed-cad-lever-workbench-enricher.ts`](../../../src/adapters/thread/sealed-cad-lever-workbench-enricher.ts)

Post-projection BFF enricher: reopens `compile.seal-admission@3` CAS. Missing/unreadable
seals add nothing

#### [`src/adapters/thread/engineering-workbench-projector.ts`](../../../src/adapters/thread/engineering-workbench-projector.ts)

Project/thread presentation composition and alignment. BFF lecture only

#### [`src/adapters/thread/thread-workbench-projector.ts`](../../../src/adapters/thread/thread-workbench-projector.ts)

Canonical-state to Workbench projection; emits `AnalysisGraph` nodes and qualified edges
as separate browser-safe `origin: "analysis"` data. The Evidence canvas omits that
overlay and paints the Thread dossier in Graphology

#### [`src/adapters/thread/evidence-family-graph.ts`](../../../src/adapters/thread/evidence-family-graph.ts)

Pure quotient of explicit `supersedes` / capture-predecessor edges for the Evidence
canvas. Presentation only

#### [`src/adapters/thread/syson-model-seed-live-projector.ts`](../../../src/adapters/thread/syson-model-seed-live-projector.ts)

Browser-safe live milestones for `architecture.seed-syson-model@2`. Never exposes
provider arguments or errors

#### [`src/adapters/thread/cockpit-fleet-projector.ts`](../../../src/adapters/thread/cockpit-fleet-projector.ts)

Declared-only fleet identity from `config/mcp-fleet.json`. No health, URLs, or tools
leak into the BFF envelope

#### [`src/ui/src/thread/`](../../../src/ui/src/thread)

Native read-only lineage feed, Graphology `MultiDirectedGraph` projection, inspectors
and SSE client; global sensitivity remains inspectable while component facets require an
exact binding and never infer one from labels

#### [`src/ui/src/project/`](../../../src/ui/src/project)

Read-only project cockpit, notifications, dossier, and run journal

#### Native Workbench bundle

Generated, gitignored `src/ui/dist/thread/` — React + Vite product page
(`native-workbench.html` + hashed JS/CSS). Rebuild locally; do not commit. No Console
MCP App bundle. `preview:browser` refuses

#### [`desktop/src/workbench/`](../../../desktop/src/workbench)

Packaged Desktop Workbench privilege domain: fixed CLI/contracts, read-only BFF rooted
in the existing Application Support control-plane workspace, host-only session
capability, exact GET/HEAD/SSE proxy allowlist, inspect/reconnect/owned-stop lifecycle,
and closed compile permissions. It owns no project command, MCP/provider credential,
Docker/process authority, or second store

#### [`desktop/src/application/shell-handler.ts`](../../../desktop/src/application/shell-handler.ts)

Deno Desktop same-origin seam. `/` is the living Workbench when its exact session is
ready; static diagnostics remain the fallback. Unknown, command, lifecycle and
privileged routes remain closed

#### [`desktop/src/build/compiled-workbench-helper_e2e_test.ts`](../../../desktop/src/build/compiled-workbench-helper_e2e_test.ts)

Real compiled-helper proof: offline project catalog without hidden focus, durable focus
follow, exact project projection, SSE, rejected POST, then token/marker cleanup and
closed port after stdin EOF

#### `deno task preview:browser`

Retired; the task refuses and points to `preview:thread`

#### `deno task preview:thread` / `deno task preview:cockpit`

Passive project/thread reads and SSE: Vite :5173 (HMR) and BFF :5175 serving hashed
JS/CSS

#### `deno task thread:capture-syson-inventory`

Read-only SysON inventory capture; writes immutable local capture file
