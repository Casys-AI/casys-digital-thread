# Reference: `EngineeringProjectSnapshot` contract

Audience: both · Diátaxis: reference · Kind: contract

> **Diátaxis category: reference.** This page describes the project contract in
> [`src/domain/project/engineering-project.ts`](../../../src/domain/project/engineering-project.ts),
> its strict validator, and its relationship to canonical thread evidence and live
> activity.

`EngineeringProjectSnapshot` is the immutable, versioned state of what an engineering
project is trying to accomplish and how the human-agent team intends to advance it. It
does not replace `ThreadSnapshot`: project state cites documentary or technical thread
records but never owns, rewrites, or manufactures their evidence.

Its trace is a control substrate, not merely an audit log: the paired agent can use
proven impact to observe, evaluate, propose a bounded correction, and request a
recomputation. The human reviews and authorizes consequential changes. Isolated CalculiX
`@3` and admitted Modelica `@1` are the current generic, bounded implementations of that
route; they do not imply a generic workflow language or a live-run success. Historical
MCP FEA `@1`/`@2` are not registered.

The current creation format is schema `4.0`: the project exists from the first intent,
its living brief evolves inside that same immutable revision stream, and every work item
is one revision of a server-stamped activity. Older snapshots are not a creation or load
route for new work. Every value is JSON-compatible. Validation clones and recursively
freezes the accepted value, rejects unknown fields, and never fills in a missing
decision, engineering input, or activity identity.

| Open                                         | Owns                                           |
| -------------------------------------------- | ---------------------------------------------- |
| Three truth boundaries                       | Project vs Thread vs activity                  |
| Agent-published plan and reviewed operations | Registered ops including admitted Modelica     |
| Isolated FEA `@3` and Modelica microVMs      | Product static proof and admitted/kit Modelica |
| Command and authority surfaces               | Who may write what                             |

Contents: [Three truth boundaries](#three-truth-boundaries) ·
[Root fields](#root-fields) · [Living brief in schema 4.0](#living-brief-in-schema-40) ·
[Agent-published plan](#agent-published-plan-and-reviewed-operations) ·
[Current analysis execution](#current-analysis-execution) ·
[V3 execution bases](#v3-execution-bases-documentary-baseline-and-syson-seed) ·
[Exact thread references](#exact-thread-references) ·
[Ordered phases](#ordered-phases-and-derived-status) ·
[Work, decisions, approvals, blockers, and runs](#work-decisions-approvals-blockers-and-runs)
· [Command and authority surfaces](#command-and-authority-surfaces) ·
[Validation and persistence](#validation-and-persistence)

## Three truth boundaries

| Boundary    | Owns                                                                                                                                                                                                 | Must not claim                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Project** | Objective, ordered phases, work items, agent-run lifecycle, decisions, approvals, blockers, and exact references to evidence                                                                         | Measurements, provenance, requirement verdicts, or transient activity |
| **Thread**  | Versioned documentary or technical artifacts, exact-byte consumption, observations with units, traced requirements, evaluations, violations, provenance, freshness, and proposed engineering actions | Project intent, human approval, or unpersisted execution progress     |
| **Live**    | Append-only progress and result notifications used to refresh the activity feed while work is occurring                                                                                              | Canonical evidence, completion, approval, or a pass/fail verdict      |

The BFF composes these boundaries for presentation. Its browser contract is an
`engineering-workbench/0.6` object with an explicit surface: `planning` contains the
durable project plus the status of the first documentary baseline and redacted live
milestones; `evidence` contains the project, projected `thread` (whose `live` field
contains current activity), `alignment`, and `projectPath`. `projectPath.phaseLanes`
classifies every exact phase into the same five columns used by the Overview thread:
`requirements`, `system-model`, `geometry`, `physics`, and `verdicts`.
`projectPath.activities` lists the explicit stable activities with ordered revision IDs;
the browser never guesses lifecycle from operation keys, phase order, labels, timestamps
or Thread proximity. `caseActivityJoins` names the Project activity that produced each
typed Thread case through its unique producer run. A later FEA proof-case revision stays
the typed mechanical series; it is not a Project retry unless that join points at an
attempt of the same activity. The server uses its registered operation taxonomy, so the
browser can wrap a long path without guessing from labels. This is presentation metadata
only: it does not select a provider, change phase order, or imply a verdict. `GET` and
SSE create only a read model; they do not promote live events into thread evidence or
project truth. Project mutations and bounded provider orchestration remain on the paired
agent's MCP surface.

## Root fields

| Field             | Contract                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `id`, `revision`  | Immutable project-snapshot identity and positive revision                                           |
| `previous`        | Required after revision 1 and always lower than the current revision                                |
| `generatedAt`     | ISO 8601 UTC materialization timestamp                                                              |
| `project`         | Stable project ID, display name, thread subject ID, and explicit objective                          |
| `framing`         | Schema 4.0 intent, questions, sourced answers, proposed brief and exact approved canonical brief    |
| `plan`            | Optional agent-published path grounded in the exact approved canonical brief for V3                 |
| `threadSnapshots` | Exact declared `ThreadSnapshot` revisions; empty before the first documentary baseline is published |
| `phases`          | Ordered project phases; phase status is deliberately absent                                         |
| `workItems`       | Human, agent, or shared work: one immutable revision of a server-stamped activity                   |
| `agentRuns`       | Observable execution lifecycle and exact produced evidence                                          |
| `decisions`       | Questions or proposals requiring project authority                                                  |
| `approvals`       | Auditable responses bound to the exact inputs approved                                              |
| `blockers`        | Open or resolved conditions overlaid on affected work and phases                                    |
| `commandReceipts` | Durable idempotency and audit ledger after a command-created revision                               |

The project revision and the referenced thread revision are independent counters. For
example, project snapshot revision 1 may cite thread snapshot revision 5.

## Living brief in schema 4.0

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
`approvedBriefBasis` that authorized it. It appends new work items and required
decisions. A work item may join a newly declared phase or append membership onto an
existing phase in the next immutable snapshot; existing phase, work, decision, run and
evidence records are never replaced. `planChanges[].phaseIds` lists only phases created
by that change and may be empty. A successor revision names `predecessorRevisionId`
explicitly; the server never infers one from a shared phase or operation. This is not a
plan replacement and it cannot amend or erase project truth. The change anchors are
planning provenance; later runs still use their distinct, server-derived exact `basis`.

Each work item created by either command has an `operation` reference with an exact ID,
version, and state-reference bindings. The code-owned registry accepts only its reviewed
operation revisions and declared binding names/source kinds; it also supplies the
durable work title, description, and classification shown to the reviewer. The generic
entry-point registry contains:

| Starting point or exact prerequisite                                          | Exact operation reference               |
| ----------------------------------------------------------------------------- | --------------------------------------- |
| New V3 idea or specification                                                  | `baseline.from-approved-brief@1`        |
| Post-baseline change; exact documentary r1 required at runtime                | `architecture.seed-syson-model@2`       |
| Human-reviewed architecture; exact generic SysON basis required               | `model.write-architecture@1`            |
| Passed agent-authored closed-subset SysML capture; Thread document only       | `model.seal-architecture-sysml@1`       |
| Human-reviewed integer scalar requirements; exact architecture basis required | `model.write-requirements@1`            |
| Ready compilation draft; exact Thread/SysML basis; no provider                | `compile.seal-admission@3`              |
| Sealed compilation admission; local isolation runtime composed                | `design.execute-build123d@1`            |
| Documentary isolated execution capture; published STEP stays gated            | `design.seal-isolated-geometry@1`       |
| Human-reviewed geometry draft; exact architecture basis required              | `design.write-geometry@1`               |
| Human-reviewed FEA proof case; exact geometry and requirements-tip in basis   | `verify.seal-proof-case@1`              |
| Sealed proof case and canonical part STEP; local isolation runtime composed   | `verify.run-fea-static-proof@3`         |
| One server-owned local Modelica linear-ramp kit; qualification reread         | `simulate.run-qualified-modelica-kit@1` |
| Sealed Modelica compilation admission; local isolation runtime composed       | `simulate.run-admitted-modelica@1`      |
| Sealed SPICE compilation admission; local isolation runtime composed          | `simulate.run-admitted-spice@1`         |
| Human inspection of an uncertain provider write                               | `record.reconcile-uncertain-writer@1`   |
| Human-approved retirement decision; exact thread-entity targets required      | `record.archive-lineage@1`              |

Lookalike pairs and grants: [lookalike traps](../agent/lookalike-traps.md). Admitted
CAD/Modelica/SPICE microVM:
[admitted source isolated execution](../pipeline/admitted-source-isolated-execution.md).
`model.seal-architecture-sysml@1` is not `model.write-architecture@2`.
`design.execute-build123d@1` is not canonical geometry promotion.
`simulate.run-admitted-modelica@1` is not `simulate.run-qualified-modelica-kit@1`.
`simulate.run-admitted-spice@1` is not mcp-spice and not the LED-driver fiche.
`design.seal-isolated-geometry@1` is not `design.write-geometry@1` and is not FEA
geometry. Historical MCP FEA runs are not registered.

The V3 baseline binding names only the exact human-approved brief. After r1,
`architecture.seed-syson-model@2` may be added by one append-only project change. That
seed work item must `dependsOn` the unique `baseline.from-approved-brief@1` work item;
`project_change_append` refuses the omission. The change's exact current snapshot is
provenance, not a SysON runtime argument. Its execution requires exact documentary r1.
The agent must not assume a later snapshot is equivalent: queueing derives and records
the exact basis for each bounded run.

These references deliberately expose no provider, tool name, raw input, workflow, or
evidence payload. Publishing rejects unknown revisions, wrong starting points,
undeclared bindings, or a brief binding that does not match the exact approved project
revision. An agent may revise the initial plan only while no baseline run, approval,
blocker, concrete decision proposal, or completed/cancelled work exists. After that
point it may append a bounded change, but cannot use either command to erase execution
or review history.

The registered operations have trusted executors. Isolated CalculiX `@3` and admitted
Modelica `@1` require a server-sealed `resolved-operation-plan/2.0` where that contract
applies. Historical MCP FEA `@1`/`@2` and recorded Modelica `@1`/`@2` are not
registered. No earlier capture, queue record or recovery route is reinterpreted as those
identities.

## Current analysis execution

When an agent queues isolated CalculiX `@3`, the server reopens the exact basis and
direct approved MRTR decision, derives one one-action plan, stores it in local CAS and
attaches its exact reference to that run. The plan carries no provider endpoint, tool,
raw arguments, path or agent-authored recovery graph. `project_agent_run_plan_get` is an
inspection read; it does not execute a plan.

Historical `simulate.seal-simulation-case@1`/`@2` and
`simulate.run-modelica-scenario@1`/`@2` are not registered. They are not a fallback for
`simulate.run-admitted-modelica@1` or `simulate.run-qualified-modelica-kit@1`.

Sealed FEA → isolated `@3`: `verify.seal-proof-case@1` writes the mandate;
`verify.run-fea-static-proof@3` rereads that sealed proof and the exact canonical part
STEP, runs Gmsh and CalculiX in the digest-pinned local microVM, then journals a
separate SysON constraint evaluation. Historical MCP FEA `@1`/`@2` are rejection
identities. Domain contract:
[isolated CalculiX static proof V3](../domains/fea/calculix-static-proof-v3.md).

Admitted Modelica `@1` reopens sealed `compile.seal-admission@3` bytes into the local
microVM. It is not the pinned kit. Pattern:
[admitted source isolated execution](../pipeline/admitted-source-isolated-execution.md).
How-to: [run admitted Modelica](../../how-to/run/run-admitted-modelica.md).

`simulate.run-qualified-modelica-kit@1` is a separate one-kit smoke. It does not accept
project `.mo` source.

An approved MRTR, a queued run or provider availability is not execution success; only
captured and reread runtime evidence establishes it. Neither route accepts arbitrary
agent-authored Modelica source or native CalculiX decks. Fleet `mcp-calculix` remains a
sensitivity capability, not the provenance of product static `@3`.

`baseline.from-approved-brief@1` has no provider call: after the agent queues the ready
registered work item, the backend records the exact approved brief and reviewed plan as
`approved-brief-baseline-capture/1.1`, fingerprints its bytes with SHA-256, stores them
immutably, and cites that document from root thread revision 1. The capture seals the
exact brief source analysis; the validator rereads both CAS records and fails closed if
either is absent or corrupted.

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

`model.seal-architecture-sysml@1` is a separate provider-free seal. The agent first
captures UTF-8 that matches the locked closed subset, previews the analysis, and
proposes only the `decisionParameters` returned from a reopened passed capture. After
human MRTR the executor reopens those CAS identities and writes one Thread document
(`architecture-sysml-seal-capture/1.0`). It does not insert into SysON, does not reuse
`compile.seal-admission@3`, and does not treat renderer `sysml-source-capture/1.0`
envelopes as agent-authored authority. Procedure:
[author architecture SysML](../../how-to/compile/author-architecture-sysml.md).

`model.write-requirements@1` starts only from an exact generic architecture artifact.
Its MRTR proposal identifies the reviewed target and declares named integer scalar
thresholds through `requirements.*` and `requirement.<slug>.*` parameters. The server
derives the native `RequirementUsage` below the exact target `PartDefinition`, verifies
its `subject target` typing and constraints by provider readback, and persists a
`requirements-capture/3.0`. The Thread receives one `TracedRequirement` per verified
integer scalar criterion and preserves the exact architecture and prior-requirements
lineage. This operation records model requirements; it does not evaluate them, invent
measurements, or publish a pass/fail verdict.

Geometry is a two-step boundary. Canonical drafts come from
`project_admitted_geometry_export` after `compile.seal-admission@3`.
`project_geometry_preview` is not a product entry. The current assembly draft is
`geometry-draft-capture/1.2` and requires exact `sourceAnalysis`. A complete bundle uses
`geometry-draft-capture/2.1`: one exact assembly source plus one exact source per unique
SysML `PartDefinition`, dispatched as an isolated N+1 sequence after every source and
identity validates, and requires exact `sourceAnalyses`. Its manifest requires
authoritative STEP for the assembly and each definition. A system-only architecture
(zero PartUsages, one PartDefinition) is a valid v2 bundle: empty components and
occurrences, and that unique PartDefinition is the FEA target. Otherwise the manifest
carries an exhaustive, identity-based `PartUsage -> PartDefinition -> placement` table
in a right-handed millimetre frame with extrinsic X/Y/Z degree rotations. The placement
is local to the PartDefinition that owns the PartUsage; reusing that parent repeats the
local placement on each expanded product path without duplicating the semantic PartUsage
declaration. build123d's `gltf` token is accepted only with its actual binary `.glb`
output. Older draft schemas `1.0`, `1.1` and `2.0` are unsupported.

The preview returns flat decision parameters for a fresh human review. Only
`design.write-geometry@1` may seal those approved hashes. `geometry-manifest/1.0` is the
current assembly dialect and produces `geometry-capture/1.2`. The explicit
`geometry-manifest/2.0` discriminator produces `geometry-capture/2.1`, retains the
approved editable sources and ordered N+1 provenance, and publishes independent
definition assets. Older canonical schemas `1.1` and `2.0` are unsupported. The seal
makes no provider call. An upgrade must name the unique active predecessor, archives its
exact geometry family, and records `derived_from` plus `supersedes`; ambiguity fails
before canonical writes. Product projection rereads the current capture and attaches the
seal-owned authoritative STEP artifact to each exact SysML occurrence. Reused
definitions share that binding; labels are never joins and no `build123d` provider
identity is invented.

`record.archive-lineage@1` is the governed retirement step. No constant in its executor
names a product: project identity comes from the exact run basis, and the work item
binds one or more exact thread-entity targets. Execution requires a human-approved MRTR
decision whose sealed evidence refs equal those exact targets and basis, and the
approval elicitation renders the server-stamped refs as canonical JSON — an injective
encoding, so no ID can forge another target list — and the approver sees precisely what
will be retired. The executor computes the domain-pure archive cascade, refuses a fully
redundant closure, and publishes the successor snapshot with CAS readback. It makes no
provider call; history stays readable while current views exclude the retired lines.

`verify.seal-proof-case@1` seals the human-reviewed mechanical proof case into the
thread without any provider call. Its signed MRTR proposal carries every consequential
input in the flat `fea.proof.*` grammar: source fingerprint, case ID, digest, geometry
and requirements artifact identities, target model element, STEP byte count, and
material constants. The executor reopens the exact signed
`mechanical-proof-case-source/1.0` capture — the agent never supplies a path, catalog id
or raw compiled case bytes — recrosses the unique current Thread tip, validates the
compiled JSON against `mechanical-proof-case/1.0`, computes `canonicalProofText` and its
SHA-256, and fails immediately if the MRTR-signed digest diverges. It then verifies the
geometry artifact by kind, fingerprint, and `geometry-capture/2.1` schema, confirms the
target `PartDefinition` model element in that capture, re-reads the requirements-capture
to confirm the authoritative tip matches the MRTR-signed artifact, and checks every
proof requirement against the corresponding oracle requirement. The resulting
`fea-proof-case-capture/1.0` record is stored by content address; the thread extension
receives one `document` artifact (version = `proofDigest`, the monotony-ratchet key) and
three full `consumption + derived_from + uses` triplets for geometry, requirements, and
STEP. Isolated `@3` consumes this sealed mandate; historical MCP `@1`/`@2` are not
registered. Execution contract:
[isolated CalculiX static proof V3](../domains/fea/calculix-static-proof-v3.md).

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
document artifact contains the immutable approved brief and reviewed plan, the sealed
brief source analysis (`approved-brief-baseline-capture/1.1`), its SHA-256 fingerprint,
an immutable capture URI, the bounded operation revision, and its run provenance. It
proves that the project started from that reviewed source. It does **not** prove or
create a SysML model, CAD geometry, mesh, FEA result, simulation, measurement,
requirement verdict, conformity claim, or certification.

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
simulation, measurement, or verification operation needs its own reviewed contract.

## Exact thread references

`evidenceRefs` are unique exact tuples with no upper cardinality; see
[isolation and Thread boundedness](../runtime/isolation-and-thread-boundedness.md).

A root thread reference always names the full immutable identity:

```json
{
  "snapshotId": "project:system-alpha:r8",
  "revision": 8,
  "subjectId": "system-alpha"
}
```

Evidence references add the entity kind and ID inside that exact revision:

```json
{
  "snapshotId": "project:system-alpha:r8",
  "snapshotRevision": 8,
  "kind": "artifact",
  "id": "geometry-system-alpha-step"
}
```

`latest`, filenames, display labels, and provider names are not evidence references. The
project validator first requires every entity reference to use a declared snapshot
revision. At the BFF boundary, structural validation stays fail-fast
(`validateEngineeringProjectSnapshot`) while
`collectEngineeringProjectThreadReferenceIssues(project, snapshots)` resolves each
reference against the supplied canonical `ThreadSnapshot`s; a newer local snapshot does
not satisfy a reference to an older revision. Persistence of a successor also runs
`validateEngineeringProjectExtension(previous, next)`: project identity and captured
intent stay frozen, existing phases keep their id/name/order/description, phase
membership and evidence are append-only, and an initial phase cannot be reclassified as
created by a later `planChanges` entry. `project.objective` may change only on the exact
`project.brief-approve` that promotes `proposedBrief` to `currentBrief`.
`project.plan-publish` may replace an unexecuted plan only while
`isEngineeringProjectPlanReplaceable` holds — the same predicate the command service
uses. Completed, cancelled or abandoned work cannot return to a nonterminal status, and
a recorded reconciliation is immutable. Newly appended `planChanges` must own exactly
the newly added phases, work items and decisions (empty `phaseIds` remains valid when
membership is appended onto existing phases). Work status, run lifecycle, decisions,
approvals, and gate-claim status remain legal transitions. Dangling references (for
example a decision left behind by abandoned work) do not hide the read-only projection:
the `evidence` surface publishes them as `unresolvedEvidenceReferences` and the cockpit
labels them. The `documentary` surface carries no such field by design — it exists only
for the single-artifact brief baseline, before any evidence reference can dangle.

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

Every work item belongs to exactly one phase and is one immutable **revision** of a
stable **activity**:

- `activityId` is server-stamped. A root revision receives `activity:<rootRevisionId>`;
  a successor inherits the predecessor's identity. Callers never supply or re-parent it.
- `predecessorRevisionId` names an existing same-activity revision when this work
  continues that activity. Omit it to start a new activity. Self, missing, cyclic and
  cross-activity predecessors are rejected.
- an `EngineeringAgentRun` is one **attempt** of that revision. Retrying unchanged
  reviewed input queues another run on the same work item; a changed operation, binding
  or method is a new revision only when the command names the predecessor.
- a kind such as `define`, `architect`, `design`, `simulate`, `verify`, or
  `industrialize`;
- an owner: `human`, `agent`, or `shared`;
- acyclic dependencies on other work items;
- evidence, decision, and blocker references.

Two independent activities that share an operation stay distinct. Reconciliation can
close only work in the same activity; it does not turn a failed attempt into a
successful one. Array order, titles and timestamps never create a lifecycle link.

An optional `operation` is a reviewed, versioned capability reference, never a raw tool
call or agent-authored workflow. It is present on work created by `project_plan_publish`
or `project_change_append`; older immutable revisions may lack it and are never promoted
into the new execution path by implication. The generic V3 route has trusted executors
for the documentary baseline, the brief-bound SysON container, reviewed architecture,
reviewed integer scalar requirements, and the sealing of an exact reviewed geometry
draft. Any active operation outside the registered generic contracts remains
planning-only until a separate reviewed executor exists.

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

The source dispatcher materializes generic V3 operations. The product
`architecture.author-inspection-drone@3` and
`model.capture-inspection-drone-part-definitions@1` identities are retired and
unregistered. `baseline.from-approved-brief@1` has no provider invocation and persists
its canonical `approved-brief-baseline-capture/1.1` before publishing the cited root
snapshot. `architecture.seed-syson-model@2` owns only the fixed SysON
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
targets. `verify.seal-proof-case@1` reopens the exact signed proof-case source capture,
recrosses the unique current Thread tip, cross-checks the MRTR-signed digest and every
parameter against the canonical bytes, verifies geometry and requirements-tip links in
the basis, and publishes the content-addressed mandate with no provider call.
`verify.run-fea-static-proof@3` is the registered isolated CalculiX run after that seal.
Historical MCP FEA `@1`/`@2` are not registered. Domain contract:
[isolated CalculiX static proof V3](../domains/fea/calculix-static-proof-v3.md). Retired
historical `architecture.author-inspection-drone@3` was restricted to the exact
`inspection-drone-v4` r2 basis and published r3: five typed usages and four qualitative
requirements with explicit TBDs, without CAD, physics, cost, certification, or verdict
claims. Its retired read-only successor,
`model.capture-inspection-drone-part-definitions@1`, completed
`run:queue-drone-v4-product-structure-20260808` and published project revision 23's r4
snapshot,
`project:inspection-drone-v4:r4:capture-inspection-drone-v4-part-definitions-7aa8c92216c3d07bde4a0b3890a9e722446abda5c4062bb5216f0d0da20651bd`.
The SHA-256 capture `7aa8c92216c3d07bde4a0b3890a9e722446abda5c4062bb5216f0d0da20651bd`
records exactly six SysON `PartDefinition` elements: `InspectionDrone`, `Airframe`,
`EnergySystem`, `PropulsionSystem`, `AvionicsAndFlightControl`, and
`InspectionCameraPayload`. Root `InspectionDrone` has five direct `PartUsage` elements,
each typed by one of those five child definitions and with provider-attested quantity
`1`. This product-structure record remains neither CAD, physics, cost, manufacturing,
certification, nor a verdict. Neither MCP planning nor queueing is an indirect CAD, FEA,
Modelica, SysON, or ERPNext endpoint: execution is available only through exact reviewed
operations and their server-owned contracts.

## Validation and persistence

[`engineering-project-validation.ts`](../../../src/domain/project/engineering-project-validation.ts)
rejects non-JSON values, unknown properties, duplicate identities, broken reciprocal
links, dependency cycles, inconsistent lifecycle timestamps, contradictory
decision/approval states, undeclared snapshot revisions, and mismatched execution
inputs.

[`FileEngineeringProjectStore`](../../../src/adapters/shared/stores/engineering-project-store.ts)
is the validated tracked-manifest loader used only when a controlled deployment provides
an explicit matching project ID and manifest path. Normal composition has no implicit
product seed.
[`FileEngineeringProjectRevisionStore`](../../../src/adapters/shared/stores/engineering-project-store.ts)
then owns append-only active state under `state/local/engineering-projects/<project>/`.
Each numbered revision is deterministic JSON; an exclusive claim file is the
cross-process compare-and-swap boundary. A claimed but unpublished head fails closed.

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
unknown, the executor does not retry it automatically. It seals the run as a terminal
uncertain failure, and the operator inspects SysON before using the generic
`record.reconcile-uncertain-writer@1` ceremony. A `provider-did-not-write` judgement
releases the exact basis so the agent can append a separately reviewed successor seed;
the Workbench remains read-only. If revision 2 is already durable but the project
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
