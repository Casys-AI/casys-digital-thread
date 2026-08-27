# Reference: exact static assembly basis

Audience: agent · Diátaxis: reference · Kind: contract

The exact static assembly basis is the profile-free application boundary shared before
any assembly observation method is selected. It reopens one immutable
`geometry-module-capture/1.0` from one exact Thread snapshot and proves its canonical
assembly STEP bytes.

`ExactStaticAssemblyBasisResolver` accepts only:

- an exact snapshot id, positive revision, and subject id;
- the already loaded snapshot carrying that exact identity; and
- one exact geometry-module artifact id and fingerprint.

`ResolvedStaticAssemblyBasis` returns:

- the same exact Thread basis and geometry-module reference;
- the unique, current, unarchived primary module artifact;
- the exact canonical assembly STEP artifact and immutable reread bytes; and
- the parsed geometry-module capture, including its explicit immediate occurrences and
  placements.

The resolver rereads the capture by content identity, recrosses primary metadata,
requires the exact derived STEP artifact, then recomputes byte count and SHA-256. A
missing, duplicate, archived, mismatched, malformed, or non-module basis fails closed.
`geometry-part-capture/1.0` is refused because it carries neither an assembly nor
occurrence placements. A consumer that cannot reopen this basis keeps the result
`unavailable` or `unresolved`. It does not invent STEP bytes, occurrences, or
placements.

## Consumer-owned meaning

This basis has no observer profile, provider, tool, runtime, tolerance, ceiling, joint,
mass, scenario, evaluation rule, or verdict. A consumer must add its own closed case and
profile after reopening the common basis.

The current static assembly-integrity consumer adds its exact method and bounds, then
creates `assembly-integrity-input-bundle/1.0`. Its L4 limits keep `motion`, `clearance`,
`physicalJoints`, and related fields as literal `not-evaluated`. This page does not
authorize kinematics, Chrono, joints, or a new operation. A later kinematics consumer,
if separately authorized, may reuse only this exact module/STEP basis beside a
separately sealed kinematic case. It must not reinterpret the static bundle or its pair
facts as joint or motion evidence.

No public MCP tool exposes this resolver. Server composition owns its stores and passes
the resolved basis only to registered application workflows.
