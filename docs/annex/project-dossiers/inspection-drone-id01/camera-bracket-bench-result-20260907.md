# ID01 - theoretical camera-bracket bench proof

Observed 2026-09-06 18:46:10 UTC. Documentary ledger, not replacement authority.

## Exact current chain

- Project: `inspection-drone-id01:project:r378:2ae24d9c0959380c`.
- Thread: `project:inspection-drone-id01:r53:decide-accept-evaluation-closeout-run:id01-queue-bench-fea-closeout-20260907`.
- Approved brief r3: `inspection-drone-id01:brief:r3:bca2a461299be869`.
  Approval origin: `local-yolo:startup-opt-in`,
  2026-09-06T18:37:47.232Z. Preserves the prior mission and exclusions.
- SysML requirements at Thread r50:
  `requirements-CameraMountBracket-3ea5824924d2d537276572c6fd9aab1940adec4a89eaa634da2b5e30e7ddfb21`.
  Native RequirementUsage: `aa7c4627-203a-46e6-aa6e-7192f23f9462`;
  target PartDefinition: `e9f1d48b-666d-48ff-af6c-abf74646b68e`.
- [Agent-authored proof source](sources/camera-bracket-bench-proof.json), raw resource
  SHA-256 `892b95bd888eb2b5cf5f57ff42b8c5e5156099c891b2ccfa5bc630da42b2a157`,
  4,902 bytes. Canonical source-capture fingerprint:
  `0cb7dbdae927d471caf487894564a0db94b38740abc25d0d9621715046530a1a`.
- Sealed proof at Thread r51:
  `fea-proof-5cfe52509a34b49694b2109996493d187cd8f834f17fe3273e6d3225828d0320`.
- Real `verify.run-fea-static-proof@3` run:
  `run:id01-queue-bench-fea-run-20260907`, completed at Thread r52.
- Exact input STEP remains 48,786 bytes, SHA-256
  `b821e5598b75449636eb57d0ea7db48ea560260ce56a6872ebeaec0f7691d201`.
- Isolated execution evidence:
  `calculix-isolated-evidence-fba4584594313471c22f4eb16ca693b043af5611a017df5d15dc3b9f1f7b1182`.
- L4 evaluation:
  `calculix-isolated-syson-evaluation-0c74b341303b1402f2b7f75576f868545bdaa049cc6690329f00441715e86d29`.
- L5 documentary accept at Thread r53:
  `evaluation-closeout-e245850178fee5b3b2b118f3656d3fcd4b819adfb9a96cd247d2abfb22a34537`.
  Separate MRTR confirmed through the requested local YOLO mode. Work item has no
  gate claims; this is not implicit whole-project satisfaction.

## Actual numerical outputs

| Observation | Returned value |
| --- | --- |
| Maximum von Mises stress | 0.00763815636944611 MPa |
| Same stress after oracle unit conversion | 7,638.15636944611 Pa |
| Reviewed upper limit | 260,000,000 Pa |
| Named criterion | `camera-bracket-bench-stress`: `pass` |
| Maximum displacement (observation, no criterion) | 0.00001733611556368841 mm |
| Mesh | 9,397 nodes; 37,788 volume elements in the normalized result |
| Fixed selection | 1,412 nodes |
| Each of four force selections | 36 nodes |
| Total prescribed external force | (0, -0.0392266, 0) N |

The logs identify CalculiX 2.21 and Gmsh 4.12.1. CalculiX reports `Job finished`.
Gmsh reports no ill-shaped tetrahedra after optimization. Its full mesh includes
lower-dimensional elements; the CalculiX header explicitly labels its element count
an estimated upper bound. Those log counts are not substituted for the normalized
37,788 volume-element count. No solver warning/error was observed in the inspected logs.

The recorded constraint evaluation converts the returned MPa to the approved Pa
threshold. Its displayed marginPercent rounds to 100; this is not an exact percentage,
a factor of safety or a qualification.

## Scope that the accept preserves

Read [the sourced assumptions](sources/camera-bracket-bench-proof-provenance.md).
This is one low-load, homogeneous isotropic, linear-static numerical bench case on the
original bracket. It uses catalogue 6082-T6 properties, camera-only 4 g weight, standard
gravity along local -Y, ideal equal force sharing and the whole bottom face perfectly
fixed. It is not a physical bench experiment, an as-built material claim, a real bolt
interface or the vehicle's flight orientation.

A single target mesh size of 1 mm is not a convergence study. Self-weight, cable,
hardware, camera centre-of-mass moment, contact, nonlinear behavior, fatigue, vibration,
landing/flight loads, manufacturing and certification remain excluded. The result does
not repair the unresolved bracket-to-drone mounting.

The six earlier immediate assembly-integrity L4 passes remain separate evidence.
Their assembly L5s were not executed. The F07 closeout-policy correction is not yet
integrated: its first pass failed historical-replay review. Nested root-module
qualification and physical integration still remain; ID01 is NOT complete.
