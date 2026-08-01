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

The read-only BFF composes these boundaries for presentation. Its browser contract is an
`engineering-workbench/0.1` object containing `project`, the projected `thread` (whose
`live` field contains current activity), and an `alignment` status. Composition creates
a read model only; it does not promote live events into thread evidence or project
truth.

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

An approval is `pending`, `approved`, `rejected`, or `revoked`. A pending approval has
no decision timestamp, actor, or rationale. Every decided approval requires all three.
Its evidence references, base snapshot, and input fingerprint must match the decision
exactly, so approval cannot silently survive changed inputs.

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
| Verification      | `blocked`   | No mechanical criterion, material model, supports, or reference load has been reviewed |
| Industrialization | `completed` | Exact ERPNext BOM-detail artifact                                                      |

The four missing mechanical inputs are four `required` decisions and four open blockers.
There are no approvals and no claimed mechanical run. The Modelica scenario observation
does not become a product requirement, and the project snapshot invents no stress,
temperature, material, support, or load threshold.

## Validation and persistence

[`engineering-project-validation.ts`](../../src/domain/engineering-project-validation.ts)
rejects non-JSON values, unknown properties, duplicate identities, broken reciprocal
links, dependency cycles, inconsistent lifecycle timestamps, contradictory
decision/approval states, undeclared snapshot revisions, and mismatched execution
inputs.

[`FileEngineeringProjectStore`](../../src/adapters/engineering-project-store.ts) is a
read-only adapter. Every read validates the declarative project snapshot again. It has
no write or execution method, so loading the Workbench cannot approve a decision,
resolve a blocker, advance project revision, or invoke an engineering provider.
