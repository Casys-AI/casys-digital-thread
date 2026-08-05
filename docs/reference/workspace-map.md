# Reference: workspace map and local ports

## Source map

| Location                                                                                                                                                   | Owns                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`docker-compose.yml`](../../docker-compose.yml)                                                                                                           | Provider containers, networks, volumes and loopback ports            |
| [`config/mcp-fleet.json`](../../config/mcp-fleet.json)                                                                                                     | Desired MCP endpoints, tools, views and trust posture                |
| [`config/thread-workflows/`](../../config/thread-workflows/)                                                                                               | Reviewed typed causal DAGs                                           |
| [`config/thread-subjects/`](../../config/thread-subjects/)                                                                                                 | Reviewed provider-to-product identity bindings                       |
| [`config/verification-plans/`](../../config/verification-plans/)                                                                                           | Provisional scenario comparisons                                     |
| [`config/projects/`](../../config/projects/)                                                                                                               | Versioned engineering intent, work and decisions                     |
| [`config/mechanical-proof-cases/`](../../config/mechanical-proof-cases/)                                                                                   | Candidate mechanical declarations; not execution receipts            |
| [`src/contracts/thread-workbench.ts`](../../src/contracts/thread-workbench.ts)                                                                             | Browser-safe thread presentation DTOs shared by backend and UI       |
| [`src/domain/thread-snapshot.ts`](../../src/domain/thread-snapshot.ts)                                                                                     | Canonical linked product state                                       |
| [`src/domain/engineering-project.ts`](../../src/domain/engineering-project.ts)                                                                             | Immutable project intent and execution-state contract                |
| [`src/domain/project-brief.ts`](../../src/domain/project-brief.ts)                                                                                         | Living brief, questions, sourced answers and exact review contract   |
| [`src/domain/project-brief-command-service.ts`](../../src/domain/project-brief-command-service.ts)                                                         | Project-from-intent and brief revision command boundary              |
| [`src/domain/syson-model-seed.ts`](../../src/domain/syson-model-seed.ts)                                                                                   | Closed r1-to-r2 SysON container identity capture and materializer    |
| [`src/domain/mechanical-proof-case.ts`](../../src/domain/mechanical-proof-case.ts)                                                                         | Declaration validation and limited identity matching                 |
| [`src/domain/proof-case.ts`](../../src/domain/proof-case.ts)                                                                                               | Discipline-agnostic oracle requirements; units are mandatory         |
| [`scripts/probe-constraint-solver.ts`](../../scripts/probe-constraint-solver.ts)                                                                           | Read-only z3 diagnostic; publishes nothing                           |
| [`src/domain/sensitivity-study.ts`](../../src/domain/sensitivity-study.ts)                                                                                 | Reviewed sensitivity case and pure finite-difference derivatives     |
| [`config/sensitivity-cases/`](../../config/sensitivity-cases/)                                                                                             | Reviewed sensitivity declarations; parameter, step and boxes         |
| [`src/adapters/coffee-machine-cm01-v3-oracle-requirements-run-executor.ts`](../../src/adapters/coffee-machine-cm01-v3-oracle-requirements-run-executor.ts) | Server-fixed requirement anchoring, fidelity check, monotony ratchet |
| [`src/adapters/coffee-machine-cm01-v3-sensitivity-run-executor.ts`](../../src/adapters/coffee-machine-cm01-v3-sensitivity-run-executor.ts)                 | Two-run sensitivity study; publishes derivatives, never verdicts     |
| [`src/tools/project-brief.ts`](../../src/tools/project-brief.ts)                                                                                           | Agent MCP project framing and exact brief-confirmation tools         |
| [`src/domain/engineering-project-validation.ts`](../../src/domain/engineering-project-validation.ts)                                                       | Strict project and exact thread-reference validation                 |
| [`src/workflow/`](../../src/workflow/)                                                                                                                     | Validation, compilation, execution and normalization                 |
| [`src/adapters/http-mcp-tool-client.ts`](../../src/adapters/http-mcp-tool-client.ts)                                                                       | Backend-only provider calls                                          |
| [`src/adapters/live-thread-update-store.ts`](../../src/adapters/live-thread-update-store.ts)                                                               | Cross-process append-only live activity journal                      |
| [`src/adapters/recording-mcp-tool-client.ts`](../../src/adapters/recording-mcp-tool-client.ts)                                                             | Browser-safe running/fresh/failed MCP projections                    |
| [`src/adapters/file-thread-snapshot-store.ts`](../../src/adapters/file-thread-snapshot-store.ts)                                                           | Immutable local snapshot persistence                                 |
| [`src/adapters/engineering-project-store.ts`](../../src/adapters/engineering-project-store.ts)                                                             | Tracked seed plus immutable active project revision store            |
| [`src/domain/engineering-project-command-service.ts`](../../src/domain/engineering-project-command-service.ts)                                             | Project transitions, authority, CAS and receipts                     |
| [`src/adapters/engineering-project-command-runtime.ts`](../../src/adapters/engineering-project-command-runtime.ts)                                         | MCP command runtime and exact evidence readers                       |
| [`src/adapters/validators/engineering-project-completion-evidence-validator.ts`](../../src/adapters/validators/engineering-project-completion-evidence-validator.ts) | Completion evidence existence and change gate                        |
| [`src/adapters/registered-project-run-executor.ts`](../../src/adapters/registered-project-run-executor.ts)                                                 | Server-owned dispatch for exact reviewed operations                  |
| [`src/orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts`](../../src/orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts) | Fixed CM-01 V3 operation catalog and evidence boundaries             |
| [`src/domain/cm01-v3-r11-closeout.ts`](../../src/domain/cm01-v3-r11-closeout.ts)                                                                           | Code-derived R11 to R12 requirement-family closeout                  |
| [`src/adapters/syson-model-seed-run-executor.ts`](../../src/adapters/syson-model-seed-run-executor.ts)                                                     | Fixed SysON project/document/root-package seed executor              |
| [`src/adapters/file-capture-store.ts`](../../src/adapters/file-capture-store.ts)                                                                           | One content-addressed capture engine, typed per evidence family      |
| [`src/adapters/file-syson-model-seed-attempt-store.ts`](../../src/adapters/file-syson-model-seed-attempt-store.ts)                                         | Write-ahead no-blind-retry state for non-idempotent SysON writes     |
| [`src/adapters/thread-snapshot-lineage.ts`](../../src/adapters/thread-snapshot-lineage.ts)                                                                 | Exact `previous`-chain ancestry proof                                |
| [`src/tools/project-control.ts`](../../src/tools/project-control.ts)                                                                                       | Agent MCP planning, elicitation, queueing, and bounded execution     |
| [`src/adapters/projectors/engineering-workbench-projector.ts`](../../src/adapters/projectors/engineering-workbench-projector.ts)                           | Project/thread presentation composition and alignment                |
| [`src/adapters/projectors/thread-workbench-projector.ts`](../../src/adapters/projectors/thread-workbench-projector.ts)                                     | Canonical-state to Workbench projection                              |
| [`src/ui/src/thread/`](../../src/ui/src/thread/)                                                                                                           | Native read-only lineage feed, graph, inspectors, and SSE client     |
| [`src/ui/src/project/`](../../src/ui/src/project/)                                                                                                         | Read-only project cockpit, notifications, dossier, and run journal   |
| [`src/ui/dist/console/index.html`](../../src/ui/dist/console/index.html)                                                                                   | Generated Console MCP App bundle                                     |
| [`scripts/console-browser-harness.ts`](../../scripts/console-browser-harness.ts)                                                                           | Loopback Console preview                                             |
| [`scripts/serve-native-workbench.ts`](../../scripts/serve-native-workbench.ts)                                                                             | Passive project/thread reads and SSE dossier BFF                     |
| [`scripts/materialize-coffee-machine-thread.ts`](../../scripts/materialize-coffee-machine-thread.ts)                                                       | Read-only CM-01 branch assembler                                     |
| [`scripts/run-coffee-machine-build.ts`](../../scripts/run-coffee-machine-build.ts)                                                                         | Explicit SysON to build123d MCP runner                               |
| [`scripts/attach-coffee-machine-build-run.ts`](../../scripts/attach-coffee-machine-build-run.ts)                                                           | Capture validation, canonical publication and reconciliation         |
| [`scripts/run-coffee-machine-mechanical.ts`](../../scripts/run-coffee-machine-mechanical.ts)                                                               | Archived bounded SysON to CAD to FEA verification runner             |
| [`scripts/run-coffee-machine-cm01-v3-correction.ts`](../../scripts/run-coffee-machine-cm01-v3-correction.ts)                                               | Explicit CM-01 V3 28 mm to 30 mm control-plane driver                |
| [`scripts/run-coffee-machine-cm01-v3-mechanical-r3-retry.ts`](../../scripts/run-coffee-machine-cm01-v3-mechanical-r3-retry.ts)                             | Bounded CM-01 V3 R3 mechanical recovery driver                       |
| [`scripts/recover-coffee-machine-cm01-v3-mechanical-r3-identity.ts`](../../scripts/recover-coffee-machine-cm01-v3-mechanical-r3-identity.ts)               | Provider-free R10 to R11 identity recovery                           |
| [`scripts/close-coffee-machine-cm01-v3-r11.ts`](../../scripts/close-coffee-machine-cm01-v3-r11.ts)                                                         | Provider-free R11 to R12 failed-work reconciliation                  |
| [`src/adapters/historical/coffee-machine-mechanical-run-extension.ts`](../../src/adapters/historical/coffee-machine-mechanical-run-extension.ts)                                 | Strict mechanical capture to canonical evidence projection           |
| [`scripts/attach-coffee-machine-mechanical-run.ts`](../../scripts/attach-coffee-machine-mechanical-run.ts)                                                 | Durable mechanical publication and live-feed reconciliation          |
| [`scripts/capture-syson-model-inventory.ts`](../../scripts/capture-syson-model-inventory.ts)                                                               | Explicit read-only SysON inventory capture                           |
| [`state/fixtures/`](../../state/fixtures/)                                                                                                                 | Explicitly labelled demo evidence                                    |
| `state/local/engineering-projects/`                                                                                                                        | Ignored immutable active project revisions and CAS claims            |
| `state/local/engineering-project-run-leases/`                                                                                                              | Empty local OS lock targets for one trusted run; not evidence        |
| `state/local/syson-model-seed-captures/`                                                                                                                   | Content-addressed normalized r2 container captures                   |
| `state/local/syson-model-seed-attempts/`                                                                                                                   | Recovery control state for uncertain SysON writes; not evidence      |

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

`deno task thread:assemble` reads the declared CM-01 manifest, the latest captured SysON
inventory, one persisted Modelica run, and reviewed ERPNext list/detail/balance
responses. It writes immutable local snapshots and an ERP capture; it does not start
CAD, FEA, Modelica, mutate SysON, or mutate ERPNext.

`deno task thread:run-coffee-machine-build` is the explicit execution path. It calls
SysON and build123d through backend MCP clients and appends redacted progress to
`state/local/live-thread-updates/`. `deno task thread:attach-coffee-machine-build`
validates the persisted capture, publishes the next immutable snapshot, then reconciles
that run's provisional feed nodes.

`deno task thread:run-coffee-machine-mechanical --run-id=<id>` audits only the exact
historical CM-01 run recorded with r6. It derives geometry, material, mesh, load, and
limits from the approved proposal, ensures the two model-owned DripTray constraints
exist, generates a content-addressed STEP, then runs the reviewed CalculiX-to-SysON
workflow through recorded backend clients. Its deterministic capture is written under
`state/local/coffee-machine-mechanical-runs/`. A same-ID retry is allowed only when
prior live activity is limited to the exact SysON constraint preflight for the same base
revision; any CAD, FEA, normalization, evaluation, reconciliation, unknown operation, or
existing capture fails closed. After the project run has explicitly entered
`publishing`, use `deno task thread:attach-coffee-machine-mechanical --run-id=<id>`.
That command fail-closes on authorization, effective arguments, constraints, provider
results and the exact STEP consumption hash; saves the immutable canonical snapshot;
reads it back; and only then reconciles the run's provisional feed nodes. It returns the
exact result snapshot and entity references needed for the separate MCP `completed`
transition, but never mutates the project lifecycle itself.

The completed local reference path for historical project `coffee-machine-cm01`
publishes thread r6
`coffee-machine-cm01:r6:coffee-machine-mechanical-run:erwan-authorize-cm01-mechanical-run-v1-extension`;
active project r10 records the same run and verification work item as `completed`. This
r5/r6 provenance remains required historical input for the distinct CM-01 V3 golden
path. Its proof boundary is the isolated concept DripTray, not the whole machine, a
fabrication release, or certification.

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
