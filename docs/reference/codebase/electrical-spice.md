# Reference: source map — electrical and SPICE

Audience: agent · Diátaxis: reference · Kind: contract

Census of the LED-driver human-fiche slice present in the map. Circuit-only SPICE
adapters are not listed here; this page does not invent them.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`src/domain/electrical/`](../../../src/domain/electrical)

Electrical authority context. `led-driver/` is the closed
`led-driver-source-capture/1.0` human-fiche contract. Not a spice/ngspice frontend, not
D1 IR/netlist, not a Thread result

#### [`src/application/ports/in/electrical/`](../../../src/application/ports/in/electrical)

Inbound LED-driver source capture (draft CAS, full `resourceRef` only) and read-only
review (`sourceRef` only). Capture and review are not substitutes. No seal, run or D1

#### [`src/application/ports/out/electrical/`](../../../src/application/ports/out/electrical)

Outbound LED-driver source-capture write and reopen. Hash before parse. No
`McpToolClient`

#### [`src/application/use-cases/electrical/`](../../../src/application/use-cases/electrical)

Capture exact human-source UTF-8 into draft CAS, reread it, and hoist declared unknowns
as `unresolved`. Review stays reference-only. Grants none

#### [`src/adapters/electrical/led-driver/`](../../../src/adapters/electrical/led-driver)

CAS save/reread/rehash of exact human-source UTF-8. Hash before parse. Not
`adapters/electrical/spice/`

#### [`src/adapters/electrical/led-driver/server-composition.ts`](../../../src/adapters/electrical/led-driver/server-composition.ts)

Provider-free LED-driver source capture/review composition. No MCP client, no ngspice,
no D1. Capture writes draft CAS; review reopens one opaque locator. Unknowns stay
`unresolved`.
