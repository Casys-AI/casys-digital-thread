# How-to: preview the native digital-thread Workbench

Use this guide to inspect the single-shell Preact cockpit against the distinct truth
surfaces it can render:

- the project objective, living brief, phases, work, decisions and blockers declared by
  immutable active `EngineeringProjectSnapshot` revisions under
  `state/local/engineering-projects/`;
- for a new V3 project, its living brief from first intent, then the immutable
  documentary r1 of its exact approved brief and reviewed path;
- the persisted technical evidence projected from exact canonical `ThreadSnapshot`
  revisions under `state/local/thread-snapshots/`.

The backend-for-frontend (BFF) chooses the applicable surface; it does not blend a
documentary record into an empty technical graph. Its `GET` and SSE paths are passive:
opening the page never starts an engineering tool. The cockpit has no command path;
human intent and consequential decisions stay in the paired agent conversation.

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
is expected because the SysON inventory captured in r5 has no mechanical
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

The completed 2026-08-02 local reference path advances the technical thread to r6 and
the active engineering project to r10. It adds an isolated DripTray STEP, exact CalculiX
consumption, `0.10363294359363535 mm` displacement, `0.5309183805726515 MPa` von Mises
stress, and two passing SysON evaluations against the approved `1 mm` / `20 MPa` limits.
This is later local evidence; it neither rewrites the tracked r5 baseline nor proves the
whole machine, release readiness, or certification.

## Start the Workbench BFF

```bash
deno task preview:thread
```

The task builds the dedicated single-file Preact shell and starts the Deno BFF at:

```text
http://127.0.0.1:5173/
```

No Docker service, Console MCP server, MCP Apps host, or provider MCP is required to
read an already persisted project and thread. With the default arguments, first start
seeds the tracked **V1 CM-01** project as active revision 1 under
`state/local/engineering-projects/` if that active state is absent. Subsequent project
commands create immutable numbered revisions there; they do not rewrite
`config/projects/coffee-machine-cm01.project.json`.

That historic CM-01 seed is not a template or fallback for a V3 project. A V3 project
has its own identity and active revision directory from the first intent. Before it has
a declared root record, the BFF returns its planning surface even if another thread for
the same subject happens to exist locally.

To open an already-created V3 project, name its project ID alone:

```bash
deno task preview:thread --project-id=<project-id>
```

The BFF resolves the persisted project's subject (normally `project:<project-id>`) after
opening its active revision. `--subject=<subject-id>` remains an explicit operator
override; no-argument preview still opens historic CM-01.

Refreshing the page performs one ordinary HTTP GET and opens one same-origin server-sent
event stream. Neither path mutates project state nor reruns assembly, build123d,
CalculiX, or Modelica. Provider MCP calls happen only in an explicit backend runner or
in a separately orchestrated agent workflow.

## Follow the agent-selected workspace

For the paired-project flow, start one same-origin workspace shell instead:

```bash
deno task preview:cockpit --port=5175
```

The agent creates or resumes a project with `project_start` / `project_snapshot`, then
uses `cockpit_focus_set` to point workspace `primary` at that durable project. It guides
questions, records sourced answers, proposes the brief, and requests exact human
confirmation in the paired conversation. Focus never changes because framing and later
engineering work share one project identity. `cockpit_focus_snapshot` supplies the
optimistic focus revision.

The browser has no selector and no command route: it only reads durable focus. The root
always remains the same project cockpit and the **Project** tab stays the entry point.
From project revision 1 onward it renders the living brief, then the current path and
engineering record without sending the person to another product page. A focus change
creates no project, answer, run, tool call, evidence, or approval. Before an agent
selects a target, workspace mode clearly says it is awaiting project context; it never
silently falls back to CM-01.

## Inspect the truth boundary

```bash
curl -i http://127.0.0.1:5175/api/thread/workbench
```

For the default CM-01 technical-evidence surface, the response header contains:

```text
X-Casys-Data-Source: canonical-thread-snapshot
```

While a technical engineering run is waiting for canonical publication, the value is
`canonical-thread-snapshot+live-updates`. Other surfaces identify their own source; a
client should treat the header as a display/audit label, not as a request to substitute
another local snapshot.

The JSON document is one atomic browser read model:

```json
{
  "schemaVersion": "engineering-workbench/0.2",
  "surface": "evidence",
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
- `thread-ahead` when a newer technical revision has a fully resolvable `previous` chain
  back to the exact project head, but project decisions still refer to that older input.
  The cockpit shows the descendant evidence and names the lag; it never promotes a
  parallel branch or pretends that existing decisions were made against the newer state.

A V3 project created from first intent returns `"surface": "planning"` until its first
documentary baseline exists. That variant contains the living brief, durable project
path, and `planning.technicalBaseline.status: "not-created"`; it has no `thread` or
`alignment` field and returns `X-Casys-Data-Source: engineering-project-plan`. The BFF
does not use the current subject head as a substitute for that missing baseline.

After `baseline.from-approved-brief@1` has completed, it instead returns
`"surface": "documentary"`. That surface contains one immutable record of the exact
human-approved brief and reviewed path, its snapshot/artifact identity, capture URI and
SHA-256 fingerprint. It deliberately has no technical `thread`, `alignment`, component
catalog, graph, tool facet, observation, requirement, evaluation, violation, or verdict.
It answers “what approved project did we start from?”, not “what has engineering
proved?”

The standard technical `"surface": "evidence"` is used only once a later operation has
created and validated technical evidence. The generic provider-backed V3 result is
`architecture.seed-syson-model@2`: it adds r2 with normalized identities for one blank,
read-back SysON project container, SysML document, and root package, bound to the exact
approved brief and documentary artifact. It makes no CAD, simulation, measurement,
requirement evaluation, or physical verdict appear. The fixed CM-01 V3 catalog is the
current technical path beyond this bootstrap; it publishes its own evidence surface with
fresh identities. No surface receives an automatic schema conversion or thread-head
fallback.

Before serving planning, documentary, or evidence state, the BFF resolves every declared
project snapshot by exact ID and validates its entity references. A missing exact
snapshot fails closed; it is never replaced by the latest available document.

The live read path is:

```bash
curl -N http://127.0.0.1:5173/api/thread/workbench/events
```

It emits a complete `engineering-workbench/0.2` replacement as
`event: workbench-snapshot`. Event IDs include the relevant immutable revision and live
activity version, but are opaque to clients: use `Last-Event-ID` only for reconnection,
not as a technical lineage identifier.

A persisted project revision, a redacted public milestone for the initial documentary
run, a durable documentary record, or a canonical technical publication can each update
the cockpit. The browser never receives raw MCP tool output or a partial graph delta.
Reconnecting with `Last-Event-ID` replays no tool call.

On the **evidence** surface, the projection must show:

- source `observed`, not `fixture`;
- exact producer and consumed SHA-256 values for every claimed CAD handoff;
- the canonical whole-machine STEP after an explicit build run is attached;
- SysON, Modelica, and ERPNext bootstrap branches, plus build123d and CalculiX only
  after their explicit runs are published;
- on the clean r5 head, zero mechanical requirements and an unavailable verdict;
- on the published r6 head, the two DripTray requirements and their `pass` evaluations,
  with an empty reconciled live overlay.

On the **documentary** surface, the page instead shows the durable starting record and a
plain-language boundary: technical proof is not recorded yet. It must not show an empty
graph as if it were a technical model, nor reuse CM-01 component or evidence panels.

## Review the initial V3 sequence

For an idea/specification project, the human and agent have a deliberately small,
ordered interaction:

1. The agent guides questions and records sourced answers inside the same durable
   schema-3.0 project, then asks the person to confirm the exact proposed living brief
   in the paired conversation. This is planning, not an engineering result.
2. The agent publishes the reviewed path and queues the documentary
   `baseline.from-approved-brief@1` work item. It does not ask the person to enter CAD,
   solver, material, legal, or requirement values.
3. The agent executes that server-owned recording operation. The activity area can show
   its public queued/running/publishing milestones, but no provider payload or technical
   result because no provider is involved.
4. Once the immutable capture and root r1 are durable, the planning page becomes the
   documentary record. The reviewer can inspect the exact fingerprint.
5. Through `project_change_append`, the agent adds the next bounded work against exact
   r1, then queues `architecture.seed-syson-model@2`. The server uses its fixed SysON
   sequence to create a blank project container, document, and root package, then reads
   the root back. The caller provides no provider/tool selection, arguments, SysML text,
   or output.
6. The executor normalizes those identities, persists and reads back its capture and r2,
   then attaches that exact r2 reference to the project before it completes the run.
   Until that attachment, the Workbench keeps showing documentary r1 plus provisional
   live activity; it does not promote the persisted-but-unattached record to an evidence
   surface. Its durable write-ahead record means an uncertain SysON creation is held for
   review, not blindly retried. r2 is only an editable container identity, not a system
   architecture, requirements, CAD, simulation, measurement, or verdict.
7. The generic route stops at r2. To see a full evidence path, open the separately
   selected `coffee-machine-cm01-v3` project after its registered operations have
   published fresh CM-01 evidence; use the
   [golden-run guide](run-cm01-v3-golden-local.md) for its exact scope and closeout.

If the technical seed stops before attachment, the project remains on its documentary r1
surface. The UI must not claim an r2 model or evidence merely because a provider write,
authorization, or live milestone exists.

## Follow agent work and decisions

The CM-01 walkthrough below is the existing technical-evidence path. It remains useful
for reviewing a bounded technical proof case, but it is not the V3 first-baseline flow
above.

Open **Project**. Its notification view is deliberately a light signal and a route into
the relevant dossier, not a form or command center. On a clean CM-01 active store it
reports one bundled proof-case decision under **Agent preparing** and zero agent runs.
`required` is not a request for the person to invent material, support, load, or
criterion values: it means the agent still owes one concrete, evidence-bound
recommendation.

1. When a decision becomes **Needs your review**, follow its context to **Activity**.
   Inspect the upstream evidence and downstream impact if needed.
2. Return to the paired conversation. Ask for an explanation, state a correction, or
   answer the agent's exact decision prompt there.
3. For an approval or rejection, the agent calls `project_decision_approve` or
   `project_decision_reject`. The MCP host presents signed elicitation for the exact
   proposal fingerprint. In a conforming host, it waits for your explicit response
   before retrying the tool.
4. Once work is ready, the agent calls `project_agent_run_queue`. The server derives the
   run identity, summary, basis, and registered operation from durable state.
5. The agent calls `project_agent_run_execute` for that exact queued run. The cockpit
   receives progress and result projections through SSE; no page click launches a tool.

The cockpit therefore remains read-only even while the project changes. It receives no
generic MCP endpoint or provider credential. The agent may queue and execute only a
registered operation, cannot confirm its own proposal, and cannot supply a raw provider
name, arguments, result snapshot, or evidence payload.

The V3 executor resolves its operation, basis, bindings, capture, root snapshot, and
completion evidence from server-owned state; callers cannot submit a tool name, raw tool
arguments, result snapshot, or evidence payload. The generic route can record the
approved-brief documentary baseline and create the fixed brief-bound SysON container
from exact r1. These operations persist and read back their closed captures and refuse
an uncertain non-idempotent write instead of retrying it blindly. Any future
requirements, CAD, simulation, measurement, or verification step still needs its own
reviewed executor, output validator, materializer, and evidence contract. The fixed
CM-01 V3 catalog is the current exception; its historical r5/r6 proof is provenance,
not a generic agent lifecycle recipe.

The page opens on **Project**, which answers what CM-01 is trying to achieve, what needs
attention, and where to go next. The five product sections have distinct jobs:

- **Project** — objective, lightweight notifications, derived phase gates, current work,
  next work, blockers, and routes into the relevant context;
- **Activity** — agent work plus the live lineage feed: the primary evidence and impact
  context for a review, never private chain-of-thought;
- **Product** — one physical component traversed across its SysON, build123d and ERPNext
  identities, including the SysON/specification context in which a follow-up correction
  can be scoped with the agent;
- **Evidence** — full graph, causal impact, requirements, verdicts and named violations;
- **Execution** — agent-run journal, declared work items and engineering systems that
  contributed evidence.

In **Activity**:

- leave **Follow live** enabled so a newly persisted fact becomes active automatically;
- when a review notification arrives, trace the recommendation through its linked
  evidence and downstream impact, then answer in the paired conversation;
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

- use the affected SysON/specification context to inspect or refine technical intent; do
  not turn the Project review notification into a substitute technical editor;
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
observations and ERPNext BOM detail, passive read/SSE paths, signed revision-bound human
elicitation in the agent channel, the bounded V3 documentary r1 flow, and the fixed
r1-to-r2 SysON container seed with read-back normalized identities and no blind retry.
It also proves one coherent native UI with shared selection and no nested Apps. The
separate CM-01 V3 path proves its own current bounded DripTray evidence; the r5/r6
records remain its historical provenance.

It does **not** prove:

- a new solve at preview time;
- a SysML model, CAD geometry, simulation, measurement, requirement verdict, or
  compliance conclusion merely because a V3 documentary record exists;
- a system architecture, requirement, CAD model, simulation, measurement, or verdict
  merely because the V3 SysON container seed has recorded r2;
- a whole-machine mechanical or compliance verdict;
- a production-material, fabrication-release, certification, or automatic correction
  claim;
- a browser command or provider-execution API. Explicit agent tools and registered
  backend runners own provider MCP calls and canonical publication.

The assembly groups independent branches under a reviewed CM-01 identity; it does not
manufacture causal links between the historical whole-machine CAD, thermal, ERP, or the
separately generated DripTray FEA branch.

## Compare the preview paths

| Command                     | Address                  | Purpose                                      |
| --------------------------- | ------------------------ | -------------------------------------------- |
| `deno task preview:thread`  | `http://127.0.0.1:5173/` | Native product shell over persisted evidence |
| `deno task preview:browser` | `http://127.0.0.1:3021/` | Console MCP App against the Console server   |

MCP Apps remains useful for one rich tool result or for embedding the complete Workbench
once in an agent host. It is not used to compose the first-party product page.

## Stop the preview

Press `Ctrl-C` in the BFF terminal. Stopping it does not affect Docker, engineering
services, Console state, active project revisions, or persisted Modelica runs.
