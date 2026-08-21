# Reference: workspace map and local ports

Audience: both · Diátaxis: reference · Kind: contract

Where things run, and which page owns the file census.

| Need | Page |
| ---- | ---- |
| File census, CAS roots, isolation spine | [workspace source map](workspace-source-map.md) |
| Admitted CAD/Modelica microVM pattern | [admitted source isolated execution](../pipeline/admitted-source-isolated-execution.md) |
| Agent tools, operations, grants | [agent workspace](../agent/agent-workspace.md) |
| Lookalike pairs | [lookalike traps](../agent/lookalike-traps.md) |
| Loopback ports, YOLO, runtime ownership | this page |

## Local YOLO approval mode

The ordinary `deno task start` composes no local Build123d, Modelica or CalculiX review
or runtime. Local execution is an explicit CLI capability: `server.ts` accepts the
valueless `--local-execution` flag and rejects lookalikes such as
`--local-execution=true`. The flag is effective only on the loopback project surface.
The permission-bearing task for all three fixed local runtimes keeps interactive MRTR:

```bash
deno task start:local
```

For supervised loopback automation, the dedicated task combines the same local runtime
opt-in with the separate local-YOLO approval opt-in:

```bash
deno task start:yolo
```

`start:local` expands to `server.ts --local-execution`; `start:yolo` expands to
`server.ts --yolo --local-execution`. Both tasks provide the native Microsandbox package
read/FFI permissions, an explicit environment allowlist and
`--no-prompt --frozen --node-modules-dir=auto`. The flags select no image, policy,
limit, command, path, network rule or backend; those remain fixed in code. The Build123d
profile fixes the 0:0 supervisor and 65532:65532 child, 30 s wall/25 s requested CPU, 1
GiB memory, 32 requested processes, 64 KiB per log and 128 MiB per-file/total output
ceilings. CPU and process count remain unattested. The Console process retains host
network/Docker permissions for its existing private MCP provider fleet and CalculiX's
separate SysON oracle, but those permissions are not inherited as guest capabilities:
each local microVM is reread as network-disabled and exposes neither the Docker socket
nor provider volumes.

The focused local gate exercises the same stateless HTTP surface against a temporary
durable project store:

```bash
deno task verify:yolo:local
```

It creates and rereads one approved brief and one approved decision, checks the fixed
human YOLO origin in the approval records and command receipts, then removes its
temporary state. That focused approval gate itself does not execute Build123d.

`--yolo` is accepted only when the effective MCP hostname is an explicit loopback
hostname; a non-loopback binding is rejected before startup. The startup-owned gate
table auto-confirms positive `project_brief_confirm`, `project_decision_approve`, queued
and `project_agent_run_cancel`. Those paths
still call the canonical command services and persist the fixed origin
`{ kind: "human", actorId: "local-yolo:startup-opt-in" }` plus an explicit YOLO
rationale; they do not fabricate an MCP elicitation response.

This mode does not auto-reject and it does not satisfy a human-only execution
interaction. It also does not bypass compilation admission, qualified execution
profiles, local microVM isolation, WAL/recovery, content hashing, output validation,
cleanup or canonical-promotion review. It is an approval-loop convenience, not an
execution or evidence shortcut; no environment variable enables it implicitly.

## Local endpoints

| Endpoint                     | Owner                       | Purpose                                                                                                                                                                            |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http://127.0.0.1:8180`      | SysON                       | SysML web modeler                                                                                                                                                                  |
| `http://127.0.0.1:3009/mcp`  | `mcp-syson`                 | Model, constraints and evaluations                                                                                                                                                 |
| `http://127.0.0.1:3012/mcp`  | `mcp-erpnext`               | Provider-native ERP data                                                                                                                                                           |
| `http://127.0.0.1:3014/mcp`  | `mcp-build123d`             | Historical recipe CAD execution and shared exports                                                                                                                                 |
| `http://127.0.0.1:3024/mcp`  | `mcp-build123d-sandbox`     | Legacy agent-proposed geometry preview, private export volume                                                                                                                      |
| `http://127.0.0.1:3015/mcp`  | `mcp-calculix`              | Static, modal, buckling, creep and coupled-thermal FEA; identity-bound recorded static runs                                                                                        |
| `http://127.0.0.1:3016/mcp`  | retired                     | Historical `mcp-modelica` Compose sidecar. Product Modelica is the local microVM (admitted + kit). Do not start or probe this port.                                                |
| `http://127.0.0.1:3018/mcp`  | `mcp-dfm`                   | Measured DFM checks on produced STEP (`dfm_check_envelope`, `dfm_check_min_thickness`, `dfm_check_overhangs`); SHA-256 attestation required. Live tools take `step_path`, not STL. |
| `http://127.0.0.1:3019/mcp`  | `mcp-tolerance`             | ISO 286-1 fits and 1D stack-ups                                                                                                                                                    |
| `http://127.0.0.1:3022/mcp`  | `mcp-prusaslicer`           | Print time and material from real G-code                                                                                                                                           |
| `http://127.0.0.1:3023/mcp`  | `mcp-spice`                 | ngspice operating points and transients                                                                                                                                            |
| `http://127.0.0.1:3020/mcp`  | `deno task start`           | Fleet reads plus agent project control                                                                                                                                             |
| `http://127.0.0.1:3021/`     | retired                     | Former Console MCP App harness; `preview:browser` now refuses                                                                                                                      |
| `http://127.0.0.1:5175/`     | `deno task preview:cockpit` | Read-only BFF (API/SSE) and built cockpit HTML + hashed JS/CSS                                                                                                                     |
| `http://127.0.0.1:5173/`     | `deno task preview:thread`  | Vite HMR cockpit; proxies `/api` to the BFF on :5175                                                                                                                               |
| `/api/draft-assets/<sha256>` | BFF (native Workbench)      | Read-only geometry draft bytes; 404 if absent or hash-mismatched; Cache-Control: no-store                                                                                          |

Docker Compose starts the provider topology only. Product composition occurs in the
backend workflow and linked state, not in the container orchestrator.

## Server-park naming convention

One MCP server wraps exactly one engine, and the server's name states what kind of
contract the caller signs. Three naming rules coexist, and the choice between them is
informative, not stylistic:

| Rule                  | When it applies                                                                                                     | Examples                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Exact engine name** | The input contract is specific to that engine — its scripts, profiles or flags would not transfer to a competitor   | `mcp-calculix`, `mcp-build123d`, `mcp-prusaslicer`                       |
| **Standard language** | The input is a format several engines speak; the wrapped implementation is an internal detail the caller never sees | `mcp-spice` (ngspice). Historical `mcp-modelica` (OpenModelica) was the retired port 3016 sidecar |
| **Domain**            | No single dominant library exists — the engine is normative formulas or in-house computation                        | `mcp-dfm` (gmsh + in-house checks), `mcp-tolerance` (ISO 286-1 formulas) |

Corollaries: tool names are prefixed with the server name (`prusaslicer_estimate_fff`,
never a generic `slicer_*`); a second engine in the same domain is a second server, not
a second backend inside the first (a CuraEngine wrapper would be `mcp-curaengine`, not
an option on `mcp-prusaslicer`); and renaming after a JSR release deprecates a package,
so the naming decision is made before first publication.

The four standalone engineering-capability servers (`mcp-dfm` 3018, `mcp-tolerance`
3019, `mcp-prusaslicer` 3022, `mcp-spice` 3023) are wired into the workshop compose
topology and the fleet manifest since 2026-08-05, each pinned to its published
multi-arch `ghcr.io/casys-ai/*` image digest. Wiring in the manifest declares the
desired state only — the MCP and Docker probes remain the execution truth, including
when they answer `unavailable`. The same images also carry a `stdio` entrypoint mode
used by the Docker MCP Catalog submissions; the workshop always talks to them over
stateless HTTP.

These servers are not four instances of an “oracle” server kind. PrusaSlicer and ngspice
wrap execution engines; DFM and tolerance expose domain calculations that may later
support separately reviewed evaluation methods. For native-source or runtime artifact
acquisition, provider MCP resources must be read-only and identity-bound: the URI or
tool input names an immutable model, scenario, profile, case or run identity, and the
response supplies media type, byte count and independently verified SHA-256. A mutable
alias such as `latest` cannot become capture evidence or authority.

`config/mechanical-proof-cases/` contains reviewed declarations using the generic
`mechanical-proof-case/1.0` form. A declaration is candidate input for review: it
neither authorizes execution nor attests effective provider arguments or results. See
the [candidate mechanical-analysis declaration](../contracts/mechanical-proof-case.md) reference for
the distinct proof-seal and execution-admission contracts.

Since the mechanical verdict moved to a separate evaluation step, a loaded proof case
supplies the _limits_, never the pass/fail decision. `syson_constraint_evaluate` renders
the verdict, and `error` and `unresolved` reach the published snapshot unchanged.

The Console MCP server and native Workbench entry point reject non-loopback hostnames.
Loopback is a deployment guard, not user authentication. Human confirmation flows use
the paired MCP host and still require a real authentication policy before multi-user
deployment.

`deno task preview:thread` injects `--workspace-id=primary` and follows the durable
cockpit focus. Pass `--project-id=` only to pin a vehicle; that disables focus follow.
Without a focus and without a pin, it reports awaiting project context. It never seeds
or falls back to retired evidence. Browser project GET and SSE requests remain passive.
The Workbench has no POST or command surface. Every command and signed decision stays in
the paired MCP conversation, so the cockpit exposes no project mutation or provider-call
surface.

`deno task start` exposes the MCP project surface used by the paired agent. Agents can
inspect the same active project, propose an input, elicit an exact human decision in the
conversation, queue a ready registered work item, and execute only that server-derived
run. Agents cannot confirm their own proposal or choose arbitrary provider calls. New V3
projects are created from first intent and the server-owned baseline executor creates
the immutable,
pre-technical approved-brief r1. The provider-backed `architecture.seed-syson-model@2`
executor accepts only that exact r1 and its brief-bound project-change lineage, then
uses fixed SysON calls to create a blank project, document, and root package; it reads
the root back, normalizes its identities into `syson-model-seed-capture/2.0`, and
publishes r2. The signed MRTR is the closed seed grammar (`seed.schemaVersion`,
`seed.scope`, `seed.operation`, `model.name`); the executor still derives provider names
from `project.project.name` and the run id and does not consume those parameters.
Callers supply no arbitrary arguments or SysML text; uncertain writes are not blindly
retried. r2 remains a container identity, not an architecture, requirements, CAD,
simulation, measurement, or verdict. The seed work item must name the documentary
baseline in `dependsOnWorkItemIds`; `project_change_append` refuses the omission. The
executor keeps the same check for historical work items accepted before that guard.

From that exact technical basis, the generic route can execute further reviewed
contracts. `model.write-architecture@1` renders and verifies one human-approved SysML
architecture proposal and inserts it into SysON. `model.seal-architecture-sysml@1` is
the provider-free sibling: it seals one agent-authored closed-subset analysis as a
Thread document and never calls SysON. `model.write-requirements@1` renders and
re-extracts human-approved integer scalar constraints against an exact architecture
basis; decimal literals are rejected before SysON until the provider can round-trip
`LiteralRational`. The legacy `design.write-geometry@1` seals the hashes from a
separately previewed and human-approved MCP sandbox draft; it never re-executes
build123d. The isolated sibling is `compile.seal-admission@1` then
`design.execute-build123d@1`, which publishes a documentary capture and a noncanonical
draft only. These operations are product-independent but deliberately bounded: they do
not provide a generic simulator, measurement source, requirement evaluator,
manufacturing decision, or certification verdict.

Lookalike traps for agents: [lookalike traps](../agent/lookalike-traps.md).

The legacy generic geometry boundary separates preview from seal, and it separates two
_natures of execution_ across two instances of the same MCP provider. `mcp-build123d`
only ever runs server-fixed recipes rendered from reviewed code, and mounts the shared
`exports` volume. `mcp-build123d-sandbox` runs geometry programs _proposed by an agent_
and owns a private `build123d-sandbox-exports` volume, so a proposed program can never
write into the evidence volume that other providers read. This matters because a SHA-256
fingerprint proves the identity of bytes after sealing, not their causal provenance: a
write landing in the shared volume before its producer computes the hash would make the
wrong hash the expected one, and every downstream consumer would then authenticate the
wrong bytes perfectly. The server lifts sandbox bytes out with `docker compose cp` plus
fail-closed SHA-256 verification, exactly as it does for attested assets.

`project_admitted_geometry_export` (composed when the `build123d-sandbox` fleet entry is
configured) reopens a sealed admission and calls `build123d_export` on the sandbox
instance. It attests each binary's SHA-256 and stores the draft JSON capture, stamped
with the admission identity, in `state/local/geometry-draft-captures/` with the raw
binaries under `state/local/geometry-draft-assets/<digest>`. `project_geometry_preview`
is not registered. V1 is the assembly-only call. V2 validates the declared bundle's
complete identity/source contract first, then makes one run-scoped assembly call plus
exactly one call per unique PartDefinition; repeated PartUsages reuse the definition
export. The later seal rereads the architecture capture to prove that declaration
exhaustive. A placement is local to the PartDefinition that owns its PartUsage, so
parent reuse repeats that placement on each expanded path. The preview returns a
`draftDigest` and the flat `decisionParameters` for an MRTR proposal. The Workbench BFF
recomputes the requested digest before serving these binaries at
`/api/draft-assets/<digest>` (read-only, `Cache-Control: no-store`). Nothing from this
path enters a `ThreadSnapshot`. Only `design.write-geometry@1` can promote a draft: it
requires a matching fresh MRTR decision with `decidedByOrigin === "human"`, an exact
architecture snapshot/revision, and the true provider basename (`gltf` maps to binary
`.glb`). V2 also requires exact coverage of every captured PartUsage and distinct
targeted PartDefinition, authoritative STEP for assembly and definitions, and a unique
predecessor when geometry already exists. It verifies every SHA-256 and writes a sealed
geometry capture plus context-specific binary artifacts into the evidence thread. The
Product catalog rereads the active capture and projects exact `digital-thread/artifact`
bindings to those STEP artifacts; it never relabels sandbox evidence as provider
`build123d`. The monotony ratchet (`geometry_artifact_removed`) then prevents a later
snapshot from silently omitting that artifact. The write executor makes no provider
calls — it seals bytes already present in the draft store.

This MCP path and its project items/state have not been migrated into the local
Microsandbox execution contract. They remain readable and operational where configured;
no removal, replacement of historical authority, or automatic promotion from one path to
the other is claimed.

The bounded `inspection-drone-v4` path adds a separate read-only successor after its
qualitative r3 architecture: `model.capture-inspection-drone-part-definitions@1` reads
only the six attested SysON PartDefinitions and their five root usages from the exact
content-addressed architecture artifact. It stores one replay-safe bundle in
`inspection-drone-v4-part-definitions-captures` and the Workbench derives the root and
five children only from that bundle. It neither writes SysML nor infers a CAD, physical,
manufacturing, certification, cost, or un-attested quantity.

## Runtime ownership

| Data                         | Owner                             | Workspace access                                                                                      |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SysML and requirements       | SysON                             | Private provider MCP plus operation WAL/readback; outside local microVM isolation                     |
| Local Build123d execution    | Microsandbox microVM + DT broker  | Exact admitted bytes in; declared output handles out; no repository, secrets or canonical volumes     |
| Local Build123d output       | Recorded-analysis output CAS      | Publication-gated private STEP plus byte-free receipt; noncanonical and absent from Thread artifacts  |
| CAD exports                  | `exports` volume                  | Hash-attested build123d to CalculiX read-only exchange                                                |
| Generic FEA staging          | CalculiX `calculix-inputs` volume | Digital Thread writes content-addressed STEP bytes; provider-private, non-authoritative, not evidence |
| CalculiX recorded runs       | `calculix-runs` volume            | Identity-bound `calculix_run_get` plus exact `resources/read`; separate from CAD exchange             |
| Modelica execution           | Local Modelica microVM            | Admitted closed-subset and qualified kit via `casys/modelica-microsandbox-worker`. Port 3016 sidecar and `modelica-runs` volume are retired |
| ERP data                     | External ERPNext database         | Provider-native MCP from backend only                                                                 |
| Native `ThreadSnapshot`      | Immutable local file store        | Read-only projection in the native Workbench                                                          |
| `EngineeringProjectSnapshot` | Immutable active file store       | Intent, living brief, exact reviews, bounded runs and evidence references; CAS revisions              |
| Live engineering activity    | Append-only local JSONL           | SSE projection; never canonical authority                                                             |

The Console browser harness forwards only reviewed Console tools. It is not a generic
MCP proxy. The native browser receives ordinary linked JSON and no MCP credentials.
