# RFC: Minimal agent orchestration and the operational-twin boundary

Status: **Partially implemented — bounded planning landed; execution remains proposed**\
Scope: one beginner journey from initial intent or existing product material to
reviewable engineering evidence\
Decision horizon: V1 orchestration now; operational Digital Twin only in V2

Truth basis: source tree inspected on 2026-08-02. Current-state claims include the
loopback Discovery handoff, the agent planning command, and the code-owned intake
operation registry implemented in this worktree. Exact initial-run authorization, a
trusted generic executor, and operational Digital Twin capabilities remain proposed.

## Decision

Casys Digital Thread should expose one product journey, not one UI per MCP and not three
separate products for three starting situations:

1. start from an idea or specification;
2. start from existing CAD and reverse-engineer its engineering definition;
3. start from an existing product and capture its static design, BOM, documents,
   measurements, and assumptions.

All three entry points converge on the same value loop:

```text
change -> affected requirements and artefacts -> new proofs -> human review
```

Traceability is the substrate for that loop, not its final purpose. It lets the agent
observe the affected state, evaluate it against named requirements, propose the smallest
bounded correction, and request a recomputation. The person reviews the consequences and
authorizes consequential work; neither a dashboard nor a language model is the verifier.

The agent guides the conversation, proposes the project path, and executes only reviewed
operations. The person answers understandable questions, approves the brief and
consequential decisions, and authorizes work. Provider names, tool names, hashes, and
execution details belong to the expert/evidence layer, not to the primary journey.

The implementation should keep four boundaries distinct:

- the **agent skill** decides what to ask and how to explain a recommendation;
- **MCP tools** read or mutate durable control-plane state and call engineering
  providers;
- **human commands** record answers, approvals, rejections, and execution authorization;
- **SSE/cockpit projections** show live and canonical state but grant no execution
  authority.

There must be no generic browser-to-MCP proxy and no generic agent tool that accepts an
arbitrary provider name, tool name, YAML workflow, or raw `structuredContent` as
evidence.

## User journey

The beginner-facing journey is deliberately short:

1. **Describe the starting point.** The person can explain an idea, point to existing
   CAD, or describe an existing product. The agent asks one bounded question at a time
   and explains its recommendation in ordinary language.
2. **Review the brief.** The agent turns sourced answers and explicit unknowns into a
   brief. The person approves it or asks for a revision.
3. **Open the project and see its proposed path.** The person creates the empty project
   shell from the exact approved brief. The agent can then publish or revise an
   unexecuted sequence of work, each item bound to a reviewed operation reference. Both
   are planning state, not technical evidence or an authorization to run.
4. **Authorize consequential work.** The agent proposes decisions with consequences. The
   person approves or rejects them, then authorizes the exact next run. There is no
   technical data-entry form in the main path.
5. **Watch work and review evidence.** The activity feed shows operations as they run.
   Successful work is replaced by canonical linked evidence; failures and unresolved
   questions stay visible.
6. **Change and repeat.** A change invalidates affected evidence, the agent proposes
   recomputation, and the person reviews the new proof and impact chain.

The three entries affect only the first reviewed operation:

| Starting point        | First bounded engineering operation                                                  | Honest V1 result                                                           |
| --------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Idea or specification | Establish a system-definition baseline from the approved brief                       | A versioned model and declared assumptions                                 |
| Existing CAD          | Fingerprint and capture the supplied CAD before proposing semantic mappings          | A content-addressed design baseline; inferred structure remains a proposal |
| Existing product      | Capture static source material such as BOM, documents, CAD, and bounded measurements | An observed static baseline; no claim of live operational state            |

After that first baseline, all projects use the same project, decision, run, evidence,
impact, and review contracts.

## Current source-backed truth

The following is implemented in the repository today. The tool inventory comes from
`server.ts`, `src/tools/`, `config/mcp-fleet.json`, the domain command services, and the
two Workbench BFFs.

### Agent skill

`.agents/skills/guide-industrial-project/` already defines the correct conversational
policy:

- establish current truth before asking;
- ask one adaptive question at a time;
- keep unknown explicit;
- distinguish intent, observed facts, calculated evidence, external evidence,
  assumptions, and approvals;
- let provider tools produce evidence;
- never let the agent approve, reject, or queue work.

The skill is procedure and wording. It is not an authority boundary, persistence layer,
or executor.

### Digital-thread MCP control plane

The Console MCP server is stateless at the transport level and registers these current
tool families:

| Family    | Existing tools                                                                                                                                                      | What they really do                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Fleet     | `console_snapshot`, `console_server_detail`, `console_run_list`, `console_run_detail`                                                                               | Read provider availability and recorded console runs              |
| Discovery | `project_discovery_snapshot`, `project_discovery_start`, `project_discovery_question_propose`, `project_discovery_answer_record`, `project_discovery_brief_propose` | Build an immutable pre-project conversation and proposed brief    |
| Project   | `project_snapshot`, `project_plan_publish`, `project_decision_propose`, `project_agent_run_start`, `project_agent_run_progress`, `project_agent_run_publish`, `project_agent_run_fail` | Read project truth, publish bounded unexecuted planning state, and record an already-authorized run lifecycle |

`project_plan_publish` can create or revise an unexecuted plan from the exact approved
Discovery handoff. It records only code-validated operation references and state
bindings; it does **not** call a provider, approve a decision, queue a run, or
materialize technical evidence. No work item is executable merely because it names an
operation. The existing run tools remain lifecycle bookkeeping around a run that a human
already queued.

The loopback Discovery BFF now exposes a human-only
`POST /api/project-discoveries/:id/handoff` action. It creates immutable project
revision 1 from the exact approved brief, with no `ThreadSnapshot`, technical plan, or
evidence. This is a human browser-authority surface, not an agent MCP planning command.

### Provider MCPs

Provider MCPs remain valuable engineering boundaries. They must stay below the main
journey and become visible by name only in evidence or expert views.

| Provider  | Current relevant capability                                                              | Important limit                                                                        |
| --------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| SysON     | Project/model/element operations, requirement tracing, constraints, numeric model values | A model mutation or constraint result is not sensor ingestion or project orchestration |
| build123d | Execute bounded CAD code and export artefacts                                            | Does not create project lineage by itself                                              |
| CalculiX  | Solve a static case against an exact STEP digest                                         | The reviewed load/material/support case still comes from project decisions             |
| Modelica  | Run shipped, approved kits and scenarios with bounded parameter overrides                | No general telemetry replay, calibration, or arbitrary model ingestion                 |
| ERPNext   | Read item, BOM, work-order, and job-card state                                           | Observation does not prove cross-tool identity without an explicit binding             |

Direct provider calls can be useful inspection results in an agent host, including MCP
Apps. They are not canonical product evidence until a trusted digital-thread operation
captures, validates, fingerprints, materializes, and publishes them.

### Human command surfaces

The browser command adapters correctly retain human-only authority:

| Context             | Current human actions                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Discovery           | Record a reported answer; approve or reject the exact brief; create its empty project shell |
| Engineering project | Propose, approve, or reject a decision; queue an exact run                                  |

The primary product should not encourage the human decision-proposal route as a manual
technical form. The agent should prepare proposals; the human should inspect and decide.
The same-origin header and loopback restriction are useful prototype safeguards, but the
recorded actor label is not authentication.

### SSE and cockpit

The browser reads normal HTTP plus passive SSE:

- discovery SSE publishes full immutable discovery replacements;
- Workbench SSE publishes full validated project/thread projections;
- `RecordingMcpToolClient` can append redacted `started`, `completed`, and `failed`
  graph updates to the live journal;
- the live journal intentionally excludes raw tool arguments and raw
  `structuredContent`;
- a canonical `ThreadSnapshot` replaces transient activity after trusted
  materialization.

SSE is the observation channel. It is not a second orchestration protocol, a command
bus, or canonical evidence storage. A reconnect must never repeat an engineering call.

### Current execution path

`WorkflowExecutor` can execute a reviewed, compiled DAG through backend-owned MCP
clients. The CoffeeMachine scripts additionally record live updates, capture provider
results, materialize a `ThreadSnapshot`, persist it, and attach exact references to the
project.

That path is real but product-specific and CLI-driven. The generic external agent cannot
currently obtain the same guarantees by using the Console MCP tools. Calling providers
directly bypasses the trusted recorder/materializer; updating the run lifecycle later
does not prove what produced the cited evidence.

## Confirmed orchestration gaps

The durable shell and bounded planning path now exist. The path from that plan to proof
still has two consequential breaks:

```text
approved discovery
  ---> durable project shell                 implemented human handoff
  ---> reviewed, unexecuted project path     implemented agent plan + registry
  -/-> initial authorization / exact basis   bootstrap basis migration pending
  -/-> trusted provider execution/evidence   no generic control-plane executor
```

There is still a bootstrap mismatch in the current project contract: queueing and
decision proposals require an exact base `ThreadSnapshot`, while the first planned
operation is grounded in an approved discovery before its first technical snapshot.
Creating an empty or fabricated technical snapshot would hide the gap rather than solve
it.

## Minimal target contract

### 1. Preserve the implemented approved-discovery handoff

The implemented human handoff is the foundation:

```text
HTTP command: project.create-from-approved-discovery
domain receipt: project.create-from-discovery
```

Preserve these invariants:

- accept only an exact approved discovery revision;
- require a human origin;
- persist the approved brief fingerprint and reviewer identity;
- create-if-absent with idempotent command receipts;
- create no SysON element, phase, work item, evidence, or fake thread state.

The UI phrases this as **Start engineering project**. It is an explicit human action,
not a technical form. The first-party surface binds the project ID to the discovery ID
and the project name to the approved objective.

### 2. Implemented: give the agent one planning command

The Console MCP server now exposes one agent-only mutation:

```text
project_plan_publish
```

Its payload should contain:

```ts
interface ProjectPlanInput {
  startingPoint: "idea-or-spec" | "existing-cad" | "existing-product";
  phases: readonly PlannedPhase[];
  workItems: readonly PlannedWorkItem[];
  requiredDecisions: readonly RequiredDecision[];
}

interface PlannedWorkItem {
  id: string;
  phaseId: string;
  title: string;
  description: string;
  kind: EngineeringWorkItemKind;
  dependsOnWorkItemIds: readonly string[];
  decisionIds: readonly string[];
  operation: EngineeringOperationRef;
}

interface EngineeringOperationRef {
  /** Stable entry in a server-side reviewed operation registry. */
  id: string;
  version: string;
  /** References to reviewed state, never raw provider arguments. */
  bindings: readonly EngineeringOperationInputBinding[];
}

type EngineeringOperationInputBinding =
  | {
    name: string;
    source: { kind: "approved-discovery" };
  }
  | {
    name: string;
    source: { kind: "discovery-answer"; answerId: string };
  }
  | {
    name: string;
    source: {
      kind: "decision-parameter";
      decisionId: string;
      key: string;
    };
  }
  | {
    name: string;
    source: {
      kind: "thread-entity";
      reference: EngineeringThreadEntityRef;
    };
  };
```

The command may create or revise only unexecuted planning state. It records a `plan`
whose basis is the exact approved discovery handoff, and stamps its agent publisher and
publication time. Each published work item carries the exact registry ID, version, and
approved state-reference bindings. The V1 intake surface accepts only
`approved-discovery` and `discovery-answer` bindings; the broader domain binding union
is reserved for a reviewed later operation/executor contract. Its displayed title,
description, and work kind are derived from the registered operation rather than supplied
by the agent. The command rejects unknown operation revisions,
wrong entry points, undeclared bindings, and stale or superseded discovery answers.
It cannot approve a decision, queue a run, call a provider, or attach evidence. Once a
run, approval, blocker, non-required decision, technical evidence, or completed work
exists, this planning command cannot replace the path.

The registry currently contains these three bounded intake operations:

| Starting point | Registered operation |
| --- | --- |
| Idea or specification | `baseline.from-approved-discovery@1` |
| Existing CAD | `baseline.capture-existing-cad@1` |
| Existing product | `baseline.capture-existing-product@1` |

The registry is intentionally a safe planning descriptor today. It exposes no provider
selection, provider tool name, raw tool arguments, workflow definition, or evidence
payload. A future trusted executor will use the same reviewed operation revision to own
typed input resolution, provider selection, output validation, materialization, and
redacted live projection. The agent never supplies raw provider tool names at execution
time.
At execution, existing-CAD and existing-product intake must resolve their supplied files
or source records through exact discovery-answer bindings. The future intake executor
must fingerprint the bytes; a path or label alone never becomes evidence.

### 3. Still pending: use one exact basis type before and after the first proof

Replace the bootstrap-only assumption that every action already has a base thread with
an exact discriminated basis:

```ts
type EngineeringBasisRef =
  | {
    kind: "approved-discovery";
    discoveryId: string;
    snapshotId: string;
    revision: number;
    briefId: string;
    approvedBriefFingerprint: ContentFingerprint;
  }
  | {
    kind: "thread-snapshot";
    snapshotId: string;
    revision: number;
    subjectId: string;
  };
```

The initial planning and baseline run use the exact approved-discovery basis. Once the
first canonical `ThreadSnapshot` exists, all later decisions and runs use an exact
thread-snapshot basis. A queue fingerprint must cover:

- the basis;
- the work-item ID;
- the reviewed operation ID and version;
- every approved decision fingerprint;
- resolved non-secret operation inputs.

This should be a clean schema revision, not parallel `baseSnapshot` and `basis` fields
with fallback behaviour.

### 4. Still pending: give the agent one trusted execution tool

Add one agent-only MCP tool:

```text
project_agent_run_execute
```

Its public input is intentionally small:

```ts
interface ExecuteQueuedProjectRunInput {
  projectId: string;
  expectedRevision: number;
  runId: string;
  commandId: string;
  issuedAt: string;
}
```

The backend must resolve all consequential detail from the human-queued run and the
server-side operation registry. The execution sequence is fixed:

1. validate the current project revision, queued run, exact basis, operation version,
   and approved decision bindings;
2. claim the run durably before any provider call;
3. execute the reviewed operation through no-retry, backend-owned MCP clients wrapped by
   `RecordingMcpToolClient`;
4. validate selected structured outputs and exact artefact consumptions;
5. materialize and persist a descendant canonical `ThreadSnapshot`;
6. read it back and validate the cited entities;
7. complete the project run with the exact result/evidence references;
8. reconcile the transient live overlay.

On a provider failure, record a failed run and no evidence. On an uncertain
interruption, leave a visible non-success state and require explicit reconciliation; an
identical MCP retry must never repeat the provider operation automatically.

This tool is not a generic workflow upload endpoint. Its registry may internally use the
existing YAML compiler and `WorkflowExecutor`, specialized TypeScript operations, or
both, but only reviewed, versioned entries can run.

### 5. Keep authority simple

| Action                                      |                     Agent |            Human |  SSE/cockpit |
| ------------------------------------------- | ------------------------: | ---------------: | -----------: |
| Ask a question and explain a recommendation |                       Yes |           Answer |      Observe |
| Record a sourced answer                     |                       Yes |              Yes |      Observe |
| Propose a brief                             |                       Yes |               No |      Observe |
| Approve/reject a brief                      |                        No |              Yes |      Observe |
| Create a project from that approval         |                 Recommend |          Confirm |      Observe |
| Publish a project path                      |                       Yes |               No |      Observe |
| Propose a consequential decision            |                       Yes | No in primary UX |      Observe |
| Approve/reject a decision                   |                        No |              Yes |      Observe |
| Authorize an exact run                      |                        No |              Yes |      Observe |
| Execute an authorized operation             |                       Yes |               No | Observe live |
| Create canonical evidence                   | Trusted backend operation |               No | Observe only |
| Approve a technical verdict or release      |                        No |              Yes |      Observe |

## V1 acceptance slice

The smallest useful vertical slice is not another dashboard panel. It is one complete,
observable run from an approved brief:

1. use the registered discovery-to-project handoff to create the exact empty project
   shell;
2. let the agent publish a minimal project path whose first work item is bound to one
   reviewed intake operation;
3. let the human authorize that exact run;
4. let `project_agent_run_execute` create the first real `ThreadSnapshot` while the
   existing feed updates live;
5. show the canonical baseline and its provenance after completion;
6. change one reviewed input, show affected state, recompute one proof, and review the
   new evidence.

The current landing point reaches steps 1 and 2: an exact approved-discovery handoff can
receive a visible, agent-published plan bound to one of the three intake operations. It
does not yet reach human authorization, execution, technical evidence, or recomputation
through this generic control-plane path. The existing CM-01 CLI flow remains a separate,
product-specific demonstration of linked evidence.

Implement the idea/spec intake executor first to prove the full contract. Existing-CAD
and existing-product already have planning registry entries; before calling the product
V1, they need the same safe execution, evidence, and review journey. They are operation
variants, not separate applications or domain models.

The resulting goal is a bounded feedback loop, not a static audit trail: observe the
current proven state, evaluate a named consequence, propose a scoped correction,
authorize it when consequential, recompute the affected proof, and review the changed
lineage. Traceability makes that loop inspectable and safe; it does not replace the
agent's engineering work.

## Digital Twin boundary

### What exists

The repository currently implements a strong **Digital Twin Prototype/design twin**:

- immutable `ThreadSnapshot` design and evidence revisions;
- a SysON system model and requirement/constraint oracle;
- content-addressed build123d CAD and exact-input CalculiX evidence;
- bounded, versioned Modelica kits and scenario runs;
- ERPNext observations and explicit cross-tool bindings;
- project decisions, approvals, runs, provenance, impact projection, and live activity.

That is already valuable for design verification and change-impact review. It is not an
operational Digital Twin Instance.

### Audit of the current positioning claim

The previous `docs/positioning.md` claim said that a true operational twin was “already
wired” by `syson_value_set` plus `syson_constraint_validate`, with “zero new bricks”.
The source does not support that claim:

- `syson_value_set` changes a numeric literal inside the **design model** and verifies
  the write. Its own description calls it a what-if model mutation and recommends the
  non-mutating `values` override for evaluation-only cases.
- `syson_constraint_validate` can evaluate constraints against supplied value overrides.
  This is a useful oracle primitive, but it does not establish where a value came from
  or whether it represents a physical asset.
- neither tool accepts an asset instance, sensor/signal identity, observed and received
  times, sample sequence, unit provenance, quality/status, uncertainty, or calibration
  metadata;
- model-resolved SysON values are currently dimensionless when constraint literals carry
  units, as the tool documentation itself notes.

The active documentation correction has the right boundary: the **constraint oracle is
reusable for a future operational slice**, but the ingestion, identity, time, quality,
estimation, and lineage bricks do not yet exist. Preserve that corrected wording when
the concurrent documentation work is integrated.

### Missing capabilities for a real operational twin

| Capability                                                                        | Current state                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Physical asset instance/serial bound to an exact design revision                  | Missing; `ThreadSubject` identifies a system/assembly/part/process design subject         |
| Telemetry ingestion contract and connector                                        | Missing                                                                                   |
| Signal identity, `observedAt`, `receivedAt`, sequence, unit, quality, uncertainty | Missing                                                                                   |
| Time-series storage, query, retention, and late/out-of-order handling             | Missing                                                                                   |
| State estimation and model calibration                                            | Missing                                                                                   |
| Event/window-to-evidence lineage                                                  | Missing                                                                                   |
| Replay of an operational window against a versioned Modelica scenario             | Missing; current Modelica accepts approved kit/scenario parameters, not telemetry windows |

`ThreadObservation.source.capturedAt` timestamps calculated evidence. It is not a
telemetry sample envelope and must not be presented as one.

### Smallest V2 operational slice

V2 should add one narrow, separate operational path without turning the immutable
engineering thread into a telemetry database:

1. define an `AssetTwinBinding` that maps one physical `assetInstanceId` to an exact
   design `ThreadSnapshot` revision and reviewed signal-to-model mappings;
2. ingest samples into a separate append-only journal or time-series store using an
   `OperationalSample` envelope containing signal identity, asset identity,
   `observedAt`, `receivedAt`, sequence, quantity/unit, quality/status, uncertainty, and
   calibration reference;
3. select one bounded time window and persist its query definition, count, bounds, and
   content digest;
4. reject missing units, unacceptable quality, unbound signals, and invalid chronology;
5. evaluate one mapped aggregate through `syson_constraint_validate(values=...)` without
   mutating the design model through `syson_value_set`;
6. materialize only the window digest, calculated aggregate observation, evaluation, and
   explicit event-to-evidence provenance into a new `ThreadSnapshot`; raw samples remain
   in the operational store;
7. expose only redacted progress and the resulting evidence through the existing SSE
   projection.

Modelica scenario replay, residual analysis, state estimation, and calibration come
after this first slice. The present approved-kit Modelica contract needs a reviewed
window/replay input contract before those claims are possible.

Operational V2 must not delay or complicate the V1 beginner journey.

## Implementation map

The human handoff and bounded planning slices are implemented. Likely implementation
locations for the remaining slices are:

| Slice                                       | Likely files                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Human handoff                               | Implemented in the domain service, HTTP adapter, Discovery BFF, browser client/UI, validation, and focused tests                         |
| Bounded plan + operation binding            | Implemented in `src/domain/engineering-project.ts`, validation, plan command service, `src/tools/project-control.ts`, and `server.ts`  |
| Reviewed intake operation registry          | Implemented as safe planning descriptors under `src/orchestration/operations/`; it does not execute providers                            |
| Exact bootstrap basis migration             | `src/domain/engineering-project.ts`, `src/domain/engineering-project-validation.ts`, `src/domain/engineering-project-command-service.ts` |
| Trusted run executor                        | New orchestration service using `RecordingMcpToolClient`, the thread materializer/store, and existing project command service            |
| Cockpit projection                          | Existing passive BFF/projector after the domain contract is stable; no provider calls in UI code                                         |
| Operational V2                              | Separate operational domain/binding/store adapters plus one bounded evaluator; no raw telemetry fields in `ThreadSnapshot`               |

The current `server.ts` also resolves a single tracked CM-01 project. A real new-product
journey will need project/discovery lookup by requested ID rather than a hard-wired
project runtime, while preserving loopback and authority checks.

## Required tests

### Domain and authority

- exact approved-discovery fingerprint is required for handoff;
- only human origin can approve the brief, create the handoff, approve/reject decisions,
  and authorize a run;
- exact command replay is idempotent; command-ID reuse with changed input fails;
- a project shell may have no thread only before technical publication and cannot claim
  completed work or evidence;
- the agent can publish planning state but cannot approve or queue it;
- planning is grounded in the exact approved-discovery handoff and accepts only the
  matching registered intake operation revision and declared bindings;
- an unknown operation, wrong entry point, undeclared binding, stale discovery answer,
  or changed command-ID replay fails closed before the plan is persisted;
- the initial run accepts only an exact approved-discovery basis;
- every later run requires an exact declared thread basis;
- queue fingerprints include operation version and decision fingerprints;
- no unknown or unregistered operation can enter a plan, be queued, or be executed.

### Trusted execution

- an unqueued, stale, changed, rejected, or already-executed run is refused before a
  provider call;
- each provider node is called at most once;
- started/completed/failed live updates are redacted and ordered;
- provider failure produces no canonical evidence;
- exact artefact digest mismatch fails closed;
- success persists and reads back a descendant `ThreadSnapshot` before project
  completion;
- completion refuses missing or foreign evidence references;
- reconnecting SSE or retrying the MCP command cannot repeat the operation.

### Product-path integration

- idea/spec, existing-CAD, and existing-product fixtures all pass through the same
  discovery, project, run, and review aggregates;
- only their registered first operation differs;
- the beginner projection contains plain-language stage, next question, recommendation,
  authorization, progress, and review state without requiring provider/tool knowledge;
- expert projections retain exact tools, hashes, inputs, units, provenance, and errors.

### Operational V2, when started

- asset/design binding is exact and versioned;
- out-of-order, bad-quality, unitless, or unbound samples fail closed;
- raw samples never enter `ThreadSnapshot` or the live UI journal;
- the selected window digest is reproducible;
- evaluation uses a non-mutating override and creates explicit window-to-evidence
  lineage;
- no operational claim is emitted when ingestion, mapping, or quality evidence is
  incomplete.

## Non-goals

- composing MCP Apps or iframes into the product cockpit;
- exposing provider credentials or endpoints to the browser;
- allowing arbitrary agent-authored workflows to execute;
- treating a direct provider result as canonical evidence;
- making every planning step a separate approval gate;
- calling a static product baseline an operational Digital Twin;
- storing raw telemetry in immutable `ThreadSnapshot` revisions;
- implementing global regulatory coverage or a general-purpose IoT platform in V1.
