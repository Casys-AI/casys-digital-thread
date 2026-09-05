# How-to: review project capability authorization

Audience: agent · Diátaxis: how-to · Kind: how-to

Use this procedure to establish or reassess a project's separate local operational
capability ceiling. It does not select a provider, start a runtime, admit an engineering
method, or establish an engineering result.

The exact contract is
[project capability authorization](../../reference/runtime/capability-packs/project-capability-authorization.md).
The initial briefing route is [project capability intent](../../reference/runtime/capability-packs/project-capability-intent.md).

## 1. Propose the brief and retain the exact review facts

Call `project_brief_propose` only after the framing is sourced and ready for human
review. Alongside the pending brief, preserve these values from the same response:

| Value | Use |
| --- | --- |
| `briefSnapshotId`, `briefRevision`, `inputFingerprint` | Identify the exact pending brief |
| `capabilityProposal` | Show the server-derived operational ceiling and its literal blockers/effects |
| `capabilityProposalFingerprint` | Opaque identity that must be echoed unchanged at confirmation |

The proposal's `brief-intent` is derived only from the brief's
`verification-activity.verificationAuthority` values, the server-owned route table, and
the registered operation demands. Its `capabilityIntentFingerprint` identifies that
semantic forecast; it is not a value to supply on the call. The proposal describes
server-selected bindings and atomic units; it is not a menu. Do not add capabilities,
providers, images, endpoints, tools, arguments, or secret values.

## 2. Obtain the exact human confirmation

Call `project_brief_confirm` with all four exact values, including the complete
`capabilityProposalFingerprint`. The paired MCP host presents the signed human
confirmation. The agent does not confirm it, forge a retry, or substitute a digest from
another brief revision.

A prepared local record before the approved brief receipt is not authorization. If the
same confirmation is retried after interruption, reuse only the exact prepared proposal
that matches the brief review.

## 3. Inspect the effective operational ceiling

Use `project_capability_inspect` with the project id after confirmation. Read its
authorization state, semantic requirements, selected bindings, units/digests, host
effects, and literal blockers.

This read is not proof that material is installed, a group is active, a provider is
healthy, or an engineering method/result has passed. Keep `unavailable`, `revoked`, and
other reported states literal.

## 4. Recheck the exact published-plan demand

After `project_plan_publish`, or after a change that changes the published plan, call
`project_capability_change_review` with the project id. The server recompiles the exact
current planned ceiling; it does not accept an agent-supplied capability list. Omit
`withdrawUnused` unless the person asked to shrink unused operational authority.

| Review state | Next action |
| --- | --- |
| `covered` | The exact plan is a subset of the approved envelope. No new capability prompt is needed and the ceiling is not shrunk. Continue through the normal project/MRTR path. |
| `no-change` (`withdrawUnused: true`) | There is no unused surplus to withdraw. The authorized ceiling is unchanged. |
| `withdrawal-required` (`withdrawUnused: true`) | Read the removal-only delta. Ask the paired MCP host for the human decision, then let its verified signed retry echo the returned `capabilityProposalFingerprint` exactly. This removes unused operational authority only; it does not delete images, data or evidence, and does not approve or reinterpret engineering methods or results. |
| `amendment-required` | Read the structured delta. Ask the paired MCP host for the human decision, then let its verified signed retry echo the returned `capabilityProposalFingerprint` exactly. If this appeared during `withdrawUnused: true`, stop the withdrawal and use this ordinary amendment path instead. |
| `method-transition-required` | Stop this amendment path. Follow the existing method-transition/MRTR boundary; do not silently switch a recorded proof's binding. |
| `not-authorized`, `revoked`, or `unresolved` | Stop. Re-establish the appropriate brief/authorization basis or resolve the reported project state; do not queue around it. |

The subset test uses the full planned ceiling, not only work that happens to be ready for
JIT now. A runtime becoming qualified or cached without changing the approved ceiling is
an operational observation, not by itself an amendment. After a confirmed unused
withdrawal, a later or current plan that again needs a removed capability is
`amendment-required` until that ordinary delta is authorized.

A blocked capability that was already approved may remain literally visible while the
server reviews a wholly resolved delta beside it. Treat that only as retention of the
same exact blocked identity, not as new availability: any new unresolved operation or
changed candidate, adapter/profile, unit manifest, material or effect must still return
`unresolved`.

## 5. Review a delta as a project authorization, not an engineering decision

An amendment review reports changes to requirements, bindings, units, materials, host
effects, and known-or-unknown byte impact. The human accepts or declines that exact
delta; the agent cannot edit it into a different requested runtime. A decline leaves the
existing envelope unchanged.

An authorization amendment is still not an MRTR for method, inputs, or criteria. After a
covered or accepted plan, continue with the normal decision, queue, and registered-run
sequence. Host activation remains server-controlled JIT work.

## Stop rather than smooth over these states

- A missing or stale brief/capability fingerprint: return to the exact current review;
  never guess a replacement.
- A declined or unconfirmed amendment: keep the current envelope and do not treat it as
  covered.
- `unavailable`, `disabled`, `incompatible`, or qualification/platform/security blockers:
  report the literal operational block; authorization is not a workaround.
- A revoked envelope: it cannot cover or be amended in V1.
- Any request to choose runtime details: the server owns that selection.

For why this remains separate from activation and engineering evidence, see
[capability management](../../explanations/runtime/capability-management.md).
