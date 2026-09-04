# Reference: MCP console

Audience: both · Diátaxis: reference · Kind: contract

The Console MCP server (`:3020/mcp`) is the agent and ops control plane. It is not a
human dashboard. The former MCP App at `ui://casys-digital-thread/console` (Fleet / Runs
/ Workbench, `preview:browser` on `:3021`) is retired. Product inspection is the native
cockpit (`preview:thread` / `preview:cockpit`). The operational snapshot contract
remains `2.0` on the `console_*` tools. The same MCP server exposes the
conversation-owned project-control tools used by the agent. Those tools mutate project
revisions or dispatch registered operations; the cockpit itself remains a passive
projection.

## Surfaces

The human Fleet / Runs / Workbench page is retired. Fleet health is a tool read, not a
sixth cockpit tab:

- `console_snapshot` compares [`config/mcp-fleet.json`](../../../config/mcp-fleet.json)
  with live MCP discovery and read-only Docker observations (`healthy` / `degraded` /
  `unavailable`, image and tool drift).
- `console_run_list` / `console_run_detail` keep execution, evidence, and
  requirement-verdict states separate for the indexed control-plane catalog. Project
  Activity / Evidence / Execution already cover project-bound runs.

## Endpoints

```bash
deno task start                        # http://127.0.0.1:3020/mcp
deno task preview:cockpit              # 5175, BFF serves hashed JS/CSS
deno task preview:thread               # 5173 Vite HMR → BFF 5175
```

`deno task preview:browser` refuses: the `:3021` harness is not a product page. The
canonical cockpit keeps one **Project** tab from the first living brief through the
technical record. Its direct previews passively read persisted state through GET and
SSE. Neither path starts CAD, meshing, FEA, Modelica, or a SysON mutation on page load.

## Tools

| Tool                    | Audience          | Meaning                                                          |
| ----------------------- | ----------------- | ---------------------------------------------------------------- |
| `console_snapshot`      | Any MCP client    | Fleet observations and run summaries                             |
| `console_server_detail` | Any MCP client    | Desired state, observation, drift, image and trust information   |
| `console_run_list`      | Any MCP client    | Indexed engineering-run summaries                                |
| `console_run_detail`    | Any MCP client    | Evidence, observations, comparisons and provenance               |
| `console_refresh`       | App-only leftover | Explicitly refresh the read-only probes; no shipped App calls it |

`console_snapshot` no longer carries dashboard-panel declarations. Product state lives
in the canonical [`ThreadSnapshot`](../contracts/thread-snapshot.md) and its native Workbench
projection.

### Engineering project tools

| Tool                                    | Authority                | Meaning                                                                                    |
| --------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `project_start`                         | Agent mutation           | Create the project immediately from the reported plain-language intent                     |
| `project_snapshot`                      | Read                     | Current durable project, decisions, approvals, runs, blockers, exact refs and receipts     |
| `project_question_propose`              | Agent mutation           | Add one adaptive framing question and recommendation inside the project                    |
| `project_answer_record`                 | Agent or human mutation  | Record a sourced answer or explicit unknown inside the project                             |
| `project_brief_propose`                 | Agent mutation           | Propose an immutable living-brief revision without replacing canonical intent              |
| `project_brief_confirm`                 | Human elicitation        | Promote only the exact accepted brief revision to canonical project intent                 |
| `project_plan_publish`                  | Agent mutation           | Publish or revise an unexecuted plan from the exact approved canonical brief               |
| `project_change_append`                 | Agent mutation           | Append a bounded next change from the exact current thread snapshot; never replace history |
| `project_decision_propose`              | Agent mutation           | Record a concrete typed proposal                                                           |
| `project_decision_approve`              | Human elicitation        | Ask the person in chat to approve the exact proposal; the agent cannot self-approve        |
| `project_decision_reject`               | Human elicitation        | Ask the person in chat to reject the exact proposal                                        |
| `project_agent_run_queue`               | Bounded agent mutation   | Queue one ready, registered work item with server-derived run identity, basis, and summary |
| `project_agent_run_plan_get`            | Read                     | Reopen the sealed `resolved-operation-plan/2.0` on one run; never executes                 |
| `project_agent_run_cancel`              | Human elicitation        | Cancel one exact unclaimed queued run after signed paired-chat confirmation                |
| `project_work_item_abandon`             | Human elicitation        | Abandon eligible work items and pending decisions; no run, provider, or Thread snapshot    |
| `project_agent_run_execute`             | Bounded server execution | Dispatch that exact queued registered run; no arbitrary execution payload                  |

Closing a leftover ready work item behind a completed successor is operator recovery,
not a Console tool: `deno task recover:work-item-successor`. Default is inspect.

### Architecture SysML and technical-compilation tools

These tools write draft CAS or return review parameters. They do not queue a run and do
not grant MRTR or provider authority. Full grants:
[agent workspace](../agent/agent-workspace.md#4-surfaces-an-agent-actually-calls).

| Tool                                        | Authority      | Meaning                                                                                                                    |
| ------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `project_architecture_sysml_source_capture` | Draft CAS      | Exact agent-authored closed-subset SysML + analysis. Not `sysml-source-capture/1.0`                                        |
| `project_architecture_sysml_preview`        | Diagnostic     | Tokenize/parse/analyse. `decisionParameters` only from a reopened passed capture                                           |
| `project_led_driver_source_capture`         | Draft CAS      | Exact `led-driver-human-source/1.0` UTF-8. Pass `result.reference` only. Review stays reference-only                       |
| `project_led_driver_source_review`          | Read           | Reopen one opaque `led-driver-source-capture/1.0` locator. Unknowns stay `unresolved`. Grants none                          |
| `project_technical_source_capture`          | Draft CAS      | Review: parser vs levers vs opaque reference. Pass `result.reference` only                                                 |
| `project_technical_compilation_preview`     | Review draft   | `{ projectId, sourceRefs: [capture.result.reference] }`; all locators share one workspace basis. Server tip, profile, unique SysML join                                                   |
| `project_admitted_geometry_export`          | Geometry draft | Export one sealed Build123d admission through the sandbox. Not isolated execution                                          |
| `project_build123d_execution_review`        | Read           | MRTR parameters plus registered `design.execute-build123d@1` operation. Reuse `operation` verbatim                          |
| `project_isolated_geometry_seal_review`     | Read           | MRTR parameters for `design.seal-isolated-geometry@1`. No STEP bytes                                                       |
| `project_modelica_qualified_kit_run_review` | Read           | MRTR parameters for the one local Modelica kit                                                                             |
| `project_admitted_modelica_run_review`      | Read           | MRTR parameters plus registered `simulate.run-admitted-modelica@1` operation. Reuse `operation` verbatim                    |
| `project_admitted_spice_run_review`         | Read           | MRTR parameters plus registered `simulate.run-admitted-spice@1` operation. Reuse `operation` verbatim                       |
| `project_electrical_observation_method_sheet_seal_review` | Read           | With `projectId`, exact current L3 observations/basis for authoring; with the captured sheet fingerprint, MRTR parameters for `verify.seal-electrical-observation-method-sheet@1`. No provider choice, threshold invention or ngspice call |
| `project_admitted_spice_evaluation_review`  | Read           | MRTR parameters for `verify.evaluate-admitted-spice-observations@1`. No L4 verdict |
| `project_admitted_spice_evaluation_closeout_review` | Read    | MRTR parameters for accepted/rejected SPICE L5. L4 pass is never implicit L5 |
| `project_fea_proof_case_capture`            | Draft CAS      | Exact `mechanical-proof-case-source/1.0` JSON. Pass `result.reference` only                                                |
| `project_fea_proof_seal_review`             | Read           | Opaque source fingerprint → `fea.proof.*` plus paste-ready `next.append` / `next.propose` for the seal                     |
| `project_fea_isolated_run_review`           | Read           | Isolated `@3` bindings plus paste-ready hops; geometry is STEP, never cad-model                                            |
| `project_sensitivity_study_seal_review`     | Read           | `sensitivity.case.*` plus paste-ready hops; `cadSource` is an admission, never STEP. `desk-lamp-dl06` is `catalog-absent`. |
| `project_geometry_preview`                  | None           | Not registered. Canonical drafts come from `project_admitted_geometry_export`                                              |

Every mutation uses a stable command ID, `expectedRevision`, and `issuedAt`. Retrying an
identical command ID and payload returns its immutable result; changing the request
under the same ID is rejected. There is no generic run-lifecycle or arbitrary
provider-execution tool.

### Cockpit focus tools

| Tool                     | Authority      | Meaning                                                                                  |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------- |
| `cockpit_focus_snapshot` | Read           | Read the durable agent-selected target for one read-only cockpit workspace               |
| `cockpit_focus_set`      | Agent mutation | Point a workspace at one already durable engineering project; never changes that project |

The paired agent, not the browser, chooses what the single cockpit shell follows. The
normal sequence is: create or resume one project, set the workspace focus to it, guide
its living brief in conversation, and obtain the person's exact brief confirmation
through MRTR. The focus never changes during this transition because there is no
separate Discovery target. `cockpit_focus_set` requires a stable `commandId` and
`issuedAt`. `expectedRevision` may be omitted (the server uses the current cockpit focus
revision). Pass `0` only when `cockpit_focus_snapshot` reports no focus; an explicit
stale integer is still rejected.

Focus is durable UI-routing state only. It cannot create a project, record an answer,
approve a brief or decision, queue or execute a run, call a provider, or produce
evidence. The cockpit remains GET/SSE-only and has no human selector yet. See
[the native Workbench preview how-to](../../how-to/workbench/preview-native-workbench.md#follow-the-agent-selected-workspace).

## Truth boundary

Desired state comes from the fleet manifest. Observed state comes from the running MCP
endpoints and Docker. Checked-in example evidence is always labelled demo.

The native Workbench BFF keeps page reads and SSE passive. The browser receives no MCP
endpoint, provider credential, project mutation, or execution authority. Human intent
and consequential decisions enter through the paired MCP conversation; the cockpit only
shows the resulting immutable state, activity, lineage, and results.

The framing, initial-planning, and change-append commands append validated immutable
revisions under `state/local/engineering-projects/`; they do not execute a workflow or a
provider. `project_plan_publish` is only for an unexecuted project with an exact
human-approved canonical brief. `project_change_append` is the agent-only continuation
after that baseline: it binds new phases, work, and required decisions to the exact
current `ThreadSnapshot` through `baseSnapshot`; a V3 change also retains the exact
`approvedBriefBasis` that authorized it. It can only add new IDs and cannot edit prior
phases, work, decisions, runs, or evidence. These anchors belong to the change command,
not to a later run; each queued run still receives its server-derived exact `basis`.
`project_agent_run_queue` derives the run ID, summary, basis, and operation from durable
project state; the caller cannot submit those execution details.
`project_agent_run_cancel` is not a generic lifecycle mutation: it accepts only an exact
still-queued run, asks the paired host for a signed human confirmation, and cannot run
after claim. Its cancellation receipt seals the run ID, work-item ID, and original queue
receipt; the derived work-item state can then become ready again for a new queue. Older
queue receipts remain readable without the newer server-stamped binding.
`project_agent_run_execute` is deliberately different from a generic lifecycle command:
it dispatches one queued, registered, server-owned operation. The generic V3 route has
two bounded bootstrap operations:

1. `baseline.from-approved-brief@1` records the exact approved brief and plan as the
   provider-free documentary `ThreadSnapshot` r1.
2. `architecture.seed-syson-model@2` requires that exact r1 and its approved-brief
   lineage, uses fixed server-owned SysON calls to create a blank project container,
   blank SysML document, and root package, reads the root back, normalizes its
   identities into `syson-model-seed-capture/2.0`, and publishes r2.

Neither caller can choose a provider, tool, argument, file, SysML text, or result.
Before every non-idempotent SysON write is dispatched, the executor writes a durable
attempt record. An unknown provider outcome fails closed for review; it is never blindly
retried. The r2 result records only an editable container identity, not a system
architecture, requirement, CAD artifact, simulation, measurement, verification result,
or compliance claim.

The first reviewed continuation beyond r2 was the now-retired
`architecture.author-inspection-drone@3`, bound to `inspection-drone-v4`. It published
r3 from its r1 documentary baseline and r2 SysON seed: a qualitative architecture with
five typed usages and four
requirements whose unresolved points remain explicit. It establishes neither CAD,
physical analysis, cost, compliance, certification, nor a requirement verdict. Other
architecture, CAD, physics, cost, compliance, or verified-requirement capabilities still
need their own reviewed executor and output contract.

Its separate retired read-only product-structure successor,
`model.capture-inspection-drone-part-definitions@1`, completed
`run:queue-drone-v4-product-structure-20260808`. Project revision 23 now exposes r4,
`project:inspection-drone-v4:r4:capture-inspection-drone-v4-part-definitions-7aa8c92216c3d07bde4a0b3890a9e722446abda5c4062bb5216f0d0da20651bd`,
from capture SHA-256 `7aa8c92216c3d07bde4a0b3890a9e722446abda5c4062bb5216f0d0da20651bd`.
The Workbench is aligned to this revision and its product catalog displays
`InspectionDrone` plus five child `PartDefinition` elements: `Airframe`, `EnergySystem`,
`PropulsionSystem`, `AvionicsAndFlightControl`, and `InspectionCameraPayload`.
`InspectionDrone` has five direct `PartUsage` elements, each typed by one child
definition and with provider-attested quantity `1`. It is a recorded SysON product
structure only: it establishes no CAD, physical analysis, cost, manufacturing,
certification, compliance, or verdict.

ERPNext remains one provider-native MCP on port `3012`. The backend selects reviewed
read tools and projects their results; the browser receives neither ERP credentials nor
generic tool-call authority.

Provider-facing work belongs inside a registered bounded executor, not in public
lifecycle calls. Such an executor owns the bounded provider calls, canonical capture,
snapshot persistence and read-back, attachment, validation, and its internal lifecycle
transitions. A caller cannot supply a provider/tool name, raw arguments, result
snapshot, or evidence payload to make that happen. The public V3 baseline executor makes
no provider call; the provider-backed seed has the closed contract above. Any other
architecture, requirements, CAD, simulation, measurement, or verification operation
still needs its own reviewed executor and output contract.

## Signed human elicitation

`project_brief_confirm`, `project_decision_approve`, `project_decision_reject`,
`project_agent_run_cancel`, and `project_work_item_abandon` use MCP `2026-07-28`
multi-round-trip requests in the default interactive mode. Their first
call returns `input_required` with an `elicitation/create` request. The MCP host asks
the person in the current conversation and retries the original tool call. The mutation
is allowed only when the framework verifies the signed `requestState` and the response
is explicitly accepted. The explicit loopback-only `--yolo` startup opt-in replaces the
positive confirmation round trip with the persisted `local-yolo` human origin for the
documented gates; it never fabricates a signed response and never auto-rejects.

Set `MCP_MRTR_SIGNING_KEY` to a stable, high-entropy server secret outside source
control. If it is absent, the loopback server creates an ephemeral key for that process;
pending elicitations become invalid on restart. Replay consumption is currently
process-local, so this is a single-instance contract. Multi-instance or restart-safe
operation requires a shared, durable replay store with atomic consume semantics in
addition to a shared signing key.

## Verification

```bash
deno task verify:evidence
```

This checks the Console fixture, cross-file values, byte counts and SHA-256 identities
without rewriting evidence.

The repository quality workflow runs on pull requests and pushes to `main`: UI
dependency installation, `deno task fmt`, `deno task lint`, backend and UI type checks,
tests, evidence verification, and native Workbench presentation verification.
