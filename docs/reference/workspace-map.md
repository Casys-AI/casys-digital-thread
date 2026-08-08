# Reference: workspace map and local ports

## Source map

| Location                                                                                                                                                                                 | Owns                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docker-compose.yml`](../../docker-compose.yml)                                                                                                                                         | Provider containers, networks, volumes and loopback ports                                                                                                                                                               |
| [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                                                                                                                   | Desired MCP endpoints, tools, views and trust posture                                                                                                                                                                   |
| [`config/thread-workflows/`](../../config/thread-workflows/)                                                                                                                             | Reviewed typed causal DAGs                                                                                                                                                                                              |
| [`config/thread-subjects/`](../../config/thread-subjects/)                                                                                                                               | Reviewed provider-to-product identity bindings                                                                                                                                                                          |
| [`config/verification-plans/`](../../config/verification-plans/)                                                                                                                         | Provisional scenario comparisons                                                                                                                                                                                        |
| [`config/projects/`](../../config/projects/)                                                                                                                                             | Versioned engineering intent, work and decisions                                                                                                                                                                        |
| [`config/mechanical-proof-cases/`](../../config/mechanical-proof-cases/)                                                                                                                 | Candidate mechanical declarations; not execution receipts                                                                                                                                                               |
| [`src/contracts/thread-workbench.ts`](../../src/contracts/thread-workbench.ts)                                                                                                           | Browser-safe thread presentation DTOs shared by backend and UI                                                                                                                                                          |
| [`src/domain/thread/thread-snapshot.ts`](../../src/domain/thread/thread-snapshot.ts)                                                                                                     | Canonical linked product state                                                                                                                                                                                          |
| [`src/domain/project/engineering-project.ts`](../../src/domain/project/engineering-project.ts)                                                                                           | Immutable project intent and execution-state contract                                                                                                                                                                   |
| [`src/domain/project/project-brief.ts`](../../src/domain/project/project-brief.ts)                                                                                                       | Living brief, questions, sourced answers and exact review contract                                                                                                                                                      |
| [`src/domain/project/project-brief-command-service.ts`](../../src/domain/project/project-brief-command-service.ts)                                                                       | Project-from-intent and brief revision command boundary                                                                                                                                                                 |
| [`src/domain/platform/syson-model-seed.ts`](../../src/domain/platform/syson-model-seed.ts)                                                                                               | Closed r1-to-r2 SysON container identity capture and materializer                                                                                                                                                       |
| [`src/domain/analysis/mechanical-proof-case.ts`](../../src/domain/analysis/mechanical-proof-case.ts)                                                                                     | Declaration validation and limited identity matching                                                                                                                                                                    |
| [`src/domain/analysis/proof-case.ts`](../../src/domain/analysis/proof-case.ts)                                                                                                           | Discipline-agnostic oracle requirements; units are mandatory                                                                                                                                                            |
| `deno task probe:constraint-solver`                                                                                                                                                      | Read-only z3 diagnostic; publishes nothing                                                                                                                                                                              |
| [`src/domain/analysis/sensitivity-study.ts`](../../src/domain/analysis/sensitivity-study.ts)                                                                                             | Reviewed sensitivity case and pure finite-difference derivatives                                                                                                                                                        |
| [`config/sensitivity-cases/`](../../config/sensitivity-cases/)                                                                                                                           | Reviewed sensitivity declarations; parameter, step and boxes                                                                                                                                                            |
| [`src/adapters/executors/cm01/coffee-machine-cm01-v3-oracle-requirements-run-executor.ts`](../../src/adapters/executors/cm01/coffee-machine-cm01-v3-oracle-requirements-run-executor.ts) | Server-fixed requirement anchoring, fidelity check, monotony ratchet                                                                                                                                                    |
| [`src/adapters/executors/cm01/coffee-machine-cm01-v3-sensitivity-run-executor.ts`](../../src/adapters/executors/cm01/coffee-machine-cm01-v3-sensitivity-run-executor.ts)                 | Two-run sensitivity study; publishes derivatives, never verdicts                                                                                                                                                        |
| [`src/tools/project-brief.ts`](../../src/tools/project-brief.ts)                                                                                                                         | Agent MCP project framing and exact brief-confirmation tools                                                                                                                                                            |
| [`src/domain/project/engineering-project-validation.ts`](../../src/domain/project/engineering-project-validation.ts)                                                                     | Strict project and exact thread-reference validation                                                                                                                                                                    |
| [`src/workflow/`](../../src/workflow/)                                                                                                                                                   | Validation, compilation, execution and normalization                                                                                                                                                                    |
| [`src/adapters/mcp/http-mcp-tool-client.ts`](../../src/adapters/mcp/http-mcp-tool-client.ts)                                                                                             | Backend-only provider calls                                                                                                                                                                                             |
| [`src/adapters/stores/live-thread-update-store.ts`](../../src/adapters/stores/live-thread-update-store.ts)                                                                               | Cross-process append-only live activity journal                                                                                                                                                                         |
| [`src/adapters/recording-mcp-tool-client.ts`](../../src/adapters/recording-mcp-tool-client.ts)                                                                                           | Browser-safe running/fresh/failed MCP projections                                                                                                                                                                       |
| [`src/adapters/stores/file-thread-snapshot-store.ts`](../../src/adapters/stores/file-thread-snapshot-store.ts)                                                                           | Immutable local snapshot persistence                                                                                                                                                                                    |
| [`src/adapters/stores/engineering-project-store.ts`](../../src/adapters/stores/engineering-project-store.ts)                                                                             | Tracked seed plus immutable active project revision store                                                                                                                                                               |
| [`src/domain/project/engineering-project-command-service.ts`](../../src/domain/project/engineering-project-command-service.ts)                                                           | Project transitions, authority, CAS and receipts                                                                                                                                                                        |
| [`src/adapters/engineering-project-command-runtime.ts`](../../src/adapters/engineering-project-command-runtime.ts)                                                                       | MCP command runtime and exact evidence readers                                                                                                                                                                          |
| [`src/adapters/validators/engineering-project-completion-evidence-validator.ts`](../../src/adapters/validators/engineering-project-completion-evidence-validator.ts)                     | Completion evidence existence and change gate                                                                                                                                                                           |
| [`src/adapters/registered-project-run-executor.ts`](../../src/adapters/registered-project-run-executor.ts)                                                                               | Server-owned dispatch for exact reviewed operations                                                                                                                                                                     |
| [`src/orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts`](../../src/orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts)                               | Fixed CM-01 V3 operation catalog and evidence boundaries                                                                                                                                                                |
| [`src/domain/cm01/cm01-v3-r11-closeout.ts`](../../src/domain/cm01/cm01-v3-r11-closeout.ts)                                                                                               | Code-derived R11 to R12 requirement-family closeout                                                                                                                                                                     |
| [`src/adapters/executors/syson-model-seed-run-executor.ts`](../../src/adapters/executors/syson-model-seed-run-executor.ts)                                                               | Fixed SysON project/document/root-package seed executor                                                                                                                                                                 |
| [`src/domain/platform/architecture-proposal.ts`](../../src/domain/platform/architecture-proposal.ts)                                                                                     | Generic architecture proposal types, `planArchitectureInsertion`, and server-fixed SysML renderer                                                                                                                       |
| [`src/adapters/extractors/architecture-structure-extractor.ts`](../../src/adapters/extractors/architecture-structure-extractor.ts)                                                       | Reads SysON children to extract the architecture package structure                                                                                                                                                      |
| [`src/adapters/executors/model-write-architecture-run-executor.ts`](../../src/adapters/executors/model-write-architecture-run-executor.ts)                                               | Generic trusted executor for `model.write-architecture@1`                                                                                                                                                               |
| [`src/adapters/wal/file-architecture-attempt-store.ts`](../../src/adapters/wal/file-architecture-attempt-store.ts)                                                                       | Write-ahead no-blind-retry store for generic architecture insertions                                                                                                                                                    |
| [`src/adapters/projectors/product-structure-catalog.ts`](../../src/adapters/projectors/product-structure-catalog.ts)                                                                     | Generic projector reading strict `architecture-capture/2.0`: causal tip, PartUsage occurrence hierarchy, exact seed/predecessor evidence; quantity is one reviewed occurrence, never inferred BOM/provider multiplicity |
| [`src/adapters/captures/file-capture-store.ts`](../../src/adapters/captures/file-capture-store.ts)                                                                                       | One content-addressed capture engine, typed per evidence family                                                                                                                                                         |
| [`src/adapters/wal/file-syson-model-seed-attempt-store.ts`](../../src/adapters/wal/file-syson-model-seed-attempt-store.ts)                                                               | Write-ahead no-blind-retry state for non-idempotent SysON writes                                                                                                                                                        |
| [`src/domain/platform/geometry-proposal.ts`](../../src/domain/platform/geometry-proposal.ts)                                                                                             | Generic geometry manifest types, `encodeGeometryDecisionParameters`, and MRTR parameter encoding for `design.write-geometry@1`                                                                                          |
| [`src/adapters/captures/geometry-draft-capture.ts`](../../src/adapters/captures/geometry-draft-capture.ts)                                                                               | Calls `build123d_export`, attests each binary's SHA-256, and stores draft JSON + binary assets in the draft stores; never writes a `ThreadSnapshot`                                                                     |
| [`src/adapters/executors/design-write-geometry-run-executor.ts`](../../src/adapters/executors/design-write-geometry-run-executor.ts)                                                     | Trusted executor for `design.write-geometry@1`: seals exact bytes from a human-signed draft into a geometry artifact; no provider call; requires a matching MRTR decision before promoting                              |
| [`src/ui/src/thread/geometry-decision-model.ts`](../../src/ui/src/thread/geometry-decision-model.ts)                                                                                     | Browser-safe parser for MRTR geometry decision parameters; returns `{ kind: "valid" }` or `{ kind: "invalid", reason }`; no domain imports                                                                             |
| [`src/adapters/stores/thread-snapshot-lineage.ts`](../../src/adapters/stores/thread-snapshot-lineage.ts)                                                                                 | Exact `previous`-chain ancestry proof                                                                                                                                                                                   |
| [`src/tools/project-control.ts`](../../src/tools/project-control.ts)                                                                                                                     | Agent MCP planning, elicitation, queueing, and bounded execution                                                                                                                                                        |
| [`src/adapters/projectors/engineering-workbench-projector.ts`](../../src/adapters/projectors/engineering-workbench-projector.ts)                                                         | Project/thread presentation composition and alignment                                                                                                                                                                   |
| [`src/adapters/projectors/thread-workbench-projector.ts`](../../src/adapters/projectors/thread-workbench-projector.ts)                                                                   | Canonical-state to Workbench projection                                                                                                                                                                                 |
| [`src/ui/src/thread/`](../../src/ui/src/thread/)                                                                                                                                         | Native read-only lineage feed, graph, inspectors, and SSE client                                                                                                                                                        |
| [`src/ui/src/project/`](../../src/ui/src/project/)                                                                                                                                       | Read-only project cockpit, notifications, dossier, and run journal                                                                                                                                                      |
| [`src/ui/dist/console/index.html`](../../src/ui/dist/console/index.html)                                                                                                                 | Generated Console MCP App bundle                                                                                                                                                                                        |
| `deno task preview:browser`                                                                                                                                                              | Loopback Console preview                                                                                                                                                                                                |
| `deno task preview:thread` / `deno task preview:cockpit`                                                                                                                                 | Passive project/thread reads and SSE dossier BFF                                                                                                                                                                        |
| `deno task thread:run-coffee-machine-cm01-v3-correction`                                                                                                                                 | Explicit CM-01 V3 28 mm to 30 mm control-plane driver                                                                                                                                                                   |
| `deno task thread:retry-coffee-machine-cm01-v3-mechanical-r3`                                                                                                                            | Bounded CM-01 V3 R3 mechanical recovery driver                                                                                                                                                                          |
| `deno task thread:recover-coffee-machine-cm01-v3-mechanical-r3-identity`                                                                                                                 | Provider-free R10 to R11 identity recovery                                                                                                                                                                              |
| `deno task thread:close-coffee-machine-cm01-v3-r11`                                                                                                                                      | Provider-free R11 to R12 failed-work reconciliation                                                                                                                                                                     |
| `deno task thread:capture-syson-inventory`                                                                                                                                               | Read-only SysON inventory capture; writes immutable local capture file                                                                                                                                                  |
| [`state/fixtures/`](../../state/fixtures/)                                                                                                                                               | Explicitly labelled demo evidence                                                                                                                                                                                       |
| `state/local/engineering-projects/`                                                                                                                                                      | Ignored immutable active project revisions and CAS claims                                                                                                                                                               |
| `state/local/engineering-project-run-leases/`                                                                                                                                            | Empty local OS lock targets for one trusted run; not evidence                                                                                                                                                           |
| `state/local/syson-model-seed-captures/`                                                                                                                                                 | Content-addressed normalized r2 container captures                                                                                                                                                                      |
| `state/local/syson-model-seed-attempts/`                                                                                                                                                 | Recovery control state for uncertain SysON writes; not evidence                                                                                                                                                         |
| `state/local/architecture-captures/`                                                                                                                                                     | Generic architecture-capture/2.0 CAS captures (model.write-architecture@1): hashed parent-to-usage-to-type graph and causal predecessor chain                                                                           |
| `state/local/architecture-attempts/`                                                                                                                                                     | Recovery control state for uncertain generic SysON architecture writes                                                                                                                                                  |
| `state/local/geometry-draft-captures/`                                                                                                                                                   | Content-addressed draft capture JSON files (one per `build123d_export` call); never in `ThreadSnapshot`; keyed by SHA-256 of the serialized draft manifest                                                             |
| `state/local/geometry-draft-assets/<sha256>`                                                                                                                                             | Raw binary geometry assets (STEP/STL/glTF) produced by `build123d_export`; file name is the SHA-256 digest of the bytes; served read-only by `/api/draft-assets/<digest>`                                              |
| `state/local/geometry-captures/`                                                                                                                                                         | Content-addressed geometry-artifact/1.0 CAS captures written by `design.write-geometry@1` after human MRTR approval; monotony ratchet prevents silently dropping a sealed geometry artifact                            |

## Local endpoints

| Endpoint                    | Owner                       | Purpose                                        |
| --------------------------- | --------------------------- | ---------------------------------------------- |
| `http://127.0.0.1:8180`     | SysON                       | SysML web modeler                              |
| `http://127.0.0.1:3009/mcp` | `mcp-syson`                 | Model, constraints and evaluations             |
| `http://127.0.0.1:3012/mcp` | `mcp-erpnext`               | Provider-native ERP data                       |
| `http://127.0.0.1:3014/mcp` | `mcp-build123d`             | CAD execution and exports                      |
| `http://127.0.0.1:3015/mcp` | `mcp-calculix`              | Meshing and static FEA                         |
| `http://127.0.0.1:3016/mcp` | `mcp-modelica`              | Approved simulations and run records           |
| `http://127.0.0.1:3018/mcp` | `mcp-dfm`                   | FDM printability checks on produced STL        |
| `http://127.0.0.1:3019/mcp` | `mcp-tolerance`             | ISO 286-1 fits and 1D stack-ups                |
| `http://127.0.0.1:3022/mcp` | `mcp-prusaslicer`           | Print time and material from real G-code       |
| `http://127.0.0.1:3023/mcp` | `mcp-spice`                 | ngspice operating points and transients        |
| `http://127.0.0.1:3020/mcp` | `deno task start`           | Fleet reads plus agent project control         |
| `http://127.0.0.1:3021/`    | `deno task preview:browser` | Console MCP App browser harness                |
| `http://127.0.0.1:5175/`    | `deno task preview:cockpit` | Canonical project cockpit and live Project tab |
| `http://127.0.0.1:5173/`    | `deno task preview:thread`  | Direct engineering-view development preview    |
| `/api/draft-assets/<sha256>` | BFF (native Workbench)     | Read-only geometry draft binary; 404 if not present; Cache-Control: no-store |

Docker Compose starts the provider topology only. Product composition occurs in the
backend workflow and linked state, not in the container orchestrator.

## Server-park naming convention

One MCP server wraps exactly one engine, and the server's name states what kind of
contract the caller signs. Three naming rules coexist, and the choice between them is
informative, not stylistic:

| Rule                  | When it applies                                                                                                     | Examples                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Exact engine name** | The input contract is specific to that engine — its scripts, profiles or flags would not transfer to a competitor   | `mcp-calculix`, `mcp-build123d`, `mcp-prusaslicer`                       |
| **Standard language** | The input is a format several engines speak; the wrapped implementation is an internal detail the caller never sees | `mcp-modelica` (OpenModelica), `mcp-spice` (ngspice)                     |
| **Domain**            | No single dominant library exists — the engine is normative formulas or in-house computation                        | `mcp-dfm` (gmsh + in-house checks), `mcp-tolerance` (ISO 286-1 formulas) |

Corollaries: tool names are prefixed with the server name (`prusaslicer_estimate_fff`,
never a generic `slicer_*`); a second engine in the same domain is a second server, not
a second backend inside the first (a CuraEngine oracle would be `mcp-curaengine`, not an
option on `mcp-prusaslicer`); and renaming after a JSR release deprecates a package, so
the naming decision is made before first publication.

The four standalone oracle servers (`mcp-dfm` 3018, `mcp-tolerance` 3019,
`mcp-prusaslicer` 3022, `mcp-spice` 3023) are wired into the workshop compose topology
and the fleet manifest since 2026-08-05, each pinned to its published multi-arch
`ghcr.io/casys-ai/*` image digest. Wiring in the manifest declares the desired state
only — the MCP and Docker probes remain the execution truth, including when they answer
`unavailable`. The same images also carry a `stdio` entrypoint mode used by the Docker
MCP Catalog submissions; the workshop always talks to them over stateless HTTP.

`config/mechanical-proof-cases/` holds two different schemas, and the distinction
matters. Three files use `cm01-v3-drip-tray-static-proof/{1,2,3}.0` and _are_ loaded by
the V3 path (`server.ts:178`, `:180`, `:182`). The remaining file uses the generic
`mechanical-proof-case/1.0` schema and is read by nothing. Either way, these files
declare candidate inputs for review: they neither authorize execution nor attest the
effective provider arguments or results. See the
[candidate mechanical-analysis declaration](mechanical-proof-case.md) reference.

Since the mechanical verdict moved to the oracle, a loaded proof case supplies the
_limits_, never the pass/fail decision. `syson_constraint_evaluate` renders the verdict,
and `error` and `unresolved` reach the published snapshot unchanged.

The Console MCP server and native Workbench entry point reject non-loopback hostnames.
Loopback is a deployment guard, not user authentication. Human confirmation flows use
the paired MCP host and still require a real authentication policy before multi-user
deployment.

The fixed `coffee-machine-cm01-v3` path is a separate project and catalog. Its original
five reviewed product operations follow the documentary baseline and SysON seed. The
recorded 28 mm → 30 mm correction then retains R2 as failed and evidence-free, creates
the correctly identified R3 successor at R11 without a provider call, and uses the local
R12 closeout to persist requirement-family links and reconcile the obsolete work item.
It does not make a generic CAD, physics, or certification operation available. See the
[CM-01 V3 golden-run guide](../how-to/run-cm01-v3-golden-local.md).

`deno task preview:thread` seeds the tracked CM-01 project as active revision 1 only
when `state/local/engineering-projects/coffee-machine-cm01/` is absent. Browser GET and
SSE requests remain passive. The cockpit exposes no project mutation or provider-call
surface.

`deno task start` exposes the MCP project surface used by the paired agent. Agents can
inspect the same active project, propose an input, elicit an exact human decision in the
conversation, queue a ready registered work item, and execute only that server-derived
run. They cannot confirm their own proposal or choose arbitrary provider calls. New V3
projects are created from first intent and the server-owned baseline executor creates
the immutable, pre-technical approved-brief r1. The current provider-backed executor,
`architecture.seed-syson-model@2`, accepts only that exact r1 and its brief-bound
project-change lineage, then uses fixed SysON calls to create a blank project, document,
and root package; it reads the root back, normalizes its identities into
`syson-model-seed-capture/2.0`, and publishes r2. Callers supply no arbitrary arguments
or SysML text; uncertain writes are not blindly retried. r2 is a container identity, not
an architecture, requirements, CAD, simulation, measurement, or verdict. The generic
route stops there. The distinct CM-01 V3 catalog owns the current product-specific
operations and their capture/evidence contracts; it does not make a generic
architecture, CAD, or verification operation available.

The generic geometry boundary separates preview from seal. `project_geometry_preview`
(registered only when `build123dMcpUrl` is configured) calls `build123d_export`,
attests each binary's SHA-256, and stores the draft JSON capture in
`state/local/geometry-draft-captures/` with the raw binaries under
`state/local/geometry-draft-assets/<digest>`. It returns a `draftDigest` and the
flat `decisionParameters` for an MRTR proposal. The Workbench BFF serves these
binaries at `/api/draft-assets/<digest>` (read-only, `Cache-Control: no-store`).
Nothing from this path enters a `ThreadSnapshot`. Only `design.write-geometry@1`
can promote a draft: it requires a matching MRTR decision with
`decidedByOrigin === "human"`, verifies the SHA-256 of every file, and writes a
sealed geometry artifact into the evidence thread. The monotony ratchet
(`geometry_artifact_removed`) then prevents a later snapshot from silently omitting
that artifact. The write executor makes no provider calls — it seals bytes already
present in the draft store.

The bounded `inspection-drone-v4` path adds a separate read-only successor after its
qualitative r3 architecture: `model.capture-inspection-drone-part-definitions@1` reads
only the six attested SysON PartDefinitions and their five root usages from the exact
content-addressed architecture artifact. It stores one replay-safe bundle in
`inspection-drone-v4-part-definitions-captures` and the Workbench derives the root and
five children only from that bundle. It neither writes SysML nor infers a CAD, physical,
manufacturing, certification, cost, or un-attested quantity.

## Runtime ownership

| Data                         | Owner                       | Workspace access                                                                         |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| SysML and requirements       | SysON                       | Provider MCP; no automatic mutation                                                      |
| CAD exports                  | `exports` volume            | Hash-attested build123d to CalculiX exchange                                             |
| Modelica runs                | `modelica-runs` volume      | Read through `modelica_run_list/get`                                                     |
| ERP data                     | External ERPNext database   | Provider-native MCP from backend only                                                    |
| Native `ThreadSnapshot`      | Immutable local file store  | Read-only projection in the native Workbench                                             |
| `EngineeringProjectSnapshot` | Immutable active file store | Intent, living brief, exact reviews, bounded runs and evidence references; CAS revisions |
| Live engineering activity    | Append-only local JSONL     | SSE projection; never canonical authority                                                |

The Console browser harness forwards only reviewed Console tools. It is not a generic
MCP proxy. The native browser receives ordinary linked JSON and no MCP credentials.
