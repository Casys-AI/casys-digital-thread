# CL01 — workspace

Audience: both · Diátaxis: explanation · Kind: dated source-workspace record

CL01 uses the project source workspace as the stable home for named engineering
sources. The Thread holds captures and results; it does not replace versioned source
files or make filenames into engineering evidence.

## Recorded recrosses

- Workspace r40 recrosses the exact Chrono mechanism source used by the r17–r21 chain.
- Workspace r41 recrosses the exact circuit-only SPICE source used by the r22–r26
  chain.

The two recrosses are independent. A new file revision or a changed source closure
would need its own capture/admission path; this dossier does not infer continuity from
a part name, timestamp or renderer label.

## Product graph relationship

The architecture records the four product constituents `Base`, `ArticulatedArm`,
`LampHead` and `DriverCircuit`; their exact source attachments are navigated through
the project workspace and are bound to the relevant product elements. The immediate
assembly is a separate r13 geometry result derived from the four canonical child
geometries. It is not a license to derive mechanism joints, axes, masses, frames or
electrical values from CAD labels.

The governing contracts are [workspace closure lowering](../../../reference/domains/cad/build123d-workspace-closure-lowering-v1.md),
[mechanism source contract](../../../reference/domains/mechanism/prescribed-kinematics-source-contract.md),
and [circuit-only SPICE](../../../reference/domains/electrical/spice-circuit-closed-subset-v1.md).
