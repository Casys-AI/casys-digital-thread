# Historical decision: Project Chrono as the prescribed-kinematics provider

Audience: agent · Diátaxis: none · Kind: RFC

Status: `implemented` · historical decision; the living boundary is the
[prescribed-kinematics reference](../../reference/domains/mechanism/prescribed-kinematics.md)

This page records the decision that opened the bounded V1 vertical. It is not a current
work brief and must not be used to alter the registered operation, binding, runtime, or
evidence contract.

## Historical decision

For V1 prescribed rigid-body kinematics, Project Chrono is the selected provider behind
the provider-neutral `mechanics.observe-prescribed-kinematics@1` capability. The provider
implementation remains in the separate `mcp-chrono` repository and published image;
Digital Thread consumes it through a fixed server-owned adapter.

There would be one provider MCP, not one MCP per gate. The Brief would name only a
versioned semantic verification authority. The server would continue to own provider,
tool, lowering, runtime, arguments, recovery, and evidence publication.

Implemented authority shape:

```text
Brief opt-in
  → registered provider-neutral operation
  → exact sealed kinematic case
  → server-selected profile and adapter
  → mcp-chrono
  → factual L3 capture
  → provider-free L4 evaluation
  → human L5 closeout
```

## Current runtime boundary

The server now has the exact `casys.mcp-chrono@0.3.1` material and
`casys-chrono@1.0.0` launch group. It is Linux/amd64, loopback-only on 3025, retains its
named volume, and has a closed host-only bearer slot. The brief names only semantic
kinematics intent; the server selects the binding, image, endpoint, tool and arguments.
The adapter/runtime remains `unqualified` and `unavailable` pending a live AMD64
emulation probe. This page cannot be used to promote it early.

Static assembly integrity remains separate. Its common profile-free basis may feed
another capability, but its
`assembly-integrity-input-bundle/1.0`, method, limits, observations, and verdicts must
not be reused as kinematic evidence.

A future kinematic case must add explicit bodies, frames, joints, axes, limits, units,
and bounded scenarios. It must never infer joints or physical properties from STEP
labels, proximity, timestamps, or current static contact facts.

## Completed implementation boundary

The completed bounded implementation defines:

1. accepted, boundary, and refused mechanism constructs;
2. exact project resource, case, units, scenario, and identity contracts;
3. a server-owned method/profile and provider-specific lowering;
4. immutable input/output resources and literal convergence/failure states;
5. WAL, uncertain-outcome recovery, capture readback, and provenance;
6. L3 facts distinct from provider-free L4 and human L5;
7. a scoped Brief gate policy so one case cannot close another case's gate;
8. a pinned, licensed, minimal runtime with focused fixtures.

A real runtime/emulation probe is still required before L3 dispatch is operationally
available. That probe cannot make a collision, contact, clearance, forces, strength,
safety, manufacturing, or certification verdict.

Static BRep intersection, exact clearance at sampled poses, kinematics, contact
dynamics, and structural strength remain separate engineering questions. A provider
success cannot collapse those questions into one assemblability verdict.

This historical RFC stays only to preserve why the provider was selected. The enduring
contract lives in the linked reference page.
