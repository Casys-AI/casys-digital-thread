# Explanation: BE project response goal and acceptance boundary

Audience: both · Diátaxis: explanation · Kind: contract

This page records the golden-goal intent and its acceptance boundary: manage a BE
(bureau d'études) project A to Z, from brief / specification / tender to a reviewable
technical and economic response dossier, in measured hours rather than days. It records
intended product behaviour and the evidence needed to assess it. Completion is
established by the recorded project, rather than this goal page.

How to prepare such a packet with only existing paths:
[Prepare a project response](../../how-to/prepare-project-response.md).

## Goal

One linked project goes from an approved brief (including tender clauses) to a response
dossier in which every clause shows: required evidence, the exact response or proof,
manufacturing-first FDM/DFM position, a configuration/versioned BOM, dated sourced
supplier costs, stated assumptions and risks, planning and deliverables, and literal
open gaps. Total handling time is recorded; acceleration is never claimed, only
measured.

## Boundary

- The agent proposes, plans, queues, and executes **registered** operations only. It
  never chooses provider/tool/args, never invents SysML/CAD text for a renderer path,
  never self-approves MRTR, and never invents numbers or units
  ([agent entry](../../../AGENTS.md)).
- Signed human MRTR, qualifications, consequential decisions, publication, and dispatch
  stay distinct acts with their own exact scope.
- No spending and no submission: Buy capture reads ERP into a documentary candidate
  bundle; it creates no RFQ, PO, payment, or approved spend
  ([Buy configuration and dated cost](../../reference/domains/buy/README.md)).
- Reuse existing modular server/MCP paths and owner-repo viewers. The Workbench stays
  `GET` + SSE read-only; its brief, requirements and recorded result viewers retain
  their exact identities.
- Extend missing capability through versioned contracts, existing ports and registered
  operations. Keep source validation, runtime qualification and project evidence
  separately reviewable.

## Acceptance per clause

| Clause                                         | Required evidence                                                                                                                                                                                                                                                         | Exact response / proof                                                                                                                                                               | Does not count                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Approved brief, incl. tender clauses           | Canonical brief via `project_brief_confirm` (signed MRTR), documentary r1 via `baseline.from-approved-brief@1`                                                                                                                                                            | Brief fingerprint + revision cited per clause                                                                                                                                        | Living brief, conversation intent, appointed AO text                                            |
| Source clauses, requirements, current evidence | `buy-configuration/1.0` sources, `project_technical_source_capture` + `project_technical_compilation_preview` (+ `..._detail` full evidence), canonical `design.write-geometry@1` STEP, `@3` proof runs, SysON evaluations                                                | Artifact ids + SHA-256 fingerprints + Thread basis per clause                                                                                                                        | A source trace alone; trace is not proof ([proofs and verdicts](proofs-and-verdicts.md))        |
| Manufacturing first, FDM then DFM              | Documentary `industrialize.observe-printability@1` / `observe-print-estimate@1` cases first; measured `industrialize.seal-dfm-case@1` then `industrialize.run-dfm-checks@1` on the canonical STEP only                                                                    | Named case + run + verdict per part; `measured DFM` vs estimate labelled                                                                                                             | Printability as a DFM verdict; isolated geometry as a DFM target                                |
| Configuration / versioned BOM                  | Source-backed `buy-configuration/1.0` (`configurationRevision`, sourced PartDefinition/occurrence identity, quantity/UOM, `thread-artifact://<project-id>/<artifact-id>` STEP) via `project_resource_capture`                                                             | Configuration digest + revision; gaps (`occurrence-unresolved`, `item-mapping-unresolved`, …) literal                                                                                | Workspace catalogue as proof; ad-hoc authored BOM JSON                                          |
| Dated sourced supplier costs                   | `buy-cost-bundle/1.0` from `buy.capture-configuration-cost@1` (locked `erpnext_buy_capture` through `commerce.read-erpnext-buy-source@1` at `qualified`), sealed by `buy.seal-configuration-cost@1`, shown in the recorded Buy viewer (`anchor` = `provenance.bundleRef`) | Covered subtotal vs `total-complete`; currency, quantity, date, validity, included/excluded dimensions per line                                                                      | Live ERP total, refreshed prices, zero-filled tax/transport, Behave/Make verdicts as cost proof |
| Assumptions, risks, planning, deliverables     | Provisional assumptions with owner and review trigger; required decisions; smallest bounded plan (`project_plan_publish`, then `project_change_append`); deliverable artifact ids                                                                                         | Each assumption labelled per the [question and evidence contract](../../../.agents/skills/guide-industrial-project/references/question-and-evidence-contract.md) class it belongs to | An approved assumption without human approval; a plan that invents an operation id              |
| Open gaps                                      | Literal `unavailable`, `unresolved`, `error`, `provisional`, `documentary`, `unverified`, `demo`, `TRACE GAP`, `UNLINKED`                                                                                                                                                 | Every gap named with its reason and the evidence still needed                                                                                                                        | Dropping a label to look complete                                                               |

Completion depends on the obligation in each clause. An intent, exclusion, question or
provisional assumption is not automatically a solver requirement. A clause requiring
verification needs evidence for its exact criterion and current basis; a commercial
clause needs its sourced financial scope. Filled rows and documentary correspondence
alone do not establish satisfaction. One branch's `pass` never proves another
([three judgement branches](product-direction.md#three-judgement-branches)).

## Real execution vs fixtures

Only runs queued through `project_agent_run_queue` / `project_agent_run_execute` against
registered operations, published as Thread revisions, count as engineering execution.
Fixtures under test files (for example Buy capture fixtures or DFM case fixtures) are
fake by contract and never a live BOM, a purchase, or a verdict. This dossier invents no
AO, numbers, prices, units, CAD/SysML renderer payloads, timings, or successful runs.

## Time measurement

Record, do not claim. For each packet, log: start/end timestamps, human interventions
(each signed MRTR with its wait), provider/runtime waiting time, and reprises
(corrections, reseals, re-runs with their cause). Report the measured total against the
hours-goal without presenting it as a general acceleration result.

## Shortest Buy closure route

1. Qualified exact site metadata: the capture review resolves only when the ERP binding
   is `qualified`; until then preparation stays `unresolved`.
2. Source-backed `buy-configuration/1.0` on the exact Thread basis with the canonical
   STEP and ERP document refs.
3. Read-only `project_buy_configuration_cost_capture_review` → human capture MRTR →
   `buy.capture-configuration-cost@1`.
4. Read-only `project_buy_configuration_cost_seal_review` → human seal MRTR →
   `buy.seal-configuration-cost@1` (reopens CAS, no ERP refresh).
5. Recorded Buy viewer session over the sealed bytes only.

## Open gaps

- Buy qualification state on a fresh atelier is `unresolved` until the exact pinned site
  binding/fingerprint is qualified; no dispatch before that.
- No end-to-end timed packet has been run; the hours-goal has no measured baseline yet.
