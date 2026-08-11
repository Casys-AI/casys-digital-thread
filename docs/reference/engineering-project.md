# Reference: `EngineeringProjectSnapshot` contract

> **Diátaxis category: reference.** This page describes the project contract in
> [`src/domain/project/engineering-project.ts`](../../src/domain/project/engineering-project.ts),
> its strict validator, and its relationship to canonical thread evidence and live
> activity.

`EngineeringProjectSnapshot` is the immutable, versioned state of what an engineering
project is trying to accomplish and how the human-agent team intends to advance it. It
does not replace `ThreadSnapshot`: project state cites documentary or technical thread
records but never owns, rewrites, or manufactures their evidence.

Its trace is a control substrate, not merely an audit log: the paired agent can use
proven impact to observe, evaluate, propose a bounded correction, and request a
recomputation. The human reviews and authorizes consequential changes. This reference
does not claim that the generic executor for that feedback loop exists yet.

The current creation format is schema `3.0`: the project exists from the first intent
and its living brief evolves inside that same immutable revision stream. Older snapshots
are not a creation route for new work. Every value is JSON-compatible. Validation clones
and recursively freezes the accepted value, rejects unknown fields, and never fills in a
missing decision or engineering input.

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
truth. Project mutations and bounded provider orchestration remain on the paired agent's
MCP surface.

## Root fields

| Field             | Contract                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `id`, `revision`  | Immutable project-snapshot identity and positive revision                                           |
| `previous`        | Required after revision 1 and always lower than the current revision                                |
| `generatedAt`     | ISO 8601 UTC materialization timestamp                                                              |
| `project`         | Stable project ID, display name, thread subject ID, and explicit objective                          |
| `framing`         | V3 intent, questions, sourced answers, proposed brief and exact approved canonical brief            |
| `plan`            | Optional agent-published path grounded in the exact approved canonical brief for V3                 |
| `threadSnapshots` | Exact declared `ThreadSnapshot` revisions; empty before the first documentary baseline is published |
| `phases`          | Ordered project phases; phase status is deliberately absent                                         |
| `workItems`       | Human, agent, or shared work and its explicit lifecycle state                                       |
| `agentRuns`       | Observable execution lifecycle and exact produced evidence                                          |
| `decisions`       | Questions or proposals requiring project authority                                                  |
| `approvals`       | Auditable responses bound to the exact inputs approved                                              |
| `blockers`        | Open or resolved conditions overlaid on affected work and phases                                    |
| `commandReceipts` | Durable idempotency and audit ledger after a command-created revision                               |

The project revision and the referenced thread revision are independent counters. For
example, project snapshot revision 1 may cite thread snapshot revision 5.

## Living brief in schema 3.0

Revision 1 is created by `project_start` from the reported plain-language intent. The
same project then records adaptive questions, sourced answers, immutable brief
proposals, and exact human review. `currentBrief` remains canonical while a newer
`proposedBrief` is pending or rejected. Approval is bound to its exact snapshot,
revision, and SHA-256 input fingerprint through signed MCP elicitation.

The approved brief is stakeholder and planning truth, not a SysML model or technical
result. Formal requirements, CAD, calculations, measurements, verdicts and compliance
evidence remain owned by their linked provider and `ThreadSnapshot` records. See the
[living project brief reference](project-brief.md).

## Agent-published plan and reviewed operations

`plan` is present only after the agent-only `project_plan_publish` command. In V3 it
records the starting point, exact `approved-brief` basis, and server-stamped agent
publisher/time. It is durable planning state, not a whole-plan approval, provider
invocation, run authorization, or technical result.

`project_plan_publish` is deliberately limited to an unexecuted project: the exact
approved brief is the planning source. Once the documentary baseline has completed, an
agent uses `project_change_append` to publish the next bounded change. The command
carries an exact current `baseSnapshot`; every change also retains the exact
`approvedBriefBasis` that authorized it. It can append only new phases, work items, and
required decisions. It preserves the initial plan and all prior phases, work, decisions,
approvals, runs, evidence, and thread references in the next immutable project revision.
This is not a plan replacement and it cannot amend or erase project truth. The change
anchors are planning provenance; later runs still use their distinct, server-derived
exact `basis`.

Each work item created by either command has an `operation` reference with an exact ID,
version, and state-reference bindings. The code-owned registry accepts only its reviewed
operation revisions and declared binding names/source kinds; it also supplies the
durable work title, description, and classification shown to the reviewer. The generic
entry-point registry contains:

| Starting point or exact prerequisite                                          | Exact operation reference          |
| ----------------------------------------------------------------------------- | ---------------------------------- |
| New V3 idea or specification                                                  | `baseline.from-approved-brief@1`   |
| Post-baseline change; exact documentary r1 required at runtime                | `architecture.seed-syson-model@2`  |
| Human-reviewed architecture; exact generic SysON basis required               | `model.write-architecture@1`       |
| Human-reviewed integer scalar requirements; exact architecture basis required | `model.write-requirements@1`       |
| Human-reviewed geometry draft; exact architecture basis required              | `design.write-geometry@1`          |
| Human-reviewed simulation case; exact thread-snapshot basis required          | `simulate.seal-simulation-case@1`  |
| Sealed simulation-case artifact in basis; thread-entity binding required      | `simulate.run-modelica-scenario@1` |
| Human-reviewed FEA proof case; exact geometry and requirements-tip in basis   | `verify.seal-proof-case@1`         |
| Sealed proof-case and geometry artifacts in basis; thread-entity bindings     | `verify.run-fea-static-proof@1`    |
| Human-approved retirement decision; exact thread-entity targets required      | `record.archive-lineage@1`         |

The V3 baseline binding names only the exact human-approved brief. After r1,
`architecture.seed-syson-model@2` may be added by one append-only project change. The
change's exact current snapshot is provenance, not a SysON runtime argument. Its
execution requires exact documentary r1. The agent must not assume a later snapshot is
equivalent: queueing derives and records the exact basis for each bounded run.

These references deliberately expose no provider, tool name, raw input, workflow, or
evidence payload. Publishing rejects unknown revisions, wrong starting points,
undeclared bindings, or a brief binding that does not match the exact approved project
revision. An agent may revise the initial plan only while no baseline run, approval,
blocker, concrete decision proposal, or completed/cancelled work exists. After that
point it may append a bounded change, but cannot use either command to erase execution
or review history.

Ten generic operations have trusted executors in the current V3 idea/spec slice.
`baseline.from-approved-brief@1` has no provider call: after the agent queues the ready
registered work item, the backend records the exact approved brief and reviewed plan as
canonical JSON, fingerprints its bytes with SHA-256, stores them immutably, and cites
that document from root thread revision 1.

`architecture.seed-syson-model@2` is available only after that exact documentary root.
Its fixed server-owned sequence is `syson_project_create`, then `syson_model_create`
with a root package, then root-package readback through `syson_element_get`. Its
`syson-model-seed-capture/2.0` preserves the exact approved-brief, project-change and
documentary-artifact lineage alongside normalized provider identities before publishing
revision 2. The agent supplies no provider name, tool name, provider arguments, or SysML
text.

`model.write-architecture@1` consumes an exact technical basis carrying that seed and
one human-approved MRTR proposal. The proposal names a package, a system, and typed
component usages through the flat `architecture.package`, `system.name`, and
`component.<slug>.(name|usage|parent)` grammar. Each component row is one `PartUsage`
occurrence: `name` selects its reusable `PartDefinition`, while `usage` is unique only
inside the named parent. The server renders each definition once, journals the
non-idempotent insertion, re-reads every parent-to-usage-to-type relationship, and
publishes only the verified content-addressed capture. The agent cannot supply raw SysML
or a provider call.

`model.write-requirements@1` starts only from an exact generic architecture artifact.
Its MRTR proposal identifies the reviewed target and declares named integer scalar
thresholds through `requirements.*` and `requirement.<slug>.*` parameters. The server
derives the native `RequirementUsage` below the exact target `PartDefinition`, verifies
its `subject target` typing and constraints by provider readback, and persists a
`requirements-capture/2.0`. The Thread receives one `TracedRequirement` per verified
integer scalar criterion and preserves the exact architecture and prior-requirements
lineage. Legacy detached `requirements-capture/1.0` records are not silently enriched.
This operation records model requirements; it does not evaluate them, invent
measurements, or publish a pass/fail verdict.

Geometry is a two-step boundary. `project_geometry_preview` is planning-only and runs
agent-proposed, validated source only in `build123d-sandbox`. Legacy
`geometry-draft-capture/1.1` remains readable and assembly-only. A complete bundle uses
`geometry-draft-capture/2.0`: one exact assembly source plus one exact source per unique
SysML `PartDefinition`, dispatched as an isolated N+1 sequence after every source and
identity validates. Its manifest requires authoritative STEP for the assembly and each
definition, and an exhaustive, identity-based `PartUsage -> PartDefinition -> placement`
table in a right-handed millimetre frame with extrinsic X/Y/Z degree rotations. The
placement is local to the PartDefinition that owns the PartUsage; reusing that parent
repeats the local placement on each expanded product path without duplicating the
semantic PartUsage declaration. build123d's `gltf` token is accepted only with its
actual binary `.glb` output.

The preview returns flat decision parameters for a fresh human review. Only
`design.write-geometry@1` may seal those approved hashes. `geometry-manifest/1.0`
retains the existing `geometry-capture/1.1` meaning; the explicit
`geometry-manifest/2.0` discriminator produces `geometry-capture/2.0`, retains the
approved editable sources and ordered N+1 provenance, and publishes independent
definition assets without changing legacy replay. The seal makes no provider call. An
upgrade must name the unique active predecessor, archives its exact geometry family, and
records `derived_from` plus `supersedes`; ambiguity fails before canonical writes.
Product projection rereads the v2 capture and attaches the seal-owned authoritative STEP
artifact to each exact SysML occurrence. Reused definitions share that binding; labels
are never joins and no `build123d` provider identity is invented.

`record.archive-lineage@1` is the governed retirement step. No constant in its executor
names a product: project identity comes from the exact run basis, and the work item
binds one or more exact thread-entity targets. Execution requires a human-approved MRTR
decision whose sealed evidence refs equal those exact targets and basis, and the
approval elicitation renders the server-stamped refs as canonical JSON — an injective
encoding, so no ID can forge another target list — and the approver sees precisely what
will be retired. The executor computes the domain-pure archive cascade, refuses a fully
redundant closure, and publishes the successor snapshot with CAS readback. It makes no
provider call; history stays readable while current views exclude the retired lines.

`simulate.seal-simulation-case@1` seals the human-reviewed OpenModelica simulation case
into the thread without any provider call. Its signed MRTR proposal carries the flat
`sim.case.*` grammar: case ID, digest, kit model ID and SHA-256, scenario ID and
SHA-256, explicit parameter overrides with units, timeout, and expected metric names and
units. The executor resolves the case path through the server-owned
`SIMULATION_CASE_SOURCES` catalog — the agent never supplies a path or raw case bytes —
validates the JSON against the `simulation-case/1.0` contract, computes
`canonicalCaseText` and its SHA-256, and fails immediately if the MRTR-signed digest
diverges. The Modelica kit lives outside the thread in the provider's own store;
`inputArtifactIds` is intentionally empty — claiming consumption for bytes that cannot
be verified by content address would be a false attestation. The honest boundary is the
`{modelSha256, scenarioSha256}` pair sealed inside `canonicalCaseText`. The
`simulation-case-capture/1.0` record is stored by content address; the thread extension
receives one `document` artifact (version = `caseDigest`, the monotony-ratchet key). No
`simulate.run-modelica-scenario@1` run may proceed without this sealed mandate.

`simulate.run-modelica-scenario@1` is observational: it never produces a verdict and a
structural triple-lock (`verdictStatus: not_evaluated`, `requirements: []`, zero
passed/failed/unresolved counts) is enforced verbatim by `validateThreadSnapshot` before
any snapshot is persisted. The executor re-reads the `simulation-case-capture/1.0` by
content address, verifies the bound `simulationCase` artifact's `caseDigest` in the
current basis, and confirms kit availability and each parameter's bounds and unit
through `modelica_kit_list` before any dispatch. A `planDigest` commits the exact
simulate request to the WAL in `dispatched` state before `modelica_simulate`. The
three-state WAL (`dispatched → provider-run-known → completed`) embeds the canonical
simulate envelope at `provider-run-known` so recovery resumes exclusively from
`modelica_run_get`; re-simulating a run whose provider run-id is already recorded is
structurally forbidden. Double attestation compares the `modelica_simulate` response
against `modelica_run_get`. Two CAS objects are produced: a provider run record
(producer `modelica`) sealing the raw normalized provider envelopes, and an execution
receipt (producer `digital-thread`) asserting the lineage from the human-signed
simulation-case artifact to the concrete provider run. No verdict, `TracedRequirement`,
evaluation, or violation is ever produced; evaluation belongs to SysON, not to this
executor.

`verify.seal-proof-case@1` seals the human-reviewed mechanical proof case into the
thread without any provider call. Its signed MRTR proposal carries every consequential
input in the flat `fea.proof.*` grammar: case ID, digest, geometry and requirements
artifact identities, target model element, STEP byte count, and material constants. The
executor resolves the case path through the server-owned `FEA_PROOF_CASE_SOURCES`
catalog — the agent never supplies a path or raw case bytes — validates the JSON against
`mechanical-proof-case/1.0`, computes `canonicalProofText` and its SHA-256, and fails
immediately if the MRTR-signed digest diverges. It then verifies the geometry artifact
by kind, fingerprint, and `geometry-capture/2.0` schema, confirms the target
`PartDefinition` model element in that capture, re-reads the requirements-capture to
confirm the authoritative tip matches the MRTR-signed artifact, and checks every proof
requirement against the corresponding oracle requirement. The resulting
`fea-proof-case-capture/1.0` record is stored by content address; the thread extension
receives one `document` artifact (version = `proofDigest`, the monotony-ratchet key) and
three full `consumption + derived_from + uses` triplets for geometry, requirements, and
STEP. No `verify.run-fea-static-proof@1` run may proceed without this sealed mandate.

`verify.run-fea-static-proof@1` consumes the sealed proof-case artifact and the sealed
geometry artifact, both bound as exact thread entities and propagated into the
approval's `inputEvidenceRefs` through `decisionEvidenceScope`. The executor re-reads
the `fea-proof-case-capture/1.0` by content address, re-checks the requirements tip for
drift since the seal, re-locates and hash-verifies the STEP bytes via the canonical
asset reader, and asserts oracle fidelity through `extractAndVerifyOracleRequirements`
before any provider dispatch. The STEP is staged content-addressed (`fea-<digest>.step`)
into the CalculiX container; a `FeaExecutionPolicy` caps proof dimensions and STEP byte
count. The `planDigest` commits the exact solver request to the WAL in `dispatched`
state before `calculix_solve_static`. The three-state WAL
(`dispatched → solver-recorded → completed`) embeds the canonical solver-capture text at
`solver-recorded` so a crash after the provider ACK resumes at the oracle step without
re-dispatch; a divergent CAS readback is a terminal integrity violation. The SysON
oracle (`syson_constraint_evaluate`) evaluates each proof requirement at native units;
evaluation IDs carry the full 64-hex `verdictCaptureFp`. A `fail` verdict is
publishable: each failing evaluation produces a named violation and a paired proposed
action. The thread extension adds a `solver-result` artifact (producer `calculix`), a
`document` verdict artifact, two `ThreadObservation` records in mm and MPa, evaluations,
any violations with proposed actions, and STEP consumption attestation with the
CalculiX-returned hash.

None of these four operations has yet been executed against a real project. Every first
seal and first run remains gated by a reviewed MRTR proposal and explicit operator
consent in the paired conversation.

The fixed `coffee-machine-cm01-v3` reference path is a separate code-owned catalog, not
a generic project template. After the documentary baseline and SysON seed, it supplies
five bounded product operations for CM-01 architecture, semantic CAD, nominal Modelica,
read-only ERP BOM observation, and the isolated DripTray proof. Its recorded correction
adds five further operations: the 28 mm → 30 mm correction, replacement CAD, mechanical
R2, mechanical R3 recovery, and R3 identity recovery. Each has a reviewed operation ID,
version, binding contract, capture/materializer, and evidence boundary. None makes an
arbitrary new CAD, simulation, or verification work item executable; see the
[CM-01 V3 golden-run guide](../how-to/run-cm01-v3-golden-local.md).

## V3 execution bases, documentary baseline, and SysON seed

V3 does not invent an empty technical snapshot merely to satisfy a bootstrap API. Each
run instead has one exact `basis`:

```ts
type EngineeringBasisRef =
  | EngineeringApprovedBriefBasis
  | EngineeringThreadSnapshotBasis;
```

The `approved-brief` arm must exactly equal the immutable human-approved brief revision
retained by the published plan. It is accepted only for
`baseline.from-approved-brief@1`, before any thread snapshot exists. A later
living-brief revision does not rewrite that historical authorization. Once the baseline
run has published its root record, the implemented SysON seed requires that exact
revision-1 documentary `thread-snapshot` basis; `latest` is never accepted.

The first result is intentionally a **documentary, pre-technical baseline**. Its single
document artifact contains the immutable approved brief and reviewed plan, its SHA-256
fingerprint, an immutable capture URI, the bounded operation revision, and its run
provenance. It proves that the project started from that reviewed source. It does
**not** prove or create a SysML model, CAD geometry, mesh, FEA result, simulation,
measurement, requirement verdict, conformity claim, or certification.

The first continuation is deliberately narrower than a system design:

```text
human-approved living brief + reviewed plan
  -> baseline.from-approved-brief@1
  -> documentary ThreadSnapshot revision 1
  -> project_change_append(baseSnapshot = exact r1)
  -> architecture.seed-syson-model@2 on that exact basis
  -> syson_project_create -> syson_model_create(root) -> syson_element_get(root)
  -> syson-model-seed-capture/2.0 + ThreadSnapshot revision 2
```

Revision 2 adds one `sysml-model` artifact and the exact SysON project identity. Its
documentary revision-1 basis authorizes the run; it is not a byte-level SysON input
artifact. The seed proves neither model semantics nor requirements, CAD, FEA,
simulation, measurements, evaluation, violation, conformity, or certification. A future
technical operation must capture and validate its own provider evidence before it can
make any of those claims.

The generic bootstrap stops at the container identity. Any future architecture, CAD,
simulation, measurement, or verification operation needs its own reviewed contract. The
CM-01 V3 catalog is the one current exception: it is fixed to that product, its reviewed
inputs, and its own evidence boundary.

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

Runs carry an exact `basis` plus an `inputFingerprint`. The queue fingerprint covers
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
call or agent-authored workflow. It is present on work created by `project_plan_publish`
or `project_change_append`; older immutable revisions may lack it and are never promoted
into the new execution path by implication. The generic V3 route has trusted executors
for the documentary baseline, the brief-bound SysON container, reviewed architecture,
reviewed integer scalar requirements, and the sealing of an exact reviewed geometry
draft. The separate CM-01 V3 catalog supplies its reviewed product-specific simulation,
verification, ERP, correction, and closeout operations. Any operation outside those
exact contracts remains planning-only until a separate reviewed executor exists.

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

Approval and rejection retain human provenance. The agent invokes
`project_decision_approve` or `project_decision_reject`, but the mutation proceeds only
after signed MCP elicitation presents the exact proposal fingerprint and the person
confirms the choice in the paired conversation. There is no direct agent self-approval
mutation; a conforming MCP host must present the elicitation to the person. An approval
resolves only the blockers whose linked decisions are all approved. A work item becomes
`ready` only when all of its decisions, blockers, and work-item dependencies are
satisfied.

The native cockpit interprets these states by owner rather than grouping them into one
generic pending bucket: `required` and `rejected` wait on agent preparation; `proposed`
waits on a conversational human decision. The presentation rule is intentionally
narrower than the command contract: **Project** only shows a lightweight notification;
**Activity** supplies the evidence and lineage for review; and **Product** is the
SysON/specification inspection context from which a correction can be scoped with the
agent. The Workbench exposes no decision button, manual proposal, or fallback data-entry
form.

### Blockers

A blocker is `open` or `resolved` and has one of four explicit kinds: `required-input`,
`decision-required`, `dependency`, or `tool-failure`. It must name at least one affected
work item through reciprocal references. Resolved blockers require a timestamp and
resolution; open blockers cannot carry either field.

### Agent runs

Agent runs expose execution state, not private reasoning. Their lifecycle is `queued`,
`running`, `waiting-for-decision`, `publishing`, `completed`, `failed`, or `cancelled`.
Timestamps must follow that lifecycle, and a completed run must cite exact thread
evidence. A run binds its normalized inputs to an exact discriminated `basis` and
SHA-256 fingerprint.

Queueing is an agent mutation over an already bounded `ready` work item.
`project_agent_run_queue` derives the run identity, summary, basis, and operation from
durable server state; the caller cannot choose a provider or submit execution payloads.
The command creates a durable `queued` run but does not execute a provider. The agent
can invoke the narrow executor only for that exact queued run. It claims the run before
materialization, records redacted progress, persists the capture and resulting snapshot,
reads the snapshot back, then completes or fails the run. `statusHistory` records public
lifecycle facts and summaries, not chain-of-thought.

`project_agent_run_cancel` is the narrow inverse available before that claim only. Its
first call asks the paired MCP host to obtain a signed human confirmation for the exact
queued run and rationale; only the accepted, framework-verified retry mutates durable
state. The final cancellation transition and its receipt bind the exact run ID,
work-item ID, and original queue command ID. A cancelled unclaimed run has no provider
activity; its work item returns to the state derived from its dependencies and may be
queued again. Historical queue receipts without the newer `queuedRun` binding remain
valid, while new queue and every cancellation receipt are sealed to their exact targets.

For the first run, the dedicated validator requires root revision 1 and the exact
documentary artifact produced by the reviewed operation; it does not pretend the result
descends from a fabricated base. The first SysON seed requires that exact documentary
root as its `thread-snapshot` basis. It persists and reads back its closed identity
capture and revision 2 before completion. For a later thread-snapshot-basis run,
completion requires a non-`latest` result whose revision advances the exact base and
whose complete `previous` chain reaches that base, plus at least one unique entity that
is new or content-changed from the base. A newer parallel branch is rejected.

### Human-only operations

A registered operation may declare `mustOrigin: "human"`. The executor gate remains the
authority — it refuses a non-human origin outright — but the flag is what makes the
operation _reachable_. `project_agent_run_execute` reads the run's work item, resolves
its operation in the registry, and when the operation is human-only asks the paired MCP
host for a signed confirmation before dispatching under `elicitedHumanOrigin`. Every
other run keeps the agent origin unchanged.

Without that declaration the surface has no way to know it should offer the operator its
elicitation, so the operation becomes executable by nobody and whatever state it exists
to unlock stays locked. That is not hypothetical: it stranded two projects on a
quarantined provider write until the marker was added.

`record.reconcile-uncertain-writer@1` is the only human-only operation today. Its
annotation is not authority by itself: the basis guard re-hashes the exact MRTR and
requires its matching human approval for either outcome. When the outcome is
`write-effect-accepted`, the server creates a separate required decision linked to the
blocker. Only that decision's exact eleven-field proposal and later human approval can
release the basis; incomplete legacy snapshots remain blocked.

### Failed-work reconciliation

A failed run is never converted into a success. The CM-01 R11 → R12 closeout accepts a
failed work item only when its named run remains failed and evidence-free, the exact R3
successor work and run are completed with their own evidence, and the persisted R12
snapshot is a direct child that records the requirement-family links. It changes only
the obsolete work item to `cancelled` with an explicit `superseded-by-successor`
reconciliation. The failed R2 run remains failed. A phase treats that cancellation as
complete only under this exact reconciliation rule. This is a code-owned CM-01 closeout,
not a generic retry, provider call, or public MCP mutation.

## Command and authority surfaces

Every mutation carries `commandId`, `projectId`, `expectedRevision`, and `issuedAt`.
`expectedRevision` is optimistic concurrency control: stale commands fail with a
conflict instead of overwriting newer work. The durable receipt binds a command ID to
its full request fingerprint and resulting immutable snapshot. An identical retry
returns the original result; reusing the ID with different arguments is an error.

The surfaces grant different fixed capabilities:

| Surface              | Allowed operations                                                                                                                     | Explicitly absent                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Cockpit browser      | `GET /api/thread/workbench` and snapshot SSE                                                                                           | Every mutation and provider call           |
| Paired agent MCP     | Snapshot, initial plan, append-only change, propose, signed human elicitation, server-derived queueing, and exact registered execution | Arbitrary provider calls or evidence input |
| Provider MCP/backend | Calls selected by one registered executor, validated capture, immutable publication, and read-back                                     | Human intent and self-certified verdicts   |

The Project notification view does not expose manual technical proposals, approvals,
revision requests, queue buttons, or fallback controls. It directs the reviewer to
Activity and the relevant Product/SysON context. The person then explains intent or
answers the exact elicitation in the paired conversation.

Agent mutation receipts use the authenticated MCP subject when one is available.
Otherwise `claimedBy` is derived from the client's self-declared MCP name and version;
it is an audit label, not proof of identity. Project mutation tools are therefore a
loopback-only prototype surface until transport authentication is required.

The agent surface is on the Console MCP server and exposes bounded initial planning,
append-only project changes, decision, queue, and execution tools.
`project_decision_approve` and `project_decision_reject` require a signed,
framework-verified MRTR retry after the MCP host elicits the person's response.
`project_agent_run_queue` derives all execution identity and basis fields from the ready
work item. `project_agent_run_execute` accepts only the exact queued run and command
metadata. The backend resolves the operation and bindings from durable state; callers
cannot supply a provider name, raw argument, workflow, result, or evidence reference.
The browser has no complementary command surface.

`MCP_MRTR_SIGNING_KEY` signs the opaque elicitation `requestState`; it does not
authenticate a person. Without an explicit key, loopback development uses a
process-ephemeral key and pending confirmations become invalid on restart. Replay state
is currently process-local, so a shared signing key alone is not sufficient for
multi-instance operation. That deployment needs a shared, durable replay store with
atomic consume semantics.

The source dispatcher materializes ten generic V3 operations, the reviewed
`inspection-drone-v4` qualitative-architecture and product-structure operations, and the
fixed CM-01 catalog. `baseline.from-approved-brief@1` has no provider invocation and
persists its canonical capture before publishing the cited root snapshot.
`architecture.seed-syson-model@2` owns only the fixed SysON
project/document/root-package sequence, closed capture, materializer, and result
validator before publishing revision 2. `model.write-architecture@1` and
`model.write-requirements@1` each perform a closed SysON write/readback sequence and
publish content-addressed evidence. The architecture writer renders the reviewed
package, reusable PartDefinitions, and scoped PartUsages; the requirements writer
renders only reviewed, server-parsed integer model thresholds. `design.write-geometry@1`
promotes only a matching human-reviewed draft after exact hash and architecture checks;
for v2, the manifest must cover every captured PartUsage and every distinct targeted
PartDefinition. The provider execution occurred earlier in the isolated preview
boundary. `record.archive-lineage@1` runs the governed retirement cascade with no
provider call, gated by a human-approved decision sealing the exact thread-entity
targets. `simulate.seal-simulation-case@1` resolves the reviewed case through
`SIMULATION_CASE_SOURCES`, cross-checks every MRTR field, and publishes the
content-addressed simulation-case mandate with empty `inputArtifactIds` and no provider
call. `simulate.run-modelica-scenario@1` verifies kit bounds through
`modelica_kit_list`, dispatches `modelica_simulate`, double-attests the result through
`modelica_run_get`, and publishes unit-carrying observations only — a structural
triple-lock enforces `verdictStatus: not_evaluated` and re-dispatch after a known
provider run-id is forbidden. `verify.seal-proof-case@1` resolves the reviewed proof
case through `FEA_PROOF_CASE_SOURCES`, cross-checks the MRTR-signed digest and every
parameter against the canonical bytes, verifies geometry and requirements-tip links in
the basis, and publishes the content-addressed mandate with no provider call.
`verify.run-fea-static-proof@1` stages the STEP content-addressed, dispatches
`calculix_solve_static` from sealed proof parameters only, evaluates through the SysON
oracle, and publishes a fail-closed verdict with named violations and proposed actions;
the WAL embeds the canonical solver capture so recovery never re-dispatches after the
solver ACKs. None of these four has yet been executed against a real project; every
first seal and run is gated by MRTR proposal and operator consent.
`architecture.author-inspection-drone@3` is restricted to the exact
`inspection-drone-v4` r2 basis and has published r3: five typed usages and four
qualitative requirements with explicit TBDs, without CAD, physics, cost, certification,
or verdict claims. Its read-only successor,
`model.capture-inspection-drone-part-definitions@1`, has completed
`run:queue-drone-v4-product-structure-20260808` and published project revision 23's r4
snapshot,
`project:inspection-drone-v4:r4:capture-inspection-drone-v4-part-definitions-7aa8c92216c3d07bde4a0b3890a9e722446abda5c4062bb5216f0d0da20651bd`.
The SHA-256 capture `7aa8c92216c3d07bde4a0b3890a9e722446abda5c4062bb5216f0d0da20651bd`
records exactly six SysON `PartDefinition` elements: `InspectionDrone`, `Airframe`,
`EnergySystem`, `PropulsionSystem`, `AvionicsAndFlightControl`, and
`InspectionCameraPayload`. Root `InspectionDrone` has five direct `PartUsage` elements,
each typed by one of those five child definitions and with provider-attested quantity
`1`. This product-structure record remains neither CAD, physics, cost, manufacturing,
certification, nor a verdict. The CM-01 catalog adds its own architecture, CAD,
Modelica, ERP, correction, governed lineage retirement, PartDefinition, and mechanical
capture/materializer contracts; see the
[CM-01 V3 golden-run guide](../how-to/run-cm01-v3-golden-local.md). Neither MCP planning
nor queueing is an indirect CAD, FEA, Modelica, SysON, or ERPNext endpoint: execution is
available only through these exact reviewed operations and their server-owned contracts.

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

## Historical CM-01 reference lifecycle

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
the reviewed `100 N` case. This historical work-item completion does not imply current
corrected-path closure, whole-machine verification, fabrication release, or
certification. A later design change must carry its own replacement evidence and
explicit project-plan closure.

## Fixed CM-01 V3 correction closure

`coffee-machine-cm01-v3` is distinct from the historical `coffee-machine-cm01` r5/r6
record. Its code-owned 28 mm → 30 mm correction retains the failed mechanical R2 attempt
as evidence-free history. The successful R3 result was first retained at R10 with an R2
artifact identity; R10 remains immutable and superseded. The provider-free identity
recovery creates the correctly named R11 successor without rerunning a solver. The
separate provider-free R11 → R12 closeout writes the direct requirement-family successor
and performs the narrow failed-work reconciliation described above.

This is one bounded CM-01 correction dossier, not a generic correction engine. It does
not make the historical r6 verdict current, validate the whole CoffeeMachine, authorize
fabrication, or establish certification.

## CM-01 PartDefinition and governed retirement

CM-01 r19 retains content-addressed PartDefinition captures for `CoffeeMachine` and
`DripTray`, bound to the exact architecture package, editing context, identities, and
capture hashes. The capture stores are intentionally distinct from architecture capture;
lineage checks fail closed if a later basis silently drops established PartDefinition
artifacts. It records documentary structure and provenance, not a new physical,
manufacturing, or certification claim.

The governed archive operation accepts only an exact approved human MRTR decision whose
proposal names the retirement targets. It can retire an artifact or requirement and its
dependent observations, evaluations, and violations as a recorded cascade. No historic
record is deleted: the snapshot retains the archived changes and provenance, while
current-state projections filter the retired entities. A fully retired cascade cannot be
run again as if it were new.

## Validation and persistence

[`engineering-project-validation.ts`](../../src/domain/project/engineering-project-validation.ts)
rejects non-JSON values, unknown properties, duplicate identities, broken reciprocal
links, dependency cycles, inconsistent lifecycle timestamps, contradictory
decision/approval states, undeclared snapshot revisions, and mismatched execution
inputs.

[`FileEngineeringProjectStore`](../../src/adapters/stores/engineering-project-store.ts)
remains the validated tracked-manifest loader. At runtime it seeds revision 1 only when
no active project exists.
[`FileEngineeringProjectRevisionStore`](../../src/adapters/stores/engineering-project-store.ts)
then owns append-only active state under `state/local/engineering-projects/<project>/`.
Each numbered revision is deterministic JSON; an exclusive claim file is the
cross-process compare-and-swap boundary. A later active revision always wins over the
tracked seed, and a claimed but unpublished head fails closed.

Every read validates again. Every write extends the exact current `id` and revision,
records `previous`, and passes the full domain validator before publication. Loading or
following the Workbench is still passive; only a validated agent MCP command can advance
project state, with signed chat elicitation where human authority is required. No
project-store method invokes an engineering provider.

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

`FileEngineeringProjectRunLease` additionally holds one local advisory lock for an
executor-owned `(projectId, scope)` while a trusted executor runs. Generic architecture,
requirements, and geometry publication share the exact Thread basis as their scope: two
queued work items cannot both create the single legal `basis + 1` subject revision. Its
retained empty file under `state/local/engineering-project-run-leases/` is coordination
state only: it is not a capture, artifact, result, or engineering claim. A duplicate
execution waits and then re-checks the declared head and active or uncertain sibling
writes before any effect. The lease serializes local writers but cannot itself prove
remote-provider idempotence; the write-ahead attempt journal supplies the fail-closed
recovery boundary.
