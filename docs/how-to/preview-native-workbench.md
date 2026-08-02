# How-to: preview the native digital-thread Workbench

Use this guide to inspect the single-shell Preact cockpit against two linked truth
surfaces:

- the project objective, phases, work, decisions and blockers declared by an immutable
  `EngineeringProjectSnapshot` under `config/projects/`;
- the persisted technical evidence projected from exact canonical `ThreadSnapshot`
  revisions under `state/local/thread-snapshots/`.

The backend-for-frontend (BFF) joins both surfaces. Its `GET` and SSE paths are passive;
opening the page never starts an engineering tool. Its separate human-only command path
may append project revisions, but it still never calls an engineering provider.

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
consumption, `0.10363294359363535 mm` displacement,
`0.5309183805726515 MPa` von Mises stress, and two passing SysON evaluations against
the approved `1 mm` / `20 MPa` limits. This is later local evidence; it neither rewrites
the tracked r5 baseline nor proves the whole machine, release readiness, or certification.

## Start the Workbench BFF

```bash
deno task preview:thread
```

The task builds the dedicated single-file Preact shell and starts the Deno BFF at:

```text
http://127.0.0.1:5173/
```

No Docker service, Console MCP server, MCP Apps host, or provider MCP is required to
read an already persisted project and thread. On first start, the tracked CM-01 project
seeds active revision 1 under `state/local/engineering-projects/` if that active state
is absent. Subsequent project commands create immutable numbered revisions there; they
do not rewrite `config/projects/coffee-machine-cm01.project.json`.

Refreshing the page performs one ordinary HTTP GET and opens one same-origin server-sent
event stream. Neither path mutates project state nor reruns assembly, build123d,
CalculiX, or Modelica. Provider MCP calls happen only in an explicit backend runner or
in a separately orchestrated agent workflow.

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

A project created from approved discovery can instead return `"surface": "planning"`.
That variant contains the durable project path and
`planning.technicalBaseline.status: "not-created"`; it has no `thread` or `alignment`
field and returns `X-Casys-Data-Source: engineering-project-plan`. The BFF does not use
the current subject head as a substitute for that missing baseline.

Before serving either state, the BFF resolves every declared project snapshot by exact
ID and validates its entity references. A missing exact snapshot fails closed; it is
never replaced by the latest available document.

The live read path is:

```bash
curl -N http://127.0.0.1:5173/api/thread/workbench/events
```

It emits a complete `engineering-workbench/0.2` replacement as `event: workbench-snapshot`.
Evidence-surface event IDs are:

```text
<project-revision>:<thread-revision>:<live-sequence>
```

Planning-surface event IDs are `planning:<project-revision>` because no technical
revision exists yet.

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
- on the clean r5 head, zero mechanical requirements and an unavailable verdict;
- on the published r6 head, the two DripTray requirements and their `pass` evaluations,
  with an empty reconciled live overlay.

## Follow a review notification

Open **Project**. Its review-notification inbox is deliberately a light signal and a
route into the relevant work, not a form for entering technical payloads. On a clean
CM-01 active store it reports one bundled proof-case decision under **Agent preparing**
and zero agent runs. `required` is not a request for the operator to invent material,
support, load, or criterion values: it means the agent still owes one concrete,
evidence-bound recommendation that covers the complete analysis case.

1. When a decision becomes **Needs your review**, follow its notification to
   **Activity**. The feed is the review context: follow the event, its upstream evidence,
   and its downstream impact before judging the recommendation.
2. Use the contextual record and the exact audit details only when the identifiers,
   fingerprints, or snapshots are needed to establish scope.
3. If the technical intent needs inspection or correction, open the affected
   **Product**/**SysON** specification context and continue the paired agent
   conversation. Do not capture replacement technical values in the notification inbox.
4. When the prepared recommendation remains appropriate, identify the local reviewer and
   issue the explicit approval. If it must change, use **Request revised recommendation**
   in Activity after the specification review; the agent can then return an evidence-bound
   replacement while the prior project revision remains auditable.
5. Once that meaningful gate is satisfied, authorize the already bounded work item. This creates a
   durable `queued` run; it does not itself launch an engineering tool.

Each submit is a same-origin JSON `POST /api/project/commands` carrying
`X-Casys-Operator-Intent: explicit` and the project revision displayed in the current
Workbench capability. A concurrent update returns a conflict; the cockpit reloads the
new state instead of overwriting it. Static or injected preview fixtures do not expose
the command capability and remain read-only.

The browser command contract is limited to `decision.propose`, `decision.approve`,
`decision.reject`, and `agent-run.queue`. That transport capability does not turn the
Project inbox into a manual proposal editor: it cannot claim, publish, complete, or fail
a run, and it receives no generic MCP endpoint or provider credential. The Console MCP
server gives agents the complementary project snapshot, proposal, and run-lifecycle
tools, but never approval, rejection, or queue authority.

After queueing, an agent must claim the named run, call the reviewed provider MCPs as a
separate operation, publish a canonical `ThreadSnapshot`, and cite entities from that
exact result revision. Completion fails closed if the snapshot or any evidence reference
does not exist. The resulting project revisions and run journal arrive over the same SSE
stream. For the CM-01 proof, the required publication order is
`project_agent_run_publish(stage=publishing)` →
`thread:attach-coffee-machine-mechanical` →
`project_agent_run_publish(stage=completed)`. See the
[mechanical workflow how-to](view-coffee-machine-cm01.md).

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

- use the affected SysON/specification context to inspect or refine technical intent;
  do not turn the Project review notification into a substitute technical editor;
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
command gate, complementary agent run controls, and one coherent native UI with shared
selection and no nested Apps. The published r6 branch also proves exact DripTray CAD
consumption and the two model-owned SysON comparisons.

It does **not** prove:

- a new solve at preview time;
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
