# How-to: run the CM-01 V3 golden path locally

> **Evidence boundary.** This guide creates a fresh, local `coffee-machine-cm01-v3`
> project and runs only its reviewed, server-owned operations. It does not reuse a
> historical CM-01 project or provider identity, certify a coffee machine, or release a
> product to manufacture.

Use this guide when the paired agent should execute the current five-branch CM-01 V3
reference path against local providers and you want the existing Docker evidence to
remain intact.

The static [golden reference](../reference/cm01-v3-golden-reference.md) is the
comparison contract. It names the semantic outputs that a fresh project must expose:
`architecture-model`, CAD plan/script/STEP, nominal Modelica result, ERP BOM
observation, and one bounded DripTray mechanical STEP handoff. It is not an executable
recipe by itself.

## 1. Start an isolated provider topology

The ERPNext bridge observes the existing ERPNext service; this repository neither starts
nor resets that ERP database. Ensure its external Docker network exists before starting
the full path:

```bash
docker network inspect erpnext-docker_frappe_network >/dev/null
```

Choose a fresh, shell-local Compose project and Modelica volume. The explicit
`MODELICA_RUNS_VOLUME` matters: the default Modelica volume intentionally retains prior
run records. The Compose project name separately scopes the SysON database and the
shared CAD/CalculiX exports volume. This isolates data, not host ports: Compose binds
the fixed loopback ports `3009`, `3012`, `3014`–`3016`, and `8180`, so only one such
topology can run at a time.

For this V3 path, `syson_project_create` and the later SysON mutations must return
machine-readable `structuredContent`. The currently verified local sidecar is
`casys-engineering-toolchain:syson-0.5.2-local`; pass it explicitly so a routine Compose
command for CAD or CalculiX cannot silently replace it with the older shared image.

```bash
cm01_run="cm01v3-$(date +%Y%m%d%H%M%S)"
export COMPOSE_PROJECT_NAME="$cm01_run"
export MODELICA_RUNS_VOLUME="casys-${cm01_run}-modelica-runs"
export MCP_SYSON_IMAGE="casys-engineering-toolchain:syson-0.5.2-local"

docker compose config --quiet
docker compose up -d
docker compose ps
```

If an earlier local topology owns those ports, stop **that known Compose project** with
`docker compose --project-name <known-project> down` before starting this one. `down`
does not remove its volumes; do not add `-v`. Never delete an unknown project or a
volume merely to free a port.

Do **not** run `docker compose down -v`, delete `casys-digital-thread-modelica-runs`, or
remove a pre-existing Compose project as part of this run. To stop only this isolated
topology while retaining its new evidence for inspection, use:

```bash
docker compose down
```

`docker compose config --volumes` shows the precise volume names allocated to this
isolated run. The prior default volumes and any other Compose project are not targets.

## 2. Wait for the local MCP endpoints

SysON may need several minutes on Apple Silicon because its amd64 image is emulated. Do
not infer readiness from a running container alone.

```bash
deno eval '
for (const port of [3009, 3014, 3015, 3016, 3012]) {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) throw new Error(`MCP health failed on ${port}: ${response.status}`);
  console.log(`${port}: healthy`);
}
'
```

This is only a transport-health check. The real path below uses the backend MCP client
and server-owned operation executors; it does not substitute HTTP probes for MCP tools.

If a check fails, use `docker compose ps` and `docker compose logs <service>`; do not
reset a volume to make a provider look ready. See the
[workspace map](../reference/workspace-map.md) for ports and ownership.

## 3. Start the control plane and the passive cockpit

The control plane reads the fixed loopback MCP URLs from
[`config/mcp-fleet.json`](../../config/mcp-fleet.json). Start it in one terminal:

```bash
deno task start
```

Start the cockpit in another terminal:

```bash
deno task preview:cockpit --port=5175
```

Open <http://127.0.0.1:5175/>. It is a passive dossier and SSE activity feed: refreshing
it never runs a provider. The paired agent selects this new project with
`cockpit_focus_set` after creating it, so there is no human project selector yet.

## 4. Run the reviewed path through the paired agent

Tell the agent that this is a fresh `coffee-machine-cm01-v3` golden run. It must create
the project from the intent, guide and source the living brief, then obtain the required
human confirmations in the conversation. The agent uses these project-control tools:

```text
project_start → questions/brief → project_brief_confirm
→ project_plan_publish → project_agent_run_queue → project_agent_run_execute
```

It may append later work only from the exact resulting snapshot with
`project_change_append`. It cannot supply provider URLs, tool names, SysML, CAD Python,
Modelica source, ERP credentials, solver input, raw provider output, run IDs, or
evidence references.

The bounded sequence and its evidence are:

| Stage               | Registered operation                                | Fresh evidence it may claim                                         |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Documentary root    | `baseline.from-approved-brief@1`                    | Exact approved brief and reviewed plan only (r1)                    |
| SysON container     | `architecture.seed-syson-model@2`                   | Fresh SysON project/document/root identity (r2)                     |
| System architecture | `architecture.author-coffee-machine-cm01@1`         | Fixed CM-01 SysML architecture and read-back (`architecture-model`) |
| CAD                 | `design.build-coffee-machine-cm01-cad@1`            | Semantic CAD plan, generated script and exported STEP               |
| Thermal             | `simulate.coffee-machine-cm01-thermal-nominal@1`    | One fixed nominal Modelica scenario and its measurements            |
| Supply              | `industrialize.observe-coffee-machine-cm01-bom@1`   | Read-only ERPNext BOM observation                                   |
| Bounded proof       | `verify.coffee-machine-cm01-drip-tray-mechanical@1` | One DripTray STEP/CalculiX handoff and its narrow evaluations       |

CAD requires the exact architecture-model artifact in its basis. Thermal and ERP
observations remain observations; a successful simulation or a BOM read is not a product
verdict. The final mechanical proof is limited to its reviewed DripTray concept case.

An unknown outcome for a non-idempotent write or simulation fails closed. Retry only the
same agent execution command after inspecting the durable attempt/capture record; never
queue a substitute run merely to bypass the stop.

### Local integration fixture

For a repeatable local proof of the registered path, use the dedicated harness. It is
inert by default and writes no state or provider call until it receives both flags. Its
brief approval is deliberately labelled as a local fixture and never substitutes for a
paired-conversation human approval.

```bash
deno task thread:run-coffee-machine-cm01-v3-local

deno task thread:run-coffee-machine-cm01-v3-local --execute \
  --acknowledge=EXECUTE_CM01_V3_LOCAL_RUN
```

Each executing invocation creates a new, immutable directory under
`state/local/cm01-v3-local-runs/`; it refuses an existing output directory and never
reads an earlier one as a fallback.

If every provider branch completed but the final static projection was interrupted, do
not rerun providers. Finalize that one explicit directory instead:

```bash
deno task thread:finalize-coffee-machine-cm01-v3-local \
  --output-dir=state/local/cm01-v3-local-runs/<completed-run>
```

The finalizer has no MCP client and does not discover a latest run. It reads only that
directory's persisted project and its uniquely declared final ThreadSnapshot, then
creates `golden-observation.json` and `run-summary.json`. Existing derived files must be
byte-for-byte identical; it never overwrites them. It cannot repair a missing or
incomplete provider branch.

### Bounded correction-loop proof

Before running a changed design through providers, the repository has one deliberately
inert proof for the reviewed DripTray height correction (`28 mm → 30 mm`):

```bash
deno task thread:verify-coffee-machine-cm01-v3-correction-loop
```

It reads the reviewed 28 mm proof case and a small correction declaration, makes zero
provider calls and writes no state. In memory it requires a new snapshot provenance for
the design input, CAD plan/script/STEP, and CalculiX result; retains the corresponding
28 mm artifacts as `stale`; and rejects a structurally valid negative control that
attempts to relabel the old CAD/CalculiX descendants as fresh. Modelica and ERP evidence
remain unchanged, because this correction does not declare them as dependents.

This is a traceability and invalidation proof, not a 30 mm simulation result. It does
not compare invented new measurements with the V3 golden reference, publish a project
change, or establish that a future provider run is safe, certified, or releasable.

### Bounded R3 mechanical recovery

If — and only if — the canonical CM-01 project is at the recorded R9 recovery boundary
after the failed `verify.coffee-machine-cm01-drip-tray-mechanical@2` attempt, the R3
recovery has its own reviewed operation and its own immutable proof configuration. The
failed R2 attempt stays visible as a failed run; it is never requeued, deleted, or used
as fallback evidence.

With the control plane running, inspect the failure first. Then invoke the dedicated,
inert-by-default MCP driver only after the R3 operation has been registered by the
server:

```bash
deno task thread:retry-coffee-machine-cm01-v3-mechanical-r3

deno task thread:retry-coffee-machine-cm01-v3-mechanical-r3 --execute \
  --acknowledge=EXECUTE_CM01_V3_MECHANICAL_R3_RETRY
```

The driver reads `project_snapshot` through MCP and refuses before mutation unless the
project is the approved canonical V3 project at r9, the correction and CAD@2 runs are
completed, the exact mechanical@2 run is failed without evidence, and no R3 retry has
already been appended. It then appends one new R3 work item with the r9 correction and
CAD STEP references, queues it, and executes only the registered
`verify.coffee-machine-cm01-drip-tray-mechanical@3` operation. A successful result must
publish exactly r10 with one artifact evidence reference. It is still an isolated
DripTray concept proof, not a whole-machine certification or release.

### Recorded R10 → R11 identity recovery

The recorded R10 result is not a second solver run. It is a retained completed R3
capture whose artifact identity was labelled as R2. If — and only if — the project is at
that exact R10 boundary, repair the identity through its dedicated, inert-by-default MCP
driver:

```bash
deno task thread:recover-coffee-machine-cm01-v3-mechanical-r3-identity

deno task thread:recover-coffee-machine-cm01-v3-mechanical-r3-identity --execute \
  --acknowledge=RECOVER_CM01_V3_MECHANICAL_R3_IDENTITY
```

This requires the control plane on `127.0.0.1:3020/mcp`, but invokes no engineering
provider. It appends one registered identity-recovery work item, queues and executes it
through the normal project-control boundary, then publishes the correctly identified R3
successor as R11. The malformed R10 record remains immutable, visible, and explicitly
superseded; it is never overwritten, aliased, or presented as new mechanical evidence.

### R11 → R12 requirement-family closeout

R11 restores the exact R3 solve identity, but a corrected path also needs current
requirements and evaluations rather than a reused historical verdict. The final closeout
is deliberately a separate provider-free operation over already persisted local state:

```bash
deno task thread:close-coffee-machine-cm01-v3-r11

deno task thread:close-coffee-machine-cm01-v3-r11 --execute \
  --acknowledge=CLOSE_CM01_V3_R11_REQUIREMENT_FAMILY
```

The command has no MCP client, network request, or provider invocation. It requires the
exact R11 completed successor and the retained R2 attempt with no evidence. It writes a
direct R12 child that records the R1/R2/R3 requirement-family supersession links, reads
it back, then reconciles the project state. The R2 **run remains `failed` and
evidence-free**. Its work item becomes `cancelled` only with an explicit
`superseded-by-successor` reconciliation that cites the completed R3 run, its exact
evidence, and R12; it is never relabelled as a successful R2 execution.

This closes the bounded CM-01 V3 correction dossier only. It does not rerun a solver,
verify the whole CoffeeMachine, authorize fabrication, or establish certification.

This harness is an isolated integration proof. Its project, snapshots, and live feed do
**not** appear automatically in the Cockpit: the Cockpit intentionally reads only the
canonical control-plane stores and the project selected through `cockpit_focus_set`. An
explicit, validated import would be required before a fixture result could become
canonical project evidence.

## 5. Read the results

For a project executed through the control plane, the Cockpit shows the current stage,
live feed, linked evidence and each provider facet. It is the first place to review what
the agent did while it ran. The isolated local fixture above is inspected from its own
run directory instead.

For durable, file-level inspection, the server owns these local records:

| Location                                                               | Contents                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `state/local/engineering-projects/coffee-machine-cm01-v3/`             | Immutable project revisions, work and run receipts                                               |
| `state/local/thread-snapshots/`                                        | Immutable canonical V3 evidence snapshots                                                        |
| `state/local/live-thread-updates/`                                     | Browser-safe live milestones; not canonical evidence                                             |
| `state/local/coffee-machine-cm01-v3-architecture-{attempts,captures}/` | SysON write-ahead state and normalized architecture read-back                                    |
| `state/local/cm01-semantic-cad-{attempts,captures}/`                   | CAD export recovery state and normalized capture                                                 |
| `state/local/cm01-nominal-modelica-{attempts,captures}/`               | Modelica recovery state and normalized capture                                                   |
| `state/local/cm01-erpnext-bom-{captures,run-captures}/`                | Read-only BOM capture and per-run binding                                                        |
| `state/local/cm01-drip-tray-mechanical-{attempts,captures}/`           | Bounded mechanical proof recovery state and capture                                              |
| `state/local/cm01-v3-local-runs/<timestamp>/`                          | One isolated harness project, its normalized captures, live feed, golden observation and summary |

The Modelica sidecar keeps its provider-native run record in the fresh volume selected
in step 1. The CAD and CalculiX containers share only this run's Compose-scoped
`exports` volume. A shared path is not provenance: the canonical snapshot retains the
exported STEP hash and the exact hash consumed by CalculiX.

## 6. Compare a completed run with the golden contract

The comparison gate deliberately reads a normalized projection; it does not call MCP,
join provider records by display name, or make a historical result executable. The local
harness writes that projection as `<run>/golden-observation.json`; a paired agent can
produce an equivalent reviewed projection from its completed V3 evidence. Then run:

```bash
deno task thread:verify-coffee-machine-cm01-v3-golden \
  --observation=<normalized-v3-observation.json>
```

The command returns `matches: true` only when the required semantic roles, producers,
units, measurements, and exact mechanical STEP/consumption attestation satisfy the
reference. ERP stock is intentionally not compared because it changes over time.

This is completion of the **original golden integration comparison**, not completion of
the whole CM-01 engineering project. It deliberately describes the original bounded
DripTray case. If a reviewed design correction has created a new CAD/CalculiX successor,
keep this matching golden observation as historical evidence and close the corrected
path with its own current requirements, observations, evaluations and project-plan
records. Do not feed the corrected result to this comparator by weakening or editing the
historical reference.

## The sensitivity study step

The runner ends with `analyze.coffee-machine-cm01-drip-tray-size-z-sensitivity@1`: the
same CAD → STEP → CalculiX chain runs twice, at the reviewed base height and at base +
step, and publishes the finite-difference derivatives with composed units (mm/mm,
MPa/mm) and their neighbourhood. Everything that shapes the study — parameter, base
value, step, mesh, material, load and selection boxes — comes from the reviewed case in
[`config/sensitivity-cases/`](../../config/sensitivity-cases/); nothing is chosen by
code at run time, and the executor refuses a case whose base value does not match the
reviewed recipe.

A sensitivity result is data, never a verdict. The published derivative satisfies no
requirement by itself; its declared limitations state that remeshing variation is
included and that the derivative is local to its neighbourhood. Its purpose is to make
correction proposals citable — "raise size-z by 2 mm because ∂displacement/∂size-z is
measured at this value around 30 mm" — instead of guessed.

Two operational pitfalls the acceptance run of 2026-08-04 hit — both are consequences of
running against the _default_ topology instead of the isolated one that section 1
prescribes:

- the shared SysON image answers in JSON-in-text rather than `structuredContent` (hence
  the pinned `MCP_SYSON_IMAGE` above). The backend client now accepts both shapes and
  rejects anything else, as `structuredContent` is optional in the MCP specification —
  but pinning the image remains the reviewed configuration;
- the default Modelica volume retains prior runs and the store caps them at 20 with no
  archive tool (hence the fresh `MODELICA_RUNS_VOLUME` above). If the cap is reached on
  the default volume, archive the `run_*` directories out of the top level (for example
  into `/runs/.archive-<date>/` inside the volume, plus a `docker cp` copy under
  `state/local/archives/`) before starting new simulations.

## What this does not prove

This local run demonstrates a traceable engineering chain. It does not prove that the
whole machine is safe, manufacturable, compliant, certified, economically viable, or a
digital twin of physical hardware. Those claims need their own reviewed requirements,
models, scenarios, evidence and, where applicable, external assessment.
