Audience: agent · Diátaxis: none · Kind: RFC Status: active Living pages:
[Behave decision roadmap](../../../explanations/product/behave-decision-roadmap.md),
[FEA coverage](../../../reference/domains/fea/coverage.md),
[Modelica coverage](../../../reference/domains/modelica/coverage.md),
[provider/analysis/evaluation taxonomy](../../../reference/providers/provider-analysis-oracle-taxonomy.md)

# RFC: 10 — integration and articulated-lamp demo closeout

Run this only after core lots 01–07 are complete and every refactor lane is either
committed or explicitly parked in the [queue journal](README.md#progress-journal). This
is an integration and evidence-audit lot, never a late bucket for new physics, UI
authority, schema redesign or cleanup.

Execute closeout as eight bounded lots, not one broad cleanup:

| Lot | Change                                                                                     | Completion boundary                                                    |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| C01 | Build the 01–09 disposition matrix from commits and handoffs.                              | Every claim has an owner, exact status and proof pointer.              |
| C02 | Reopen all core sealed inputs, method identities, outputs, captures and Thread successors. | No console-only or UI-only evidence remains.                           |
| C03 | Replay every accepted engine and evaluation path with dispatch sentinels.                  | Zero new CalculiX, OMC, ngspice or SysON call.                         |
| C04 | Reconcile living coverage/reference/how-to pages.                                          | Docs state only evidenced behavior and literal gaps.                   |
| C05 | Run the read-only demo script against the fresh project.                                   | The full story is understandable without creating state.               |
| C06 | Run the single integrated validation gate below.                                           | Focused and applicable global checks are green.                        |
| C07 | Audit exact final paths, commits and unrelated worktree state.                             | No accidental file, authority expansion or generated output is staged. |
| C08 | Commit the closeout docs/demo reconciliation and write the final handoff.                  | Core 01–07 complete; refactors complete or explicitly parked.          |

## Entry audit

Inspect exact commits, `git status --short`, cached diff and every prior handoff. Build
an explicit 01–09 disposition matrix before changing code or docs:

| Field                | Required statement                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| disposition          | `complete`, `parked`, `blocked`, or `not started`; only refactor lots may remain parked for demo closeout |
| authority            | registered operation/method/schema added, or `none`                                                       |
| persisted proof      | exact sealed inputs, outputs, observation/evaluation capture, WAL/replay identities, or literal gap       |
| validation           | commands actually run and their result                                                                    |
| living documentation | exact reference/how-to/coverage pages needing reconciliation, or `none`                                   |

Return work to its owning lot if a core claim has no readable commit/handoff; a claimed
operation is absent from the registry; an execution lacks sealed input-to-output
lineage; a claimed evaluation lacks exact SysON capture; or a completed replay
redispatches an engine or SysON. Do not start broad global checks until such facts are
resolved or explicitly classified as a core blocker.

## Evidence and replay closure

For each accepted proof path, reopen—not merely display—the exact records at its real
authority level:

1. Lamp question, reviewed MRTRs and any L5 human decision, all bound to the exact
   project revision and stated limits.
2. Architecture/requirements capture and the canonical geometry artifact where the
   downstream method requires it. Confirm a `cad-model`, preview or private draft was
   not substituted for canonical STEP.
3. Every mechanical, Modelica, electrical or impact sealed input; qualified method;
   resolved operation plan; isolated evidence batch; output manifest; normalized
   observations; SysON evaluation request/response capture where an evaluation exists;
   and Thread successor.
4. Cross-binding fingerprints, byte counts, media types, operation/method identities and
   Thread lineage. A solver transcript alone is not persisted evidence.
5. Completed replay for every accepted engine/evaluation path. It must reread durable
   evidence only—no Gmsh, CalculiX, OpenModelica, ngspice or SysON dispatch. An
   ambiguous prior state remains `unresolved`/`error`; never repeat non-idempotent work
   to erase it.

Keep branches separate: static mechanics cannot establish impact; Modelica observations
are documentary unless their own qualified evaluation exists; ngspice is an engine, not
an electrical oracle; an L4 `pass` is not an L5 decision. Absence or failure of the
thermal, electrical or impact lane blocks this agreed demo and stays visible as such.

## Living documentation and demo script

Update living pages only for accepted, evidenced behavior:

- Behave roadmap: state the exact bounded demo decision level and retained exclusions;
  do not promote a solver run to an L5 decision.
- CAD, FEA, Modelica and SysML coverage: add only an actually qualified contract,
  registered operation and replayable evidence. Retain each unimplemented analysis as
  excluded/candidate. Do not promise modal analysis.
- Provider taxonomy: when needed, describe a new engine/method/evaluation boundary
  accurately; never rename an engine as an oracle.
- How-to/reference pages: document the registered review/queue/run/replay sequence
  people can actually follow, not internal RFC intentions or agent-specific commands.

Write or update the demo script only as a read-only guided inspection: open the lamp
revision, trace its architecture and canonical geometry, inspect the separate persisted
proof cards/records, show their limits and literal states, then show the exact human
decision if it exists. The Workbench stays a GET/SSE projection. The script must never
tell a presenter to execute a provider operation, enter a raw payload, claim an
unavailable result, or use a screenshot as evidence.

An RFC, catalog row, test fixture, terminal output, screenshot or UI label is not living
truth. If observed behavior and living documentation differ, repair the behavior or name
the documentation gap; do not dilute contract labels.

## Global validation gate

Run after integration repairs and documentation reconciliation, once:

1. Rerun all affected focused contract, registry, lowering, worker, output-validator,
   evaluation, WAL and replay checks recorded by lots 01–09.
2. Run `deno task check`. Run `deno task check:ui` only if UI sources changed.
3. Exercise the persisted demo boundary: inspect mechanical, Modelica, electrical and
   impact records, their true authority status, and the read-only Workbench projection.
   Prove every completed replay makes no engine or SysON call.
4. Audit documentation links and wording against the exact registry and persisted
   evidence. Verify literal unresolved/error/parked states remain visible.
5. Audit the full final diff for accidental scope expansion, caller authority, modal
   claims, unpinned runtime/provider choices, raw solver payloads, or special-case lamp
   branches.

On any failure, return to the owning lot. Do not weaken a check, erase WAL/evidence,
retry a non-idempotent provider, or replace missing persisted proof with console output.

## Scope and commit audit

Use `git diff <base>...HEAD --name-only` and `git diff <base>...HEAD --check`, then
compare every path to the disposition matrix. Permit only:

- implementation and tests directly owned by completed lots;
- living docs, coverage and how-to changes justified by the evidence reopened above;
- this RFC and its sibling implementation records; and
- a read-only demo script/projection that adds no authority.

Exclude unrelated lockfiles, temp/screenshot output, broad formatting churn, UI work
outside 07's read-only projection, provider image changes without an owning qualified
method, catalog rows for unqualified methods, generic modal scaffolding, and speculative
future demo scenarios. Preserve pre-existing dirty changes and do not stage them.

Make one final `docs(behave): close articulated lamp demo integration` commit only for
closeout/docs/demo-script reconciliation. If source repair is required, return it to the
owning lot and commit it there first; do not hide code in the closeout commit. Audit
cached paths and whitespace immediately before commit. Do not push or publish without
separate authorization.

## Final handoff

Use the required format in [README](README.md#required-handoff), with
`Lot: 10 —
integration and demo closeout`, then include:

- the 01–09 disposition matrix and exact audited commit range;
- identities of every persisted record reopened and each replay outcome;
- all focused and global commands actually run, with pass/fail outcome;
- living pages changed plus exact covered and excluded claims;
- the read-only demo-script location and what it deliberately does not do; and
- any parked optional lane or unresolved state, with its exact next human decision.

Mark closeout `complete` only when lots 01–07 and the global gate are green. Refactor
work may be `parked`; it must never be folded into a completed capability claim.
