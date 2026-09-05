# Reference: prescribed-kinematics operations

Audience: agent · Diátaxis: reference · Kind: operation and tool inventory

This is the exact provider-neutral control surface for the bounded mechanism vertical.
Agents call only the Digital Thread MCP on `:3020`; Chrono tools, endpoint, image,
bearer and arguments never appear here.

## Brief route and runtime demand

A pending brief requests this family only through a `verification-activity` carrying:

```json
{"verificationAuthority":{"id":"prescribed-kinematics","version":"1.0"}}
```

The server routes that authority to `verify.run-prescribed-kinematics@1`, whose only
semantic runtime demand is `mechanics.observe-prescribed-kinematics@1`. The brief does
not choose the current Chrono binding. Capability authorization, host qualification and
engineering MRTR remain separate authorities.

## Registered operations

| Level | Operation | Runtime | Required predecessor | Execution origin |
| --- | --- | --- | --- | --- |
| L1 | `verify.seal-prescribed-kinematics-case@1` | none | exact current `model.write-architecture@1` producer | agent |
| L2/L3 | `verify.run-prescribed-kinematics@1` | authorized exact binding + exact host qualification + sealed ROP | L1 | agent after exact human L2 MRTR |
| L4 method | `verify.seal-prescribed-kinematics-method@1` | none | L3 | agent |
| L4 evaluation | `verify.evaluate-prescribed-kinematics@1` | none | method | agent |
| L5 accept | `decide.accept-prescribed-kinematics-evaluation@1` | none | L4 literal `pass` | human |
| L5 reject | `decide.reject-prescribed-kinematics-evaluation@1` | none | L4 | human |

Every Thread writer also follows the ordinary project change, decision proposal, human
approval, queue, execute and snapshot-reread path. “L2” specifically names the separate
human authorization of the consequential L3 observation; it is not a fourth stored
result level.

## Read-only review tools

| Tool | Exact caller input | Prepared result |
| --- | --- | --- |
| `project_prescribed_kinematics_case_review` | `projectId`, `workspaceRevision`, `attachmentId`, `attachmentRevision` | Exact same-file source and SysON architecture recross, plus pasteable L1 `next.append` / `next.propose` whose parameters are exactly those three workspace identities |
| `project_prescribed_kinematics_run_review` | `projectId` | Unique current L1 case and pasteable L3 envelopes whose only parameter is that case's domain SHA-256 |
| `project_prescribed_kinematics_method_review` | `projectId`; optional `methodResourceRef` | Domain method-sheet identities from current L1/L3; pasteable method envelopes only when the resource is named |
| `project_prescribed_kinematics_evaluation_review` | `projectId` | Current L1/L3/method chain and pasteable L4 envelopes |
| `project_prescribed_kinematics_evaluation_closeout_review` | `projectId` | Human accept/reject branches and their pasteable envelopes |

The `next` reviews return complete generic command arguments except `issuedAt`. Use them
literally with `project_change_append` and `project_decision_propose`; they are not
approvals or writes. Do not add a provider, runtime, image, tool, endpoint, or extra
fingerprint caller choice.

L1 decision parameters are exactly `workspaceRevision`, `attachmentId`, and
`attachmentRevision`. L3 decision parameters are exactly the domain
`prescribed-kinematics-case/1.0` SHA-256; the executor recrosses that digest against the
ROP-bound case. Do not invent a placeholder because the generic proposal tool requires
one parameter.

Method authoring uses `methodSheet.caseFingerprint` (domain sealed-case SHA-256) and
`methodSheet.observationFingerprint` (SHA-256 of the canonical normalized
`PrescribedKinematicsObservation`). Outer Thread artifact or capture fingerprints on
`evidence.*` are not substitutes. Call the method review with `projectId` first, author
criteria against those identities, capture the resource, then call it again with
`methodResourceRef`. See
[method and evaluation](prescribed-kinematics-method-and-evaluation.md).

Where a closed envelope exists, the generic sequence is:

```text
project_change_append → project_decision_propose → project_decision_approve
  → project_agent_run_queue → project_agent_run_plan_get → project_agent_run_execute
  → project_snapshot
```

`project_agent_run_plan_get` is especially important before L3: it exposes the sealed
ROP for inspection without granting provider choice. See the
[verification runbook](../../../how-to/verify-design/verify-prescribed-kinematics.md).
