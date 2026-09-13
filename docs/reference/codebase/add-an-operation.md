# Reference: add a registered operation
> Verified-Against: 4d6cd4e5 (2026-09-13).

Audience: agent · Diátaxis: reference · Kind: contract

Ordered mechanical wiring for one new **registered** engineering operation. File
locations and line numbers were traced from `record.archive-lineage@1`
(`ARCHIVE_LINEAGE_OPERATION`). This page is not an authority-extension runbook.

Index: [workspace source map](../codebase/codebase-map.md). Placement rules:
[agent workspace §8](../agent/agent-workspace.md#8-where-to-put-code). Planning
catalogue: [registered operations](../agent/agent-workspace.md#5-registered-operations).

## Not the authority runbook

A new CAD, admitted Modelica, FEA, or generic SysML **construct or physics** is a
bounded capability extension. Route that work through
[extend an engineering capability](../../../.agents/skills/extend-engineering-capability/SKILL.md)
and the selected row of
[capability routes](../../../.agents/skills/extend-engineering-capability/references/capability-routes.md).
The skill points at the living how-tos under
[extend a reviewed engineering surface](../../how-to/extend/README.md). Do not copy those
runbooks here. Do not invent an operation identity as a substitute for a missing
construct.

This page covers only the control-plane wiring that makes an already-specified
operation planable, queueable, executable, and projectable.

## Explicit refusals

- Do not plan, queue, execute, or document an operation the live registry does not
  know. Unknown `id@version` is indistinguishable from absent
  ([`registry.ts:1862`](../../../src/orchestration/operations/registry.ts)).
- Do not add a caller-selected provider, tool, argument set, image, endpoint, or
  runtime. The registry is a provider-neutral planning boundary: it describes
  only the safe planning contract
  ([`registry.ts:160`](../../../src/orchestration/operations/registry.ts)).
  Queue authorization still resolves `runtimeDemand` through it
  (`operations.require`,
  [`capability-runtime-supervisor.ts:186`](../../../src/application/control-plane/capability-runtime-supervisor.ts));
  `runtimeDemand.kind === "none"` authorizes no runtime
  ([`capability-runtime-supervisor.ts:188`](../../../src/application/control-plane/capability-runtime-supervisor.ts)).
- Do not register a Workbench command. Workbench is `GET` + SSE
  ([`AGENTS.md`](../../../AGENTS.md)).
- Do not treat `prerequisiteOnly` as plan/queue work
  ([`registry.ts:1947`](../../../src/orchestration/operations/registry.ts)).
- Do not re-open `retiredForPlanning` identities for new work
  ([`registry.ts:1957`](../../../src/orchestration/operations/registry.ts)).
- Do not teach a skill or how-to an identifier the registry will refuse.
  [`operation-reference-docs_test.ts`](../../../src/orchestration/operations/operation-reference-docs_test.ts)
  watches exactly the documents in `OPERATION_CITING_DOCUMENTS`
  ([`operation-reference-docs_test.ts:30`](../../../src/orchestration/operations/operation-reference-docs_test.ts)),
  including this guide, skills, how-tos and reference pages. The inventory
  discovers operation-citing pages in those trees and requires an explicit
  classification: pages with only live identities are watched; pages naming
  historical or unknown identities stay explicitly inventoried as unwatched.
  A new live path document must join the watched list, or the pin at
  [`operation-reference-docs_test.ts:260`](../../../src/orchestration/operations/operation-reference-docs_test.ts)
  will not see it.
- Do not assume registry membership alone wires execution or Workbench
  persistence ordering. Those lists are explicit.

## Ordered checklist

Every new caller-visible operation must pass these steps. Conditional steps say
when they apply. Citations are the `record.archive-lineage@1` sites unless noted.

1. **Own the identity in the authority-owned operation module.** Export
   `{ id, version }` next to the domain math or proposal grammar owned by
   that authority. The tracer lives at
   [`src/domain/thread/thread-retirement.ts:299`](../../../src/domain/thread/thread-retirement.ts)
   (`id: "record.archive-lineage"`, `version: "1"`). Cascade math for that
   identity is
   [`computeArchiveCascade`](../../../src/domain/thread/thread-retirement.ts)
   at line 83. Authorities outside `src/domain` own theirs the same way:
   `verify.run-fea-static-proof@3` is owned in
   [`src/orchestration/operations/fea-isolated-static-proof.ts:20`](../../../src/orchestration/operations/fea-isolated-static-proof.ts).
   Other operations typically colocate a closed parameter parser in
   a `*-proposal.ts` module; this tracer does not.

2. **Add one descriptor to the code-owned registry.** Append a
   `RegisteredEngineeringOperation` object to `OPERATIONS` in
   [`src/orchestration/operations/registry.ts`](../../../src/orchestration/operations/registry.ts).
   The tracer is
   [`registry.ts:1796`](../../../src/orchestration/operations/registry.ts)
   (`decisionEvidenceScope: "thread-entity-bindings"`,
   `runtimeDemand: none`, bindings `approvedBrief` + `archiveTarget`). Prefer
   `id: THE_OPERATION.id` like neighbouring entries; the tracer currently repeats
   the literal string. Descriptor shape:
   [`engineering-operation-registry.ts:52`](../../../src/application/control-plane/engineering-operation-registry.ts).
   Planning and queue both call
   [`validateRegisteredEngineeringOperationInput`](../../../src/orchestration/operations/registry.ts)
   at line 1923 via
   [`REGISTERED_ENGINEERING_OPERATION_REGISTRY`](../../../src/orchestration/operations/registry.ts)
   at line 2338.

3. **Classify the project-path lane.** Every caller-visible operation needs one
   entry in
   [`PATH_LANE_BY_OPERATION`](../../../src/orchestration/operations/path-lanes.ts)
   ([`path-lanes.ts:26`](../../../src/orchestration/operations/path-lanes.ts)).
   The tracer is `"record.archive-lineage@1": fixed("system-model")` at
   [`path-lanes.ts:89`](../../../src/orchestration/operations/path-lanes.ts).
   Totality:
   [`path-lanes_test.ts:13`](../../../src/orchestration/operations/path-lanes_test.ts).
   `prerequisiteOnly` operations must stay off this map
   ([`path-lanes_test.ts:30`](../../../src/orchestration/operations/path-lanes_test.ts)).

4. **Declare runtime demand.** `none` or one explicit required-capability list.
   The tracer is `NO_RUNTIME_DEMAND`
   ([`registry.ts:123`](../../../src/orchestration/operations/registry.ts));
   demanding operations use `requiredRuntimeDemand`
   ([`registry.ts:143`](../../../src/orchestration/operations/registry.ts)).
   The code-owned registry is the single projection source:
   `engineeringOperationRegistry.list()`
   ([`registry.ts:1986`](../../../src/orchestration/operations/registry.ts))
   returns a frozen list of frozen descriptors, and
   `fingerprintRegisteredEngineeringOperationRegistry`
   ([`registry.ts:1897`](../../../src/orchestration/operations/registry.ts))
   seals the trusted demand fingerprint. The exhaustive projection test
   ([`runtime-demand-registry_test.ts:105`](../../../src/orchestration/operations/runtime-demand-registry_test.ts))
   pins `operations.length` to 59
   ([`runtime-demand-registry_test.ts:107`](../../../src/orchestration/operations/runtime-demand-registry_test.ts))
   and `noneCount` to 35 ([`runtime-demand-registry_test.ts:142`](../../../src/orchestration/operations/runtime-demand-registry_test.ts)),
   then asserts every descriptor's `runtimeDemand` exactly: `{ kind: "none" }`
   for operations absent from `DEMANDING_OPERATIONS`
   ([`runtime-demand-registry_test.ts:38`](../../../src/orchestration/operations/runtime-demand-registry_test.ts),
   [`runtime-demand-registry_test.ts:128`](../../../src/orchestration/operations/runtime-demand-registry_test.ts)),
   `{ kind: "required", capabilities }` for listed ones
   ([`runtime-demand-registry_test.ts:134`](../../../src/orchestration/operations/runtime-demand-registry_test.ts)),
   and bidirectionally that no map entry lacks a registry operation
   ([`runtime-demand-registry_test.ts:139`](../../../src/orchestration/operations/runtime-demand-registry_test.ts)).
   So a new operation always touches that manifest: bump the pinned counts and
   add an exact `qualified(...)` entry — with `preparation` vs `execution` use —
   when it demands anything. Capability queue eligibility uses
   `operations.require`
   ([`capability-runtime-supervisor.ts:186`](../../../src/application/control-plane/capability-runtime-supervisor.ts));
   `runtimeDemand.kind === "none"` returns no runtime
   ([`capability-runtime-supervisor.ts:188`](../../../src/application/control-plane/capability-runtime-supervisor.ts)).

5. **Declare `runtimePreparationPrerequisites` when the execution
   operation needs a separate preparation capability.** This is a
   registry demand-closure edge, never an agent-plan or queue
   dependency
   ([`engineering-operation-registry.ts:77`](../../../src/application/control-plane/engineering-operation-registry.ts)).
   Every target must be `planning-only` and `prerequisiteOnly` with
   exactly one `use: "preparation"` capability
   ([`runtime-preparation-prerequisite-closure.ts:211`](../../../src/application/control-plane/runtime-preparation-prerequisite-closure.ts)).
   The graph is canonicalized once
   ([`runtime-preparation-prerequisite-closure.ts:59`](../../../src/application/control-plane/runtime-preparation-prerequisite-closure.ts))
   and expands demand for planned work items
   ([`compile-project-capability-demand.ts:290`](../../../src/application/control-plane/compile-project-capability-demand.ts))
   and Brief intent
   ([`compile-project-capability-intent.ts:75`](../../../src/application/control-plane/compile-project-capability-intent.ts)).
   Edges participate in the trusted demand fingerprint
   ([`registry.ts:1900`](../../../src/orchestration/operations/registry.ts)).
   The tracer has **no** such edge. The live example is
   `verify.observe-assembly-integrity@1` →
   `design.prepare-geometry-module@1`
   ([`registry.ts:592`](../../../src/orchestration/operations/registry.ts);
   pinned at
   [`runtime-demand-registry_test.ts:150`](../../../src/orchestration/operations/runtime-demand-registry_test.ts)).
   Skip this step when the operation does not need a separate
   planning-only preparation prerequisite. Declaring
   `use: "preparation"` on the operation's own `runtimeDemand` does
   not by itself require this edge.

6. **Add the operation to `BRIEF_CAPABILITY_INTENT_ROUTES` when a
   Brief verification authority must forecast it.** The table names
   registered operations that may carry a runtime demand; it never
   restates a capability or selects a provider
   ([`brief-capability-intent-routes.ts:70`](../../../src/orchestration/operations/brief-capability-intent-routes.ts),
   table at
   [`brief-capability-intent-routes.ts:72`](../../../src/orchestration/operations/brief-capability-intent-routes.ts)).
   `compileProjectCapabilityIntent` reads only
   `verification-activity.verificationAuthority`, looks up the route,
   then resolves those operations through the preparation-prerequisite
   closure
   ([`compile-project-capability-intent.ts:45`](../../../src/application/control-plane/compile-project-capability-intent.ts)).
   Prerequisite-only operations cannot be route roots
   ([`runtime-preparation-prerequisite-closure.ts:86`](../../../src/application/control-plane/runtime-preparation-prerequisite-closure.ts)).
   The table is injected at
   [`server.ts:1035`](../../../server.ts).
   The tracer is **not** on any route. Skip this step unless the
   operation must appear in a Brief capability-intent ceiling.
   Runtime demand alone does not put an operation on this table.

7. **Gate the MRTR grammar at proposal time when the operation has one.**
   [`PROPOSAL_VALIDATORS`](../../../src/orchestration/operations/proposal-validation.ts)
   at
   [`proposal-validation.ts:192`](../../../src/orchestration/operations/proposal-validation.ts)
   is keyed by `id@version`. An absent key is left untouched
   ([`proposal-validation.ts:491`](../../../src/orchestration/operations/proposal-validation.ts)).
   `project_decision_propose` always calls
   [`assertProposalMatchesOperationGrammar`](../../../src/orchestration/operations/proposal-validation.ts)
   ([`project-control.ts:423`](../../../src/tools/project-control.ts)).
   This tracer has **no** map entry; the executor still requires
   `archiveAction=retire-lineage`, `archiveOperation=record.archive-lineage@1`,
   and `archiveTargetCount`
   ([`archive-lineage-run-executor.ts:674`](../../../src/adapters/record/archive-lineage-run-executor.ts)).
   Pin that choice with a test
   ([`proposal-validation_test.ts:510`](../../../src/orchestration/operations/proposal-validation_test.ts)).
   Prefer a closed parser in the map for a new consequential grammar.

8. **Implement a trusted executor.** One adapter class that structurally
   satisfies
   [`ProjectRunExecutor`](../../../src/application/ports/in/project-run-executor.ts)
   ([`project-run-executor.ts:18`](../../../src/application/ports/in/project-run-executor.ts)).
   The tracer is
   [`ArchiveLineageRunExecutor`](../../../src/adapters/record/archive-lineage-run-executor.ts)
   ([`archive-lineage-run-executor.ts:126`](../../../src/adapters/record/archive-lineage-run-executor.ts)):
   agent-only origin
   ([`archive-lineage-run-executor.ts:148`](../../../src/adapters/record/archive-lineage-run-executor.ts)),
   `requireShape` against the exact identity
   ([`archive-lineage-run-executor.ts:500`](../../../src/adapters/record/archive-lineage-run-executor.ts)),
   human MRTR + exact target evidence
   ([`archive-lineage-run-executor.ts:571`](../../../src/adapters/record/archive-lineage-run-executor.ts)),
   domain cascade +
   [`applyThreadSnapshotExtension`](../../../src/domain/thread/thread-snapshot-extension.ts)
   ([`archive-lineage-run-executor.ts:465`](../../../src/adapters/record/archive-lineage-run-executor.ts);
   extension helper
   [`thread-snapshot-extension.ts:110`](../../../src/domain/thread/thread-snapshot-extension.ts)),
   CAS readback, `publishRun`, `completeRun`. Re-export the domain identity so
   composition cannot drift
   ([`archive-lineage-run-executor.ts:92`](../../../src/adapters/record/archive-lineage-run-executor.ts)).
   Hexagonal placement: `src/adapters/<authority>/`, never `src/infrastructure/`.

9. **Join shared Thread-write guards when the executor appends a snapshot.**
   Add `id@version` to `THREAD_WRITE_OPERATIONS`
   ([`thread-write-basis-guard.ts:71`](../../../src/adapters/shared/thread-write-basis-guard.ts);
   tracer at
   [`thread-write-basis-guard.ts:95`](../../../src/adapters/shared/thread-write-basis-guard.ts)).
   Claim injection:
   [`assertThreadWriteClaimAllowed`](../../../src/adapters/shared/thread-write-basis-guard.ts)
   ([`thread-write-basis-guard.ts:275`](../../../src/adapters/shared/thread-write-basis-guard.ts)) from
   [`engineering-project-command-runtime.ts:110`](../../../src/adapters/project/engineering-project-command-runtime.ts).
   The tracer also calls
   [`assertThreadWriteBasisAvailable`](../../../src/adapters/shared/thread-write-basis-guard.ts)
   ([`archive-lineage-run-executor.ts:185`](../../../src/adapters/record/archive-lineage-run-executor.ts)).
   Skip this step only when the operation does not write Thread.

10. **Wire the composition root.** In
   [`server.ts`](../../../server.ts): construct the executor
   ([`server.ts:1396`](../../../server.ts)), then register it on
   [`RegisteredProjectRunExecutor.additional`](../../../src/application/use-cases/registered-project-run-executor.ts)
   ([`server.ts:1848`](../../../server.ts), tracer at
   [`server.ts:2000`](../../../server.ts)). A registered plan identity with no
   dispatch entry fails at execute:
   [`registered-project-run-executor.ts:117`](../../../src/application/use-cases/registered-project-run-executor.ts)
   (`"not backed by a trusted registered executor"`). Inject the same registry
   into project planning
   ([`server.ts:996`](../../../server.ts)). `project_plan_publish` /
   `project_change_append` /
   `project_agent_run_queue` already validate through that registry
   ([`project-planning-transitions.ts:730`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts),
   [`engineering-run-transitions.ts:451`](../../../src/application/use-cases/project/commands/engineering-run-transitions.ts)).
   Do not add a new MCP tool for the operation.
   `project_agent_run_execute` dispatches only by queued run id
   ([`project-control.ts:751`](../../../src/tools/project-control.ts)).

11. **Set registry flags that planning actually enforces.**
   - `requiresAdditiveChange` — refused in the initial plan
     ([`project-planning-transitions.ts:86`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts)).
     The tracer does **not** set this flag.
   - `requiresDependsOnOperation` — every work item must name exactly one
     `dependsOnWorkItemIds` entry resolving to the unique current leaf
     revision of that named registered operation. Unknown ids, multiple
     matches, stale non-leaf revisions, and ambiguous leaf sets are each
     refused. Enforced only at `project_change_append`, before MRTR or queue
     ([`project-planning-transitions.ts:279`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts),
     wrapper
     [`project-planning-transitions.ts:625`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts),
     domain
     [`required-depends-on-operation.ts:54`](../../../src/domain/project/required-depends-on-operation.ts)).
     Initial plan publication does not run this check. The tracer does
     **not** set this flag. Live example:
     `architecture.seed-syson-model@2` depends on
     `baseline.from-approved-brief@1`
     ([`registry.ts:213`](../../../src/orchestration/operations/registry.ts)).
     Skip unless planning must enforce that predecessor.
   - `decisionEvidenceScope: "thread-entity-bindings"` — copies thread-entity
     bindings into decision `inputEvidenceRefs`
     ([`project-planning-transitions.ts:799`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts)).
     The tracer sets it
     ([`registry.ts:1809`](../../../src/orchestration/operations/registry.ts)).
     Human approval elicitation then renders those refs as canonical JSON
     ([`project-control.ts:1308`](../../../src/tools/project-control.ts)).
   - `threadEntityBindingsMustMatchBasis` — append and queue must name the
     current basis: `project_change_append` is the primary UX guard
     ([`project-planning-transitions.ts:265`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts)),
     the queue recheck is a pre-persistence defence
     ([`engineering-run-transitions.ts:319`](../../../src/application/use-cases/project/commands/engineering-run-transitions.ts)).
     The tracer does **not** set this flag; the executor still checks target
     snapshot identity
     ([`archive-lineage-run-executor.ts:542`](../../../src/adapters/record/archive-lineage-run-executor.ts)).
   - `mustOrigin: "human"` — run lifecycle and
     `project_agent_run_execute` elicitation
     ([`engineering-project-command-policy.ts:82`](../../../src/application/use-cases/project/commands/engineering-project-command-policy.ts),
     [`project-control.ts:1119`](../../../src/tools/project-control.ts)).
     The tracer is agent-dispatched after a human MRTR; it is not
     `mustOrigin: "human"`.

12. **Set `resolvedOperationPlan: "2.0"` and add a resolver branch
    when the operation needs a sealed dispatch plan.** Descriptor
    field
    ([`engineering-operation-registry.ts:81`](../../../src/application/control-plane/engineering-operation-registry.ts)).
    Queueing calls the configured sealer when the marker is set
    ([`engineering-run-transitions.ts:349`](../../../src/application/use-cases/project/commands/engineering-run-transitions.ts)).
    `ResolvedOperationPlanResolver.resolve` currently branches
    CalculiX, prescribed kinematics, admitted Modelica, and admitted
    SPICE, then fails closed
    ([`resolved-operation-plan-resolver.ts:176`](../../../src/adapters/compile/plans/resolved-operation-plan-resolver.ts);
    first branch
    [`resolved-operation-plan-resolver.ts:231`](../../../src/adapters/compile/plans/resolved-operation-plan-resolver.ts),
    unknown identity
    [`resolved-operation-plan-resolver.ts:252`](../../../src/adapters/compile/plans/resolved-operation-plan-resolver.ts)).
    A new plan-bearing operation must add a branch or queueing throws
    `"resolved-operation-plan/2.0 is not defined for this operation."`.
    The tracer has **no** marker. Live descriptors include
    `verify.run-prescribed-kinematics@1`
    ([`registry.ts:669`](../../../src/orchestration/operations/registry.ts))
    and `verify.run-fea-static-proof@3`
    ([`fea-isolated-static-proof.ts:55`](../../../src/orchestration/operations/fea-isolated-static-proof.ts)).
    Registry marker / persisted-receipt identity parity is pinned
    ([`registry_test.ts:304`](../../../src/orchestration/operations/registry_test.ts)).
    Skip this step when the operation does not need a sealed dispatch
    plan.

13. **Name Workbench persistence ordering when the executor saves Thread before
    `completeRun`.** Membership in the registry does not do this. Add the
    identity to `DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS`
    ([`serve-native-workbench.ts:1245`](../../../scripts/serve/serve-native-workbench.ts);
    tracer at
    [`serve-native-workbench.ts:1262`](../../../scripts/serve/serve-native-workbench.ts)).
    While such a run awaits durable attachment, the browser keeps the declared
    project head
    ([`serve-native-workbench.ts:1220`](../../../scripts/serve/serve-native-workbench.ts)).
    That includes a `failed` run whose snapshot save succeeded before readback
    (legacy/recovery guard,
    [`serve-native-workbench.ts:1300`](../../../scripts/serve/serve-native-workbench.ts)).
    Pin it
    ([`serve-native-workbench_test.ts:1629`](../../../scripts/serve/serve-native-workbench_test.ts)).
    Archived-entity hiding uses generic
    [`archivedRefKeys`](../../../src/domain/thread/thread-snapshot.ts)
    ([`thread-snapshot.ts:271`](../../../src/domain/thread/thread-snapshot.ts));
    do not add an operation-specific projector for retirement.
    When the executor publishes requirement evaluations or Thread
    observations, also add `id@version` to the exact project read-time
    allowlists `REQUIREMENT_JOIN_OPERATIONS`
    ([`agent-run-requirement-join.ts:23`](../../../src/domain/project/agent-run-requirement-join.ts))
    and/or `THREAD_OBSERVATION_OPERATIONS`
    ([`agent-run-requirement-join.ts:31`](../../../src/domain/project/agent-run-requirement-join.ts));
    otherwise completed runs expose no `join`/`observations` fields. The
    tracer publishes neither; skip this wiring for pure retirement writers.

14. **Cover the material risk with colocated tests.** Minimum for a Thread
    writer like the tracer:
    - executor refusals and one successful publish
      ([`archive-lineage-run-executor_test.ts`](../../../src/adapters/record/archive-lineage-run-executor_test.ts));
    - domain cascade
      ([`thread-retirement_test.ts`](../../../src/domain/thread/thread-retirement_test.ts));
    - Thread-write sibling exclusion
      ([`thread-write-basis-guard_test.ts:625`](../../../src/adapters/shared/thread-write-basis-guard_test.ts));
    - Workbench durable-writer classification
      ([`serve-native-workbench_test.ts:1629`](../../../scripts/serve/serve-native-workbench_test.ts));
    - extend
      [`runtime-demand-registry_test.ts`](../../../src/orchestration/operations/runtime-demand-registry_test.ts):
      bump the pinned `operations.length`
      ([`runtime-demand-registry_test.ts:107`](../../../src/orchestration/operations/runtime-demand-registry_test.ts));
      when `runtimeDemand.kind` is `"none"`, `noneCount`
      ([`runtime-demand-registry_test.ts:142`](../../../src/orchestration/operations/runtime-demand-registry_test.ts))
      grows by one and no map entry is added; when it is `"required"`, add
      the exact `DEMANDING_OPERATIONS` entry and leave `noneCount`
      unchanged. Leave no stale map entry (the seen-demanding assertion
      fails otherwise);
    - path-lane totality (automatic once step 3 is done);
    - registry contract tests when bindings, flags, `mustOrigin`,
      `runtimePreparationPrerequisites`, `requiresDependsOnOperation`, or
      `resolvedOperationPlan` are new.
    Unknown ids already fail closed
    ([`registry_test.ts:105`](../../../src/orchestration/operations/registry_test.ts),
    code `unknown_operation`). A work-item whose operation is not in the
    registry compiles as `unresolved / operation-unregistered`
    ([`compile-project-capability-demand.ts:170`](../../../src/application/control-plane/compile-project-capability-demand.ts)).

15. **Update living catalogues that name operations, then stop.** Add the row to
    [agent workspace §5](../agent/agent-workspace.md#5-registered-operations)
    (tracer at
    [`agent-workspace.md:518`](../agent/agent-workspace.md)). If the operation
    is part of the public project contract, name it in
    [engineering project](../contracts/engineering-project.md)
    (tracer at
    [`engineering-project.md:160`](../contracts/engineering-project.md)). Cite
    it from a path skill only when that skill actually teaches it. Those
    citations are pinned only if the document is listed in
    `OPERATION_CITING_DOCUMENTS`
    ([`operation-reference-docs_test.ts:30`](../../../src/orchestration/operations/operation-reference-docs_test.ts));
    that list includes live reference pages, how-tos and agent skills.
    Add any new
    operation-citing path document to that array, or
    [`operation-reference-docs_test.ts:260`](../../../src/orchestration/operations/operation-reference-docs_test.ts)
    will not see it.
    File census of the owning authority stays on the matching page under
    [codebase map](../codebase/codebase-map.md)
    (tracer executor already listed in
    [project, Thread, and record](../codebase/project-thread-record.md)
    at
    [`project-thread-record.md:223`](../codebase/project-thread-record.md)).
    Queueing sequence for any trusted consequential op remains
    `project_change_append` → `project_decision_propose` →
    `project_decision_approve` → `project_agent_run_queue` →
    `project_agent_run_execute`
    ([`agent-workspace.md:559`](../agent/agent-workspace.md)).

## Tracer inventory (`ARCHIVE_LINEAGE_OPERATION`)

Verified 2026-09-12 against this worktree; conditional wiring rows verified
2026-09-13; every `file:line` citation re-read and regenerated 2026-09-13.
Every `file:line` was read in source.

| Layer | Role | Citation |
| ----- | ---- | -------- |
| Domain identity | `{ id, version }` constant | [`src/domain/thread/thread-retirement.ts:299`](../../../src/domain/thread/thread-retirement.ts) |
| Domain cascade | Downward production closure; never `traces_to` | [`src/domain/thread/thread-retirement.ts:83`](../../../src/domain/thread/thread-retirement.ts) |
| Domain snapshot | `archived` change keys used for idempotence | [`src/domain/thread/thread-snapshot.ts:271`](../../../src/domain/thread/thread-snapshot.ts) |
| Domain extension | Successor snapshot write | [`src/domain/thread/thread-snapshot-extension.ts:110`](../../../src/domain/thread/thread-snapshot-extension.ts) |
| Registry contract | Descriptor type | [`src/application/control-plane/engineering-operation-registry.ts:52`](../../../src/application/control-plane/engineering-operation-registry.ts) |
| Registry entry | Planning descriptor (literal id, not the constant) | [`src/orchestration/operations/registry.ts:1796`](../../../src/orchestration/operations/registry.ts) |
| Registry lookup | `unknown_operation` fail-closed | [`src/orchestration/operations/registry.ts:1862`](../../../src/orchestration/operations/registry.ts) |
| Registry list | Keys for doc-pinning tests | [`src/orchestration/operations/registry.ts:1875`](../../../src/orchestration/operations/registry.ts) |
| Registry validate | Plan + queue input | [`src/orchestration/operations/registry.ts:1923`](../../../src/orchestration/operations/registry.ts) |
| Registry instance | Code-owned `get` / `require` / `list` / `validate` | [`src/orchestration/operations/registry.ts:1986`](../../../src/orchestration/operations/registry.ts) |
| Registry inject | Planning validation boundary | [`src/orchestration/operations/registry.ts:2338`](../../../src/orchestration/operations/registry.ts) |
| Path lane | `system-model` | [`src/orchestration/operations/path-lanes.ts:89`](../../../src/orchestration/operations/path-lanes.ts) |
| Proposal map | **No** grammar entry; free-form until executor | [`src/orchestration/operations/proposal-validation.ts:192`](../../../src/orchestration/operations/proposal-validation.ts) |
| Proposal MCP | Gate at `project_decision_propose` | [`src/tools/project-control.ts:423`](../../../src/tools/project-control.ts) |
| Executor | Trusted generic writer, no provider | [`src/adapters/record/archive-lineage-run-executor.ts:126`](../../../src/adapters/record/archive-lineage-run-executor.ts) |
| Executor identity export | Same object `server.ts` registers | [`src/adapters/record/archive-lineage-run-executor.ts:92`](../../../src/adapters/record/archive-lineage-run-executor.ts) |
| Executor origin | Agent only | [`src/adapters/record/archive-lineage-run-executor.ts:148`](../../../src/adapters/record/archive-lineage-run-executor.ts) |
| Executor MRTR | Human approval + exact targets | [`src/adapters/record/archive-lineage-run-executor.ts:571`](../../../src/adapters/record/archive-lineage-run-executor.ts) |
| Executor grammar | `isArchiveProposal` | [`src/adapters/record/archive-lineage-run-executor.ts:674`](../../../src/adapters/record/archive-lineage-run-executor.ts) |
| Thread-write set | Shared basis exclusion | [`src/adapters/shared/thread-write-basis-guard.ts:95`](../../../src/adapters/shared/thread-write-basis-guard.ts) |
| Claim hook | Command runtime | [`src/adapters/project/engineering-project-command-runtime.ts:110`](../../../src/adapters/project/engineering-project-command-runtime.ts) |
| Compose construct | Always-on, no provider | [`server.ts:1396`](../../../server.ts) |
| Compose dispatch | `additional[]` registration | [`server.ts:2000`](../../../server.ts) |
| Compose planning | Registry injected | [`server.ts:996`](../../../server.ts) |
| Dispatch miss | Unwired registered op | [`src/application/use-cases/registered-project-run-executor.ts:117`](../../../src/application/use-cases/registered-project-run-executor.ts) |
| Plan validate | `stage: "planning"` | [`src/application/use-cases/project/commands/project-planning-transitions.ts:730`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts) |
| Evidence scope | Bindings → decision refs | [`src/application/use-cases/project/commands/project-planning-transitions.ts:799`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts) |
| Queue validate | `stage: "queue"` | [`src/application/use-cases/project/commands/engineering-run-transitions.ts:451`](../../../src/application/use-cases/project/commands/engineering-run-transitions.ts) |
| MCP append | `project_change_append` | [`src/tools/project-control.ts:580`](../../../src/tools/project-control.ts) |
| MCP queue | `project_agent_run_queue` | [`src/tools/project-control.ts:706`](../../../src/tools/project-control.ts) |
| MCP execute | `project_agent_run_execute` | [`src/tools/project-control.ts:751`](../../../src/tools/project-control.ts) |
| MCP elicitation | Exact evidence JSON | [`src/tools/project-control.ts:1308`](../../../src/tools/project-control.ts) |
| Workbench allowlist | Durable-before-attachment | [`scripts/serve/serve-native-workbench.ts:1262`](../../../scripts/serve/serve-native-workbench.ts) |
| Workbench hold | Keep declared head | [`scripts/serve/serve-native-workbench.ts:1220`](../../../scripts/serve/serve-native-workbench.ts) |
| Capability demand | Unregistered → unresolved | [`src/application/control-plane/compile-project-capability-demand.ts:170`](../../../src/application/control-plane/compile-project-capability-demand.ts) |
| Capability runtime | `none` demand skips host | [`src/application/control-plane/capability-runtime-supervisor.ts:188`](../../../src/application/control-plane/capability-runtime-supervisor.ts) |
| Prep-prerequisite field | Optional demand-closure edges; tracer has **none** | [`src/application/control-plane/engineering-operation-registry.ts:77`](../../../src/application/control-plane/engineering-operation-registry.ts) |
| Prep-prerequisite graph | Canonicalize; preparation-only targets | [`src/application/control-plane/runtime-preparation-prerequisite-closure.ts:59`](../../../src/application/control-plane/runtime-preparation-prerequisite-closure.ts) |
| Prep-prerequisite live | `verify.observe-assembly-integrity@1` → prepare-geometry-module | [`src/orchestration/operations/registry.ts:592`](../../../src/orchestration/operations/registry.ts) |
| Depends-on field | Optional planning predecessor; tracer has **none** | [`src/application/control-plane/engineering-operation-registry.ts:96`](../../../src/application/control-plane/engineering-operation-registry.ts) |
| Depends-on append | `assertRequiredDependsOnOperation` at `project_change_append` | [`src/application/use-cases/project/commands/project-planning-transitions.ts:279`](../../../src/application/use-cases/project/commands/project-planning-transitions.ts) |
| Depends-on domain | Exact current leaf of the named operation | [`src/domain/project/required-depends-on-operation.ts:54`](../../../src/domain/project/required-depends-on-operation.ts) |
| ROP2 field | `resolvedOperationPlan: "2.0"`; tracer has **none** | [`src/application/control-plane/engineering-operation-registry.ts:81`](../../../src/application/control-plane/engineering-operation-registry.ts) |
| ROP2 queue seal | Sealer required when the marker is set | [`src/application/use-cases/project/commands/engineering-run-transitions.ts:349`](../../../src/application/use-cases/project/commands/engineering-run-transitions.ts) |
| ROP2 resolver | Identity branches, else fail closed | [`src/adapters/compile/plans/resolved-operation-plan-resolver.ts:176`](../../../src/adapters/compile/plans/resolved-operation-plan-resolver.ts) |
| Brief intent routes | `BRIEF_CAPABILITY_INTENT_ROUTES`; tracer **not** listed | [`src/orchestration/operations/brief-capability-intent-routes.ts:72`](../../../src/orchestration/operations/brief-capability-intent-routes.ts) |
| Brief intent compile | Authority → route operations → demand closure | [`src/application/control-plane/compile-project-capability-intent.ts:45`](../../../src/application/control-plane/compile-project-capability-intent.ts) |

### Tracer tests

| Suite | What it pins | Citation |
| ----- | ------------ | -------- |
| Domain cascade | Closure, unknown target, idempotence | [`src/domain/thread/thread-retirement_test.ts:1`](../../../src/domain/thread/thread-retirement_test.ts) |
| Executor | Origin, shape, MRTR, publish, recovery, redundant cascade | [`src/adapters/record/archive-lineage-run-executor_test.ts:1`](../../../src/adapters/record/archive-lineage-run-executor_test.ts) |
| Thread-write guard | Shares basis exclusion with compilation | [`src/adapters/shared/thread-write-basis-guard_test.ts:625`](../../../src/adapters/shared/thread-write-basis-guard_test.ts) |
| Workbench | Durable-writer classification includes the tracer | [`scripts/serve/serve-native-workbench_test.ts:1629`](../../../scripts/serve/serve-native-workbench_test.ts) |
| Proposal | Ungated grammar; shared decision still gated by the other op | [`src/orchestration/operations/proposal-validation_test.ts:510`](../../../src/orchestration/operations/proposal-validation_test.ts) |
| Path lanes | Totality over caller-visible registry keys | [`src/orchestration/operations/path-lanes_test.ts:13`](../../../src/orchestration/operations/path-lanes_test.ts) |
| Runtime demand | Exhaustive `none` vs required counts | [`src/orchestration/operations/runtime-demand-registry_test.ts:105`](../../../src/orchestration/operations/runtime-demand-registry_test.ts) |
| Registry unknown | `unknown_operation`, no tool/args leak | [`src/orchestration/operations/registry_test.ts:105`](../../../src/orchestration/operations/registry_test.ts) |
| Doc watch list | Exact documents the pin suite reads (`OPERATION_CITING_DOCUMENTS`, live reference pages, how-tos and skills) | [`src/orchestration/operations/operation-reference-docs_test.ts:30`](../../../src/orchestration/operations/operation-reference-docs_test.ts) |
| Doc pin | Cited ids in those watched documents must exist | [`src/orchestration/operations/operation-reference-docs_test.ts:260`](../../../src/orchestration/operations/operation-reference-docs_test.ts) |

### Tracer-only, not a general wiring step

These files mention `record.archive-lineage` as a fixture, probe, or narrative. Copying
them is not how a new operation is added.

| File | Why it is not a wiring step |
| ---- | --------------------------- |
| [`src/adapters/shared/stores/engineering-project-store_test.ts:686`](../../../src/adapters/shared/stores/engineering-project-store_test.ts) | Store fixture work-item id |
| [`src/domain/project/engineering-project-extension_test.ts:373`](../../../src/domain/project/engineering-project-extension_test.ts) | Extension fixture work-item id |
| [`scripts/probes/probe-archive-cascade.ts:1`](../../../scripts/probes/probe-archive-cascade.ts) | Diagnostic cascade probe; no project command |
| [`docs/reference/contracts/engineering-project.md:300`](../contracts/engineering-project.md) | Contract narrative of this operation |
| [`docs/reference/pipeline/analysis-authority-pipeline.md:427`](../pipeline/analysis-authority-pipeline.md) | Provenance-retirement narrative |
| [`docs/reference/codebase/project-thread-record.md:41`](../codebase/project-thread-record.md) | File census of the record adapters |

`computeArchiveCascade` is also imported by other Thread writers (requirements,
geometry, compilation tests). That reuse is cascade math, not operation
registration.
