# How-to: verify prescribed kinematics

Audience: both · Diátaxis: how-to · Kind: how-to

Use this runbook to move one declared immediate rigid-body mechanism through L1 case, L2
authorization, L3 facts, L4 evaluation, and a human L5 closeout. The relevant contracts
are [mechanism](../../reference/domains/mechanism/README.md) and
[Chrono's provider boundary](../../reference/providers/chrono/README.md).

## 0. Authorize the capability and establish Product Structure

Put `{"id":"prescribed-kinematics","version":"1.0"}` in the `verificationAuthority` of
the relevant Brief V2 `verification-activity`. Review and confirm the server-derived
operational capability proposal with the brief. This authorizes a bounded runtime
ceiling; it does not approve a mechanism method or a result. Then call
`project_capability_inspect` with only `projectId` and record the effective envelope and
current host state. Follow
[review project capability authorization](../agents/review-project-capability-authorization.md)
and preserve every literal `unavailable` or `unresolved` state.

Create the SysON container **immediately** after the approved-brief baseline:

```text
baseline.from-approved-brief@1
  → append + propose + human approve + queue + execute architecture.seed-syson-model@2
  → project_brief_architecture_review
  → model.write-architecture@1
```

The seed must execute while that baseline work item is the unique completed
`baseline.from-approved-brief@1` result for the plan. Do not insert another documentary
Thread writer between the baseline and seed. In particular,
`model.seal-architecture-sysml@1` only seals agent-authored SysML as a Thread document:
it does not write SysON and creates no Product Structure. It may come later. Use the
exact append and dependency sequence in
[sequence a SysON seed](../agents/sequence-a-syson-seed.md).

`model.write-architecture@1` must then expose the assembly as either the exact reusable
`PartDefinition` or an occurrence-specific `PartUsage`, with every declared body as that
definition's immediate `PartUsage` children. Do not invent a synthetic assembly
occurrence when the intended context already is that definition. Confirm the exact
identities through `project_product_explore`, `project_product_search`, and
`project_product_inspect`. Stop if that graph is absent or ambiguous; labels are not a
substitute.

Capture the canonical case JSON with `project_resource_capture`, put it in one
ProjectSourceWorkspace file, then attach that same file revision to the assembly context
and every body `PartUsage` with role `mechanism-source@1`. The assembly attachment must
use the same `elementKind` as the source. Every attachment must name the current Thread
and architecture basis. The wider project may contain many files, but the V1 mechanism
case is one closed file with no inferred dependency closure. See
[author a project source workspace](../compile/author-project-source-workspace.md) and
the
[source contract](../../reference/domains/mechanism/prescribed-kinematics-source-contract.md).

## 1. Establish an exact L1 candidate

Start from `project_snapshot`. Record the unique current Thread basis, current approved
Brief, and the one ProjectSourceWorkspace JSON file with its exact active
`mechanism-source@1` attachments.

Call `project_prescribed_kinematics_case_review` with only `projectId`,
`workspaceRevision`, `attachmentId`, and `attachmentRevision`. It is a read-only
recross—not a provider probe. If it returns `unavailable` or `unresolved`, preserve that
state and repair the source/architecture evidence through its normal successor path. Do
not infer bodies or joints from STEP labels or static contact.

When the review is `resolved`, paste `next.append.arguments` into
`project_change_append` and `next.propose.arguments` into `project_decision_propose`.
Both envelopes are complete except `issuedAt`. The server emits them only after
reopening the unique current Thread tip and its lineage, proving the source closure
declares against that same basis, and linking the exact architecture producer work item
as the L1 dependency. The L1 decision carries exactly `workspaceRevision`,
`attachmentId`, and `attachmentRevision`. Do not add a case fingerprint, provider, or
runtime parameter. Finish the normal human approval, queue, and execution flow for
`verify.seal-prescribed-kinematics-case@1`. Reread the resulting Thread successor. That
is L1; it does not authorize L3. Use the exact operation identities in
[mechanism operations](../../reference/domains/mechanism/operations.md).

## 2. Obtain L2 before asking for an observation

Call `project_prescribed_kinematics_run_review` with only `projectId`. Paste its
`next.append.arguments` then `next.propose.arguments`. The only decision parameter is
the domain L1 case SHA-256; do not invent a placeholder, provider, runtime, or workspace
identity. Obtain the exact human L2 MRTR through the normal approval flow. Its sealed
ROP must bind the exact L1 artifact and current Thread basis. Do not recreate its
action, request identity, runtime fields, or recovery policy by hand.
`project_agent_run_plan_get` is read-only if you need to inspect the sealed ROP.

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

At the current L1/L3 basis, call `project_prescribed_kinematics_method_review` with only
`projectId`. Copy `methodSheet.caseFingerprint` and `methodSheet.observationFingerprint`
into the method resource. Those are the domain sealed-case SHA-256 and the SHA-256 of
the canonical normalized `PrescribedKinematicsObservation`. Do not substitute the outer
`evidence.*` artifact or capture fingerprints. Author the criteria yourself; the review
does not invent them or auto-approve.

Capture that reviewed method resource through the normal resource boundary. Call
`project_prescribed_kinematics_method_review` again with `projectId` and the closed
`methodResourceRef`. Its `mode: "review"` rereads accepted UTF-8 bytes, requires
canonical JSON, and recrosses criteria plus both fingerprints before returning the
append/propose envelopes. Paste those envelopes in the normal project/MRTR path for
`verify.seal-prescribed-kinematics-method@1`. The exact schema and L4 semantics are in
[method and evaluation](../../reference/domains/mechanism/prescribed-kinematics-method-and-evaluation.md).

At the successor current basis, call `project_prescribed_kinematics_evaluation_review`
with only `projectId`. It reopens the exact L1/L3/method chain and prepares the existing
`verify.evaluate-prescribed-kinematics@1` flow. Do not provide facts, a provider, a
tolerance, or a requested verdict. The result is literal `pass`, `fail`, or
`unresolved`; it is still not L5.

## 5. Ask the responsible human for L5

At the current L4 basis, call `project_prescribed_kinematics_evaluation_closeout_review`
with only `projectId`. Present only the returned human consequences:

| Choice                                             | Availability                   |
| -------------------------------------------------- | ------------------------------ |
| `decide.accept-prescribed-kinematics-evaluation@1` | Only when L4 is literal `pass` |
| `decide.reject-prescribed-kinematics-evaluation@1` | Always                         |

The person chooses and signs the exact returned MRTR. Queue and execute the resulting
human-origin work item. Neither accept nor reject authorizes a CAD correction, a
provider rerun, or a broader product claim.

## Do not bypass the path

Do not invoke a Chrono MCP tool, endpoint, or bearer directly; retry an L3 provider
call; reuse an old request identity; or treat runtime health, an L3 receipt, or L4
`pass` as human acceptance. Those actions break the evidence chain rather than
completing it.
