# How-to: verify prescribed kinematics

Audience: both · Diátaxis: how-to · Kind: how-to

Use this runbook to move one declared immediate rigid-body mechanism through L1 case,
L2 authorization, L3 facts, L4 evaluation, and a human L5 closeout. The relevant
contracts are [mechanism](../../reference/domains/mechanism/README.md) and
[Chrono's provider boundary](../../reference/providers/chrono/README.md).

## 1. Establish an exact L1 candidate

Start from `project_snapshot`. Record the unique current Thread basis, current approved
Brief, and the one ProjectSourceWorkspace JSON file with its exact active
`mechanism-source@1` attachments.

Call `project_prescribed_kinematics_case_review` with only `projectId`,
`workspaceRevision`, `attachmentId`, and `attachmentRevision`. It is a read-only
recross—not a provider probe. If it returns `unavailable` or `unresolved`, preserve that
state and repair the source/architecture evidence through its normal successor path.
Do not infer bodies or joints from STEP labels or static contact.

When the review is `resolved`, use the server-provided material only through the normal
project change, decision, human approval, queue, and execution flow for
`verify.seal-prescribed-kinematics-case@1`. Reread the resulting Thread successor. That
is L1; it does not authorize L3.

## 2. Obtain L2 before asking for an observation

For `verify.run-prescribed-kinematics@1`, use the registered project flow to obtain an
exact human MRTR. Its sealed ROP must bind the exact L1 artifact and current Thread
basis. Do not recreate its action, request identity, runtime fields, or recovery policy
by hand. `project_agent_run_plan_get` is read-only if you need to inspect the sealed ROP.

Before execution, the server must be able to prove:

- the project authorizes the provider-neutral prescribed-kinematics capability;
- the host has the exact runtime evidence required by the sealed plan;
- the Thread basis is still the unique writable head; and
- the JIT capability session can acquire its exact lease.

The repository catalogue's `unqualified` baseline does not rule out a host-local exact
emulated AMD64 attestation, but neither state replaces the other L2/L3 preconditions. If
the server reports `unavailable`, stop there; do not select a provider or call Chrono.

## 3. Execute L3 once, then reread

Queue and execute only the registered L3 work item. The server owns lowering, runtime,
request identity, case submission, dispatch, same-request receipt readback, and capture.
After completion, reread `project_snapshot` and record the new current Thread basis and
the L3 observation artifact.

An L3 record is factual motion evidence only. It is not an L4 result or a conclusion
about collision, clearance, contact, forces, strength, safety, manufacturability, or
product fitness.

If L3 returns an unknown-outcome failure, do not retry it. Follow
[recover a prescribed-kinematics observation](../run/recover-prescribed-kinematics-observation.md).

## 4. Seal a method and evaluate L4

Capture the reviewed method resource through the normal resource boundary. At the current
L1/L3 basis, call `project_prescribed_kinematics_method_review` with only `projectId` and
the closed method resource reference. Use its returned append/propose envelopes in the
normal project/MRTR path for `verify.seal-prescribed-kinematics-method@1`.

At the successor current basis, call
`project_prescribed_kinematics_evaluation_review` with only `projectId`. It reopens the
exact L1/L3/method chain and prepares the existing
`verify.evaluate-prescribed-kinematics@1` flow. Do not provide facts, a provider, a
tolerance, or a requested verdict. The result is literal `pass`, `fail`, or
`unresolved`; it is still not L5.

## 5. Ask the responsible human for L5

At the current L4 basis, call
`project_prescribed_kinematics_evaluation_closeout_review` with only `projectId`.
Present only the returned human consequences:

| Choice | Availability |
| --- | --- |
| `decide.accept-prescribed-kinematics-evaluation@1` | Only when L4 is literal `pass` |
| `decide.reject-prescribed-kinematics-evaluation@1` | Always |

The person chooses and signs the exact returned MRTR. Queue and execute the resulting
human-origin work item. Neither accept nor reject authorizes a CAD correction, a provider
rerun, or a broader product claim.

## Do not bypass the path

Do not invoke a Chrono MCP tool, endpoint, or bearer directly; retry an L3 provider call;
reuse an old request identity; or treat runtime health, an L3 receipt, or L4 `pass` as
human acceptance. Those actions break the evidence chain rather than completing it.
