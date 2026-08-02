# Reference: `EngineeringProjectSnapshot` contract

> **Diátaxis category: reference.** This page describes the project contract in
> [`src/domain/engineering-project.ts`](../../src/domain/engineering-project.ts), its
> strict validator, and its relationship to canonical thread evidence and live activity.

`EngineeringProjectSnapshot` is the immutable, versioned state of what an engineering
project is trying to accomplish and how the human-agent team intends to advance it. It
does not replace `ThreadSnapshot`: project state cites technical evidence but never
owns, rewrites, or manufactures that evidence.

The current schema version is `1.0`. Every value is JSON-compatible. Validation clones
and recursively freezes the accepted value, rejects unknown fields, and never fills in a
missing decision or engineering input.

## Three truth boundaries

| Boundary    | Owns                                                                                                                                                                        | Must not claim                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Project** | Objective, ordered phases, work items, agent-run lifecycle, decisions, approvals, blockers, and exact references to evidence                                                | Measurements, provenance, requirement verdicts, or transient activity |
| **Thread**  | Versioned artifacts, exact-byte consumption, observations with units, traced requirements, evaluations, violations, provenance, freshness, and proposed engineering actions | Project intent, human approval, or unpersisted execution progress     |
| **Live**    | Append-only progress and result notifications used to refresh the activity feed while work is occurring                                                                     | Canonical evidence, completion, approval, or a pass/fail verdict      |

The BFF composes these boundaries for presentation. Its browser contract is an
`engineering-workbench/0.1` object containing `project`, the projected `thread` (whose
`live` field contains current activity), `alignment`, and explicit capabilities. `GET`
and SSE create only a read model; they do not promote live events into thread evidence
or project truth. A separate, narrow command route can append project revisions, but it
cannot manufacture thread evidence or execute a provider.

## Root fields

| Field             | Contract                                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| `id`, `revision`  | Immutable project-snapshot identity and positive revision                  |
| `previous`        | Required after revision 1 and always lower than the current revision       |
| `generatedAt`     | ISO 8601 UTC materialization timestamp                                     |
| `project`         | Stable project ID, display name, thread subject ID, and explicit objective |
| `threadSnapshots` | One or more exact, declared `ThreadSnapshot` revisions                     |
| `phases`          | Ordered project phases; phase status is deliberately absent                |
| `workItems`       | Human, agent, or shared work and its explicit lifecycle state              |
| `agentRuns`       | Observable execution lifecycle and exact produced evidence                 |
| `decisions`       | Questions or proposals requiring project authority                         |
| `approvals`       | Auditable responses bound to the exact inputs approved                     |
| `blockers`        | Open or resolved conditions overlaid on affected work and phases           |
| `commandReceipts` | Optional durable idempotency and audit ledger after the first command      |

The project revision and the referenced thread revision are independent counters. For
example, project snapshot revision 1 may cite thread snapshot revision 5.

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

Runs, decisions, and approvals may also carry `baseSnapshot` plus an `inputFingerprint`.
These two fields are atomic: either both are present or neither is. The SHA-256
fingerprint represents the normalized execution or decision inputs, including values
such as material properties, supports, or loads that are not themselves thread entities.
An approval must reproduce both the decision evidence references and this execution
binding exactly. Changed inputs require a new approval.

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
correction can be scoped with the agent. The Workbench exposes no general manual proposal
or fallback data-entry form in that inbox.

### Blockers

A blocker is `open` or `resolved` and has one of four explicit kinds: `required-input`,
`decision-required`, `dependency`, or `tool-failure`. It must name at least one affected
work item through reciprocal references. Resolved blockers require a timestamp and
resolution; open blockers cannot carry either field.

### Agent runs

Agent runs expose execution state, not private reasoning. Their lifecycle is `queued`,
`running`, `waiting-for-decision`, `publishing`, `completed`, `failed`, or `cancelled`.
Timestamps must follow that lifecycle, and a completed run must cite exact thread
evidence. A run may bind its normalized inputs to an exact base snapshot and SHA-256
fingerprint using the same atomic pair as decisions.

Queueing is a human authorization over an already bounded `ready` work item. The command
creates a durable `queued` run; it does not execute a tool. An agent may claim it, append
public progress summaries,
enter `publishing`, and then complete or fail it. `statusHistory` records these public
lifecycle facts and summaries, not chain-of-thought. Completion requires a non-`latest`
result snapshot whose revision advances the run's exact base snapshot and whose complete
`previous` chain reaches that base, plus at least one unique entity reference from that
result. The completion validator resolves the base, result, intervening ancestors, and
every cited entity, then requires each cited entity to be new or content-changed relative
to the base before the project may cite it. A newer parallel branch is rejected.

## Command and authority surfaces

Every mutation carries `commandId`, `projectId`, `expectedRevision`, and `issuedAt`.
`expectedRevision` is optimistic concurrency control: stale commands fail with a
conflict instead of overwriting newer work. The durable receipt binds a command ID to
its full request fingerprint and resulting immutable snapshot. An identical retry
returns the original result; reusing the ID with different arguments is an error.

The transports grant different fixed capabilities:

| Surface               | Allowed project operations                                          | Explicitly absent                    |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| Passive browser reads | `GET /api/thread/workbench` and snapshot SSE                        | Every mutation and provider call     |
| Human browser command | Propose, approve, reject, and queue                                 | Claim, run lifecycle, provider calls |
| Agent MCP tools       | Snapshot, propose, claim/start, progress, publish/complete, fail | Approve, reject, queue               |

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

The agent surface is on the Console MCP server and exposes these tools:
`project_snapshot`, `project_decision_propose`, `project_agent_run_start`,
`project_agent_run_progress`, `project_agent_run_publish`, and `project_agent_run_fail`.
There is intentionally no MCP approval, rejection, or queue tool. Conversely, there is
no browser command for claiming or completing a run.

Project commands only mutate `EngineeringProjectSnapshot`. An agent still has to call
the reviewed provider tools, validate their results, publish a canonical
`ThreadSnapshot`, and then cite that exact evidence when completing the run. A browser
queue command and an MCP run-lifecycle command are therefore not indirect CAD, FEA,
Modelica, SysON, or ERPNext execution endpoints.

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

| Phase             | Status      | Basis                                                                                  |
| ----------------- | ----------- | -------------------------------------------------------------------------------------- |
| Definition        | `completed` | Exact SysON inventory artifact                                                         |
| Architecture      | `completed` | Exact observed SysON architecture artifact                                             |
| Design            | `completed` | Exact whole-machine STEP artifact                                                      |
| Simulation        | `completed` | Exact observed Modelica result artifact                                                |
| Verification      | `blocked`   | The bundled mechanical proof case has not been reviewed                                |
| Industrialization | `completed` | Exact ERPNext BOM-detail artifact                                                      |

The missing mechanical inputs form one `required` proof-case decision and one open
blocker. There are no approvals and zero agent runs. This is still the clean state seeded
on a fresh active store; real operator or agent commands may create later local revisions.
The Modelica scenario observation does not become a product requirement, and the project
snapshot invents no stress, temperature, material, support, or load threshold.

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
