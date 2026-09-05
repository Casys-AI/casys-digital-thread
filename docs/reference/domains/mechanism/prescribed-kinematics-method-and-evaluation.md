# Reference: prescribed-kinematics method and evaluation

Audience: both · Diátaxis: reference · Kind: L4 contract

`prescribed-kinematics-method-sheet-source/1.0` is an agent-proposed, human-reviewed
method for one exact L1 case and L3 observation. Criteria never belong in the mechanism
case. The sealed method is provider-free, and L4 makes no Chrono call.

## Source fields and criteria

The source has exactly `schemaVersion`, `id`, `revision`, `scope`, `evidenceBoundary`,
`caseFingerprint`, `observationFingerprint`, and nonempty `criteria`.

| Criterion | Required fields | L4 comparison |
| --- | --- | --- |
| `body-pose` | `bodyId`, exact `sampleTimeS`, `expectedPose`, positive `translationToleranceM`, positive `orientationToleranceRad` | Euclidean translation distance and sign-invariant quaternion angular distance |
| `joint-angle` | `jointId`, exact `sampleTimeS`, `expectedAngleRad`, positive `toleranceRad` | Absolute angular difference in radians |
| `translation-residual` | `jointId`, exact `sampleTimeS`, nonnegative `maximumNormM` | Euclidean norm of the observed metre-valued residual vector |
| `rotation-quaternion-imag-residual` | `jointId`, exact `sampleTimeS`, nonnegative `maximumNorm` | Euclidean norm of the dimensionless quaternion-imaginary residual vector |
| `convergence` | No fields beyond `id` and `kind` | Observed `converged` passes; observed non-convergence fails; missing observation is unresolved |

Criterion ids are unique. A body/joint/time selection may occur only once per criterion
kind, and at most one convergence criterion is accepted. Every body, joint, expected
angle and sample time is recrossed against the exact L1 case. The source carries no
requested verdict, provider, runtime, tool, argument, generic SysML requirement, or
unsupported physics criterion.

## Canonical resource

As with the case, the exact signed resource must be deterministic minified JSON with
sorted object keys and criteria sorted by `id`. `project_prescribed_kinematics_method_review`
has two read-only modes. With only `projectId`, `mode: "preparation"` returns the two
domain content fingerprints needed to author the source. With the closed resource
reference too, `mode: "review"` reopens accepted UTF-8 bytes, requires canonical source
JSON, and recrosses criteria plus both content fingerprints against the exact current
L1/L3 evidence before returning a next hop. The executor repeats this validation after
MRTR approval; preparation/review never seals a method or grants approval.

The following line is canonical for its displayed placeholder fingerprints, but it is
not a usable project method. Copy `methodSheet.caseFingerprint` and
`methodSheet.observationFingerprint` from `project_prescribed_kinematics_method_review`
called with `projectId` only. Those are the sealed-case **domain** fingerprint and the
SHA-256 of the canonical `PrescribedKinematicsObservation`. Outer Thread artifact or
observation-capture fingerprints on `evidence.*` are not substitutes.

```json
{"caseFingerprint":{"algorithm":"sha256","digest":"0000000000000000000000000000000000000000000000000000000000000000"},"criteria":[{"expectedAngleRad":0.5,"id":"angle-final","jointId":"hinge","kind":"joint-angle","sampleTimeS":1,"toleranceRad":0.001},{"id":"converged","kind":"convergence"},{"bodyId":"link","expectedPose":{"orientationWxyz":[1,0,0,0],"positionM":[0,0,1]},"id":"pose-final","kind":"body-pose","orientationToleranceRad":0.001,"sampleTimeS":1,"translationToleranceM":0.001},{"id":"rotation-residual-final","jointId":"hinge","kind":"rotation-quaternion-imag-residual","maximumNorm":0.0001,"sampleTimeS":1},{"id":"translation-residual-final","jointId":"hinge","kind":"translation-residual","maximumNormM":0.0001,"sampleTimeS":1}],"evidenceBoundary":"No collision, contact, clearance, load, strength, safety or manufacturing claim.","id":"method-demo","observationFingerprint":{"algorithm":"sha256","digest":"1111111111111111111111111111111111111111111111111111111111111111"},"revision":1,"schemaVersion":"prescribed-kinematics-method-sheet-source/1.0","scope":"Evaluate the declared final pose, angle, residuals and convergence."}
```

Call the method review with `projectId` first, author nonempty criteria against the
published identities, capture the exact canonical bytes, then call it again with
`methodResourceRef`. It returns `mode: "review"` and `next.append` / `next.propose` only
after canonical-byte and L1/L3 domain recross succeeds. The review never invents criteria
or auto-approves. Regenerate a project method line with
`canonicalPrescribedKinematicsMethodSheetSourceText`.

## L4 and L5 boundary

Each L4 criterion is `fail`, `unresolved`, or `pass`. Aggregate order is literal:
any `fail` wins; otherwise any `unresolved` wins; only all-pass criteria produce
`pass`. L4 still does not accept the result. Human L5 accept is offered only for a
literal aggregate `pass`; reject remains available for every aggregate.

Collision, contact, clearance, force, strength, safety and manufacturability remain
`not_evaluated`. See the [evidence lifecycle](prescribed-kinematics-evidence-lifecycle.md)
and [coverage](coverage.md).
