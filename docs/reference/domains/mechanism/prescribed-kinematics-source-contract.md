# Reference: prescribed-kinematics source contract

Audience: agent · Diátaxis: reference · Kind: closed source contract

`prescribed-kinematics-case-source/1.0` is the one agent-authored L1 case input to the
bounded mechanism vertical. It is one canonical JSON text resource in a
ProjectSourceWorkspace. It declares a scenario; it does not select Chrono, a runtime, an
MCP tool, an engineering method, or a verdict.

## Closed shape

| Field                                        | Exact meaning                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `schemaVersion`                              | Literal `prescribed-kinematics-case-source/1.0`                                                    |
| `id`, `revision`                             | Stable case identity and positive revision                                                         |
| `scope`, `evidenceBoundary`                  | Nonempty text without leading or trailing whitespace                                               |
| `project.id`, `project.subjectId`            | Exact current project and Thread subject identities                                                |
| `assembly.elementId`, `assembly.elementKind` | Exact assembly context: `PartDefinition` or `PartUsage`, distinct from every body usage            |
| `units`                                      | Exactly `{length:"m", angle:"rad", time:"s"}`                                                      |
| `durationS`, `sampling.timeStepS`            | Positive duration and an exact divisor of it                                                       |
| `groundBodyId`                               | Exactly one declared body                                                                          |
| `bodies[]`                                   | Unique `bodyId`, unique exact `PartUsage` mapping, and absolute zero pose                          |
| `joints[]`                                   | Unique revolute tree edge, absolute parent/child frames, limits, and one full-duration linear ramp |

The root and every nested object reject missing and extra keys. The case contains no
fingerprint, L4 criterion, provider, image, endpoint, tool, arguments, solver payload,
mass, inertia, force, contact, collision, clearance, strength, safety, or
manufacturability field.

The domain parser admits unit axes, absolute frames, the shared 256-character source-id
grammar and an undirected rooted tree. The current Chrono lowering is narrower: provider
ids use `[A-Za-z][A-Za-z0-9_-]{0,63}`, the tree must already be directed from the
ground, parent and child frames must match exactly, both axes must be literal `[0,0,1]`,
and the schedule may have at most 510 intervals. The lowerer never composes a missing
transform.

A lowering mismatch is rejected before provider dispatch, but the current executor
surfaces it as terminal `prescribed-kinematics-execution-failed`, not as a preflight
`unavailable`. This is a current AX gap and is not authority to retry or bypass L2.

## Canonical bytes

The captured UTF-8 bytes must equal the repository's deterministic JSON exactly:
lexicographically sorted object keys, stable arrays, no indentation, and no leading or
trailing whitespace or newline. Bodies are canonicalized by `bodyId`; joints by
`jointId`. Use `canonicalPrescribedKinematicsCaseSourceText` when producing the text;
pretty-printed JSON is refused rather than silently normalized.

This is a syntactically complete two-body example. Replace every project, subject,
assembly context and body `PartUsage` identity with values read from the live project,
then regenerate the whole canonical line before `project_resource_capture`. An exact
reusable definition uses `elementKind` `PartDefinition`; an occurrence-specific context
uses `PartUsage`.

```text
{"assembly":{"elementId":"usage-assembly","elementKind":"PartUsage"},"bodies":[{"bodyId":"base","partUsageElementId":"usage-base","zeroPose":{"orientationWxyz":[1,0,0,0],"positionM":[0,0,0]}},{"bodyId":"link","partUsageElementId":"usage-link","zeroPose":{"orientationWxyz":[1,0,0,0],"positionM":[0,0,1]}}],"durationS":1,"evidenceBoundary":"Prescribed poses, angles, residuals and convergence only.","groundBodyId":"base","id":"case-demo","joints":[{"childBodyId":"link","childFrame":{"axis":[0,0,1],"orientationWxyz":[1,0,0,0],"positionM":[0,0,1]},"jointId":"hinge","kind":"revolute","limitRad":{"maximum":1,"minimum":-1},"parentBodyId":"base","parentFrame":{"axis":[0,0,1],"orientationWxyz":[1,0,0,0],"positionM":[0,0,1]},"ramp":{"endTimeS":1,"finalAngleRad":0.5,"initialAngleRad":0,"kind":"linear","startTimeS":0}}],"project":{"id":"project-demo","subjectId":"subject-demo"},"revision":1,"sampling":{"timeStepS":0.5},"schemaVersion":"prescribed-kinematics-case-source/1.0","scope":"One immediate two-body mechanism.","units":{"angle":"rad","length":"m","time":"s"}}
```

## Workspace binding

Capture the line as `application/json`, put the returned resource into one workspace
file, then attach that same file with role `mechanism-source@1` to the assembly context
and every body `PartUsage`. The assembly attachment uses the same `elementKind` as
`assembly.elementKind`. The closure has exactly one file and no dependency edge. A
project may contain many other files; the V1 mechanism case itself may not be split
across files.

The attachment set and SysON architecture recross are defined by
[case and architecture binding](prescribed-kinematics-case-and-architecture-binding.md).
Size and cardinality limits are in [boundedness](boundedness.md).
