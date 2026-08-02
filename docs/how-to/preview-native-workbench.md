# How-to: preview the native digital-thread Workbench

Use this guide to inspect the single-shell Preact cockpit against the distinct truth
surfaces it can render:

- the project objective, phases, work, decisions and blockers declared by an immutable
  `EngineeringProjectSnapshot` under `config/projects/`;
- for a new V2 project, the immutable documentary record of its exact approved discovery
  and reviewed path, once the first bounded operation has recorded it;
- the persisted technical evidence projected from exact canonical `ThreadSnapshot`
  revisions under `state/local/thread-snapshots/`.

The backend-for-frontend (BFF) chooses the applicable surface; it does not blend a
documentary record into an empty technical graph. Its `GET` and SSE paths are passive:
opening the page never starts an engineering tool. Its separate human-only command path
can record an explicit review decision or work authorization, but it never calls an
engineering provider.

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

That historic CM-01 seed is not a template or fallback for a V2 discovery project. A V2
project is configured with its own project identity, active revision directory, and
approved-discovery store. Before it has a declared root record, the BFF returns its
planning surface even if another thread for the same subject happens to exist locally.

To open an already-created V2 project, name its project ID alone:

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

## Inspect the truth boundary

```bash
curl -i http://127.0.0.1:5173/api/thread/workbench
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

A V2 project created from approved discovery first returns `"surface": "planning"`. That
variant contains the durable project path and
`planning.technicalBaseline.status: "not-created"`; it has no `thread` or `alignment`
field and returns `X-Casys-Data-Source: engineering-project-plan`. The BFF does not use
the current subject head as a substitute for that missing baseline.

After the exact first V2 operation has completed, it instead returns
`"surface": "documentary"`. That surface contains one immutable record of the approved
discovery and reviewed path, its exact snapshot/artifact identity, capture URI and
SHA-256 fingerprint. It deliberately has no technical `thread`, `alignment`, component
catalog, graph, tool facet, observation, requirement, evaluation, violation, or verdict.
It answers “what approved project did we start from?”, not “what has engineering
proved?”

The standard technical `"surface": "evidence"` is used only once a later operation has
created and validated technical evidence. The three surfaces are mutually exclusive: V1
CM-01 records remain historic/readable, and neither direction receives an automatic
schema conversion or thread-head fallback.

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

## Review the first V2 starting record

For an idea/specification project, the human and agent have a deliberately small first
interaction:

1. The agent prepares a bounded project path from the exact approved discovery; this is
   planning, not an engineering result.
2. The reviewer sees one explicit authorization for the known documentary baseline. It
   records the approved discovery and reviewed path; it does not ask the reviewer to
   enter CAD, solver, material, legal, or requirement values.
3. The agent executes that already-authorized, server-owned recording operation. The
   activity area can show its public queued/running/publishing milestones, but no
   provider payload or technical result because no provider is involved.
4. Once the immutable capture and its root record are durable, the planning page becomes
   the documentary record. The reviewer can inspect the exact fingerprint and then ask
   the agent to propose the first genuine technical operation.

If that recording attempt stops before publication, the project remains a planning
surface. The UI must not claim a baseline, model, or evidence merely because an
authorization or a live milestone exists.

## Follow a review notification

The CM-01 walkthrough below is the existing technical-evidence path. It remains useful
for reviewing a bounded technical proof case, but it is not the V2 first-baseline flow
above.

Open **Project**. Its review-notification inbox is deliberately a light signal and a
route into the relevant work, not a form for entering technical payloads. On a clean
CM-01 active store it reports one bundled proof-case decision under **Agent preparing**
and zero agent runs. `required` is not a request for the operator to invent material,
support, load, or criterion values: it means the agent still owes one concrete,
evidence-bound recommendation that covers the complete analysis case.

1. When a decision becomes **Needs your review**, follow its notification to
   **Activity**. The feed is the review context: follow the event, its upstream
   evidence, and its downstream impact before judging the recommendation.
2. Use the contextual record and the exact audit details only when the identifiers,
   fingerprints, or snapshots are needed to establish scope.
3. If the technical intent needs inspection or correction, open the affected
   **Product**/**SysON** specification context and continue the paired agent
   conversation. Do not capture replacement technical values in the notification inbox.
4. When the prepared recommendation remains appropriate, identify the local reviewer and
   issue the explicit approval. If it must change, use **Request revised
   recommendation** in Activity after the specification review; the agent can then
   return an evidence-bound replacement while the prior project revision remains
   auditable.
5. Once that meaningful gate is satisfied, authorize the already bounded work item. This
   creates a durable `queued` run; it does not itself launch an engineering tool.

Each submit is a same-origin JSON `POST /api/project/commands` carrying
`X-Casys-Operator-Intent: explicit` and the project revision displayed in the current
Workbench capability. A concurrent update returns a conflict; the cockpit reloads the
new state instead of overwriting it. Static or injected preview fixtures do not expose
the command capability and remain read-only.

The browser command contract is limited to `decision.propose`, `decision.approve`,
`decision.reject`, and `agent-run.queue`. That transport capability does not turn the
Project inbox into a manual proposal editor: it cannot claim, publish, complete, or fail
a run, and it receives no generic MCP endpoint or provider credential. The Console MCP
server gives agents the complementary project snapshot, proposal, and one bounded
`project_agent_run_execute` operation for an exactly human-queued V2 documentary
baseline. It never gives an agent approval, rejection, queue, generic run-lifecycle, or
arbitrary provider-execution authority.

The V2 executor resolves its operation, basis, bindings, capture, root snapshot, and
completion evidence from server-owned state; callers cannot submit a tool name, raw tool
arguments, result snapshot, or evidence payload. It records only the approved-discovery
documentary baseline. A future technical operation must bring its own reviewed executor,
output validator, materializer, and evidence contract. The historic CM-01 technical
proof is reviewed in this Workbench as existing evidence; it is not a generic agent
lifecycle recipe.

The page opens on **Project**, which answers what CM-01 is trying to achieve, what needs
attention, and where to go next. The five product sections have distinct jobs:

- **Project** — objective, a lightweight review-notification inbox, derived phase gates,
  current work, next work, blockers, and routes into the relevant context;
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
  evidence and downstream impact before issuing a human approval or revision request;
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
observations and ERPNext BOM detail, passive read/SSE paths, a revision-bound human
command gate, the bounded V2 documentary starting-record flow, and one coherent native
UI with shared selection and no nested Apps. The published r6 branch also proves exact
DripTray CAD consumption and the two model-owned SysON comparisons.

It does **not** prove:

- a new solve at preview time;
- a SysML model, CAD geometry, simulation, measurement, requirement verdict, or
  compliance conclusion merely because a V2 documentary record exists;
- a whole-machine mechanical or compliance verdict;
- a production-material, fabrication-release, certification, or automatic correction
  claim;
- a browser provider-execution API. The browser command route mutates only project
  state; explicit backend runners or agents still own provider MCP calls and canonical
  publication.

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
