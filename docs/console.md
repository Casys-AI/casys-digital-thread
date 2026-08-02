# Reference: MCP console

The Console MCP App is a read-only observer for the engineering fleet and indexed
evidence. Its resource is `ui://casys-digital-thread/console`; its operational snapshot
contract is `2.0`. The same MCP server also exposes a separate project-control tool
family for agents. Those tools mutate project revisions, never the Console fleet model
or a provider directly.

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
deno task preview:thread    # http://127.0.0.1:5173/
```

The browser harness relays only the Console's reviewed read operations. The native
preview passively reads persisted state from `GET /api/thread/workbench` and SSE.
Neither path starts CAD, meshing, FEA, Modelica, or a SysON mutation on page load.

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

| Tool                        | Authority                | Meaning                                                                                              |
| --------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `project_snapshot`          | Read                     | Current durable project, decisions, approvals, runs, blockers, exact refs and receipts               |
| `project_plan_publish`      | Agent mutation           | Publish or revise an unexecuted plan from the exact approved discovery                               |
| `project_decision_propose`  | Agent mutation           | Record a concrete typed proposal; human approval remains required                                    |
| `project_agent_run_execute` | Bounded server execution | Materialize only the exact human-queued V2 documentary baseline; no provider arguments or proof data |

Every mutation uses a stable command ID, `expectedRevision`, and `issuedAt`. Retrying an
identical command ID and payload returns its immutable result; changing the request
under the same ID is rejected. There is deliberately no MCP tool for approving,
rejecting, queueing work, or advancing a generic agent-run lifecycle.

## Truth boundary

Desired state comes from the fleet manifest. Observed state comes from the running MCP
endpoints and Docker. Checked-in example evidence is always labelled demo.

The native Workbench BFF keeps page reads and SSE passive. Its narrow same-origin
`POST /api/project/commands` accepts only human propose, approve, reject, and queue
commands with `X-Casys-Operator-Intent: explicit` and an expected project revision. The
actor ID is self-declared and unauthenticated. The browser cannot claim or complete a
run and receives no generic MCP authority.

The proposal and planning commands append validated immutable revisions under
`state/local/engineering-projects/`; they do not execute a workflow or a provider.
`project_agent_run_execute` is deliberately different from a generic lifecycle command:
it dispatches one registered, server-owned V2 operation after a human has queued that
exact run. The currently implemented operation creates only an immutable documentary,
pre-technical starting record from the approved discovery. It invokes no provider and
does not create CAD, SysML, simulation, measurement, verification, or compliance proof.

The tracked r5 CM-01 baseline assembles captured or read-only observed branches from SysON,
build123d, Modelica, and ERPNext through an explicit identity manifest. Its captured
SysON inventory has no mechanical `ConstraintUsage`, so no mechanical verdict or
CalculiX branch exists **in that clean baseline**. Assembly does not claim that
independent thermal or ERP evidence was caused by the CAD branch.

The separately authorized 2026-08-02 reference run added the exact reviewed DripTray
`1 mm` and `20 MPa` constraints to SysON, generated a content-addressed build123d STEP,
verified its CalculiX consumption, normalized the observations, and published two passing
SysON evaluations in r6. Active project revision 10 records that run and its work item as
completed. This later local evidence does not turn the r5 baseline into a mechanical
baseline and does not establish whole-machine, release, or certification proof.

ERPNext remains one provider-native MCP on port `3012`. The backend selects reviewed
read tools and projects their results; the browser receives neither ERP credentials nor
generic tool-call authority.

Provider-facing work belongs inside a registered bounded executor, not in public
lifecycle calls. Such an executor owns the reviewed provider calls, canonical capture,
snapshot persistence and read-back, attachment, validation, and its internal lifecycle
transitions. A caller cannot supply a provider/tool name, raw arguments, result snapshot,
or evidence payload to make that happen. The public V2 baseline executor does not make
provider calls; a future technical operation needs its own reviewed executor and output
contract. CM-01's mechanical r6 remains valuable historical evidence of a bounded loop,
not a public CM-01 execution endpoint.

## Verification

```bash
deno run --allow-read scripts/verify-console-evidence.ts
```

This checks the Console fixture, cross-file values, byte counts and SHA-256 identities
without rewriting evidence.
