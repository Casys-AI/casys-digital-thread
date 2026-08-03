# Reference: MCP console

The Console MCP App is a read-only observer for the engineering fleet and indexed
evidence. Its resource is `ui://casys-digital-thread/console`; its operational snapshot
contract is `2.0`. The same MCP server exposes the conversation-owned project-control
tools used by the agent. Those tools mutate project revisions or dispatch registered
operations; the cockpit itself remains a passive projection.

## Surfaces

- **Fleet** compares [`config/mcp-fleet.json`](../config/mcp-fleet.json) with live MCP
  discovery and read-only Docker observations.
- **Runs** keeps execution, evidence, and requirement-verdict states separate.
- **Workbench** renders the native linked-thread projection. It does not mount provider
  Apps or call provider MCPs from the browser.

## Endpoints

```bash
deno task start             # http://127.0.0.1:3020/mcp
deno task preview:browser   # http://127.0.0.1:3021/
deno task thread:assemble
deno task preview:cockpit --port=5175  # canonical product shell
deno task preview:thread               # 5173, direct development preview
deno task preview:discovery            # 5174, direct development preview
```

The browser harness relays only the Console's reviewed read operations. The canonical
cockpit keeps one **Project** tab from the first living brief through the technical
record. Its direct previews passively read persisted state through GET and SSE. Neither
path starts CAD, meshing, FEA, Modelica, or a SysON mutation on page load.

## Tools

| Tool                    | Audience       | Meaning                                                        |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| `console_snapshot`      | Any MCP client | Fleet observations and run summaries                           |
| `console_server_detail` | Any MCP client | Desired state, observation, drift, image and trust information |
| `console_run_list`      | Any MCP client | Indexed engineering-run summaries                              |
| `console_run_detail`    | Any MCP client | Evidence, observations, comparisons and provenance             |
| `console_refresh`       | MCP App only   | Explicitly refresh the read-only probes                        |

`console_snapshot` no longer carries dashboard-panel declarations. Product state lives
in the canonical [`ThreadSnapshot`](reference/thread-snapshot.md) and its native
Workbench projection.

### Engineering project tools

| Tool                        | Authority                | Meaning                                                                                    |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `project_snapshot`          | Read                     | Current durable project, decisions, approvals, runs, blockers, exact refs and receipts     |
| `project_plan_publish`      | Agent mutation           | Publish or revise an unexecuted plan from the exact approved discovery                     |
| `project_change_append`     | Agent mutation           | Append a bounded next change from the exact current thread snapshot; never replace history |
| `project_decision_propose`  | Agent mutation           | Record a concrete typed proposal                                                           |
| `project_decision_approve`  | Human elicitation        | Ask the person in chat to approve the exact proposal; the agent cannot self-approve        |
| `project_decision_reject`   | Human elicitation        | Ask the person in chat to reject the exact proposal                                        |
| `project_agent_run_queue`   | Bounded agent mutation   | Queue one ready, registered work item with server-derived run identity, basis, and summary |
| `project_agent_run_execute` | Bounded server execution | Dispatch that exact queued registered V2 run; no arbitrary execution payload               |

Every mutation uses a stable command ID, `expectedRevision`, and `issuedAt`. Retrying an
identical command ID and payload returns its immutable result; changing the request
under the same ID is rejected. There is no generic run-lifecycle or arbitrary
provider-execution tool.

### Project discovery tools

| Tool                                 | Authority         | Meaning                                                                               |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------- |
| `project_discovery_snapshot`         | Read              | Current immutable intent, questions, answers, brief, review, and receipts             |
| `project_discovery_start`            | Agent mutation    | Start a discovery from reported plain-language intent                                 |
| `project_discovery_question_propose` | Agent mutation    | Persist one bounded question and recommendation                                       |
| `project_discovery_answer_record`    | Agent mutation    | Persist the person's sourced answer, including an explicit unknown                    |
| `project_discovery_brief_propose`    | Agent mutation    | Publish or replace the reviewable brief                                               |
| `project_discovery_brief_confirm`    | Human elicitation | Confirm the exact pending brief through signed MRTR in the paired conversation        |
| `project_discovery_project_create`   | Bounded handoff   | Create only the empty project shell from the exact human-confirmed discovery revision |

### Cockpit focus tools

| Tool                     | Authority      | Meaning                                                                                              |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------------------- |
| `cockpit_focus_snapshot` | Read           | Read the durable agent-selected target for one read-only cockpit workspace                           |
| `cockpit_focus_set`      | Agent mutation | Point a workspace at one already durable discovery or engineering project; never changes that target |

The paired agent, not the browser, chooses what the single cockpit shell follows. The
normal sequence is: start or resume a discovery with `project_discovery_*`, set the
workspace focus to that discovery, obtain the person's brief confirmation through MRTR,
create the empty project shell, then set the same workspace focus to that project.
`cockpit_focus_snapshot` supplies the current revision; `cockpit_focus_set` requires it
as `expectedRevision` together with a stable `commandId` and `issuedAt`.

Focus is durable UI-routing state only. It cannot create a discovery or project, record
an answer, approve a brief or decision, queue or execute a run, call a provider, or
produce evidence. The cockpit remains GET/SSE-only and has no human selector yet. See
[the native Workbench preview how-to](how-to/preview-native-workbench.md#follow-the-agent-selected-workspace).

## Truth boundary

Desired state comes from the fleet manifest. Observed state comes from the running MCP
endpoints and Docker. Checked-in example evidence is always labelled demo.

The native Workbench BFF keeps page reads and SSE passive. The browser receives no MCP
endpoint, provider credential, project mutation, or execution authority. Human intent
and consequential decisions enter through the paired MCP conversation; the cockpit only
shows the resulting immutable state, activity, lineage, and results.

The proposal, initial-planning, and change-append commands append validated immutable
revisions under `state/local/engineering-projects/`; they do not execute a workflow or a
provider. `project_plan_publish` is only for an unexecuted discovery handoff.
`project_change_append` is the agent-only continuation after that baseline: it binds new
phases, work, and required decisions to the exact current `ThreadSnapshot` through
`baseSnapshot`, and can only add new IDs. It cannot edit prior phases, work, decisions,
runs, or evidence. The `baseSnapshot` belongs to the change command, not to a V2 run;
each queued V2 run still receives its server-derived exact `basis`.
`project_agent_run_queue` derives the run ID, summary, basis, and operation from durable
project state; the caller cannot submit those execution details.
`project_agent_run_execute` is deliberately different from a generic lifecycle command:
it dispatches one queued, registered, server-owned V2 operation. The source tree
implements three guarded operations for the idea/spec path:

1. `baseline.from-approved-discovery@1` records the exact approved discovery and plan as
   the provider-free documentary `ThreadSnapshot` r1.
2. `architecture.seed-syson-model@1` requires that exact r1, uses fixed server-owned
   SysON calls to create a blank project container, blank SysML document, and root
   package, reads the root back, normalizes its identities, and publishes r2.
3. `architecture.author-inspection-drone@1` requires the exact r2 seed and the same
   approved discovery's explicit `primary-mission = inspection-controlled` and
   `payload-class = light-inspection-camera` answers. It can insert one fixed,
   high-level architecture only into an empty root, then attests and reads it back
   before it could publish r3.

Neither caller can choose a provider, tool, argument, file, SysML text, or result.
Before every non-idempotent SysON write is dispatched, the executor writes a durable
attempt record. An unknown provider outcome fails closed for review; it is never blindly
retried. The r2 result records only an editable container identity, not a system
architecture, requirement, CAD artifact, simulation, measurement, verification result,
or compliance claim.

The r3 implementation is source-only and has not been released into the running SysON
toolchain. Its separately authorized disposable local parser/translator and model-tree
check passed against loopback `mcp-syson 0.5.2` on 2026-08-03; it was not an r3 project
execution or engineering evidence. r3 makes no CAD, physics, flight, cost, compliance,
or verified-requirement claim. The agent can add it after r1 through a reviewed,
append-only project change bound to the exact current thread snapshot; its execution
basis remains r2.

The tracked r5 CM-01 baseline assembles captured or read-only observed branches from
SysON, build123d, Modelica, and ERPNext through an explicit identity manifest. Its
captured SysON inventory has no mechanical `ConstraintUsage`, so no mechanical verdict
or CalculiX branch exists **in that clean baseline**. Assembly does not claim that
independent thermal or ERP evidence was caused by the CAD branch.

The separately authorized 2026-08-02 reference run added the exact reviewed DripTray
`1 mm` and `20 MPa` constraints to SysON, generated a content-addressed build123d STEP,
verified its CalculiX consumption, normalized the observations, and published two
passing SysON evaluations in r6. Active project revision 10 records that run and its
work item as completed. This later local evidence does not turn the r5 baseline into a
mechanical baseline and does not establish whole-machine, release, or certification
proof.

ERPNext remains one provider-native MCP on port `3012`. The backend selects reviewed
read tools and projects their results; the browser receives neither ERP credentials nor
generic tool-call authority.

Provider-facing work belongs inside a registered bounded executor, not in public
lifecycle calls. Such an executor owns the bounded provider calls, canonical capture,
snapshot persistence and read-back, attachment, validation, and its internal lifecycle
transitions. A caller cannot supply a provider/tool name, raw arguments, result
snapshot, or evidence payload to make that happen. The public V2 baseline executor makes
no provider call; the provider-backed seed and the source-only r3 inspection-drone
architecture operation have the closed contracts above. Any other architecture,
requirements, CAD, simulation, measurement, or verification operation still needs its
own reviewed executor and output contract. CM-01's mechanical r6 remains valuable
historical evidence of a bounded loop, not a public CM-01 execution endpoint.

## Signed human elicitation

`project_discovery_brief_confirm`, `project_decision_approve`, and
`project_decision_reject` use MCP `2026-07-28` multi-round-trip requests. Their first
call returns `input_required` with an `elicitation/create` request. The MCP host asks
the person in the current conversation and retries the original tool call. The mutation
is allowed only when the framework verifies the signed `requestState` and the response
is explicitly accepted. This makes chat the human command surface without giving the
agent self-approval authority.

Set `MCP_MRTR_SIGNING_KEY` to a stable, high-entropy server secret outside source
control. If it is absent, the loopback server creates an ephemeral key for that process;
pending elicitations become invalid on restart. Replay consumption is currently
process-local, so this is a single-instance contract. Multi-instance or restart-safe
operation requires a shared, durable replay store with atomic consume semantics in
addition to a shared signing key.

## Verification

```bash
deno run --allow-read scripts/verify-console-evidence.ts
```

This checks the Console fixture, cross-file values, byte counts and SHA-256 identities
without rewriting evidence.
