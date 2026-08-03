# RFC: bounded inspection-drone SysON architecture slice

Status: **Implemented in source — not released; disposable local SysON parser/translator and model-tree check passed**\
Evidence: **No r3 project technical evidence exists**\
Scope: guarded V2 operation after `architecture.seed-syson-model@1`\
Target: a controlled visual-inspection drone carrying a light inspection camera

This is deliberately not a generic “write SysML” capability. It specifies one immutable
model fragment, one known provider mutation, and the evidence that must be read back
before the project can call the result an editable system architecture.

It does **not** create CAD, a motor layout, a battery selection, a simulation, a
requirement verdict, a safety case, a compliance conclusion, a cost, or a claim that a
drone can fly.

## Why this is the right next slice

The implemented r2 seed has a real SysON project, document, and root package, but they
are intentionally blank. The smallest useful next state is a named model that makes the
future proof loop possible:

```text
approved discovery
  -> r1 documentary basis
  -> r2 blank SysON container
  -> r3 named system architecture and high-level intent
  -> later CAD frame -> later static proof -> later requirement evaluation
```

It gives the cockpit something truthful to show under **Product** without pretending
that the named parts have geometry, mass, suppliers, a feasible propulsion layout, or
verified behaviour.

## Exact eligibility

The implemented source operation is `architecture.author-inspection-drone@1`. It may be queued
only after all of the following are true:

1. Its exact basis is the subject's r2 `ThreadSnapshot`, produced by
   `architecture.seed-syson-model@1`.
2. The r2 `sysml-model` artifact points to a re-readable, hash-valid
   `syson-model-seed-capture/1.0`; its project, editing-context, and root-package
   identities are the only provider coordinates used by the executor.
3. The same human-approved discovery unambiguously selects
   `primary-mission = inspection-controlled` **and**
   `payload-class = light-inspection-camera`. A recommendation alone is not enough.
4. Its work item was included in the initial reviewed plan, before r1. The plan cannot
   be revised to add r3 after documentary or technical execution has begun.
5. A human has queued this exact run. The agent can prepare and execute it, but cannot
   approve the choice or queue it itself.
6. A read of the seed root package shows no direct children. A non-empty root is not a
   harmless collision: this narrowly scoped executor stops for review rather than
   merging with manual or future model content.

The current local discovery has the first answer, but not the second approved answer or
an approved brief. It therefore cannot reach this operation yet.

Its registry entry has `thread-snapshot` as its only queue basis and retains the
existing `approvedDiscovery` binding, so the executor can re-read the exact approved
discovery capture behind the r1/r2 lineage. Do not add a project decision merely to
duplicate those approved discovery answers; a different future architecture profile
would instead need its own explicit decision. This operation must never accept SysML
text, a provider URL, a tool name, or a raw result from the calling agent.

## Canonical SysML text

The executor owns this exact UTF-8 string. It must not template names, add a model
library import, or use an LLM-generated variation. Its SHA-256 is recorded in the r3
capture before publication.

```sysml
package InspectionDroneArchitecture {
    part def InspectionDrone {
        part airframe: Airframe;
        part energy: EnergySystem;
        part propulsion: PropulsionSystem;
        part avionicsAndFlightControl: AvionicsAndFlightControl;
        part cameraPayload: InspectionCameraPayload;
    }

    part def Airframe;
    part def EnergySystem;
    part def PropulsionSystem;
    part def AvionicsAndFlightControl;
    part def InspectionCameraPayload;

    package Requirements {
        requirement controlledVisualInspection {
            doc /* The system shall support visual inspection in a controlled environment. */
        }

        requirement cameraPayloadProvision {
            doc /* The system shall provide an integration location for one light inspection camera payload. */
        }

        requirement modifiableArchitecture {
            doc /* The initial architecture shall preserve explicit airframe, energy, propulsion, avionics and camera-payload boundaries for later design changes. */
        }

        requirement evidenceDrivenVerification {
            doc /* Later design decisions shall be evaluated against named, traceable engineering evidence before a verification claim is made. */
        }
    }
}
```

The `InspectionDrone` part definition is the architectural decomposition. The five
nested part usages are deliberately **not** an assembly instance, motor count, port
topology, or CAD BOM. The four requirements are high-level intent statements, not
measurable acceptance criteria. They cannot produce a pass/fail status until later work
introduces traceable, unit-bearing criteria and evidence.

There are intentionally no quantities, units, `constraint` expressions, `satisfy`
relationships, material names, regulatory references, or flight-performance claims.
Adding any of these would require an explicit decision/evidence source and a separate
reviewed operation.

`requirement` (rather than `requirement def`) is chosen provisionally because the local
`mcp-syson` contract documents this textual form and its requirements-trace tool queries
SysON `RequirementUsage` elements. The fragment also avoids `SI::*`, because no numeric
unit needs it. SysON's own documentation describes textual import as a supported but
still partial surface. The fixed fragment was accepted and read back once by the
loopback `mcp-syson 0.5.2` image on 2026-08-03; that narrow result does not release the
operation or establish engineering evidence. See the
[SysON textual-format documentation](https://doc.mbse-syson.org/syson/v2025.2.0/user-manual/features/import-export-textual.html).

## Server-owned call sequence

The source executor uses one write and three reads. The browser and the agent see only
the reviewed operation/run identity; they never see this payload as an editable form.

```text
read  syson_element_children(root package)              -> require []
journal architecture-insert as dispatched
write syson_element_insert_sysml(root package, text)    -> require exact attestation
journal architecture-insert as completed
read  syson_element_children(root package)              -> find one Architecture package
read  syson_element_children(Architecture package)     -> check expected declarations
materialize capture + persist/read-back r3 + publish run
```

The only mutation is:

```ts
{
  name: "syson_element_insert_sysml",
  arguments: {
    editing_context_id: seed.normalizedResults.project.editingContextId,
    parent_id: seed.normalizedResults.rootPackage.id,
    sysml_text: INSPECTION_DRONE_ARCHITECTURE_SYSML,
  },
}
```

The local MCP tool's successful wire contract is already bounded to:

```ts
{
  inserted: true,
  parentId: string,
  text: string,
}
```

The executor must require `inserted === true`, the exact root `parentId`, and byte-for-
byte equality with its own text. A successful mutation does not yield element IDs, so
the post-write reads are the source of the new package identity and the limited semantic
check.

Before the mutation, persist a new dedicated write-ahead attempt record (do not weaken
or repurpose the seed journal's two-step type). On timeout, malformed structured result,
or connection loss after the record is `dispatched`, report an unknown provider outcome
and never auto-retry the insertion. If the insertion result was recorded but later
read-back/persistence fails, a retry of the same command may resume only the reads and
publication; it must not insert a second copy.

## Implemented r3 capture boundary

The source implementation has the pure materializer in
`src/domain/inspection-drone-architecture.ts`, a matching content-addressed capture
store, and a separate write-ahead attempt store. Its normalized capture contains only:

- operation identity/version, trusted run ID, and capture time;
- exact r2 seed artifact fingerprint and the normalized SysON project/document/root
  identities it authorizes;
- the canonical fragment's SHA-256 and fixed recipe version;
- normalized insertion acknowledgement (`inserted`, root parent ID, text SHA-256);
- normalized post-write architecture package identity and the expected named direct
  declarations;
- no raw GraphQL payload, request ID, credentials, agent text, or provider-only UI data.

The materializer creates the r3 descendant with a `sysml-model` architecture
artifact that depends on the r2 container artifact. It may expose the named model
artifact and its source hash in the cockpit. It must leave canonical
`ThreadSnapshot.requirements`, evaluations, violations, observations, and proposed
actions empty: provider-side high-level requirements are model content, not a verified
digital-thread verdict.

## Test and mock recipe for review

The source implementation is tested with a `FakeSysonClient` implementing the existing
`McpToolClient` port. No normal test starts Docker or contacts a provider.

| Test                        | Fake response / assertion                                                                                                                                                 | Safety property                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Happy path                  | Root children are empty; insertion returns the exact `inserted/parentId/text`; post-read returns one `InspectionDroneArchitecture` package and the expected declarations. | Exactly one mutation, a stable r3 capture, and a model artifact dependent on r2.     |
| Caller cannot alter text    | Inspect recorded calls.                                                                                                                                                   | The sole `sysml_text` is the constant above; no caller/provider payload is accepted. |
| Non-empty root              | First `syson_element_children` returns one child.                                                                                                                         | No insertion call and no project/run transition beyond a reviewed failure.           |
| Unknown write outcome       | The fake throws from `syson_element_insert_sysml` after the attempt record is written. Re-run the same command.                                                           | The second execution makes no second insert.                                         |
| Wrong acknowledgement       | `inserted` is false, `parentId` differs, or `text` differs.                                                                                                               | Nothing is materialized or published as r3.                                          |
| Missing/ambiguous read-back | Post-write children omit or duplicate the architecture package.                                                                                                           | The operation does not call a partial model a valid architecture.                    |
| Basis drift                 | Supply r1, a different r2, a corrupt capture, or discovery choices other than the two exact values.                                                                       | No provider call occurs.                                                             |

The mock's happy-path call list should be asserted exactly:

```ts
[
  "syson_element_children",
  "syson_element_insert_sysml",
  "syson_element_children",
  "syson_element_children",
];
```

and the one mutation's three arguments should be compared structurally to the root
coordinates and constant text above. Add a small live-projector test in parallel: it
should expose redacted `started` and `completed` milestones for the single write, but a
live-feed failure must never cause a retry.

After the fake tests pass, the repository provides the separately authorized, disposable
harness at `scripts/run-inspection-drone-syson-conformance.ts`. Its default invocation
is inert: it does not instantiate an MCP client, make an MCP call, or mutate SysON:

```sh
deno run scripts/run-inspection-drone-syson-conformance.ts
```

An actual conformance attempt must be authorized separately and acknowledge all of the
following in one command: `--execute`, `--acknowledge=CREATE_DISPOSABLE_SYSON_PROJECT`,
a lowercase `--disposable-project-prefix=disposable-...`, and a credential-free loopback
`--mcp-url=http(s)://127.0.0.1:<port>/mcp` (or `localhost`). It retains the disposable
project for provider inspection rather than attempting cleanup. The harness creates a
throwaway project/root, inserts this exact text once, and checks from read-back the
architecture package, five `PartUsage` elements, and four `RequirementUsage` elements.
It is intentionally not a normal test-suite step: actual mode mutates a real provider.

It reports parser/translator and model-tree-shape conformance only. It is not CAD,
physics, flight, cost, compliance, requirement-verification, or other engineering
evidence. On 2026-08-03 it passed once against loopback `mcp-syson 0.5.2`, creating a
retained disposable project/model/root, inserting the fixed fragment once, and reading
back the expected package, direct declarations, five `PartUsage` elements, and four
`RequirementUsage` elements. It was not an r3 EngineeringProject execution and creates
no r3 project technical evidence or production-release claim.

## Implementation state and remaining gates

The reviewed vertical source slice now includes the registry entry, pure
capture/materializer, dedicated write-ahead journal, executor, queue gate, live
projector, and fake-client coverage. This does not release the capability or make a
provider claim. The remaining gates are:

1. Release and deploy the source-side `mcp-syson` structured-result correction required
   by the closed client contract; do not relax `HttpMcpToolClient` to parse JSON from
   text.
2. Let discovery reach an approved brief with the exact `payload-class` answer, then
   create the human-owned initial plan and execute r1/r2 under their existing gates.
3. Keep the passed disposable SysON parser conformance check as narrow provider
   compatibility evidence only. A later r3 project mutation still requires its own
   explicit authorization, exact r1/r2/discovery gates, durable capture, and read-back.
4. Only after r3 is durable, review a separate CAD-frame operation; do not smuggle CAD
   or CalculiX work into architecture authoring.

The first future physical loop remains deliberately narrow: a camera-carrying frame
design, one specified static load case, and a named mechanical criterion. Dynamic flight
simulation, BOM/cost, regulatory compliance, and an operational Digital Twin are later
operations with their own evidence contracts.
