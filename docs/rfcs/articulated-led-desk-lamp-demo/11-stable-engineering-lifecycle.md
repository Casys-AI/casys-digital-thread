Audience: agent · Diátaxis: none · Kind: RFC Status: active Living pages:
[Engineering project contract](../../reference/contracts/engineering-project.md),
[Workbench preview](../../how-to/cockpit/preview-native-workbench.md),
[Workspace map](../../reference/runtime/workspace-map.md)

# RFC: 11 — stable engineering lifecycle

This is a breaking post-demo refactor. The lamp run exposed a domain identity defect:
the Project aggregate persists phases, work items and runs, while the Workbench guesses
which work items are revisions of the same engineering activity. Similar operation IDs,
phase order, labels, timestamps or Thread graph proximity are not identity.

The objective is a small model-driven lifecycle that works for requirements, system
model, CAD, physics and verdict work without a lamp branch or a universal `Model` base
class. Rename current concepts when that makes the ubiquitous language exact. There are
no clients and no obligation to read old local project snapshots.

## Ubiquitous language

The implementation must express these four different facts directly:

1. **Activity** — the stable engineering intent that survives revisions.
2. **Revision** — one immutable planned form of that activity: exact registered
   operation, bindings, decisions, dependencies and brief-gate claims.
3. **Attempt** — one execution of one revision. Failed and cancelled attempts remain
   literal history; retrying unchanged work creates another attempt, not another
   revision or phase.
4. **Evidence lineage** — exact Thread/CAS provenance. It may corroborate a lifecycle
   link but never creates one.

`EngineeringAgentRun` already behaves as the attempt attached to a work item. Preserve
that semantic or rename it consistently. Do not add another attempt counter or duplicate
run state. `Phase` remains scheduling/presentation order, `GateClaim` remains reviewed
brief coverage, and `reconciliation` remains truthful terminal closeout; none is an
activity identity.

Prefer a broad noun such as `EngineeringActivity` over `Study` if one noun must cover
architecture, CAD and human-verdict work. The concrete storage shape may be an explicit
entity or a required lifecycle value on each revision, but the persisted current schema
and the domain API must expose one stable ID and an explicit predecessor relation.

## Required invariants

- A root revision starts one stable activity. Its stable ID is server-derived from the
  root revision identity or otherwise server-stamped; a caller cannot re-parent it.
- A successor names an existing predecessor revision. The server inherits the stable
  activity identity and rejects absent, self, forward, cross-project and cross-activity
  predecessors.
- Revisions are append-only. Several successors of one predecessor are valid branches;
  do not impose a linear chain or mutable `latest` pointer.
- Every attempt references exactly one revision. Retrying a failed or cancelled attempt
  on unchanged reviewed input reuses that revision.
- A changed operation, binding, reviewed input or method is a new revision only when the
  command declares the predecessor explicitly. The server never guesses from equality.
- Two independent activities using the same operation and version never merge. One
  activity whose operation version changes remains one activity.
- Reconciliation can close only work in the same stable activity. It still does not turn
  a failed attempt into a successful one.
- Typed domain identity remains typed. For example, FEA proof-case `id` and `revision`
  remain the mechanical declaration series; Project lifecycle links its work without
  replacing or inferring that domain identity.
- All IDs, predecessors, statuses and evidence references survive JSON round trips and
  order shuffling. No result depends on array order, label suffixes or timestamps.

Adopt one current Project schema version and one current Workbench schema version. Since
active development explicitly accepts breakage, remove obsolete readers, optional
fallbacks and compatibility heuristics instead of maintaining old snapshots. Do not
silently change the meaning of an existing schema identifier. Retire or regenerate local
fixtures and start a fresh validation project; never manufacture lifecycle edges for
AL01 history.

## Ownership and projection

- Domain owns lifecycle vocabulary and invariants.
- Application commands accept only the minimum declaration needed to start an activity
  or append a revision. The service validates and stamps derived identity.
- Registered operations still own title, description, kind, bindings and path-lane
  classification. Callers do not choose providers, tools, arguments or lanes.
- The BFF projects explicit stable activities with ordered revisions and their exact
  attempts. It may calculate a presentation status but cannot suppress literal failures.
- The Workbench remains GET + SSE and renders the BFF read model. Delete client code that
  guesses lifecycle from operation keys, phase order, correction labels, timestamps or
  Thread proximity.
- Thread provenance, decision supersession and Project lifecycle remain different graphs.
  Do not create a generic relation abstraction that erases their authority.

The five server-owned Overview lanes remain. Each activity is rendered once, with its
revisions and attempts wrapped inside it. Counts include every visible activity and do
not cap requirements or verdicts. Empty technical results stay disabled and
non-navigational.

When the hero omits documentary/evidence/result connector nodes, preserve exact
connectivity by a deterministic server-owned or pure read-model condensation through
those omitted nodes. Never draw an invented edge. A retained node with only hidden
intermediaries must not appear as a false isolated SPICE, Modelica, FEA or CAD point.

## Implementation lots

1. Inventory current Project identity, mutation, validation, serialization and BFF/UI
   inference seams. Record only findings that affect this lifecycle.
2. Introduce the stable activity/revision/attempt model and its strict parser. Perform
   coherent breaking renames rather than leaving deprecated aliases.
3. Change initial plan and additive change commands. Keep the agent surface declarative;
   server-side validation and identity stamping are mandatory.
4. Project the lifecycle from the BFF, remove Overview lifecycle heuristics and render
   explicit revisions/attempts within the server-owned lanes.
5. Condense hidden evidence connectors without changing the Thread authority graph.
6. Update the living Project and Workbench reference pages. Keep domain coverage pages
   about engineering capability; do not mix this software lifecycle into each provider.

Do not refactor unrelated engine mathematics, provider images, make/buy, dl05, retired
CM-01 paths or desktop chat. Do not add a framework, service locator, generic aggregate
superclass, caller-selected runtime, lamp-specific map or fallback to `latest`.

## Acceptance examples

- Same operation, two activities: two Overview items.
- Same activity, new operation version: one item with two explicit revisions.
- Failed then successful retry with unchanged revision: one revision, two attempts, both
  statuses visible.
- Failed revision then corrected successor revision: one activity, two revisions, each
  with its own attempts and evidence.
- Branched successors: deterministic branch order and no fabricated current winner.
- FEA declaration revisions 1 and 2: exact typed series retained and linked to explicit
  Project revisions; revision 2 is never called a retry without an attempt relation.
- Hidden SPICE result/evidence connectors: visible observations remain connected through
  exact condensed paths.
- Shuffled arrays and identical titles/timestamps do not change grouping.

Use focused domain, command, projector and UI model tests for these examples. Format only
touched files. Run targeted `deno test`, targeted `deno lint`/`deno fmt --check`, UI type
check when UI contracts change, and one final causal integration check. Do not run the
whole repository suite after every lot.

## Grok execution contract

Grok 4.6 `xhigh` is the implementation lead. Read `AGENTS.md`, `CLAUDE.md`, this RFC and
the linked living contracts before editing. Inspect current HEAD and the clean worktree,
then implement the complete domain-to-Workbench refactor; do not stop at an inventory or
proposal. Preserve server/human/agent authority, literal statuses and exact provenance.

Renames and breaking changes are authorized. Old local Project snapshots need not load.
Remove the old aliases and inference paths rather than maintaining two models. Preserve
the already-landed five-lane Overview behavior and empty-CAD navigation fix. Do not edit
`deno.lock` or `docs/assets/Dashboard UI mockups (1)/`. Do not commit or push; leave one
auditable worktree for architecture review. Report the chosen ubiquitous language,
invariants, exact files changed and focused validations actually run.
