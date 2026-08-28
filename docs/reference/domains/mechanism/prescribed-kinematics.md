# Prescribed kinematics V1

Audience: both · Diátaxis: reference · Kind: domain contract

`prescribed-kinematics/1.0` is the bounded mechanism evidence family for one connected,
immediate rigid-body subassembly. It has the same three authority stages as other
engineering evidence:

```text
sealed case → L3 factual observation → sealed method → L4 evaluation → human L5
```

The current contract and its focused pure-domain tests live in
[`src/domain/mechanism/prescribed-kinematics`](../../../../src/domain/mechanism/prescribed-kinematics).
The registered server path includes the fixed Chrono adapter, an atomic local runtime
definition and L1/L3/L4/L5 executors. It does **not** claim that the Chrono runtime has
passed a live emulation probe: its exact binding remains `unqualified` and its runtime
mode remains `unavailable` until that probe is recorded.

## Case source and graph binding

The agent-authored `prescribed-kinematics-case-source/1.0` is one canonical JSON text
resource in `ProjectSourceWorkspace`. It declares only the engineering scenario:

- explicit SI `m`, `rad`, and `s` units;
- an assembly `PartUsage`, bodies, zero poses, revolute joint frames and unit axes,
  limits, one full-duration linear ramp per joint, duration, ground body, and an exact
  time-step schedule;
- a connected immediate tree of at least two bodies;
- a bijective `bodyId → PartUsage` mapping.

### V1 coordinate convention and Chrono lowering boundary

`zeroPose`, `parentFrame`, and `childFrame` are all absolute poses in the same
right-handed world frame at zero joint angle. Positions are metres and orientations are
Hamilton quaternions in `WXYZ` order. The source contains no alternate local-frame
interpretation, no pose-composition rule, and no geometry-derived reference frame. A
body's `zeroPose` is the exact body centre-of-mass/reference pose passed to a binding
that needs `absolute_com_pose`; V1 does not separately assert a mass property.

The Chrono 0.3.1 binding is deliberately narrower than the source vocabulary: it accepts
a revolute joint only when `parentFrame` and `childFrame` are the exact same world pose
and their axis fields are both the literal local `[0, 0, 1]`. It then passes that pose
unchanged as Chrono's `absolute_joint_frame`. It passes each body `zeroPose` unchanged
as `absolute_com_pose`, makes **only** `groundBodyId` fixed, and uses the exact source
IDs, limits, units and time step. A source using relative frames, distinct mating
frames, a non-Z axis, another topology, or a ramp that is not explicit from `0` through
the whole duration is literally `unavailable` for this binding. The server must not
average frames, compose an undocumented transform, infer a joint from a STEP/label, or
synthesize geometry to make it runnable.

Before submission, the binding also repeats the pinned mcp-chrono 0.3.1 numeric
boundary: every emitted numeric value, including poses, quaternions, limits, angles and
derived angular speed, must be finite and within `±1,000,000`. It fixes
`sample_every_steps` to `1` and rejects the source if
`floor(durationS / timeStepS) / sample_every_steps + 2 > 512`, even where the broader V1
source contract is otherwise valid. These are lowering rejections, not a derived
engineering verdict.

V1 deliberately bounds one source to 16 bodies, 15 joints, a duration of at most 10 s,
and 512 stored sample instants. This in turn bounds normalized L3 to 23,552 fact rows
(poses, angles, and residual rows). Larger products scale as several bounded
mechanism-source files/assemblies, never as one unbounded case.

The case source does not contain L4 criteria, a verdict, provider/tool/image/
endpoint/runtime selection, a solver payload, mass/inertia, contact model, force,
clearance, or safety statement.

Every declared `PartUsage` is proven against the workspace rather than merely trusted
from the JSON. The same single file must have active `mechanism-source@1` attachments,
on their exact heads, for the assembly and every mapped body. Those attachments must
have the same project, workspace revision/event, source file/revision/resource bytes,
and declared Thread/architecture basis. The source subject must equal that exact Thread
subject, and the assembly PartUsage must be distinct from every body PartUsage. Extra,
missing, duplicate, stale, cross-file, cross-subject, or cross-basis attachments are
rejected.

The workspace has attachment identities but does not contain the complete SysML graph.
The application seam must additionally recross that the assembly and body usages exist
in the exact architecture capture and that each body is an immediate child of that
assembly. It must never derive a body from a STEP label, proximity, timestamp, geometry
name, or a physical guess.

## L3: prescribed-kinematics observation

`verify.run-prescribed-kinematics@1` is a registered server-owned L3 operation. When
the exact Chrono capability has been operationally authorized and its local binding is
qualified, it produces one `prescribed-kinematics-observation/1.0`. The provider-neutral
normal form is bound to the exact sealed case and contains every case-derived sample
time, each body pose, each joint angle, and each joint's two residual vectors:
`translationResidualM` in metres and the dimensionless
`rotationQuaternionImagResidual`, plus the convergence state. It does not collapse
those values into one ambiguous scalar.

L3 values are literal facts only. Missing observations use `unresolved` and unsupported
observations use `unavailable`; they are never guessed. Collision, contact, clearance,
forces, strength, safety, and manufacturability are copied as literal `not_evaluated`
boundaries.

The immutable L3 capture records the exact dispatch identity (`requestId` and case
SHA-256), source/lowering/request fingerprints, sealed ROP and capability fingerprints,
binding/adapter/profile identity, material digest, launch-group identity, and a strictly
normalized factual Chrono receipt. The receipt must repeat the same request and case
identities, engine/runtime identity, exact execution exit and the fixed provider
`not_evaluated` boundary. It never stores the provider case JSON, endpoint, bearer
token, or Compose secret overlay; the transient request is recoverable only by
re-lowering the sealed source under the recorded binding.

The mcp-chrono 0.3.1 wire owns exactly nine `not_evaluated` literals: collision,
clearance, contact, forces, torques, dynamics, strength, safety, and product fitness.
The Digital Thread capture retains those nine verbatim **and separately** writes its
code-owned coverage limit, including `manufacturability: not_evaluated`. It never edits
or pretends that the provider wire supplied a tenth value.

Time identity is a case-derived integer sample tick. The normalizer accepts decimal JSON
spellings such as `0.3` for the `0.1 s` third tick within the fixed numeric tolerance,
then stores the canonical case time. It never joins L3 or L4 using raw floating-point
equality.

## Method, L4, and L5

After L3, `prescribed-kinematics-method-sheet-source/1.0` proposes explicit pose, angle,
and convergence criteria for that exact case and L3 fingerprint. Residual criteria are
per joint and sample: the translation-vector norm has a `maximumNormM` tolerance in
metres, while the quaternion-imaginary-vector norm has a dimensionless `maximumNorm`.
There is no generic residual tolerance and no implied radians conversion. The server
must obtain its normal MRTR before `verify.seal-prescribed-kinematics-method@1` writes
the immutable `prescribed-kinematics-method-sheet/1.0`. The signed method’s exact
`scope` and `evidenceBoundary` are preserved through L4 and its eligibility record.

`verify.evaluate-prescribed-kinematics@1` performs no provider or SysML call. It
recrosses the case, L3, and sealed method and applies only the method’s signed criteria.
Aggregate precedence is `fail`, then `unresolved`, then `pass`. An L4 result is not an
L5 decision.

`decide.accept-prescribed-kinematics-evaluation@1` is merely offered to a human when all
L4 criteria pass. The reject consequence is always available; non-pass L4 uses the
literal disposition `prescribed-kinematics-review-required`. Both are registered and
retain the exact project, subject, Thread basis, and human-origin signed decision before
they can create L5 evidence. They preserve the method limitations and never make an L5
decision from a provider success, runtime health check, or L4 result alone.

The MCP AX exposes the provider-neutral L1 case review plus three read-only next-hop
reviews for the already registered later stages:

- `project_prescribed_kinematics_method_review` rereads the exact current L1/L3 branch
  and a closed method resource reference, then presents the existing method-seal append
  and proposal envelopes;
- `project_prescribed_kinematics_evaluation_review` rereads the exact current L1/L3 and
  sealed-method branch, then presents the existing L4 append and proposal envelopes;
- `project_prescribed_kinematics_evaluation_closeout_review` rereads the exact current
  L1/L3/method/L4 branch, then presents reject and, only for literal L4 `pass`, accept
  envelopes for the existing L5 operations.

All three reviews are `GET`-like discovery only: they do not create a project change,
MRTR proposal or approval, queue a run, call Chrono, write Thread evidence, evaluate L4,
or decide L5. Returned envelopes remain display-only preparation for the existing
generic project commands. In particular, the L5 work item remains human-owned and
requires the existing human-origin signed decision; no review gives an agent approval or
verdict authority.

## Explicit exclusions

This V1 family does not establish collision-free motion, contact behavior, clearance,
fit-up, loads, forces, torque, dynamics, resistance, strength, fatigue, safety,
fabrication, certification, or product fitness. A successful provider call, an L3
observation, a runtime health check, or an L4 pass cannot be reinterpreted as any of
those claims.

## Runtime boundary

`casys.mcp-chrono@0.3.1` is an optional atomic material selected only by the
provider-neutral `prescribed-kinematics` verification authority in the project brief.
The server selects its exact binding, image digest, launch group, and fixed loopback
endpoint; the agent never sends any of them. `casys-chrono@1.0.0` runs one
`linux/amd64` service on `127.0.0.1:3025`, retains `chrono-data:/data`, has no public
port, bind mount, device, socket or privilege, and receives its one bearer value only
through a host-local opaque secret snapshot at launch and client construction. The
sealed group fingerprint covers the fixed shape and secret slot, never the value.

An active secret-bearing group is reconciled with that same process-local snapshot
before the fixed client is returned; this avoids a container/client token generation
mismatch after restart or rotation. It is still operational plumbing, not engineering
evidence. Until the explicit live AMD64-on-ARM64 emulation probe succeeds, this material
is visible but `unqualified`/`unavailable` and cannot make an L3 call.
