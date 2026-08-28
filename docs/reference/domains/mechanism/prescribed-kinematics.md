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
This reference does **not** claim that a provider adapter, runtime image, or real Chrono
execution is installed or qualified.

## Case source and graph binding

The agent-authored `prescribed-kinematics-case-source/1.0` is one canonical JSON text
resource in `ProjectSourceWorkspace`. It declares only the engineering scenario:

- explicit SI `m`, `rad`, and `s` units;
- an assembly `PartUsage`, bodies, zero poses, revolute joint frames and unit axes,
  limits, one full-duration linear ramp per joint, duration, ground body, and an exact
  time-step schedule;
- a connected immediate tree of at least two bodies;
- a bijective `bodyId → PartUsage` mapping.

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

`verify.run-prescribed-kinematics@1` will later produce one
`prescribed-kinematics-observation/1.0`. The provider-neutral normal form is bound to
the exact sealed case and contains every case-derived sample time, each body pose, each
joint angle, and each joint's two residual vectors: `translationResidualM` in metres and
the dimensionless `rotationQuaternionImagResidual`, plus the convergence state. It does
not collapse those values into one ambiguous scalar.

L3 values are literal facts only. Missing observations use `unresolved` and unsupported
observations use `unavailable`; they are never guessed. Collision, contact, clearance,
forces, strength, safety, and manufacturability are copied as literal `not_evaluated`
boundaries.

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
literal disposition `prescribed-kinematics-review-required`. Both preserve the method
limitations and still require a human-origin, signed append operation. In this
pure-domain lot they are **unregistered and uncallable** eligibility identities: a later
application lot must bind the exact project, subject, Thread basis, and signed
human-origin `EngineeringDecisionProposalParameter` before either can create L5
evidence.

## Explicit exclusions

This V1 family does not establish collision-free motion, contact behavior, clearance,
fit-up, loads, forces, torque, dynamics, resistance, strength, fatigue, safety,
fabrication, certification, or product fitness. A successful provider call, an L3
observation, a runtime health check, or an L4 pass cannot be reinterpreted as any of
those claims.
