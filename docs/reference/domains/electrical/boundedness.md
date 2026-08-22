# Electrical boundedness inventory (H01)

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory of the only electrical product surface that exists: human-source
capture. It does not invent a limit and does not treat a fleet probe as a bound.

Status words: **enforced**, **physical-only**, **unbounded**, **needs decision**.
`unresolved` stays literal.

Sibling: [domain index](README.md),
[mcp-spice](../../providers/spice/README.md).

## Human-source capture

Fiche:
[`led-driver-human-source.ts`](../../../../src/domain/electrical/led-driver/led-driver-human-source.ts).
UTF-8 ceiling:
[`MAX_LED_DRIVER_SOURCE_BYTES = 262_144`](../../../../src/adapters/electrical/led-driver/led-driver-source-capture.ts).
Composition never receives a provider URL, tool client, or ngspice grant.

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Human-source UTF-8 | At most 262144 bytes before parse | Enforced | None |
| Unknowns | Array of unique ids; each `status` is exactly `unresolved` | Enforced uniqueness and status; **unbounded** count | A semantic max would be a product/storage decision. Source bytes are only a physical envelope. |
| Named circuit / test condition | Exactly one of each | Enforced | None |

## What does not exist

There is no ngspice manifest, WAL, isolated executor, or output-role table in this
repository. `mcp-spice` remains a maintainer-only health/discovery probe that concludes
`non-executable-preflight` with integration `unresolved`. That observation is not a
runtime byte budget and does not authorize a number.

No electrical isolated-output count is required until a reviewed executor exists.
