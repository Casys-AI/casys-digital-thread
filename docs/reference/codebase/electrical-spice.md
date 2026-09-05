# Reference: source map — electrical and SPICE

Audience: agent · Diátaxis: reference · Kind: contract

Census of the LED-driver human-fiche slice present in the map, plus the circuit-only
admitted SPICE isolated-execution adapters needed to operate the ngspice-worker
imported-candidate gate. LED-driver and admitted SPICE are not substitutes.

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

#### [`src/adapters/electrical/spice/admitted/first-party-spice-execution.ts`](../../../src/adapters/electrical/spice/admitted/first-party-spice-execution.ts)

Code-owned active admitted-SPICE policy, limits and local server options. The server and
the imported-candidate gate share this builder. The candidate factory accepts only an
already-bound import record and never exports a raw image-selector API

#### [`src/adapters/electrical/spice/admitted/ngspice-worker-candidate-qualification.ts`](../../../src/adapters/electrical/spice/admitted/ngspice-worker-candidate-qualification.ts)

Record-bound plan/run/recover orchestration for an imported `ngspice-worker` candidate.
WAL, CAS, captures/attestations and `qualification.json` stay under the candidate root.
It never reopens admission, MRTR, project or Thread authority. Method/binding remain
`unqualified`

#### [`scripts/gates/verify-ngspice-worker-candidate-qualification.ts`](../../../scripts/gates/verify-ngspice-worker-candidate-qualification.ts)

Maintainer-only imported-candidate qualification for `ngspice-worker`. Input is only a
bound `first-party-microsandbox-image-candidate-import/3.0` record plus `--run` or
`--recover`. Host observation is read once. The server-owned admitted circuit profile
and code-owned resistor-divider fixture are used. `eligibleForPromotion` stays `false`.
It is not the Docker smoke, not cache preparation, and not product admitted-SPICE

#### [`scripts/gates/verify-ngspice-microsandbox-worker.ts`](../../../scripts/gates/verify-ngspice-microsandbox-worker.ts)

Docker deny-all ngspice worker preflight. Useful worker-contract evidence but not a
substitute for imported-candidate Microsandbox qualification or product IsolatedCodeRunner
wiring
