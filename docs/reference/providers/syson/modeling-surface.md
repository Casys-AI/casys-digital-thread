# SysON modelling surface

Audience: both · Diátaxis: reference · Kind: provider contract

Digital Thread currently uses SysON for one empty model-container seed, one narrow
generic architecture language, exact structure readback and scalar requirements. This is
not general SysML v2 authoring.

Source contracts:

- [`syson-model-seed.ts`](../../../../src/domain/architecture/seed/syson-model-seed.ts)
- [`architecture-proposal.ts`](../../../../src/domain/architecture/renderer/architecture-proposal.ts)
- [`requirements-proposal.ts`](../../../../src/domain/architecture/requirements/requirements-proposal.ts)
- [`architecture-structure-extractor.ts`](../../../../src/adapters/architecture/renderer/architecture-structure-extractor.ts)

## Model container

`architecture.seed-syson-model@2` creates a SysON project, an empty SysML document and
one root package, then reads the root back. Its `syson-model-seed-capture/2.0` retains
only the normalized project, document and root-package identities.

The seed proves an editable container exists. It does not prove architecture,
requirements, geometry, simulation, measurement or a verdict. It must follow the exact
documentary baseline through an additive project change.

## Generic architecture renderer

`model.write-architecture@1` consumes human-signed flat decision parameters. The server
parses them, renders deterministic SysML, persists and reopens its own source manifest,
then inserts those bytes into the exact seeded model. The caller never supplies SysML
text or provider identifiers.

| Construct        | Current surface                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| `Package`        | Exactly one reviewed package name                                                |
| System type      | Exactly one root `PartDefinition`                                                |
| Component type   | Zero or more `PartDefinition` names; repeated occurrences may share one type     |
| Occurrence       | Zero or more `PartUsage` edges `part usageName : PartDefinition;`                |
| Parameter handle | Zero or more bare `AttributeUsage` declarations `attribute name;`, without value |

Names are ASCII SysML identifiers. Usage and attribute names begin with a lower-case
letter. Each occurrence has one parent definition and one target definition; parents
must exist, self-parenting and cycles are rejected, and `(parent, usageName)` is unique.
Attribute names are currently unique across the whole proposal, not merely within one
parent.

Initial mode inserts the package, definitions and attributes through bounded textual
statements. Typed occurrences use a native lowering: the adapter creates `PartUsage`
and `FeatureTyping`, resolves the reviewed target definition's semantic identity through
code-owned AQL, sets `FeatureTyping.type`, then rereads the exact triple. Enrichment
mode adopts exact existing parent→usage→target triples and adds missing definitions,
usages or attributes.
Mistyped or ambiguous usages fail closed. An old structural edge cannot disappear
through this operation; removal or retyping requires another reviewed authority that is
not currently generic.

No port, interface, item or flow, connection, allocation, multiplicity, inheritance,
state, activity, action, view, diagram, stereotype, typed attribute value or arbitrary
SysML statement belongs to this renderer surface.

After insertion the server reopens the package, definitions and features. `PartUsage`
typing is resolved through one code-owned AQL expression over `FeatureTyping.type`, not
from labels. The resulting `architecture-capture/4.0` and Thread artifact record the
provider identities and the reviewed graph.

The native usage writer owns provider tool names, child types, semantic-id queries and
AQL. A caller still supplies only the reviewed architecture parameters. Any failure
after an acknowledged native write is quarantined in the architecture WAL; it is not
blindly retried.

### AttributeUsage ratchet

`AttributeUsage` is part of the same monotone authority boundary as definitions and
occurrences. Every inherited attribute must survive with its exact provider identity,
label and owning `PartDefinition`; every new attribute must correspond bijectively to a
reviewed proposal entry. An out-of-band addition, removal, move or same-label identity
replacement therefore refuses promotion and completed replay applies the same check.

The guard is implemented in
[`model-write-architecture-run-executor.ts`](../../../../src/adapters/architecture/renderer/model-write-architecture-run-executor.ts),
while the exact capture shape is defined in
[`architecture-capture.ts`](../../../../src/adapters/architecture/renderer/architecture-capture.ts).

## Exact PartDefinition capture

`model.capture-part-definitions@1` does not search the whole provider model. It reopens
the exact active generic architecture capture, rereads only its sealed `PartDefinition`
identities and their one-level `PartUsage`→target and `AttributeUsage` children, then
publishes `part-definitions-capture/1.0`.

Sibling definitions added after the architecture capture are intentionally invisible.
This is a bounded product-structure bundle, not a live SysON inventory, quantity model,
CAD model or verdict.

## Requirements writer

`model.write-requirements@1` targets one exact architecture `PartDefinition`. The server
derives a native RequirementUsage name `${containerComponent}Requirements` and renders:

- one typed `AttributeUsage` per metric;
- one `require constraint` per metric;
- one `subject target : PartDefinition` relation;
- `private import SI::*` for the qualified unit types.

Each requirement has a display name, unique metric identifier, `<=` or `>=`, a safe
integer threshold and one qualified unit. The server re-extracts the native constraints
and requires exact metric, operator, value, unit and provider identity before publishing
`requirements-capture/3.0`.

Requirements enrichment is monotone by metric: identical entries are adopted, new
metrics may be added, but a changed threshold/operator/unit or a missing prior metric is
refused. Provider replacement uses delete-then-reinsert behind a dedicated WAL; an
uncertain partial outcome is quarantined rather than retried blindly.

## Provider-free SysML is a different path

`model.seal-architecture-sysml@1` accepts captured agent-authored text under
`sysml-architecture-closed-subset-v1`, but publishes only a Thread document. It never
calls SysON and cannot become a substitute for the renderer above.

That source frontend recognizes one package of part definitions, one part definition, or
one part usage. Comments, strings, numbers and attributes are lexically rejected; other
tokenizable constructs remain explicit `unresolved`. The current analyzer can still
report policy `passed` while unresolved constructs are present, so a seal may retain
them as documentary evidence. They never acquire SysON or compilation authority.

Operational guide:
[author and seal architecture SysML](../../../how-to/compile/author-architecture-sysml.md).
