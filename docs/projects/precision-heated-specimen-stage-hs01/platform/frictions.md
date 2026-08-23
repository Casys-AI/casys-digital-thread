# HS01 — platform frictions

Generic facts seen next to this pilot. Not HS01 product claims.

## Generic slug fix

MRTR slugs (`component.<slug>.*`, `requirement.<slug>.*`,
`attribute.<slug>.*`) are grouping keys: letters, digits, hyphen, underscore.
They are not SysML identifiers. Hyphen allowance is a concurrent generic fix.
HS01 renderer names stayed camelCase (`heatedStagePlate`, `stageThickness`).
Do not paste a slug into SysML text.

## Resource ingress — proved on HS01

Commit `d1bf53d7` introduced the generic resource ingress. HS01 exercised it
for the documentary SysML source, CAD, Modelica, SPICE, FEA proof JSON, thermal
and electrical method sheets, and the impact manifest. Each downstream capture
received a full immutable `resourceRef`; no raw resource was passed straight to
a solver or microVM.

`project_resource_capture` mints bytes; `resources/read` projects them. The
capture bound is 262144 bytes.

## One-file SysML limitation

Profile `sysml-architecture-closed-subset-v1` accepts **exactly one** write
form per source (package of part defs, one part def, or one typed part usage).
No `import`, no multi-file package, no comments/strings/numbers/`attribute`.
[hs01-architecture.sysml](../sources/hs01-architecture.sysml) is that one-form
specimen. The live SysON graph is a different authority.

## Project purge lifecycle gap

MCP lifecycle is `project_start` then append-only change. There is no
`project_delete` / purge / reset. A mistaken HS01 cannot be erased in place; a
new project id is a different identity. Orphan work-item closeout is
`deno task recover:work-item-successor`, not a purge.

## Raw versus typed fingerprint

Raw SHA-256 is the exact captured payload (CAD `ed2c3346…`, Modelica
`7384350d…`, SPICE `e7893fe3…`, FEA source `544ca2dd…884`). A later typed store
(canonical JSON or method sheet) hashes a different byte string. HS01 sealed
both typed method sheets; sheet reviews consume
`interpretation.typed.fingerprint`, never a raw CAS URI.

## Initial AX findings

The first r17 thermal evaluation selected the first of three criteria sharing
one RequirementUsage (`c1f…`), so it is literally `unresolved`, not failed.
AX now requires `requirementMetric` in each method-sheet output and output
binding, and resolves the exact `(RequirementUsage, metric)` pair before
evidence, SysON or MRTR. The edited source needs a new resource capture, typed
fingerprint, seal and L4/L5 successor; it cannot mutate r17.

The first r22 impact evaluation exposed branch states, but X09 could not decide
because the original work items have no `gateClaims`
(`work_item_claim_unresolved`). AX preflights current `gateClaims` versus the
manifest `gateMap` at X06 and X07/X08, failing unresolved before MRTR/evaluation
on a missing, mismatched or ambiguous gate. X09 retains its own recross. Neither
initial finding authorises a hand-written result or a false final status.
