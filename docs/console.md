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
| `project_start`             | Agent mutation           | Create the project immediately from the reported plain-language intent                     |
| `project_snapshot`          | Read                     | Current durable project, decisions, approvals, runs, blockers, exact refs and receipts     |
| `project_question_propose`  | Agent mutation           | Add one adaptive framing question and recommendation inside the project                    |
| `project_answer_record`     | Agent or human mutation  | Record a sourced answer or explicit unknown inside the project                             |
| `project_brief_propose`     | Agent mutation           | Propose an immutable living-brief revision without replacing canonical intent              |
| `project_brief_confirm`     | Human elicitation        | Promote only the exact accepted brief revision to canonical project intent                 |
| `project_plan_publish`      | Agent mutation           | Publish or revise an unexecuted plan from the exact approved canonical brief               |
| `project_change_append`     | Agent mutation           | Append a bounded next change from the exact current thread snapshot; never replace history |
| `project_decision_propose`  | Agent mutation           | Record a concrete typed proposal                                                           |
| `project_decision_approve`  | Human elicitation        | Ask the person in chat to approve the exact proposal; the agent cannot self-approve        |
| `project_decision_reject`   | Human elicitation        | Ask the person in chat to reject the exact proposal                                        |
| `project_agent_run_queue`   | Bounded agent mutation   | Queue one ready, registered work item with server-derived run identity, basis, and summary |
| `project_agent_run_execute` | Bounded server execution | Dispatch that exact queued registered run; no arbitrary execution payload                  |

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
separate Discovery target. `cockpit_focus_snapshot` supplies the current revision;
`cockpit_focus_set` requires it as `expectedRevision` together with a stable `commandId`
and `issuedAt`.

Focus is durable UI-routing state only. It cannot create a project, record an answer,
approve a brief or decision, queue or execute a run, call a provider, or produce
evidence. The cockpit remains GET/SSE-only and has no human selector yet. See
[the native Workbench preview how-to](how-to/preview-native-workbench.md#follow-the-agent-selected-workspace).

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
`project_agent_run_execute` is deliberately different from a generic lifecycle command:
it dispatches one queued, registered, server-owned operation. The source tree implements
the three guarded V3 bootstrap operations for a general idea/spec path:

1. `baseline.from-approved-brief@1` records the exact approved brief and plan as the
   provider-free documentary `ThreadSnapshot` r1.
2. `architecture.seed-syson-model@2` requires that exact r1 and its approved-brief
   lineage, uses fixed server-owned SysON calls to create a blank project container,
   blank SysML document, and root package, reads the root back, normalizes its
   identities into `syson-model-seed-capture/2.0`, and publishes r2.
3. `architecture.author-inspection-drone@2` requires the exact r2 seed, the same exact
   human-approved brief lineage, and an empty root. It can insert one fixed high-level
   architecture, then persists `inspection-drone-architecture-capture/2.0`, attests and
    reads it back before publishing r3.

The separate `coffee-machine-cm01-v3` golden path additionally registers five bounded
operations for its fixed architecture, semantic CAD, nominal Modelica observation,
read-only ERP BOM observation, and isolated DripTray proof. They do not turn the
historical CM-01 r6 record into a fallback. See the
[local CM-01 V3 guide](how-to/run-cm01-v3-golden-local.md) for exact scope, provider
topology, evidence locations, and comparison boundary.

Neither caller can choose a provider, tool, argument, file, SysML text, or result.
Before every non-idempotent SysON write is dispatched, the executor writes a durable
attempt record. An unknown provider outcome fails closed for review; it is never blindly
retried. The r2 result records only an editable container identity, not a system
architecture, requirement, CAD artifact, simulation, measurement, verification result,
or compliance claim.

The r3 implementation is a registered trusted operation, but r3 still makes no CAD,
physics, flight, cost, compliance, or verified-requirement claim. The agent can add it
after r1 through a reviewed, append-only project change bound to the exact current
thread snapshot; its execution basis remains r2. The real `inspection-drone-v3` project
has three agent-recorded recommended answers and proposed brief revision 2, but no human
confirmation; it still awaits exact human review, so this sequence is not yet authorized
there. Drone CAD must wait for a sourced and reviewed geometric definition; CM-01
remains a separate CAD/physics proof case.

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
snapshot, or evidence payload to make that happen. The public V3 baseline executor makes
no provider call; the provider-backed seed and guarded r3 inspection-drone architecture
operation have the closed contracts above. Any other architecture, requirements, CAD,
simulation, measurement, or verification operation still needs its own reviewed executor
and output contract. CM-01's historical r6 remains valuable evidence of a bounded loop;
the new V3 route uses fresh identities and distinct registered executors instead.

## Signed human elicitation

`project_brief_confirm`, `project_decision_approve`, and `project_decision_reject` use
MCP `2026-07-28` multi-round-trip requests. Their first call returns `input_required`
with an `elicitation/create` request. The MCP host asks the person in the current
conversation and retries the original tool call. The mutation is allowed only when the
framework verifies the signed `requestState` and the response is explicitly accepted.
This makes chat the human command surface without giving the agent self-approval
authority.

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
