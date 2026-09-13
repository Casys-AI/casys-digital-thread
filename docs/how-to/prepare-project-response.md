# How-to: prepare a project response packet

Audience: both · Diátaxis: how-to · Kind: how-to

Prepare a complete BE response packet — approved brief → source clauses, requirements
and current evidence → manufacturing-first FDM/DFM → Buy capture/seal with recorded
viewer → evidence-indexed dossier with literal gaps — using only existing read, review,
and registered-operation paths. This page prepares; it approves, spends, submits,
merges, or publishes nothing.

Goal and acceptance boundary:
[BE project response goal](../explanations/product/be-project-response-goal.md).
Behave-only from-zero script:
[Verify a new design from scratch](verify-design/verify-a-new-design-from-scratch.md).
Buy contract: [Buy configuration and dated cost](../reference/domains/buy/README.md).

## 0. Open the read-only surfaces

```bash
deno task start               # MCP :3020
deno task preview:thread      # cockpit :5173, GET + SSE read-only
```

Connect the agent to `http://127.0.0.1:3020/mcp`. The person never types a provider
tool. The agent never invents an operation id, metric, unit, price, or renderer payload.
`cockpit_focus_set` points the cockpit at the project; there is no `GET /projects/<id>`.
Reads: `project_snapshot`, `console_snapshot`, `console_run_list`, `console_run_detail`.

## 1. Freeze the approved brief

`project_start` (plain-language intent) → `cockpit_focus_set` → one question at a time
(`project_question_propose` / `project_answer_record`, unknown kept explicit) →
`project_brief_propose` → exact human confirmation (`project_brief_confirm`, signed
MRTR). Then `project_plan_publish` (unexecuted non-seed work only),
`baseline.from-approved-brief@1` (documentary Thread r1), and the seed via
`project_change_append` with `architecture.seed-syson-model@2` (blank container r2, not
an architecture).

Every later consequential step repeats the same queueing sequence:
`project_change_append` (work item + required decision together) →
`project_decision_propose` → `project_decision_approve` (human MRTR) →
`project_agent_run_queue` → `project_agent_run_execute`.

## 2. Bind each source clause to requirements and current evidence

- Architecture and requirements: `project_brief_architecture_review` then
  `model.write-architecture@1`; `project_brief_requirements_review` then
  `model.write-requirements@2`. Thresholds are safe integers; brief `MPa` → stored `Pa`
  and `0.2 mm` → `200000 nm` (`fractional-mm-to-nm`) are the only compilation-boundary
  rescales.
- Geometry: `project_resource_capture` → `project_technical_source_capture` (quadruplet
  `projectId`, `workspaceRevision`, `attachmentId`, `attachmentRevision`) →
  `project_technical_compilation_preview` with exactly
  `{ projectId, sourceRefs: [capture.result.reference] }` →
  `project_technical_compilation_preview_detail` (named pages or explicit
  `full-evidence`; full evidence is required for MRTR) → `compile.seal-admission@3` →
  `project_admitted_geometry_export` → `design.write-geometry@1` (canonical STEP).
  `parser.status: passed` is not admission; isolated `design.execute-build123d@1` +
  `design.seal-isolated-geometry@1` is a Thread document, never canonical geometry and
  never a DFM target.
- Proof: `project_fea_proof_case_capture` → `project_fea_proof_seal_review` →
  `verify.seal-proof-case@1` → `project_fea_isolated_run_review` →
  `verify.run-fea-static-proof@3` (isolated microVM; historical `@1`/`@2` are rejected
  identities). Optional sensitivity only through the seal/run/evaluate reviews; only a
  study-base `fail` citing `sensitivity-base-<metric>-<digest>` can authorize
  `design.apply-vector-correction@1`. Human L5 is `project_evaluation_closeout_review` →
  `decide.accept-evaluation-closeout@1` / `decide.reject-evaluation-closeout@1`.
- Navigation: `project_product_explore` / `project_product_search` /
  `project_product_inspect` and `project_source_closure` for exact element and
  attachment lineage; labels never join.

Per clause, record artifact id + SHA-256 + exact Thread basis. A source trace is
linkage, not proof: provider success is never L4/L5, and an L4 `pass` is never L5.
`UNLINKED`, `unresolved`, `unavailable`, and `error` stay literal.

## 3. Manufacturing first: FDM documentary, DFM measured

Documentary FDM first: `industrialize.seal-printability-case@1` then
`industrialize.observe-printability@1` (observations only, no evaluation);
`industrialize.seal-print-estimate-case@1` then `industrialize.observe-print-estimate@1`
(time and material observations, never a cost quote). Then measured DFM:
`industrialize.seal-dfm-case@1` (attested canonical STEP, build-volume object, declared
Z-min filter, sourced limits) then `industrialize.run-dfm-checks@1` on that
`design.write-geometry@1` STEP only. A measured fail is publishable with a named
violation; the Activity card reads `measured DFM`. Inspect results in the recorded DFM
App (`io.casys.mcp-dfm.results`) via `viewer.session.apply` over the exact
capture/case/STEP/run — never a live solver UI, never restored MRTR authority. Do not
copy fixture numbers onto the vehicle.

## 4. Buy: configuration, capture, seal, recorded viewer

Shortest closure route; stop at the first step that is not `ready`.

1. Source-backed configuration via `project_resource_capture`: `buy-configuration/1.0`
   with `configurationRevision`, sourced PartDefinition/occurrence identity,
   quantity/UOM per line, geometry bound to `design.write-geometry@1`
   (`parentOperation`, parent artifact id + fingerprint,
   `thread-artifact://<project-id>/<artifact-id>` STEP URI). Workspace catalogue
   identities are `catalog-declared`, not proof; gaps (`occurrence-unresolved`,
   `item-mapping-unresolved`, `quantity-unresolved`, `uom-unresolved`, …) stay in the
   bytes.
2. `project_buy_configuration_cost_capture_review` (read-only; no ERP) with project,
   exact Thread-snapshot basis, configuration resource URI + digest, parent geometry
   id + fingerprint, ERP documents (`doctype`, `name`, optional `expectedModified`), and
   pricing (`currency`, `asOf`, `requiredDimensions`, `rounding`). It resolves `ready`
   only with a `qualified` ERP binding; until the exact pinned site binding/fingerprint
   is qualified, preparation stays `unresolved` and nothing dispatches.
3. Human capture MRTR on the exact configuration, STEP, document refs, pricing scope,
   and authorized site fingerprint; then `buy.capture-configuration-cost@1` (locked
   `erpnext_buy_capture` through sealed `commerce.read-erpnext-buy-source@1`; DT CAS
   keeps the canonical bytes; the bundle is a documentary candidate, not spend).
4. `project_buy_configuration_cost_seal_review` (reopens the candidate; no ERP refresh)
   → human seal MRTR → `buy.seal-configuration-cost@1` (provider-free Thread seal of
   those CAS bytes).
5. Recorded Buy viewer (`io.casys.mcp-erpnext.buy-evidence`,
   `ui://mcp-erpnext/buy-evidence-viewer`,
   `io.casys.mcp-erpnext.buy-recorded-session/1.0`) whose `anchor` equals
   `provenance.bundleRef` of the sealed DT artefact. Absent admitted package →
   `unavailable`. No live `erpnext_bom_get`, no `latest`, no `app.callServerTool`.

Totals discipline: `complete` forbids unresolved gaps; `partial` keeps `coveredSubtotal`
with named unknown dimensions (tax, transport, …) and empty `excludedLineIds` only when
every selected line is priced. Never fabricate a zero line or a complete total.

## 5. Assemble the evidence-indexed dossier

Index every tender/brief clause to: brief item → requirement id → artifact (id +
fingerprint + Thread basis) → verdict or cost line → literal gap or `complete`. Read the
current photograph under Evidence and the journal under Activity; sealed cases resolve
through the `engineering-cases/1.1` `current` selection per `(family, id)`. A newer
canonical STEP retires prior behave/make/buy evidence of that geometry to `historical`;
re-runs are new reviewed operations and one branch's `pass` never proves another.

## 6. Log time, do not claim it

| Segment                                       | Started | Ended | Notes |
| --------------------------------------------- | ------- | ----- | ----- |
| Brief → freeze (incl. each signed MRTR wait)  |         |       |       |
| Source → proof (incl. runtime waits)          |         |       |       |
| FDM / DFM                                     |         |       |       |
| Buy capture / seal (incl. qualification wait) |         |       |       |
| Reprises (cause + new operation)              |         |       |       |

Report the measured total against the hours-goal; it is one observation, not an
acceleration result.

## What this packet does not prove

- Test fixtures are not evidence: DFM, printability, and Buy captures under test paths
  are fake by contract, not a live BOM, purchase, or verdict.
- No invented AO, numbers, prices, units, CAD/SysML renderer payloads, timings, or
  successful runs appear in the dossier.
- Qualification, publication, dispatch and offer submission require their corresponding
  authorization. A sealed cost bundle remains documentary evidence for its dated scope.
