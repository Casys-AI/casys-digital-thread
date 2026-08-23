# HS01 — impact

Branches are separate by brief design; that is not by itself an impact recross.

## Initial evidence

The resource-backed [hs01-cross-domain-impact-manifest.json](../sources/hs01-cross-domain-impact-manifest.json)
was sealed at r21. Initial X08 evaluation was captured at r22. Its states are
literal initial evidence only: electrical `invalidated`, thermal
`impact-unresolved`, mechanical `carried-forward`. No claims or work items
were changed by X08. AX correction/replay is in progress; this is not a final
impact outcome. X10 remains `unavailable`.

## Pending

X09 initial decision review is `unresolved` with
`work_item_claim_unresolved`: the initial work items do not carry `gateClaims`.
X11 was not executed. It may be reconsidered only after a resolved X09 and on
the exact mechanical r14/r15 branch. Independent Modelica/SPICE walks are not
X10.

AX now preflights current work-item `gateClaims` against the manifest `gateMap`
at X06 seal and X07/X08 evaluation. Missing, mismatched or ambiguous
`gateItemId` stops `unresolved` before MRTR or evaluation. X09 still recrosses
the sealed result; this does not alter r22.

## Friction

Do not invent a fourth branch, a rerun planner, or preservation by omitted
edges. The manifest used generic resource ingress. Coupled thermomechanics is
a brief exclusion, not an impact edge.
