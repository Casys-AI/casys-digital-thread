# Reference: CAD coverage

Audience: both · Diátaxis: reference · Kind: contract

This is the current **product** surface, not the build123d API and not the broader D4
import allowlist. A construct is covered only when the qualified analyzer can prove it,
admission can seal it, and the fixed execution paths can reopen the same sealed bytes.
The detailed grammar and the authority of each path remain in
[Build123d closed subset v1](build123d-closed-subset-v1.md) and
[CAD execution paths](execution-paths.md). The direct workspace-closure form is defined
separately in [Build123d workspace-closure lowering v1](build123d-workspace-closure-lowering-v1.md).

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
| Direct workspace closure V1 | The Build123d 3.0 profile accepts the exact direct scalar-leaf form, lowers it to one D4-valid script, and carries its `technical-unit:<closure sha256>` plus full manifest through V4 capture/reopen, `technical-compilation/2.0`, and `technical-compilation-admission/4.0`. This is code-and-test coverage, not a claim that any caller can select a lowerer, path, provider or runtime. |
| Geometry authority | A system/bundle admitted export produces canonical STEP/GLTF draft then `design.write-geometry@1` seals canonical STEP. A target admitted export can seal exactly one PartDefinition through `geometry-part-capture/1.0`. The bounded module path reopens exact immediate child geometries plus an exact placement capture, and the same sealer can publish one composite PartDefinition STEP/GLB. Neither path infers a physical product verdict. The local isolated path writes a validated AP214 STEP privately and only a documentary Thread capture. |

The active closure slice is proven by focused code tests for lowering, V4 capture and
reopen, V2 preview, V4 admission/replay, and the canonical and isolated review
boundaries. A real private `mcp-build123d` execution from a lowered multi-file closure
is still pending. It must not be represented as runtime proof, canonical geometry or a
relaxation of either path's existing authority.

Named single-root runtime proof: MCS-02 captured an attachment-rooted RailFrame source,
sealed its admission at Thread r4, and published one canonical target STEP at r7 before
the downstream FEA branch. See
[MCS-02 CAD](../../../project-dossiers/motorized-camera-slider-mcs02/domains/cad.md).
That proof covers one `PartDefinition`, not an assembly.

MSM01 then proved the bounded immediate-module path: three independently admitted
child roots were sealed as canonical PartDefinition geometries; after the required
`model.capture-part-definitions@1` structural capture and an exact three-usage placement
capture, `project_geometry_module_export` produced a ModularSensorMount STEP/GLB draft
and `design.write-geometry@1` sealed it. The associated L3/L4/L5 assembly-integrity
branch passed only the exact static checks it records: child import, occurrence
coverage, captured placements, BRep reopening and intersection observation. It does
not prove joints, clearance, motion, loads, fabricability or safety. Exact assets,
placements and the L3/L4/L5 boundary are recorded in the
[MSM01 CAD dossier](../../../project-dossiers/modular-sensor-mount-msm01/domains/cad.md).

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
- CAD `.py` enters through `project_resource_capture`, a workspace file + attachment,
  then `project_technical_source_capture` (`projectId` + `workspaceRevision` +
  `attachmentId` + `attachmentRevision`). Public capture does not accept `sourceText`,
  `fileId`, `profileId` or `resourceRef`. Isolated execution still starts from
  `compile.seal-admission@3`.
- Modelica and circuit-only SPICE multi-file closures are not enabled by the Build123d
  lowering. They remain `source.dependency-lowering-unavailable`; a capture or
  navigable closure is not an executable language environment.
- [Assembly integrity](assembly-integrity.md) is a separate post-publication evidence
  family, not a CAD language construct or an export path. L3 first reopens the
  [exact static assembly basis](static-assembly-basis.md), then the current
  server-composed observer adapter (`mcp-build123d`) records facts. Callers do not
  choose that provider. If the exact basis, profile, or runtime cannot be reopened, the
  result remains `unavailable` or `unresolved`. L3 facts, the provider-free L4
  evaluation, and human L5 closeout do not create geometry or a product verdict. L4
  keeps motion and related limits as `not-evaluated`. There is no local OCCT, sandbox,
  or caller-selected-provider fallback.

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

The qualified observer consumes a canonical module artifact; it does not replace the
[provider-neutral module assembler](module-assembly.md). The current fixed Build123d
worker is one adapter implementation. Another qualified backend must implement the same
closed input, neutral receipt, exact-output, and recovery contract.

## Targeted PartDefinition seal

`geometry-part-manifest/1.0` and `geometry-part-draft-capture/1.1` are a separate
target-only review family. Version `geometry-part-draft-capture/1.0` is unsupported:
it retained a provider container path, so readers do not migrate or dual-read it.
Promotion remains exclusively `design.write-geometry@1`: it
reopens the human-signed target MRTR and the exact capture-backed
`compile.seal-admission@3` artifact named by the v2 target-bound stamp, re-crossing
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
