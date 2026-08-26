# TPS01 — SysML product graph

Audience: both · Diátaxis: explanation · Kind: dated product trace

The reviewed architecture at Thread r3 contains one composite
`TwoPieceTabletStand` and two immediate typed usages. The exact graph matters because
source files and canonical geometry are attached to these identities, rather than being
inferred from their labels.

| Role | SysML identity | Type |
| --- | --- | --- |
| Root definition | `173bb4f7-bb49-4c1e-b096-5a8c9908dcc9` | `TwoPieceTabletStand` PartDefinition |
| Base occurrence | `29b5428e-661d-4dba-80fe-dd449294b9f7` | `standBase` PartUsage → `StandBase` |
| Backrest occurrence | `01ca15a0-770d-4b03-ab90-9305fd65d5dd` | `standBackrest` PartUsage → `StandBackrest` |
| Base definition | `822c8ed1-fc61-447e-92ea-35aa3d35116d` | `StandBase` PartDefinition |
| Backrest definition | `28f384f1-05a6-4876-9e4e-93b96191e02c` | `StandBackrest` PartDefinition |

The architecture deliberately uses globally distinct CAD-handle names:
`baseWidth`, `baseDepth`, `baseThickness`, `backrestWidth`, `backrestThickness`, and
`backrestHeight`. This is an authoring constraint observed in the current renderer; it
does not turn the demo dimensions into engineering requirements.

At r8 the exact structure was reread through `model.capture-part-definitions@1`; that
capture is a prerequisite for an immediate module export. The source workspace keeps
root CAD source on each PartDefinition and placement source on each PartUsage. At final
workspace r16, all four active attachment heads had that exact-basis relation.

Exact graph navigation from the root to the two occurrences, their target definitions,
and their source attachments was reread successfully. This identity/navigation result
does not add general SysML semantics or a product verdict.
