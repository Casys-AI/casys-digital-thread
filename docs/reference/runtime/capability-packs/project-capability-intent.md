# Reference: project capability intent

Audience: both · Diátaxis: reference · Kind: contract

`project-capability-intent/1.0` is the server-owned, provider-neutral forecast used
when a brief is still pending. It is not a `project-capability-demand/2.0`: before
`project_plan_publish` there is no work-item history or published plan to pretend exists.
It does not start, install, authorize, or qualify a runtime.

```text
pending Brief verification authorities
  -> ProjectCapabilityIntent
  -> brief-intent capabilityProposal
  -> project_brief_confirm

published plan + registered-operation history
  -> ProjectCapabilityDemand
  -> published-plan capabilityProposal / delta review
```

Only the resulting `capabilityProposalFingerprint` is echoed by
`project_brief_confirm`. `capabilityIntentFingerprint` identifies the server-derived
semantic intent inside that proposal; it is not a caller-selected capability list.

## Source and resolution

The compiler reads only each pending brief's
`verification-activity.verificationAuthority`. Statements, source references, item ids,
ordering, provider names, images, endpoints, tools, arguments, and secrets do not alter
the intent. The server-owned route table then maps that semantic authority to registered
operations and resolves their demands from the complete operation registry, including
closed preparation prerequisites.

| Brief verification authority | Registered operation route |
| --- | --- |
| `static-structural-fea@1.0` | `design.write-geometry@1`, `verify.run-fea-static-proof@3` |
| `static-structural-fea-sensitivity@1.0` | `analyze.run-fea-sensitivity@1` |
| `admitted-modelica-thermal@1.0` | `simulate.run-admitted-modelica@1`, `verify.evaluate-admitted-modelica-observations@1` |
| `admitted-spice-electrical@1.0` | `simulate.run-admitted-spice@1` |
| `prescribed-kinematics@1.0` | `verify.run-prescribed-kinematics@1` |
| `assembly-integrity@1.0` | `architecture.seed-syson-model@2`, `model.write-architecture@1`, `model.capture-part-definitions@1`, `design.write-geometry@1`, `verify.observe-assembly-integrity@1` |

This is an authority-to-operation route, not a second capability catalogue. Runtime
demands, their qualifications, and preparation edges remain owned by the registered
operation registry. A missing route or missing registered operation is literal
`unresolved`; the proposal retains that blocker and cannot be smoothed into an empty
need.

## Relationship to authorization and the later plan

The trusted planner applies the same catalogue, policy, host observation, and admin lock
to the intent requirements, producing a `brief-intent` proposal. Human confirmation
authorizes that exact operational ceiling; it does not approve a method or result.

After publication, the demand compiler derives the exact current planned ceiling and JIT
slice from the registered work-item history. `project_capability_change_review` then
compares that later `published-plan` proposal against the approved envelope. A subset
needs no new prompt and does not shrink the ceiling; a widening or changed
binding/material/effect is a bounded human amendment. Shrinking unused surplus requires
the explicit `withdrawUnused` confirmation on that same tool. See
[project capability demand](project-capability-demand.md) and
[project capability authorization](project-capability-authorization.md).

The code-owned route is
[`brief-capability-intent-routes.ts`](../../../../src/orchestration/operations/brief-capability-intent-routes.ts).
It must never be replaced by project data or an agent-provided route.
