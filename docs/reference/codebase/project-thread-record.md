# Reference: source map — project, Thread, and record

Audience: agent · Diátaxis: reference · Kind: contract

Census of project ledger, Thread snapshot, brief, and record-reconciliation files. Not
Workbench presentation and not CAS directory roots.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`docs/reference/contracts/graph-data-model.md`](../contracts/graph-data-model.md)

Four-layer graph inventory (ThreadSnapshot, AnalysisGraph, BFF ThreadGraph, Graphology)
with live dl05 examples for coherence review; not a Workbench screen

#### [`src/adapters/project/`](../../../src/adapters/project)

Project ledger adapters: `baseline.from-approved-brief@1` executor, command runtime,
cockpit-focus store, initial-baseline evidence validator. Brief tools stay under
`src/tools/`. Not CAD/FEA

#### [`src/adapters/thread/`](../../../src/adapters/thread)

Read-only Thread/BFF projectors and post-projection enrichers (GET + SSE). Not command
authority. Métier catalogs stay under `cad/canonical` and `architecture/renderer`

#### [`src/application/ports/out/project/`](../../../src/application/ports/out/project)

Outbound cockpit-focus ledger port. Other project ports remain flat under `ports/out/`

#### [`src/domain/record/`](../../../src/domain/record)

`record.reconcile-uncertain-writer@1` proposal and accepted-write basis-release. Archive
cascade math stays in `domain/thread/thread-retirement.ts`. Not CAD/FEA

#### [`src/adapters/record/`](../../../src/adapters/record)

Trusted executors for `record.archive-lineage@1` and
`record.reconcile-uncertain-writer@1`. No WAL, no provider. Shared thread-write guard
lives in `adapters/shared/thread-write-basis-guard.ts`

#### [`src/domain/thread/thread-snapshot.ts`](../../../src/domain/thread/thread-snapshot.ts)

Canonical linked product state; schema 1.1 carries a non-empty validated `AnalysisGraph`
while 1.0 remains provenance-only history

#### [`src/domain/thread/thread-snapshot-ancestry.ts`](../../../src/domain/thread/thread-snapshot-ancestry.ts)

Exact `previous`-chain descendant proof. Not numeric revision, not `latest`. Shared by
completed-dependency resolution and adapter lineage checks

#### [`src/domain/project/engineering-activity.ts`](../../../src/domain/project/engineering-activity.ts)

Stable engineering activity, immutable work revisions and bound run attempts. The server
stamps `activityId`; labels, timestamps and `latest` never group or select revisions

#### [`src/domain/project/required-depends-on-operation.ts`](../../../src/domain/project/required-depends-on-operation.ts)

Exact selected `dependsOn` leaf for `requiresDependsOnOperation`. Planning issues and
runtime resolution share this rule. No sibling inference

#### [`src/application/use-cases/project/resolve-exact-completed-dependency-artifact.ts`](../../../src/application/use-cases/project/resolve-exact-completed-dependency-artifact.ts)

Named completed work artifact plus current-revision `dependsOn` wrapper. Runtime uses
`dependsOn` + required operation; preflight review uses unique completed operation leaf
then the same evidence resolver. Not an active-head label scan. Used by X07/X09/X11
structural selectors

#### [`src/domain/project/engineering-project.ts`](../../../src/domain/project/engineering-project.ts)

Immutable project intent and execution-state contract

#### [`src/domain/project-source-workspace/`](../../../src/domain/project-source-workspace)

Generic draft source-tree aggregate: modules, files, versioned authoring attachments,
exact predecessors, derived POSIX paths, mutation-id idempotency. Event `/3.0`, snapshot
`/2.0`. Replay is pure. Not Thread, not admission

#### [`src/adapters/project-source-workspace/`](../../../src/adapters/project-source-workspace)

Append-only event adapter under `state/local/project-source-workspaces/`, composition,
the fixed generic v1 attachment-role catalogue, and the product-navigation authoring
attachment reader. Claim/publish fail-closed. Not a generic repository. `server.ts`
shares one `CaptureProductStructureTraversal` and one workspace store with product
navigation.

#### [`src/application/use-cases/project-source-workspace/`](../../../src/application/use-cases/project-source-workspace)

Project-scoped mutations and revision-anchored reads. File put reopens the exact
`AgentResourceReference` before the event is accepted. Attachment put recrosses the
current Thread tip and `architecture-capture/4.0` unless the mutation id is already
accepted. Not admission

#### [`src/tools/project-control/project-source-workspace-tools.ts`](../../../src/tools/project-control/project-source-workspace-tools.ts)

Eleven MCP tools for the draft source tree and authoring attachments. `grants: none`.
Optional `captureRequest` is stored inertly; Vertical 1 does not register it. Attachment
roles are the fixed generic v1 catalogue only

#### [`src/domain/project/thread-tip.ts`](../../../src/domain/project/thread-tip.ts)

Unique current Thread tip from the project ledger, plus the closed basis parse. Not
`latest`. Shared by FEA reviews and CAD/compile command parsers

#### [`src/domain/project/project-brief.ts`](../../../src/domain/project/project-brief.ts)

Living brief, questions, sourced answers and exact review contract

#### [`src/application/use-cases/project/project-brief-command-service.ts`](../../../src/application/use-cases/project/project-brief-command-service.ts)

Application use case for project-from-intent and reviewed brief revisions

#### [`src/tools/project-control/demo-loop-tools.ts`](../../../src/tools/project-control/demo-loop-tools.ts)

Read-only `project_sensitivity_base_evaluation_review`. Corrections return through
`project_resource_capture` plus a successor workspace file revision; there is no
corrected-admission review tool

#### [`docs/how-to/verify-design/verify-a-new-design-from-scratch.md`](../../how-to/verify-design/verify-a-new-design-from-scratch.md)

Live from-zero script for a new project on the behave branch; lists harness refusals;
does not replay dl05 or open make/buy

#### [`docs/how-to/verify-design/review-and-correct-after-a-proof.md`](../../how-to/verify-design/review-and-correct-after-a-proof.md)

Behave continuation after FEA: join, fail-only correction, `z*`, reseal. DFM is the
other branch. Historical dl05 r16 is UNLINKED

#### [`src/domain/thread/engineering-assertion.ts`](../../../src/domain/thread/engineering-assertion.ts)

Canonical declared, inferred or observed engineering relations with exact evidence,
distinct from Thread provenance; the authority-admission type is separate and not
activated by analysis

#### [`src/domain/thread/analysis-graph.ts`](../../../src/domain/thread/analysis-graph.ts)

Canonical `AnalysisGraph` index over validated assertions and exact semantic endpoints;
no second relation dialect, provenance rewrite or authority

#### [`src/tools/project-brief.ts`](../../../src/tools/project-brief.ts)

Agent MCP project framing and exact brief-confirmation tools

#### [`src/tools/project-approval-mode.ts`](../../../src/tools/project-approval-mode.ts)

Startup-owned interactive or loopback-only local-YOLO gate table; auto-confirms positive
brief/MRTR, queued-run cancel, work-item abandon, and reviewed registered human-only
execute; never rejects; identity fixed as `human/local-yolo:startup-opt-in`

#### [`src/domain/project/engineering-project-validation.ts`](../../../src/domain/project/engineering-project-validation.ts)

Public validation facade for project snapshots and exact Thread references. Structural
parsing and invariant families live beside it under `src/domain/project/validation/`

#### [`experiments/thread-workflow/`](../../../experiments/thread-workflow)

Frozen YAML DAG authoring prototype (spec + engine, no production caller)

#### [`src/domain/thread/requirements-tip.ts`](../../../src/domain/thread/requirements-tip.ts)

Pure selector for one exact, active, non-archived requirements component tip; shared by
writer, executor and review

#### [`src/application/ports/in/engineering-project-command-origin.ts`](../../../src/application/ports/in/engineering-project-command-origin.ts)

Authenticated command-origin contract shared by project use cases and their inbound
execution boundary

#### [`src/application/ports/in/project-run-executor.ts`](../../../src/application/ports/in/project-run-executor.ts)

Inward exact-run execution contract shared by the MCP tool, application dispatcher and
structurally compatible server-owned executors

#### [`src/application/ports/out/engineering-project-revision-store.ts`](../../../src/application/ports/out/engineering-project-revision-store.ts)

Outbound immutable project-revision persistence contract and optimistic-conflict error

#### [`src/adapters/shared/stores/live-thread-update-store.ts`](../../../src/adapters/shared/stores/live-thread-update-store.ts)

Cross-process append-only live activity journal

#### [`src/adapters/recording-mcp-tool-client.ts`](../../../src/adapters/recording-mcp-tool-client.ts)

Browser-safe running/fresh/failed MCP projections

#### [`src/adapters/shared/stores/file-thread-snapshot-store.ts`](../../../src/adapters/shared/stores/file-thread-snapshot-store.ts)

Immutable local snapshot persistence

#### [`src/adapters/shared/stores/engineering-project-store.ts`](../../../src/adapters/shared/stores/engineering-project-store.ts)

Tracked seed plus immutable active project revision store

#### [`src/application/use-cases/project/engineering-project-command-service.ts`](../../../src/application/use-cases/project/engineering-project-command-service.ts)

Transactional application facade for reviewed project transitions, authority checks,
idempotent replay and receipts. Command DTOs, policies and stage-owned transitions live
beside it under `src/application/use-cases/project/commands/`

#### [`src/adapters/project/engineering-project-command-runtime.ts`](../../../src/adapters/project/engineering-project-command-runtime.ts)

MCP command runtime and exact evidence readers

#### [`scripts/runners/reconcile-work-item-successor.ts`](../../../scripts/runners/reconcile-work-item-successor.ts)

Operator recovery for a leftover ready work item after a completed successor. Not an MCP
tool. Inspect by default; `--apply` writes through the command service. Task:
`recover:work-item-successor`

#### [`src/adapters/validators/engineering-project-completion-evidence-validator.ts`](../../../src/adapters/validators/engineering-project-completion-evidence-validator.ts)

Completion evidence existence and change gate

#### [`src/application/use-cases/registered-project-run-executor.ts`](../../../src/application/use-cases/registered-project-run-executor.ts)

Application dispatch for exact reviewed operations through
`ports/in/project-run-executor.ts`; concrete executors are wired only by the composition
root

#### [`src/adapters/record/archive-lineage-run-executor.ts`](../../../src/adapters/record/archive-lineage-run-executor.ts)

Generic trusted executor for `record.archive-lineage@1`: governed retirement cascade,
gated by a human-approved decision sealing the exact thread-entity targets; no provider
call

#### [`src/adapters/record/reconcile-uncertain-writer-run-executor.ts`](../../../src/adapters/record/reconcile-uncertain-writer-run-executor.ts)

Trusted executor for the human-only `record.reconcile-uncertain-writer@1`: gates on
human origin and an exact re-hashed MRTR; `provider-did-not-write` may release the
basis, while `write-effect-accepted` creates a separate governed release decision; no
provider call or ThreadSnapshot

#### [`src/domain/record/reconcile-uncertain-writer-proposal.ts`](../../../src/domain/record/reconcile-uncertain-writer-proposal.ts)

Single fail-closed reconciliation grammar plus persisted human-ceremony verification for
both outcomes

#### [`src/application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts`](../../../src/application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts)

Provider-neutral extra eligibility for historical generic uncertain writes. Closed by
default. The Chrono adapter lives under `src/adapters/mechanics/chrono/`

#### [`src/domain/record/uncertain-writer-basis-release.ts`](../../../src/domain/record/uncertain-writer-basis-release.ts)

Exact 11-field accepted-write basis-release contract; validates canonical reciprocal
blocker/decision state, recomputed proposal fingerprint, exact basis, and one matching
human approval

#### [`src/adapters/shared/stores/thread-snapshot-lineage.ts`](../../../src/adapters/shared/stores/thread-snapshot-lineage.ts)

Write-boundary lineage integrity. Exact descendant proof is
`domain/thread/thread-snapshot-ancestry.ts` and is re-exported here

#### [`src/tools/project-control.ts`](../../../src/tools/project-control.ts)

Agent MCP planning, elicitation, queueing and bounded execution; geometry preview
depends only on its inward use-case port, not provider clients or CAS stores
