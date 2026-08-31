# Reference: prescribed-kinematics case and architecture binding

Audience: both · Diátaxis: reference · Kind: domain contract

This page defines L1 input identity for the bounded prescribed-kinematics vertical. It
does not select a provider or authorize an L3 run; those are separate boundaries in the
[evidence lifecycle](prescribed-kinematics-evidence-lifecycle.md).

## One exact declared scenario

The source is one canonical JSON `prescribed-kinematics-case-source/1.0` resource in a
ProjectSourceWorkspace. It declares an immediate connected rigid-body tree, not an
inferred assembly:

- one assembly `PartUsage`, at least two body `PartUsage` mappings, and a bijective
  `bodyId → PartUsage` mapping;
- one ground body, revolute joints, limits, frames, unit axes, and one full-duration
  linear ramp per joint;
- exact SI units: metres, radians, and seconds; and
- a bounded schedule, with at most 16 bodies, 15 joints, 10 seconds, and 512 stored
  sample instants.

The source uses one right-handed world frame at zero joint angle. `zeroPose`,
`parentFrame`, and `childFrame` are absolute poses; positions are metres and orientations
are Hamilton `WXYZ` quaternions. A body zero pose is the declared reference pose, not an
assertion of mass or inertia.

The V1 server lowering accepts only its documented narrow form: matching absolute joint
frames, literal local Z joint axes, finite bounded numbers, and the declared sampled
ramp. Relative frames, distinct mating frames, another topology, a non-Z axis, or an
implicit ramp remain `unavailable`. The server does not compose a missing transform,
infer a joint from a STEP label or proximity, or synthesize geometry.

The source does not contain L4 criteria, a verdict, a solver payload, a provider,
runtime, image, endpoint, tool, bearer, or arguments. It also does not establish contact,
collision, clearance, force, torque, dynamics, strength, safety, manufacturability, or
product fitness.

## Exact workspace and architecture recross

`project_prescribed_kinematics_case_review` accepts only `projectId`,
`workspaceRevision`, `attachmentId`, and `attachmentRevision`. It is read-only. The
server reopens the exact JSON bytes and every active same-file `mechanism-source@1`
attachment needed by the source:

1. one attachment for the declared assembly and one for every mapped body;
2. common project, workspace revision/event, file revision/resource bytes, and declared
   Thread and architecture basis;
3. no missing, duplicate, stale, cross-file, cross-subject, or cross-basis attachment;
   and
4. an exact architecture-capture recross showing that the assembly and body usages exist
   and every body is an immediate child of that assembly.

The assembly usage must be distinct from every body usage. A workspace attachment proves
an exact authoring edge; it is not a substitute for the architecture graph recross. The
server never derives a body from CAD labels, physical proximity, timestamps, or a
plausible mechanism shape.

`resolved` means the review can prepare L1 case material. `unresolved` and `unavailable`
remain literal states. The review does not write a Thread successor, create or approve an
MRTR, start a runtime, call a provider, observe L3, evaluate L4, or decide L5.

## L1 seal

The registered `verify.seal-prescribed-kinematics-case@1` operation seals the exact
recrossed source closure as `prescribed-kinematics-case/1.0` in a Thread successor. Its
normal project/MRTR path is a case-seal authority only. It does not authorize the later
L3 provider observation; the discrete L2 run authorization remains required.

Later stages consume the sealed case artifact and its fingerprint, never an active
workspace head selected by a label. A source correction is a successor workspace file and
attachment revision followed by a new L1 path; historical L1 evidence stays historical.
