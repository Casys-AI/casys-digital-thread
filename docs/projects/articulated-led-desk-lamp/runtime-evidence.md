# Articulated LED desk lamp — local runtime evidence

Audience: both · Diátaxis: none · Kind: tracking evidence

Dated observation from the primary local atelier on **2026-08-22**. The underlying
`state/local/` files are gitignored runtime state; this page records their exact
identities without turning them into portable proof or provider truth.

## Current heads

| Authority         | Exact identity                                                                                                                        | Meaning                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Project           | `articulated-led-desk-lamp-al01:project:r34:39d44bdcf818e1bc`                                                                         | Latest durable project revision after adding the open G2 guidance question                             |
| Approved brief    | `articulated-led-desk-lamp-al01:brief:r2:528a4d63848cfe20`                                                                            | Bounded indoor desk-use story, five components, five bare handles, and three separate Behave questions |
| Brief fingerprint | `sha256:4fe12375f5f2ebbd67752accd1d3997dec85c1991b2023e2263fb2b2ff053f32`                                                             | Exact approved brief r2 input                                                                          |
| Thread            | `project:articulated-led-desk-lamp-al01:r4:capture-part-definitions-8007e5fa7617b9d18ff8d538c31ed23459b401ad71e0b9e0eb573ceea780da1b` | Current evidence head; structure only                                                                  |

The project plan's documentary baseline and seed remain correctly bound to approved
brief r1. The successor architecture change is separately bound to approved brief r2;
history was not rewritten.

## Completed chain

| Thread revision | Registered operation               | Run                                                | Persisted artifact                                                                         | Established fact                             |
| --------------- | ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| r1              | `baseline.from-approved-brief@1`   | `run:lamp-queue-baseline-20260822`                 | `approved-brief-document-51c85905974549dc696ecc380401cc6c282f988ee5d274ec0f78ef47aad1738f` | Documentary brief r1 baseline only           |
| r2              | `architecture.seed-syson-model@2`  | `run:lamp-queue-syson-seed-20260822`               | `syson-model-seed-2b2a508531ec8b0ab8a1d66e905afde1a749c9529c3b1dadd484e226920476e0`        | Editable SysON container identity only       |
| r3              | `model.write-architecture@1`       | `run:lamp-queue-write-architecture-20260822`       | `architecture-1092dcfdf42dcc125e5b4f54da79a12d2c0229775d993b3713fedabcc0993bb7`            | Renderer-authored and SysON-reread structure |
| r4              | `model.capture-part-definitions@1` | `run:lamp-queue-part-definitions-capture-20260822` | `part-definitions-8007e5fa7617b9d18ff8d538c31ed23459b401ad71e0b9e0eb573ceea780da1b`        | Exact captured architecture subgraph         |

The r3 capture contains the root `ArticulatedLedDeskLamp`, usages targeting `Base`,
`ArticulatedArm`, `LampHead`, `LedDriver`, and `PowerSupply`, plus bare attributes
`armLever`, `armMaterial`, `lampHeadThermalState`, `ledDriverElectrical`, and
`electricalPower`. It contains no magnitude, unit, port, flow, equation, requirement, or
branch verdict.

## Replay and stops

Replaying the exact architecture execution command returned the same project r28 and
Thread r3 with the same four-entry run history; it did not append another revision.

The already-running read-only Workbench BFF projected the live project through
`GET /api/thread/workbench` as `engineering-workbench/0.3`, surface `evidence`, project
r34 aligned with Thread r4, with no unresolved evidence reference. The projection kept
the three success criteria and their three verification activities as separate brief
items. `GET /api/thread/workbench/events` emitted a `workbench-snapshot` SSE event for
the same project/Thread head. These reads executed no engineering operation.

Current literal stops:

- G2: question `g2-mechanical-arm-inputs` is open; no sourced geometry, material,
  support, load, or mechanical criterion has been recorded;
- G4: no approved thermal method sheet, equations, inputs, or criterion;
- G5: no approved circuit boundary, circuit source, test condition, or criterion;
- G6/G7: no reviewed cross-domain change and no branch L4/L5 consequence.

Therefore r4 is stable product structure, not CAD, FEA, Modelica, ngspice, compliance,
or whole-lamp proof.
