# MSM01 — CAD and immediate module

Three independent PartDefinition geometries were sealed from root-only admitted CAD
sources:

| Part | Geometry capture | STEP SHA-256 |
| ---- | ---------------- | ----------- |
| BasePlate | `geometry-0af9422265145f8c80ba0e8c7f4fae82d91dc376002f3ef62ed2c2b78ca91eb8` | `a6444d71ecf10359e9473391c64a645b8782f844004b1e1dab61ebd9664ee1a1` |
| Riser | `geometry-f29fa249e275b89a5369a3efe0fc868b169e26bc6ea60fdaa91cf5ca640e236f` | `b6a3d55ca2aa27494d9589c10385d85470d9434499a081197229c93c57bb7365` |
| SensorCradle | `geometry-d62824f950b5b2b6f5226563b16f3ae573740a7f38b68576e56f3dae9f01d35d` | `9f4d0b3f5dbe76cf4476c88203ef3e6b2ec1e411a2348292f87aea10e602376b` |

After `model.capture-part-definitions@1` at r10 and exact placement capture, the
immediate module was sealed at r11. The three captured translations are BasePlate
`[0, 0, 0]` mm, Riser `[200, 0, 0]` mm, and SensorCradle `[400, 0, 0]` mm.

L3 r12 observed an importable three-solid BRep and three `no-contact` pairs. L4 r13
passed import, occurrence coverage, placement recross, BRep validity and zero pairwise
intersection. L5 r14 accepted only that L4 capture. The separated placements are **not
joined**; physical joints, clearance, motion, loads, fabricability and safety remain
`not-evaluated`.
