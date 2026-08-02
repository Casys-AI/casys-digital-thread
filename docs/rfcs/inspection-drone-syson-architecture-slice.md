# RFC: bounded inspection-drone SysON architecture slice

Status: **Proposed — no provider call or technical evidence has been made**\
Scope: the next reviewed V2 operation after `architecture.seed-syson-model@1`\
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

The proposed operation is `architecture.author-inspection-drone@1`. It may be queued
only after all of the following are true:

1. Its exact basis is the subject's r2 `ThreadSnapshot`, produced by
   `architecture.seed-syson-model@1`.
2. The r2 `sysml-model` artifact points to a re-readable, hash-valid
   `syson-model-seed-capture/1.0`; its project, editing-context, and root-package
   identities are the only provider coordinates used by the executor.
3. The same human-approved discovery unambiguously selects
   `primary-mission = inspection-controlled` **and**
   `payload-class = light-inspection-camera`. A recommendation alone is not enough.
4. A human has queued this exact run. The agent can prepare and execute it, but cannot
   approve the choice or queue it itself.
5. A read of the seed root package shows no direct children. A non-empty root is not a
   harmless collision: this narrowly scoped executor stops for review rather than
   merging with manual or future model content.

The current local discovery has the first answer, but not the second approved answer or
an approved brief. It therefore cannot reach this operation yet.

The registry entry should have `thread-snapshot` as its only queue basis and retain the
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
still partial surface, so the text remains a proposed conformance target until it has
been accepted and read back by the exact deployed SysON image. See the
[SysON textual-format documentation](https://doc.mbse-syson.org/syson/v2025.2.0/user-manual/features/import-export-textual.html).

## Server-owned call sequence

The proposed executor uses one write and three reads. The browser and the agent see only
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

## Proposed r3 capture boundary

Introduce a small pure domain materializer, for example
`src/domain/inspection-drone-architecture.ts`, and a matching content-addressed capture
store. Its normalized capture should contain only:

- operation identity/version, trusted run ID, and capture time;
- exact r2 seed artifact fingerprint and the normalized SysON project/document/root
  identities it authorizes;
- the canonical fragment's SHA-256 and fixed recipe version;
- normalized insertion acknowledgement (`inserted`, root parent ID, text SHA-256);
- normalized post-write architecture package identity and the expected named direct
  declarations;
- no raw GraphQL payload, request ID, credentials, agent text, or provider-only UI data.

The materializer then creates the r3 descendant with a `sysml-model` architecture
artifact that depends on the r2 container artifact. It may expose the named model
artifact and its source hash in the cockpit. It must leave canonical
`ThreadSnapshot.requirements`, evaluations, violations, observations, and proposed
actions empty: provider-side high-level requirements are model content, not a verified
digital-thread verdict.

## Test and mock recipe for review

The first implementation should be test-first with a `FakeSysonClient` implementing the
existing `McpToolClient` port. No test starts Docker or contacts a provider.

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

After the fake tests pass, run a **separately authorized disposable SysON conformance
test**. It creates a throwaway project/root, inserts this exact text once, and asserts
the package, five part definitions/usages, and four `RequirementUsage` elements from
read-back. It is intentionally not a normal test-suite step: it mutates a real provider
and is the only reliable answer to the current parser/translator uncertainty.

## Implementation order

1. Finish and deploy the source-side `mcp-syson` structured-result correction required
   by the r2 seed; do not relax `HttpMcpToolClient` to parse JSON from text.
2. Let discovery reach an approved brief with an explicit `payload-class` answer, then
   create the human-owned project/plan and execute r1/r2 under their existing gates.
3. Review this recipe and add the operation registry entry, pure capture/materializer,
   dedicated write-ahead journal, executor, live projector, and fake-client tests as one
   vertical slice.
4. Run the disposable SysON parser conformance check only with explicit authorization.
5. Only after r3 is durable, review a separate CAD-frame operation; do not smuggle CAD
   or CalculiX work into architecture authoring.

The first future physical loop remains deliberately narrow: a camera-carrying frame
design, one specified static load case, and a named mechanical criterion. Dynamic flight
simulation, BOM/cost, regulatory compliance, and an operational Digital Twin are later
operations with their own evidence contracts.
