# Reference: `EngineeringProjectSnapshot` contract

> **Diátaxis category: reference.** This page describes the project contract in
> [`src/domain/engineering-project.ts`](../../src/domain/engineering-project.ts), its
> strict validator, and its relationship to canonical thread evidence and live activity.

`EngineeringProjectSnapshot` is the immutable, versioned state of what an engineering
project is trying to accomplish and how the human-agent team intends to advance it. It
does not replace `ThreadSnapshot`: project state cites documentary or technical thread
records but never owns, rewrites, or manufactures their evidence.

Its trace is a control substrate, not merely an audit log: the paired agent can use
proven impact to observe, evaluate, propose a bounded correction, and request a
recomputation. The human reviews and authorizes consequential changes. This reference
does not claim that the generic executor for that feedback loop exists yet.

The current creation format is schema `2.0`: every new project created from an approved
discovery handoff uses it. Schema `1.0` remains strictly readable for immutable CM-01
history; it is not a compatibility route into the V2 first-run executor. Every value is
JSON-compatible. Validation clones and recursively freezes the accepted value, rejects
unknown fields, and never fills in a missing decision or engineering input.

## Three truth boundaries

| Boundary    | Owns                                                                                                                                                                                                 | Must not claim                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Project** | Objective, ordered phases, work items, agent-run lifecycle, decisions, approvals, blockers, and exact references to evidence                                                                         | Measurements, provenance, requirement verdicts, or transient activity |
| **Thread**  | Versioned documentary or technical artifacts, exact-byte consumption, observations with units, traced requirements, evaluations, violations, provenance, freshness, and proposed engineering actions | Project intent, human approval, or unpersisted execution progress     |
| **Live**    | Append-only progress and result notifications used to refresh the activity feed while work is occurring                                                                                              | Canonical evidence, completion, approval, or a pass/fail verdict      |

The BFF composes these boundaries for presentation. Its browser contract is an
`engineering-workbench/0.2` object with an explicit surface: `planning` contains the
durable project plus the status of the first documentary baseline and redacted live
milestones; `evidence` contains the project, projected `thread` (whose `live` field
contains current activity), `alignment`, and explicit capabilities. `GET` and SSE create
only a read model; they do not promote live events into thread evidence or project
truth. A separate, narrow command route can append project revisions, but it cannot
manufacture technical provider evidence.

## Root fields

| Field              | Contract                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `id`, `revision`   | Immutable project-snapshot identity and positive revision                                                    |
| `previous`         | Required after revision 1 and always lower than the current revision                                         |
| `generatedAt`      | ISO 8601 UTC materialization timestamp                                                                       |
| `project`          | Stable project ID, display name, thread subject ID, and explicit objective                                   |
| `discoveryHandoff` | Optional exact approved-discovery provenance; only valid for a human-created initial project                 |
| `plan`             | Optional agent-published, unexecuted path grounded in that exact approved discovery                          |
| `threadSnapshots`  | Exact declared `ThreadSnapshot` revisions; may be empty only before the V2 documentary baseline is published |
| `phases`           | Ordered project phases; phase status is deliberately absent                                                  |
| `workItems`        | Human, agent, or shared work and its explicit lifecycle state                                                |
| `agentRuns`        | Observable execution lifecycle and exact produced evidence                                                   |
| `decisions`        | Questions or proposals requiring project authority                                                           |
| `approvals`        | Auditable responses bound to the exact inputs approved                                                       |
| `blockers`         | Open or resolved conditions overlaid on affected work and phases                                             |
| `commandReceipts`  | Durable idempotency and audit ledger after a command-created revision                                        |

The project revision and the referenced thread revision are independent counters. For
example, project snapshot revision 1 may cite thread snapshot revision 5.

## Discovery handoff

`discoveryHandoff` records the exact discovery ID, snapshot ID and revision, approved
brief ID and fingerprint, approval time, and human approver. The first command receipt
is `project.create-from-discovery`. The create operation is atomic and idempotent; a
different request cannot reuse its command ID or existing project ID.

This is planning provenance, not engineering evidence. The initial handoff revision may
have empty phases, work, decisions, runs, approvals, blockers, and `threadSnapshots`.
Its derived status is `planned`, never a fabricated completion. An agent may later
publish an unexecuted project path from this exact handoff. The first authorized V2 run
can then record a documentary baseline; SysON modeling and every technical proof still
require later authorized work and their own evidence.

## Agent-published plan and reviewed operations

`plan` is present only after the agent-only `project_plan_publish` command. It records
the starting point, the exact approved-discovery basis copied from `discoveryHandoff`,
and server-stamped agent publisher/time. It is durable planning state, not a whole-plan
approval, provider invocation, run authorization, or technical result.

Each work item created by that command has an `operation` reference with an exact ID,
version, and state-reference bindings. The code-owned registry accepts only its reviewed
operation revisions and declared binding names/source kinds; it also supplies the
durable work title, description, and classification shown to the reviewer. The initial
registry contains:

| Starting point                                                                 | Exact operation reference                    |
| ------------------------------------------------------------------------------ | -------------------------------------------- |
| Idea or specification                                                          | `baseline.from-approved-discovery@1`         |
| Same initial idea/specification plan; exact documentary r1 required at runtime | `architecture.seed-syson-model@1`            |
| Same initial idea/specification plan; exact SysON r2 required at runtime       | `architecture.author-inspection-drone@1`     |
| Existing CAD                                                                   | `baseline.capture-existing-cad@1`            |
| Existing product                                                               | `baseline.capture-existing-product@1`        |

For this intake-only planning surface, bindings may refer only to the approved discovery
itself or to a current provided answer in that same exact discovery. Later operation
revisions may introduce decision or thread-entity bindings only together with their
reviewed executor contract; they are not accepted by `project_plan_publish` today.

`architecture.seed-syson-model@1` and
`architecture.author-inspection-drone@1` may be planned from the same approved
discovery, but that binding is planning provenance, not a SysON runtime argument. Their
later execution requires the exact documentary r1 and SysON r2 thread snapshots,
respectively. The latter must already be in that initial plan: planning cannot be
revised after r1 has been produced.

These references deliberately expose no provider, tool name, raw input, workflow, or
evidence payload. Publishing rejects unknown revisions, wrong starting points,
undeclared bindings, and discovery-answer bindings that are absent, no longer current,
or not provided in the exact approved discovery revision. An agent may revise planning
only while no baseline run, approval, blocker, concrete decision proposal, or
completed/cancelled work exists. It cannot use a plan revision to erase execution or
review history.

Three operations have trusted executors in the current V2 source slice.
`baseline.from-approved-discovery@1` has no provider call: after explicit human
queueing, the trusted backend records the exact approved discovery and reviewed plan as
a canonical JSON document, fingerprints its bytes with SHA-256, stores the bytes
immutably, and cites that document from root thread revision 1.

`architecture.seed-syson-model@1` is available only after that exact documentary root.
Its fixed server-owned sequence is `syson_project_create`, then `syson_model_create`
with a root package, then root-package readback through `syson_element_get`. It records
only the normalized project, document, and root-package identities in a
content-addressed capture before it publishes and reads back revision 2. The agent
supplies no provider name, tool name, or provider arguments.

`architecture.author-inspection-drone@1` is available only on the exact r2 container,
after the exact approved discovery has selected
`primary-mission = inspection-controlled` and
`payload-class = light-inspection-camera`. It accepts no caller-authored SysML or
provider arguments; the server inserts one fixed high-level fragment only after an empty
root readback, then records a narrow attestation and model readback before it could
publish r3. The operation is implemented in source but has neither been released to the
running toolchain nor exercised against a real SysON instance. It is not CAD, physics,
flight, cost, compliance, or a verified requirement result. The two existing-CAD/product
registry entries remain planning descriptors until their own file/source capture and
technical-evidence contracts exist.

## V2 execution bases, documentary baseline, SysON seed, and guarded r3

V2 does not invent an empty technical snapshot merely to satisfy a bootstrap API. Each
run instead has one exact `basis`:

```ts
type EngineeringBasisRef =
  | EngineeringApprovedDiscoveryBasis
  | EngineeringThreadSnapshotBasis;
```

The `approved-discovery` arm must exactly equal the approved handoff and published plan.
It is accepted only for `baseline.from-approved-discovery@1`, before any thread snapshot
exists. Once that run has published its root record, the implemented SysON seed requires
that exact revision-1 documentary `thread-snapshot` basis; `latest` is never accepted.

The first result is intentionally a **documentary, pre-technical baseline**. Its single
document artifact contains the immutable approved discovery and reviewed plan, its
SHA-256 fingerprint, an immutable capture URI, the bounded operation revision, and its
run provenance. It proves that the project started from that reviewed source. It does
**not** prove or create a SysML model, CAD geometry, mesh, FEA result, simulation,
measurement, requirement verdict, conformity claim, or certification.

The first continuation is deliberately narrower than a system design:

```text
approved discovery + reviewed plan
  -> baseline.from-approved-discovery@1
  -> documentary ThreadSnapshot revision 1
  -> architecture.seed-syson-model@1 on that exact basis
  -> syson_project_create -> syson_model_create(root) -> syson_element_get(root)
  -> content-addressed capture + ThreadSnapshot revision 2
  -> architecture.author-inspection-drone@1 on that exact r2 basis
  -> guarded empty-root check -> one fixed insert -> narrow readback
  -> content-addressed capture + ThreadSnapshot revision 3
```

Revision 2 adds one `sysml-model` artifact and the exact SysON project identity. Its
documentary revision-1 basis authorizes the run; it is not a byte-level SysON input
artifact. The seed proves neither model semantics nor requirements, CAD, FEA,
simulation, measurements, evaluation, violation, conformity, or certification. A future
technical operation must capture and validate its own provider evidence before it can
make any of those claims.

The r3 source contract is narrower still than a design or proof loop. It can only use a
hash-valid r2 seed capture and the same approved discovery's two exact answers:
`inspection-controlled` and `light-inspection-camera`. Its named SysML decomposition and
high-level intent requirements are model content, not measured acceptance criteria or
verified thread verdicts. No r3 provider mutation, real SysON conformance result, or
release is recorded yet.

Schema `1.0` records retain the former `baseSnapshot` field solely for historic reading.
Schema `2.0` rejects `baseSnapshot` on a run and rejects `basis` on a V1 run: there is
no automatic fallback or promotion between the two formats.

## Exact thread references

A root thread reference always names the full immutable identity:

```json
{
  "snapshotId": "coffee-machine-cm01:r5:coffee-machine-build-coffee-machine-cm01-cad-baseline-extension",
  "revision": 5,
  "subjectId": "coffee-machine-cm01"
}
```

Evidence references add the entity kind and ID inside that exact revision:

```json
{
  "snapshotId": "coffee-machine-cm01:r5:coffee-machine-build-coffee-machine-cm01-cad-baseline-extension",
  "snapshotRevision": 5,
  "kind": "artifact",
  "id": "coffee-machine-build-coffee-machine-cm01-cad-baseline-step"
}
```

`latest`, filenames, display labels, and provider names are not evidence references. The
project validator first requires every entity reference to use a declared snapshot
revision. At the BFF boundary,
`validateEngineeringProjectThreadReferences(project, snapshots)` additionally resolves
each reference against the supplied canonical `ThreadSnapshot`; a newer local snapshot
does not satisfy a reference to an older revision.

V2 runs carry an exact `basis` plus an `inputFingerprint`. The queue fingerprint covers
that basis, work-item ID, reviewed operation ID and version, approved-decision
fingerprints, and declared state bindings. A changed input, operation revision, or basis
therefore needs a new human authorization. Decisions and approvals retain exact evidence
references and their own input fingerprints; an approval cannot silently survive changed
inputs.

## Ordered phases and derived status

Each phase declares a unique, contiguous `order`, its work-item IDs, required-decision
IDs, and exact evidence references. A persisted `status` field on a phase is invalid.
`deriveEngineeringPhaseStatus` computes one of:

| Derived status | Condition                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `blocked`      | At least one open blocker belongs to the phase                                                                 |
| `completed`    | Every phase work item is completed, every required decision is approved, and the phase cites evidence          |
| `active`       | Work is in progress or waiting for a decision, or an associated run is queued, running, waiting, or publishing |
| `planned`      | None of the conditions above applies                                                                           |

Blockers are the sole blocking overlay. `EngineeringWorkItemStatus` intentionally has no
`blocked` value, avoiding two competing sources for the same fact. A work item can be
`planned`, `ready`, `in-progress`, `waiting-for-decision`, `completed`, or `cancelled`.
A completed work item must cite exact thread evidence.

`deriveEngineeringProjectStatus` produces the cockpit header signal. It returns
`completed` when every phase is complete, `attention-required` while a decision is
required or proposed, then `blocked`, `active`, or `planned` according to the derived
phase states. It is also a projection and is never persisted in the project snapshot.

## Work, decisions, approvals, blockers, and runs

### Work items

Every work item belongs to exactly one phase and declares:

- a kind such as `define`, `architect`, `design`, `simulate`, `verify`, or
  `industrialize`;
- an owner: `human`, `agent`, or `shared`;
- acyclic dependencies on other work items;
- evidence, decision, and blocker references.

An optional `operation` is a reviewed, versioned capability reference, never a raw tool
call or agent-authored workflow. It is present on work created by
`project_plan_publish`; older immutable revisions may lack it and are never promoted
into the new execution path by implication. In the current V2 slice,
`baseline.from-approved-discovery@1` has the provider-free documentary executor and
`architecture.seed-syson-model@1` has the fixed SysON model-container executor. No
generic technical executor exists; other operation references remain planning-only until
a separate reviewed executor exists.

`waiting-for-decision` requires at least one linked unresolved decision. A phase lists
all work items assigned to it, exactly once.

### Decisions and approvals

A decision moves through `required`, `proposed`, `approved`, `rejected`, or
`superseded`. `required` means that the question is known but no concrete proposal is
ready for approval. `proposed` requires a pending approval. Approved or rejected
decisions require a matching approved or rejected approval; a superseded decision must
be named by its replacement.

A concrete proposal has a non-empty summary and one or more typed parameters. Each
parameter has a stable key, a label, and a string, finite number, or boolean value. A
unit is allowed only with a numeric value. The command service stamps the authoritative
proposal time and actor and computes the exact SHA-256 input fingerprint; clients do not
choose those audit fields.

An approval is `pending`, `approved`, `rejected`, or `revoked`. A pending approval has
no decision timestamp, actor, or rationale. Every decided approval requires all three.
Its evidence references, base snapshot, and input fingerprint must match the decision
exactly, so approval cannot silently survive changed inputs.

Approval and rejection are human-only operations. They require a rationale and the exact
proposal fingerprint presented to the operator. An approval resolves only the blockers
whose linked decisions are all approved. A work item becomes `ready` only when all of
its decisions, blockers, and work-item dependencies are satisfied.

The native cockpit interprets these states by owner rather than grouping them into one
generic pending bucket: `required` and `rejected` wait on agent preparation; `proposed`
waits on human review. Only a proposed decision is counted as a human action. The
presentation rule is intentionally narrower than the command contract: **Project** only
shows a lightweight review notification; **Activity** supplies the evidence and lineage
for review; and **Product** is the SysON/specification inspection context from which a
correction can be scoped with the agent. The Workbench exposes no general manual
proposal or fallback data-entry form in that inbox.

### Blockers

A blocker is `open` or `resolved` and has one of four explicit kinds: `required-input`,
`decision-required`, `dependency`, or `tool-failure`. It must name at least one affected
work item through reciprocal references. Resolved blockers require a timestamp and
resolution; open blockers cannot carry either field.

### Agent runs

Agent runs expose execution state, not private reasoning. Their lifecycle is `queued`,
`running`, `waiting-for-decision`, `publishing`, `completed`, `failed`, or `cancelled`.
Timestamps must follow that lifecycle, and a completed run must cite exact thread
evidence. A V2 run binds its normalized inputs to an exact discriminated `basis` and
SHA-256 fingerprint.

Queueing is a human authorization over an already bounded `ready` work item. The command
creates a durable `queued` run; it does not execute a provider. The agent can invoke the
narrow executor only for that exact queued run. It claims the run before
materialization, records redacted progress, persists the capture and resulting snapshot,
reads the snapshot back, then completes or fails the run. `statusHistory` records public
lifecycle facts and summaries, not chain-of-thought.

For the discovery-basis first run, the dedicated validator requires root revision 1 and
the exact documentary artifact produced by the reviewed operation; it does not pretend
the result descends from a fabricated base. The first SysON seed requires that exact
documentary root as its `thread-snapshot` basis. It persists and reads back its closed
identity capture and revision 2 before completion. For a later thread-snapshot-basis
run, completion requires a non-`latest` result whose revision advances the exact base
and whose complete `previous` chain reaches that base, plus at least one unique entity
that is new or content-changed from the base. A newer parallel branch is rejected.

The source-only inspection-drone r3 executor adds a narrower pre-queue gate: exact r2,
its hash-valid seed capture, and the same approved discovery's explicit
`primary-mission = inspection-controlled` and
`payload-class = light-inspection-camera` answers. It then refuses a non-empty root
rather than merging model content. Those gates do not make a real SysON run or a
technical claim; none has been recorded for r3.

## Command and authority surfaces

Every mutation carries `commandId`, `projectId`, `expectedRevision`, and `issuedAt`.
`expectedRevision` is optimistic concurrency control: stale commands fail with a
conflict instead of overwriting newer work. The durable receipt binds a command ID to
its full request fingerprint and resulting immutable snapshot. An identical retry
returns the original result; reusing the ID with different arguments is an error.

The transports grant different fixed capabilities:

| Surface               | Allowed project operations                                                                                                          | Explicitly absent                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Passive browser reads | `GET /api/thread/workbench` and snapshot SSE                                                                                        | Every mutation and provider call                     |
| Human browser command | Propose, approve, reject, and queue                                                                                                 | Publish a path, claim, run lifecycle, provider calls |
| Agent MCP tools       | Snapshot, publish/revise an unexecuted plan, propose, and execute the exact human-queued registered V2 run                         | Approve, reject, queue, arbitrary provider calls     |

`decision.propose` is a narrow command capability, not a promise of a generic browser
data-entry workflow. The Project review inbox does not expose manual technical proposal
or fallback controls; it directs the reviewer to Activity and, when technical work needs
to change, to the relevant Product/SysON specification context. Approval, rejection, and
queue authorization remain explicit human-only boundaries even when the agent prepared
the recommendation.

The human route is `POST /api/project/commands`. It accepts only exact same-origin JSON
requests carrying `X-Casys-Operator-Intent: explicit`; the request body cannot upgrade
its authority. Its local actor ID is self-declared and recorded for audit, but this
prototype does **not** authenticate that identity. Do not expose the loopback service as
an authenticated multi-user control plane.

Agent mutation receipts use the authenticated MCP subject when one is available.
Otherwise `claimedBy` is derived from the client's self-declared MCP name and version;
it is an audit label, not proof of identity. Project mutation tools are therefore a
loopback-only prototype surface until transport authentication is required.

The agent surface is on the Console MCP server and exposes the bounded planning and run
tools, including `project_agent_run_execute`. That executor accepts only project ID,
expected revision, run ID, command ID, and issue time. It resolves the basis, operation,
and bindings from durable server state; callers cannot supply a provider name, tool
name, raw argument, workflow, result, or evidence reference. There is intentionally no
MCP approval, rejection, queue, or generic provider-execution tool. Conversely, there is
no browser command for publishing an agent path or completing a run.

The source dispatcher materializes only three reviewed operations.
`baseline.from-approved-discovery@1` has no provider invocation and persists its
canonical capture before publishing the cited root snapshot. The seed operation has only
the fixed SysON project/document/root-package sequence described above; it has a closed
normalizer, capture, materializer, and result validator before it publishes revision 2.
The inspection-drone operation adds only its fixed high-level fragment to the exact,
empty r2 root after its exact discovery gates; it does not accept arbitrary SysML.
It is code-implemented but not released or run against a real SysON instance.
Neither a browser queue command nor an MCP planning command is an indirect CAD, FEA,
Modelica, SysON, or ERPNext endpoint, and no generic provider execution is available.

## CM-01 baseline

[`coffee-machine-cm01.project.json`](../../config/projects/coffee-machine-cm01.project.json)
is project snapshot revision 1. It cites only the clean CM-01 thread baseline:

```text
coffee-machine-cm01:r5:coffee-machine-build-coffee-machine-cm01-cad-baseline-extension
```

That exact thread revision contains the observed SysON system definition, product
architecture, whole-machine build123d CAD, Modelica run, and ERPNext BOM evidence. It
does not cite the historical support-bracket demo.

The project honestly derives these phase states:

| Phase             | Status      | Basis                                                   |
| ----------------- | ----------- | ------------------------------------------------------- |
| Definition        | `completed` | Exact SysON inventory artifact                          |
| Architecture      | `completed` | Exact observed SysON architecture artifact              |
| Design            | `completed` | Exact whole-machine STEP artifact                       |
| Simulation        | `completed` | Exact observed Modelica result artifact                 |
| Verification      | `blocked`   | The bundled mechanical proof case has not been reviewed |
| Industrialization | `completed` | Exact ERPNext BOM-detail artifact                       |

The missing mechanical inputs form one `required` proof-case decision and one open
blocker. There are no approvals and zero agent runs. This is still the clean state
seeded on a fresh active store; real operator or agent commands may create later local
revisions. The Modelica scenario observation does not become a product requirement, and
the project snapshot invents no stress, temperature, material, support, or load
threshold.

## Completed CM-01 reference lifecycle

The 2026-08-02 local reference execution demonstrates the intended immutable progression
without changing the tracked revision-1 seed. A human approved the exact
`review-mechanical-proof-case` proposal and queued
`run:erwan-authorize-cm01-mechanical-run-v1`; an agent claimed it, ran the providers,
entered `publishing`, attached canonical technical evidence, and then completed it.

Active project revision 10 records both that agent run and
`verify-current-mechanical-design` as `completed`. Their exact result is:

```text
coffee-machine-cm01:r6:coffee-machine-mechanical-run:erwan-authorize-cm01-mechanical-run-v1-extension
```

That snapshot contains exact DripTray STEP consumption, two unit-bearing CalculiX
observations, the approved `1 mm` / `20 MPa` SysON requirements, and two passing
evaluations. The evidence boundary remains the isolated ABS-like concept DripTray under
the reviewed `100 N` case. Project completion does not imply whole-machine verification,
fabrication release, or certification.

## Validation and persistence

[`engineering-project-validation.ts`](../../src/domain/engineering-project-validation.ts)
rejects non-JSON values, unknown properties, duplicate identities, broken reciprocal
links, dependency cycles, inconsistent lifecycle timestamps, contradictory
decision/approval states, undeclared snapshot revisions, and mismatched execution
inputs.

[`FileEngineeringProjectStore`](../../src/adapters/engineering-project-store.ts) remains
the validated tracked-manifest loader. At runtime it seeds revision 1 only when no
active project exists.
[`FileEngineeringProjectRevisionStore`](../../src/adapters/engineering-project-store.ts)
then owns append-only active state under `state/local/engineering-projects/<project>/`.
Each numbered revision is deterministic JSON; an exclusive claim file is the
cross-process compare-and-swap boundary. A later active revision always wins over the
tracked seed, and a claimed but unpublished head fails closed.

Every read validates again. Every write extends the exact current `id` and revision,
records `previous`, and passes the full domain validator before publication. Loading or
following the Workbench is still passive; only an explicit authorized command can
advance project state, and no project-store method invokes an engineering provider.

The V2 documentary capture bytes are a separate immutable object under
`state/local/approved-discovery-captures/`, named by their SHA-256 digest. Existing
identical content is idempotent; different content at the same digest is rejected. The
executor persists those bytes before it publishes the thread snapshot that cites their
logical capture URI. This ordering makes the document auditable without treating it as
technical tool evidence.

### SysON model-seed capture and recovery

The seed stores its closed, normalized identity capture under
`state/local/syson-model-seed-captures/`, also named by SHA-256 digest and cited as
`casys://syson-model-seed-capture/sha256/<digest>`. It saves and reads that capture back
before it saves and reads back revision 2. The capture contains only the identities of
the created SysON project, SysML document, and root package; it excludes raw provider
responses, transport metadata, credentials, arbitrary arguments, model semantics, and
any requirement or verdict.

`FileSysonModelSeedAttemptStore` writes a durable `dispatched` record under
`state/local/syson-model-seed-attempts/` before each non-idempotent SysON creation. A
completed attempt retains only its normalized identity result. If a provider outcome is
unknown, the executor does not retry it automatically: the operator must inspect SysON
outside this early slice. The current MCP and cockpit intentionally expose no recovery
or requeue action for an uncertain write, so the run remains stopped rather than risking
a duplicate project or document. If revision 2 is already durable but the project
attachment did not finish, retrying the same execution command may redo only the
read-only readback, materialization, and idempotent persistence of the recorded result,
then completes the attachment; it never repeats non-idempotent writes or recreates
provider state. This journal is recovery control state, not thread evidence.

The executor deliberately persists and reads back r2 before it asks the project command
service to attach that exact result and complete the run. That ordering makes an
interrupted attachment resumable without repeating provider writes. It does **not** make
r2 browser-visible early: while the seed run is still running, waiting, or publishing,
the Workbench holds the declared documentary r1 and renders only its closed live
activity sequence. The evidence surface can promote r2 only after the immutable project
revision has attached it.

### Inspection-drone architecture capture and recovery

The source-only r3 operation keeps its separate normalized capture under
`state/local/inspection-drone-architecture-captures/`, addressed by SHA-256, and its
single-write attempt record under `state/local/inspection-drone-architecture-attempts/`.
The capture can contain the fixed recipe/source hash, the exact r2 authorization, the
insertion attestation, and the narrow package/declaration readback; it excludes raw
provider payloads, credentials, caller-authored SysML, and verdicts. A `dispatched`
write with unknown provider outcome is never replayed automatically. Once a completed
insert has been recorded, a retry may resume only readback, materialization, and
idempotent persistence. This recovery design has not yet been tested against a real
SysON instance and does not establish CAD, physics, flight, cost, compliance, or
requirements verification.

`FileEngineeringProjectRunLease` additionally holds one local advisory lock for the
exact `(projectId, runId)` while the trusted V2 executor runs. Its retained empty file
under `state/local/engineering-project-run-leases/` is coordination state only: it is
not a capture, artifact, result, or engineering claim. A duplicate execution waits and
then reads the durable outcome instead of creating a competing capture or lifecycle
transition. The lease serializes local writers but cannot itself prove remote-provider
idempotence; the write-ahead attempt journal supplies the fail-closed recovery boundary.
