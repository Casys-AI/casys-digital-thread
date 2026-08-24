# CAD part and module builds

Status: proposed large-assembly design · not implemented beyond current registered paths

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

The current registered CAD operations and closed language remain authoritative. Genuine
multi-file module lowering, nested promotion or unbounded assemblies stay `unavailable`
until implemented and qualified.
