# CAD part and module builds

Status: Runtime-proven for one immediate module (MSM01) and bounded manual two-level
composition (ID01, 2026-09-06 UTC) · deeper/unbounded assemblies and automatic ancestor
rebuild remain outside qualified coverage

## Definition geometry

A CAD source root and its server-resolved dependency closure attach geometry to one
exact SysML `PartDefinition`. The join is server-resolved from reviewed SysML relations
and exact workspace revisions. A filename, module path, output label or digest cannot
choose the definition.

One definition build produces independently identified canonical geometry for that
definition. Multiple `PartUsage` occurrences may reuse it. Byte-identical outputs for
two different definitions remain two different semantic targets.

The registered compiler profile owns parsing, lowering, provider selection and output
validation. A workspace dependency closure is not an arbitrary Python environment and
does not authorize general imports.

## Occurrence placement

A placement source attaches translation and rotation values to exact immediate
`PartUsage` identities in one derived SysML module scope. It may repeat the target
`PartDefinition` identity for recross, but it cannot invent a usage or alter its owner
or target.

The server must prove exact coverage of the immediate usages in the selected SysML
scope, no extra usage and no ambiguous placement. Missing or extra mappings are
`unresolved`; they are never filled from array order or names.

The accepted source schema is `cad-immediate-placement-source/1.0`:

```json
{
  "schemaVersion": "cad-immediate-placement-source/1.0",
  "unitSystem": "mm",
  "placementConvention": "right-handed-mm-extrinsic-xyz-degrees",
  "placements": [
    {
      "usageElementId": "exact-syson-part-usage-id",
      "partDefinitionElementId": "exact-syson-part-definition-id",
      "placement": {
        "translationMm": [0, 0, 0],
        "rotationDeg": [0, 0, 0]
      }
    }
  ]
}
```

The JSON is a closed, order-independent source document. Every vector has exactly three
finite numbers. `usageElementId` is unique; several usages may target the same
definition. Labels, occurrence paths, parent IDs, structure bases, providers, tools,
runtimes, MRTR data, geometry and verdicts are forbidden. The server derives the common
owner and every usage target from the exact SysON capture.

The agent uploads the JSON through `project_resource_capture`, stores it as one
workspace file with role `cad-placement-source`, then attaches that same stable `fileId`
with `design-source@1` to every exact immediate `PartUsage`. No new workspace aggregate
or attachment role is required. Attachments remain authoring edges and grant no build
authority.

`project_cad_placement_capture` accepts only `projectId`, `workspaceRevision`,
`attachmentId` and `attachmentRevision`. It reopens the exact file and all active
same-file placement attachments, then requires exact equality between:

- the immediate usages derived from the common SysON owner;
- the attached usage targets;
- the JSON placement entries.

It also recrosses every `PartUsage` to its exact target `PartDefinition`. Only a fully
resolved capture returns an opaque `cad-placement-analysis-capture/1.0` locator. Its
review is bounded and has `grants: none`.

## Module build

A composite definition build consumes only:

- its exact SysML structure basis;
- its own admitted CAD source closure when the definition has authored geometry;
- exact canonical geometry references for each immediate child target definition;
- exact placements for each immediate child usage;
- one server-owned lowering profile.

The output is geometry for that exact composite `PartDefinition`, not a new product
structure. A parent module can consume that output exactly like any other child
definition geometry. Promotion occurs only by sealing new Thread evidence; successful
isolated execution alone is not canonical geometry.

The accepted public draft surface is `project_geometry_module_export`. It receives only
the project, exact current Thread basis, exact composite `PartDefinition` and exact
placement-capture locator. The server resolves the canonical child captures; the caller
cannot submit source text, a manifest, transforms, child targets, child assets, provider
or runtime selection.

The server orders the immediate occurrences by exact usage identity, reopens every
canonical child STEP by digest, then creates one deterministic
`geometry-module-input-bundle/1.0`. The binary bundle contains a canonical manifest,
placements, offsets, byte counts and digests followed by the exact STEP bytes. It does
not copy agent CAD source text or flatten descendant manifests.

A dedicated digest-pinned microVM profile owns the assembly algorithm. Its fixed worker
decodes and rehashes the bundle, imports each STEP, applies the captured transform,
creates the compound and exports the server-fixed STEP plus GLB. The caller supplies no
program. This reuses the isolated execution broker's single immutable input, bounded
outputs, atomic CAS publication and destruction proof without widening the generic
broker contract.

The draft recrosses every canonical child capture and asset, the exact structure basis,
the placement capture, input-bundle fingerprint, runtime profile and execution receipt.
A successful export still writes no Thread state. The existing `design.write-geometry@1`
remains the only canonical geometry sealer; it is extended to accept the bounded module
manifest rather than duplicating the operation.

The qualified nested case is two manually sequenced module levels: canonical parts form
child modules, and their exact canonical module STEP files form one parent. The existing
schemas and immediate-compound semantics are unchanged. Each invocation retains the
32-occurrence, 1 MiB manifest, 32 MiB child STEP, and 256 MiB bundle bounds. A parent
with mixed immediate part/module children was source-tested at export, but was not
exercised by this runtime canary and is not promoted by it. Deeper/unbounded trees and
automatic ancestor rebuilding remain outside qualification; this is not a new depth
validator. Build success does not assert collision freedom or fitness; those facts
belong to the separate
[assembly-integrity](../../reference/domains/cad/assembly-integrity.md) contract.

## Runtime proof and boundary

MSM01 proved this path on 2026-08-26 with three independently admitted, canonical
PartDefinition geometries (BasePlate, Riser and SensorCradle) and one shared
`cad-placement-source` attached to the exact three immediate usages. The current
architecture must first have a sealed `model.capture-part-definitions@1` result; without
that exact structural capture, `project_geometry_module_export` remains unavailable. The
export then reopened the three child STEP assets and the exact placement capture, and
`design.write-geometry@1` sealed the resulting ModularSensorMount STEP and GLB.

The following assembly-integrity evidence subsequently passed: L3 observation, L4
evaluation and L5 closeout. Its positive result is deliberately narrow: it covers
exact-basis child import, immediate occurrence coverage, captured placement, BRep
reopening and the configured static intersection observation. It does not establish
joints, clearance, motion, load response, fabricability or safety. Those facts need
their own bounded capability and evidence family; this module export is not a mechanism
solver or a manufacturing oracle.

ID01 added the bounded two-level runtime proof on 2026-09-06 UTC / 2026-09-07
Asia/Taipei: six canonical subsystem modules, retaining twelve distinct leaf-part
targets, were consumed by the fixed qualified runtime and sealed as InspectionDrone at
Thread r66. Separate L3/L4/L5 at r67-r69 passed only the five fixed geometric criteria
with zero gate claims. Exact child capture/STEP identities, bundle, neutral/native
receipts, parent STEP/GLB and observations are in the
[ID01 canary ledger](../../project-dossiers/inspection-drone-id01/nested-root-canary-20260907.md).

Focused source-control-flow tests separately prove module-child bundle rehash, canonical
export/seal, refusal of wrong child target/STEP or archived evidence, and two-hop
leaf-to-child-to-parent retirement preserving historical bytes and an unrelated target.
The only added run in that replacement fixture is the explicitly queued leaf successor;
no parent is rebuilt. This archival lifecycle was tested in a disposable fixture, not by
replacing a valid ID01 leaf solely as a canary. Follow the
[qualification route](../../how-to/extend/qualify-nested-cad-modules.md) before
promoting any further case.
