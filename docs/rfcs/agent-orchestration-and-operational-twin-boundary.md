# RFC: Minimal agent orchestration and the operational-twin boundary

Status: **Partially implemented — V2 documentary r1 and bounded SysON container r2 landed; architecture and proof execution remain proposed**\
Scope: one beginner journey from initial intent or existing product material to
reviewable engineering evidence\
Decision horizon: V1 orchestration now; operational Digital Twin only in V2

Truth basis: source tree inspected on 2026-08-02. Current-state claims include the
loopback Discovery handoff, V2 planning and exact basis, the code-owned operation
registry, the provider-free documentary-baseline executor, and one fixed provider-backed
SysON container seed. Generic SysML architecture, requirements, CAD, FEA, simulation,
measurement, and operational Digital Twin execution remain proposed.

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
5. **Watch work and review its record.** The activity feed shows bounded operations as
   they run. The first idea/spec run produces only the canonical documentary r1. The
   next supported run records only a read-back, editable SysON container as r2; it is not
   an architecture or proof. Failures and unresolved questions stay visible.
6. **Change and repeat.** A change invalidates affected evidence, the agent proposes
   recomputation, and the person reviews the new proof and impact chain.

The three entries affect only the first reviewed operation:

| Starting point        | First bounded engineering operation                                                  | Honest V1 result                                                           |
| --------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Idea or specification | Capture the exact approved brief and reviewed plan                                   | An immutable documentary baseline; no technical model or proof             |
| Existing CAD          | Fingerprint and capture the supplied CAD before proposing semantic mappings          | A content-addressed design baseline; inferred structure remains a proposal |
| Existing product      | Capture static source material such as BOM, documents, CAD, and bounded measurements | An observed static baseline; no claim of live operational state            |

After that first baseline, all projects use the same project, decision, run, evidence,
impact, and review contracts.

For the idea/spec path, the first implemented follow-on is
`architecture.seed-syson-model@1`. It may run only from exact documentary r1 and creates
only a blank SysON project container, blank SysML document, and root package. Its r2
record is deliberately narrower than an architecture, requirements, CAD, simulation,
measurement, or verdict.

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
| Project   | `project_snapshot`, `project_plan_publish`, `project_decision_propose`, `project_agent_run_execute` | Read project truth, publish bounded unexecuted planning state, and dispatch an exact human-authorized registered V2 run |

`project_plan_publish` can create or revise an unexecuted plan from the exact approved
Discovery handoff. It records only code-validated operation references and state
bindings; it does **not** call a provider, approve a decision, queue a run, or
materialize technical evidence. Human queueing is still the authorization boundary.
`project_agent_run_execute` then resolves only that durable queued run; it accepts no
provider/tool/argument/result/evidence payload from its caller. It can dispatch exactly
two reviewed idea/spec operations:

1. `baseline.from-approved-discovery@1`, which calls no provider and materializes the
   approved-discovery documentary r1; and
2. `architecture.seed-syson-model@1`, which requires exact r1 and runs a fixed
   server-owned SysON sequence: blank project container, blank SysML document, root
   package, then root-package read-back and normalized identity capture into r2.

The second executor has no arbitrary SysML text, provider argument, or output input. It
persists a write-ahead attempt before each non-idempotent creation. If an outcome is
unknown, it fails closed for review rather than blindly retrying a possibly successful
SysON write. r2 captures container identity only; it is not an architecture,
requirements, CAD, simulation, measurement, verification, or compliance result.

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

That provider path is real but product-specific and CLI-driven. Calling providers
directly still bypasses the trusted recorder/materializer; updating a run lifecycle later
does not prove what produced the cited evidence.

## Implemented V2 r1-to-r2 boundary

The generic control plane now closes the first two bounded contracts:

```text
exact approved discovery + reviewed plan
  ---> V2 project with an approved-discovery basis
  ---> explicit human queue authorization
  ---> provider-free immutable documentary capture (SHA-256)
  ---> persisted/read-back root ThreadSnapshot r1
  ---> exact thread-snapshot basis + explicit human queue authorization
  ---> fixed SysON project/document/root-package creation + root read-back
  ---> normalized identity capture + persisted/read-back ThreadSnapshot r2
```

This avoids fabricating an empty technical snapshot. r1 is provenance for the project
starting point, not evidence that an engineering tool ran. r2 is the read-back identity
of a blank editable SysON container, not a system architecture, requirements, CAD, FEA,
simulation, measurements, or verification. The remaining gap is an architecture and
proof **technical** operation/executor contract, not the initial authorization, basis, or
minimal container contract.

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
approved state-reference bindings. The intake planning surface accepts only
`approved-discovery` and `discovery-answer` bindings; the broader domain binding union
is reserved for a reviewed later operation/executor contract. Its displayed title,
description, and work kind are derived from the registered operation rather than supplied
by the agent. The command rejects unknown operation revisions,
wrong entry points, undeclared bindings, and stale or superseded discovery answers.
It cannot approve a decision, queue a run, call a provider, or attach evidence. Once a
run, approval, blocker, non-required decision, technical evidence, or completed work
exists, this planning command cannot replace the path.

The registry currently contains three bounded intake operations and one bounded
idea/spec follow-on:

| Starting point or basis | Registered operation |
| --- | --- |
| Idea or specification | `baseline.from-approved-discovery@1` |
| Exact documentary r1 | `architecture.seed-syson-model@1` |
| Existing CAD | `baseline.capture-existing-cad@1` |
| Existing product | `baseline.capture-existing-product@1` |

The registry is intentionally a safe planning descriptor. It exposes no provider
selection, provider tool name, raw tool arguments, workflow definition, or evidence
payload. The implemented baseline executor uses the exact reviewed operation revision
for a provider-free documentary capture. The implemented SysON seed executor separately
owns its fixed provider sequence, normalized output projection, materialization, and
redacted live projection; the agent never supplies raw provider tool names or arguments.
Its non-idempotent writes are never blindly retried after an unknown outcome. Any later
architecture, requirements, CAD, simulation, or verification executor must still own its
own typed input resolution, output validation, materialization, and interruption rules.
At execution, existing-CAD and existing-product intake must resolve their supplied files
or source records through exact discovery-answer bindings. Their future executors must
fingerprint the bytes; a path or label alone never becomes evidence.

### 3. Implemented: use one exact basis type before and after the first record

V2 replaces the bootstrap-only assumption that every action already has a base thread
with an exact discriminated basis:

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

The initial planning and documentary baseline use the exact approved-discovery basis.
Once the root `ThreadSnapshot` exists, later V2 runs use an exact thread-snapshot basis.
A queue fingerprint covers:

- the basis;
- the work-item ID;
- the reviewed operation ID and version;
- every approved decision fingerprint;
- resolved non-secret operation inputs.

This is a clean schema revision: V2 runs use `basis` and reject `baseSnapshot`; V1
history remains readable but cannot fall back into the V2 path.

### 4. Implemented: one trusted execution tool with two closed operations

The agent-only MCP tool is:

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

The backend resolves all consequential detail from the human-queued run and the
server-side operation registry. For `baseline.from-approved-discovery@1` it validates the
exact V2 discovery basis and operation, claims the run, produces deterministic canonical
JSON for the approved discovery and plan, SHA-256 fingerprints and persists that document,
creates and reads back root `ThreadSnapshot` r1, validates the cited artifact, then
completes the run. Redacted lifecycle updates may appear in the feed while it runs. It
calls no provider.

For `architecture.seed-syson-model@1`, it validates exact r1 and the reviewed operation,
then executes only this server-fixed sequence: create a blank SysON project container,
create a blank SysML document with root package, and read that root package back. The
executor normalizes the returned identities, persists their SHA-256-addressed capture,
creates and reads back descendant r2, then completes the run. It accepts no caller
provider/tool choice, arguments, SysML text, file, result, or evidence payload. A durable
write-ahead attempt precedes each non-idempotent SysON write; an unknown outcome is held
for review and is never blindly retried.

The tool is not a generic workflow upload endpoint or generic technical executor. r2 is
only a container identity; it does not add an architecture, requirements, CAD,
simulation, measurement, verification, or compliance claim. Later provider-backed
operations must enforce their own input-consumption, output-validation, persistence, and
interruption rules.

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

## V2 documentary-to-container acceptance slice

The smallest implemented vertical slice is not another dashboard panel. It is two
complete, observable, deliberately bounded runs from an approved brief:

1. use the registered discovery-to-project handoff to create the exact empty project
   shell;
2. let the agent publish a minimal project path whose first work item is bound to one
   reviewed intake operation;
3. let the human authorize that exact run;
4. let `project_agent_run_execute` create the first root `ThreadSnapshot` r1 while the
   existing feed updates live;
5. show the immutable document and its provenance after completion;
6. once r1 completes its declared dependency, let the human authorize the already
   reviewed `architecture.seed-syson-model@1` work item from exact r1;
7. let the fixed server executor create and read back only a blank SysON
   project/document/root-package container, normalize its identities, and publish r2.

The path reaches those seven steps for the idea/spec starting point. r1 is deliberately
not technical evidence: it contains no provider output, technical model, geometry,
calculation, measurement, requirement evaluation, or compliance conclusion. r2 captures
the read-back identity of a blank editable container, but still contains no architecture,
requirements, CAD, simulation, measurement, or verdict. Its no-arbitrary-arguments and
no-blind-retry boundaries make it a safe first provider-backed operation, not a generic
SysON authoring surface. The next product increment is a separately reviewed operation
that can attach actual model semantics or proof to that now-explicit source baseline. The
existing CM-01 CLI flow remains a separate, product-specific demonstration of linked
technical evidence.

Existing-CAD and existing-product already have planning registry entries; they need their
own safe source-capture and technical-evidence contracts before they can execute. They
are operation variants, not separate applications or domain models.

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

The human handoff, bounded planning, exact V2 basis, documentary r1, and fixed SysON
container r2 are implemented. The remaining slices are deliberately separate:

| Slice                                       | Likely files                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Human handoff                               | Implemented in the domain service, HTTP adapter, Discovery BFF, browser client/UI, validation, and focused tests                         |
| Bounded plan + operation binding            | Implemented in `src/domain/engineering-project.ts`, validation, plan command service, `src/tools/project-control.ts`, and `server.ts`  |
| Reviewed operation registry                 | Implemented under `src/orchestration/operations/`; baseline and exact-r1 SysON container seed are executable                            |
| Exact bootstrap basis migration             | Implemented in `src/domain/engineering-project.ts`, validation, handoff, and command service                                              |
| Documentary baseline executor               | Implemented with immutable capture storage, root-snapshot materialization/read-back, project command service, and narrow MCP tool        |
| Fixed SysON container seed executor         | Implemented with server-fixed calls, root read-back, normalized capture, durable write-ahead attempts, r1-to-r2 materialization, and narrow MCP dispatch |
| Architecture and proof executors            | Future reviewed operations with provider clients, output validators, materializers, and no-retry semantics                               |
| Cockpit projection                          | Passive BFF/projector exposes planning/documentary/evidence state and redacted seed milestones; no provider calls in UI code              |
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
- a project shell may have no thread only before documentary-baseline publication and
  cannot claim completed work or evidence;
- the agent can publish planning state but cannot approve or queue it;
- planning is grounded in the exact approved-discovery handoff and accepts only the
  matching registered intake operation revision and declared bindings;
- an unknown operation, wrong entry point, undeclared binding, stale discovery answer,
  or changed command-ID replay fails closed before the plan is persisted;
- the initial run accepts only an exact approved-discovery basis;
- every later run requires an exact declared thread basis;
- queue fingerprints include operation version and decision fingerprints;
- no unknown or unregistered operation can enter a plan, be queued, or be executed.
- a plan may declare the documentary baseline followed by the SysON seed, but the seed
  becomes ready only when baseline completion has published exact r1;
- the seed queue rejects the approved-discovery basis, a forged thread reference, and an
  operation whose reviewed contract does not accept `thread-snapshot`.

### Documentary first-run execution

- an unqueued, stale, changed, or already-executed run is refused before capture;
- the run basis must exactly equal the approved discovery and plan basis;
- the canonical JSON document is byte-fingerprinted, immutable, and persisted before its
  cited root `ThreadSnapshot`;
- success reads that root snapshot back and validates the one documentary artifact before
  project completion;
- completion refuses missing or foreign evidence references;
- started/completed/failed live updates are redacted and ordered;
- reconnecting SSE or retrying the MCP command cannot repeat the operation.

### Fixed SysON container-seed execution

- only `architecture.seed-syson-model@1` with exact documentary r1 may reach its
  provider client;
- the executor accepts no provider/tool name, arguments, SysML text, result snapshot, or
  evidence payload from the MCP caller;
- project creation, document/root-package creation, and root read-back are the only
  allowed sequence; returned identities are normalized before capture;
- capture and r2 are persisted and read back before completion;
- a durable `dispatched` write attempt prevents automatic replay after an unknown
  non-idempotent provider outcome;
- r2 records no architecture, requirements, CAD, simulation, measurement, or verdict.

### Future architecture and proof execution

- each provider node must be called at most once;
- provider failure must produce no canonical evidence;
- exact artefact digest mismatch must fail closed;
- a later run must persist and read back a descendant `ThreadSnapshot` before project
  completion.

### Product-path integration

- idea/spec passes through the implemented discovery, project, authorization, first-run,
  and review aggregates;
- existing-CAD and existing-product remain planning-only until their own capture
  contracts are implemented;
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
