# Electrical boundedness inventory (H01)

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory of the electrical product surfaces that exist: LED-driver human-source
capture and the generic circuit-only SPICE closed subset. It does not invent a limit
and does not treat a fleet probe as a bound.

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

## Circuit-only SPICE source

Grammar:
[`closed-subset-v1.ts`](../../../../src/domain/electrical/spice/closed-subset-v1.ts).
UTF-8 ceiling:
[`SPICE_CIRCUIT_MAX_SOURCE_BYTES = 262_144`](../../../../src/adapters/electrical/spice/source-analysis-composition.ts).
Composition never receives a provider URL, tool client, or ngspice grant.

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Circuit source UTF-8 | At most 262144 bytes before parse | Enforced | None |
| Elements | 1 to 256 unique instance names | Enforced | None |
| Nodes | 1 to 256 unique node names | Enforced | None |
| Named levers | 0 to 32 `.param` finite literals | Enforced; device literals are not levers | None |

## Isolated ngspice worker and admitted run

Worker and output contract:
[`isolated-output.ts`](../../../../src/domain/electrical/spice/admitted/isolated-output.ts),
[`images/ngspice-microsandbox-worker/`](../../../../images/ngspice-microsandbox-worker).
The worker exists. Product IsolatedCodeRunner wiring is
`simulate.run-admitted-spice@1` after `project_admitted_spice_run_review`.
`mcp-spice` is not this worker. L3 stays documentary. L4/L5 are later registered
operations on a sealed method sheet; they are not this worker. Safety stays
`unavailable`.

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Source UTF-8 at `/input/source.cir` | 1 to 262144 bytes | Enforced in the worker | None |
| Observables | 1 to 2048 node voltages and branch currents | Enforced | None |
| Result / evidence JSON | Each at most 262144 bytes; total outputs 524288 | Enforced | None |
| Vector file / log | 262144 / 1048576 bytes | Enforced | None |
| Wall time | 30000 ms code-owned timeout | Enforced | None |
| Network / caller args / `.include` | Denied | Enforced | None |

These ceilings are the worker contract. Product IsolatedCodeRunner composition is the
approved capability-runtime supervisor plus the digest-pinned ngspice image. Until that
supervisor activates the unit, the registered operation stays `unavailable`. That
composition state is not a
`spice-isolated-evidence/1.0` limitation.

## What does not exist

There is no safety, EMC, optical, lifetime, or vendor-validity claim in this
repository. `mcp-spice` remains a maintainer-only health/discovery probe that
concludes `non-executable-preflight` with integration `unresolved`. That
observation is not a runtime byte budget and does not authorize a number.

Derived current/power and L4/L5 exist only as the later method-sheet operations
(`verify.seal-electrical-observation-method-sheet@1`,
`verify.evaluate-admitted-spice-observations@1`,
`decide.accept-admitted-spice-evaluation@1` /
`decide.reject-admitted-spice-evaluation@1`). They are not granted by L3
`spice-isolated-evidence/1.0`, which still lists `not-l4` and
`not-a-requirement-verdict`.
