# TPS03 — SysML product graph

Audience: both · Diátaxis: explanation · Kind: dated product trace

The reviewed architecture at Thread r3 contains one composite definition, two typed
immediate usages and one explicit RequirementUsage. Navigation and joins use these
identities; labels are display text only.

| Role | SysML identity | Type |
| --- | --- | --- |
| Root definition | `1f12c73b-8dc8-49b5-859a-94d95a838a0f` | `TwoPieceTabletStand` PartDefinition |
| Base occurrence | `22afa6fa-829b-4372-b126-6bbbeefd1a51` | `standBase` PartUsage → `StandBase` |
| Backrest occurrence | `56a97aee-becf-4645-8e76-3bb3406e3cdc` | `standBackrest` PartUsage → `StandBackrest` |
| Base definition | `7d6b0240-8300-4dd3-bd6a-a0803f0f148f` | `StandBase` PartDefinition |
| Backrest definition | `20e71742-390d-4c6d-a91c-120debab5aa8` | `StandBackrest` PartDefinition |
| Static-FEA requirement | `122501cd-54d6-4aa9-b6a6-50b361ee2168` | RequirementUsage scoped to `StandBackrest` |

The requirement capture carries two criteria: maximum displacement at or below 1 mm
and maximum von Mises stress at or below 55,000,000 Pa. The successful r16 successor
evaluation records both as literal `pass`; their L5 acceptance is a separate r17 human
disposition.

The source workspace attaches CAD roots to PartDefinitions and immediate-placement
source to PartUsages. Exact graph exploration reached the two occurrences, their type
definitions, attachments and files. This proves navigation of this graph, not general
SysML semantics or a product verdict.
