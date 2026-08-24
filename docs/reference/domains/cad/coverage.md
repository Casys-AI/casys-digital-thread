# Reference: CAD coverage

Audience: both · Diátaxis: reference · Kind: contract

This is the current **product** surface, not the build123d API and not the broader D4
import allowlist. A construct is covered only when the qualified analyzer can prove it,
admission can seal it, and the fixed execution paths can reopen the same sealed bytes.
The detailed grammar and the authority of each path remain in
[Build123d closed subset v1](build123d-closed-subset-v1.md) and
[CAD execution paths](execution-paths.md).

## Covered now

| Area               | Exact covered surface                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Values             | Module-level finite decimal values, unary/binary arithmetic, earlier values, `pi`/`e`/`tau`, and reviewed flat lists.                                                                                                                                                                                                                                                                            |
| Solids             | `Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`.                                                                                                                                                                                                                                                                                                                                           |
| Sketches           | `Rectangle`, `Circle`, `Ellipse`, `RegularPolygon`. A sketch cannot be `result`.                                                                                                                                                                                                                                                                                                                 |
| Placement          | `Pos`, `Rot`, prior placements and their left-associative products; `Plane.XY`, `XZ`, `YZ`, `YX`, `ZX`, `ZY` applied to a solid or sketch.                                                                                                                                                                                                                                                       |
| Shape algebra      | Same-kind `+` and `-`; `scale` on a solid; reviewed `fillet`/`chamfer`, including reviewed `solid.edges()` forms; `extrude`, `offset`, `revolve` about `Axis.X`, `Y`, or `Z`; `Compound(children=[...])` over prior solids.                                                                                                                                                                      |
| Result             | One module-level `result`, resolving to a solid.                                                                                                                                                                                                                                                                                                                                                 |
| Admission          | No unresolved construct; unique server-derived `represents` artifact binding and `parameterizes` bindings; at least one finite named numeric literal must causally reach `result`.                                                                                                                                                                                                               |
| Geometry authority | A system/bundle admitted export produces canonical STEP/GLTF draft then `design.write-geometry@1` seals canonical STEP. A target admitted export can seal exactly one PartDefinition through `geometry-part-capture/1.0`; it makes no assembly, component, occurrence or placement claim. The local isolated path writes a validated AP214 STEP privately and only a documentary Thread capture. |

## Not covered

These states must remain literal: they are not degraded success.

- General Python and build123d are not covered: loops, comprehensions, functions,
  classes, lambdas, builders/`with`, general methods or selector chains, arbitrary
  `Plane`/`Axis`, and unreviewed call arguments become `unresolved` or are rejected.
- `&` and `|`, arbitrary imports, I/O/serialization, reflection, dunder access,
  non-finite values, raw/bytes/f-strings, and a non-module-level or repeated `result`
  are rejected by D4.
- `Ellipsoid` is a known phantom: the hand table contains it, but the pinned build123d
  0.11.1 inventory does not. It is not executable capability.
- A successful parser/capture, a `levers` result, or isolated execution is not
  admission, canonical geometry, DFM/FEA input, observation, evaluation, or verdict.
- CAD `.py` enters through `project_resource_capture` then
  `project_technical_source_capture` (`profileId` + `sourceId` + full `resourceRef`).
  Public capture does not accept `sourceText`. Isolated execution still starts from
  `compile.seal-admission@2`.

## Candidates and non-goals

Some D4-reachable names are deliberately still unqualified: boolean helper forms,
`Part`, `mirror`, `loft`, `sweep`, extra sketch primitives, builders, and location
generators. They are **candidates for a separately reviewed extension**, not a promise
or a caller-selectable capability. `shell` and the phantom `Ellipsoid` are not
candidates until the pinned runtime inventory proves an executable, safe API.

Explicitly outside the product surface are an arbitrary Python/build123d escape hatch, a
CAD JSON/DSL parallel to the source language, caller-selected provider/runtime/tool
envelopes, automatic assembly mapping in V1, and promotion of private isolated output to
canonical geometry. A new geometry inside this surface is **source text only**: there is
no new agent, Workbench, or provider command for it.

## Targeted PartDefinition seal

`geometry-part-manifest/1.0` and `geometry-part-draft-capture/1.0` are a separate
target-only review family. Promotion remains exclusively `design.write-geometry@1`: it
reopens the human-signed target MRTR and the exact capture-backed
`compile.seal-admission@2` artifact named by the v2 target-bound stamp, re-crossing
admitted source bytes/hash plus the unique P1 `represents` PartDefinition, passive
source analysis and exact reviewed assets. It never reruns Build123d. The resulting
`geometry-part-capture/1.0` repeats the exact PartDefinition element ID, architecture
basis, admission/source hash and one authoritative STEP hash. It has no `assembly`,
`components`, `occurrences`, `placements` or `partDefinitions` array.

Each target STEP asset uses the deterministic capture-scoped identity
`cad-asset-<captureDigest>-target-<fileIndex>-<fileDigest>`. Different PartDefinitions
may coexist. A successor archives only the exact prior target capture and its target
files; an active V2 bundle that covers that target is a fail-closed conflict, never a
partial V2 archive. Product projection therefore does not infer complete assembly
coverage from this evidence. It may nevertheless attach the target STEP and reviewed GLB
to every Product occurrence whose SysON `part-definition` binding has the exact signed
element ID. That remains a PartDefinition surface only: the projector creates no
assembly, occurrence, placement, or complete-product coverage claim.
