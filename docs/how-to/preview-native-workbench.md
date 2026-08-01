# How-to: preview the native digital-thread Workbench

Use this guide to inspect the single-shell Preact cockpit against two linked truth
surfaces:

- the project objective, phases, work, decisions and blockers declared by an immutable
  `EngineeringProjectSnapshot` under `config/projects/`;
- the persisted technical evidence projected from exact canonical `ThreadSnapshot`
  revisions under `state/local/thread-snapshots/`.

The read-only backend-for-frontend (BFF) joins both surfaces. Opening the page never
starts an engineering tool.

## Prepare the clean CM-01 baseline

Install the UI dependencies once:

```bash
npm --prefix src/ui ci
```

The repository includes one domain-validated observed baseline specifically so preview
does not require local state or a running provider. When deliberately producing new
evidence, `deno task thread:assemble` reads the workspace-declared identity manifest,
captured SysON inventory, one persisted Modelica run, and reviewed ERPNext reads. It
writes successive immutable canonical documents under `state/local/thread-snapshots/`;
an explicit build run then adds the reviewed whole-machine CAD branch. See
[the assembly how-to](assemble-coffee-machine-thread.md) for that execution and
publication sequence.

The current clean baseline ends at:

```text
coffee-machine-cm01:r5:coffee-machine-build-coffee-machine-cm01-cad-baseline-extension
```

It contains CM-01 SysON, Modelica, ERPNext and whole-machine CAD evidence. It contains
no legacy support-bracket attachment and no claimed CalculiX result. It reports
`requirements: 0` and `verdict: unavailable-no-model-owned-mechanical-criterion`; this
is expected because the live CoffeeMachine model has no approved mechanical
`ConstraintUsage`.

[`config/projects/coffee-machine-cm01.project.json`](../../config/projects/coffee-machine-cm01.project.json)
anchors project work and decisions to that exact baseline. It never uses a `latest`
alias. If you deliberately rebuild CM-01 and publish another canonical revision, create
a new reviewed project snapshot referencing the new exact ID; do not silently edit old
evidence references in place.

The capture itself and its lossless STL transport live under
`config/projects/baselines/`. Both are labelled observed integration evidence, not a
fixture and not proof that any provider is currently online. Active local snapshots and
assets have read priority; the checked baseline is used only when the requested exact ID
or filename is absent locally.

## Start the read-only BFF

```bash
deno task preview:thread
```

The task builds the dedicated single-file Preact shell and starts the Deno BFF at:

```text
http://127.0.0.1:5173/
```

No Docker service, Console MCP server, MCP Apps host, or provider MCP is required to
read an already persisted project and thread. Refreshing the page performs one ordinary
HTTP GET and opens one same-origin server-sent event stream. Neither path reruns
assembly, build123d, CalculiX, or Modelica. Provider MCP calls happen only in an
explicit backend runner such as `deno task thread:run-coffee-machine-build`.

## Inspect the truth boundary

```bash
curl -i http://127.0.0.1:5173/api/thread/workbench
```

The response header must contain:

```text
X-Casys-Data-Source: canonical-thread-snapshot
```

While an engineering run is waiting for canonical publication, the value is
`canonical-thread-snapshot+live-updates`.

The JSON document is one atomic browser read model:

```json
{
  "schemaVersion": "engineering-workbench/0.1",
  "project": {
    "schemaVersion": "1.0",
    "project": { "id": "coffee-machine-cm01" },
    "phases": [],
    "workItems": [],
    "agentRuns": [],
    "decisions": [],
    "approvals": [],
    "blockers": []
  },
  "thread": {
    "schemaVersion": "thread-workbench/0.1",
    "source": "observed",
    "live": { "schemaVersion": "live-thread-overlay/1.0" }
  },
  "alignment": {
    "status": "aligned",
    "projectThreadRevision": 5,
    "currentThreadRevision": 5
  }
}
```

The abbreviated arrays above describe shape only; the real response contains the full
validated project and technical projection. `alignment.status` is:

- `aligned` when the current technical head is the exact revision referenced by the
  project;
- `thread-ahead` when a newer technical revision exists but project decisions still
  refer to an older exact input. The cockpit shows the newer evidence and names the lag;
  it never pretends that existing decisions were made against it.

Before serving either state, the BFF resolves every declared project snapshot by exact
ID and validates its entity references. A missing exact snapshot fails closed; it is
never replaced by the latest available document.

The live read path is:

```bash
curl -N http://127.0.0.1:5173/api/thread/workbench/events
```

It emits a complete `engineering-workbench/0.1` replacement as `event: thread-snapshot`.
Event IDs are:

```text
<project-revision>:<thread-revision>:<live-sequence>
```

This means a persisted project decision, a canonical technical publication, or a
provisional MCP result can each update the cockpit. Canonical publication replaces the
provisional nodes in place. Reconnecting with `Last-Event-ID` replays no tool call and
never exposes a partial graph delta.

The projection must show:

- source `observed`, not `fixture`;
- exact producer and consumed SHA-256 values for every claimed CAD handoff;
- the canonical whole-machine STEP after an explicit build run is attached;
- SysON, Modelica, and ERPNext bootstrap branches, plus build123d and CalculiX only
  after their explicit runs are published;
- zero requirements and an unavailable verdict, not a successful one.

The page opens on **Overview**, which answers what CM-01 is trying to achieve, where the
project is, what is happening now, what can happen next, and what needs a human
decision. The five product sections have distinct jobs:

- **Overview** — objective, derived phase gates, current work, next work, blocker,
  decision and routes into technical proof;
- **Work** — shared human-agent plan plus the live lineage feed. The feed exposes
  actions and outcomes, never private chain-of-thought;
- **Product** — one physical component traversed across its SysON, build123d and ERPNext
  identities;
- **Verification** — full evidence graph, causal impact, requirements, verdicts and
  named violations;
- **Operations** — agent-run journal, declared work items and engineering systems that
  contributed evidence.

In **Work**:

- leave **Follow live** enabled so a newly persisted fact becomes active automatically;
- read the active card's complete inline subgraph as upstream evidence → selected fact →
  downstream impact;
- pause following or select an older card only when revisiting history;
- select an edge to inspect its typed relation, rationale, and any hash attestation;
- switch between **Tool context** and **Exact record** in the right drawer;
- open **Graph** for the complete subject graph and **Show all evidence** only when
  implementation artifacts and consumption proof nodes are needed;
- treat separate component frames as missing causal links, not layout errors.

Use **Product** when navigation starts from a physical component instead of a thread
event:

- select a PartUsage in the SysON structure, then switch to ERPNext without losing the
  selected component;
- read the exact provider IDs in the trace strip and open their canonical evidence in
  the right inspector;
- select the root **CoffeeMachine CM-01**, then **build123d**, to orbit the real STL
  display mesh; every reviewed child keeps its own exact assembly identity;
- treat `Unlinked facet`, `TRACE GAP`, and `UNLINKED` literally. They mean that the
  current snapshot has no reviewed provider identity for that component;
- distinguish the STL display hash from the authoritative STEP SHA-256 shown below the
  viewer.

The project declaration is loaded and domain-validated from
`config/projects/coffee-machine-cm01.project.json`. The component declaration is loaded
from `config/thread-subjects/coffee-machine-cm01.components.json`. The ERP identities
are backed by the persisted full `erpnext_bom_get` document, not by the BOM-list header.

The local snapshot records its exact provider revisions and capture timestamps. Treat it
as integration evidence unless those provider revisions are released and reproduced in
the target environment.

## Know what this slice proves

It proves durable project and canonical-thread validation, exact project-to-evidence
references, explicit provider-to-subject and component identity, persisted Modelica
observations and ERPNext BOM detail, a read-only BFF, and one coherent native UI with
shared selection and no nested Apps. When a FEA branch exists, its exact CAD consumption
must be attested before projection.

It does **not** prove:

- a new solve at preview time;
- a model-owned mechanical requirement or compliance verdict;
- the SysON evaluation and correction loop;
- a browser execution API. The BFF intentionally exposes reads and SSE only; explicit
  backend runners own provider MCP calls.

The assembly groups independent branches under a reviewed CM-01 identity; it does not
manufacture causal links between the CAD, thermal, ERP, or future FEA branches.

## Compare the preview paths

| Command                     | Address                  | Purpose                                      |
| --------------------------- | ------------------------ | -------------------------------------------- |
| `deno task preview:thread`  | `http://127.0.0.1:5173/` | Native product shell over persisted evidence |
| `deno task preview:browser` | `http://127.0.0.1:3021/` | Console MCP App against the Console server   |

MCP Apps remains useful for one rich tool result or for embedding the complete Workbench
once in an agent host. It is not used to compose the first-party product page.

## Stop the preview

Press `Ctrl-C` in the BFF terminal. Stopping it does not affect Docker, engineering
services, Console state, or persisted Modelica runs.
