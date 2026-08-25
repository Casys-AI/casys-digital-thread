# CAD part and module builds

Status: Phase D contract accepted · implementation and runtime proof pending

## Definition geometry

A CAD source root and its server-resolved dependency closure attach geometry to one exact
SysML `PartDefinition`. The join is server-resolved from reviewed SysML relations and
exact workspace revisions. A filename, module path, output label or digest cannot choose
the definition.

One definition build produces independently identified canonical geometry for that
definition. Multiple `PartUsage` occurrences may reuse it. Byte-identical outputs for
two different definitions remain two different semantic targets.

The registered compiler profile owns parsing, lowering, provider selection and output
validation. A workspace dependency closure is not an arbitrary Python environment and
does not authorize general imports.

## Occurrence placement

A placement source attaches translation and rotation values to exact immediate
`PartUsage` identities in one derived SysML module scope. It may repeat the target
`PartDefinition` identity for recross, but it cannot invent a usage or alter its owner or
target.

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
the project, exact current Thread basis, exact composite `PartDefinition`, exact
placement-capture locator and the exact canonical child geometry references selected by
the server. The caller cannot submit source text, a manifest, transforms, child targets,
provider or runtime selection.

The server-owned lowerer reopens all child admissions and canonical child captures,
orders them by exact usage identity, constructs one assembly program from those admitted
sources plus the captured local transforms, then invokes the registered canonical CAD
provider. The generated program is an execution detail identified by a versioned lowerer
ID and digest; it is not an agent-authored source or a second product model.

The draft carries a multi-source admission stamp. It recrosses every child source,
attachment, admission, canonical child capture, structure basis and placement capture.
A successful export still writes no Thread state. The existing
`design.write-geometry@1` remains the only canonical geometry sealer; it is extended to
accept the bounded module manifest rather than duplicating the operation.

The implementation target is one level only. Nested promotion, incremental ancestor
rebuild and unbounded assemblies stay `unavailable` until separately implemented and
runtime-proven. Build success does not assert collision freedom or fitness; those facts
belong to the separate assembly-integrity observation contract.
