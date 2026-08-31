# Reference: SysML coverage

Audience: both · Diátaxis: reference · Kind: scope

This page is the current Digital Thread surface, verified from this repository's
renderer, closed-subset parser, captures and registered operations. It does not claim
general SysML v2 support, nor the full native feature set of SysON.

## Surface implemented today

| Boundary               | What the Digital Thread actually admits or reads                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Seed                   | `architecture.seed-syson-model@2` creates one SysON project, empty document and root package, then seals normalized identities in `syson-model-seed-capture/2.0`. This is a container, not architecture.                                                                                                                                                     |
| Architecture proposal  | `model.write-architecture@1` accepts only human-approved flat string parameters: `architecture.package`, `system.name`, `component.<slug>.(name\|usage\|parent)` and `attribute.<slug>.(name\|parent)`. The server owns parsing and SysML text.                                                                                                              |
| Architecture renderer  | One package; one root `PartDefinition`; zero or more target `PartDefinition`s; typed `PartUsage` occurrences `part usage : Target;`; and bare `AttributeUsage` declarations `attribute name;`. Definitions and attributes use bounded textual insertion. Each usage is lowered natively as `PartUsage` plus `FeatureTyping`, then typed through code-owned AQL. |
| Architecture readback  | The adapter rereads the exact package, its `PartDefinition`s and one-level owned `PartUsage`/`AttributeUsage` children. It resolves each usage target through the pinned `FeatureTyping.type` AQL expression, then saves `architecture-capture/4.0` with sealed `scopeRoot` and `semanticRoot` ids.                                                          |
| PartDefinition capture | `model.capture-part-definitions@1` rereads only the identities sealed by the active generic architecture capture and publishes `part-definitions-capture/1.0`; it is not a live whole-model inventory.                                                                                                                                                       |
| Scalar requirements    | `model.write-requirements@1` writes native per-metric typed attributes, `require constraint`, a subject relation and qualified SI imports against one exact captured `PartDefinition`. Current thresholds are safe integers with `<=` or `>=` and a qualified unit; extraction must round-trip every metric, operator, value, unit and identity.             |
| Agent-authored source  | Profile `sysml-architecture-closed-subset-v1`. Public capture takes `profileId`, `sourceId`, and a full `resourceRef` from `project_resource_capture` (no `sourceText`). Preview takes that opaque `sourceRef` only. Tokens, one-form rule, and 262144-byte bound: [language](language.md). Documentary Thread only after `model.seal-architecture-sysml@1`. |

### Structural rules and ratchets

The renderer uses ASCII identifiers. Package and definition names start with a letter;
usage and attribute names start lower-case. It rejects unknown keys, duplicate usage
under one parent, duplicate attribute name in the proposal, missing parent,
self-parenting and component cycles.

Enrichment can adopt only an exact existing parent → usage → target triple. It adds
missing definitions, usages or attributes; it cannot silently repair a mistyped usage,
choose among duplicate labels, remove an edge or retype an occurrence.

Published architecture is monotone. The executor refuses disappearance of the generic
architecture artifact from an intact Thread lineage. On an architecture update it
requires exact inherited provider identities for PartDefinitions, PartUsages and
AttributeUsages. An inherited attribute may not disappear, move owner, change label or
be replaced under the same label; each newly observed attribute must correspond to one
reviewed proposal entry. This ratchet is evidence preservation, not a generic SysML
revision or deletion facility.

After an `architecture-capture/4.0` exists, its sealed Package scope is fixed: a
successor `model.write-architecture@1` proposal must retain that capture's
`packageName`. The executor refuses a different package name before acquiring a lease,
creating a WAL, or calling SysON; multi-package architecture is outside this registered
surface.

Named runtime proof: MCS-02 used `architecture-capture/4.0` to navigate eight separate
product definitions, attach exact CAD/Modelica/SPICE sources to three of them, and write
system plus RailFrame scalar requirements. See
[MCS-02 SysML](../../../project-dossiers/motorized-camera-slider-mcs02/domains/sysml.md). This
does not add placements, ports, flows or behavioral SysML to the covered grammar.

PS-01 added a second runtime proof on 2026-08-25. SysON accepted the package and six
component definitions from textual insertion but omitted all six usage statements. The
renderer created the six native `PartUsage`/`FeatureTyping` pairs, set their exact target
definitions and reread them before publishing Thread r3. Product navigation and the
Workbench then exposed one root plus six typed occurrences. This proves the bounded
native lowerer; it does not widen the accepted proposal language.

Thread r4 then exercised monotone enrichment on those inherited identities: nine
reviewed `AttributeUsage` handles were added without replacing a definition or usage.
The compiler subsequently resolved the exact CAD, Modelica and SPICE `parameterizes`
joins from those handles. This proves the existing enrichment and join surface; it does
not add ports, flows, placements or behavioral SysML.

## Two source authorities, not one

Comparison, distinct identities, and writer lookalikes: [paths](paths.md). Closed-subset
tokens, one-form rule, and resource ingress: [language](language.md).

The closed-subset parser records other tokenizable constructs as `unresolved`; a preview
with such constructs is not `ready-for-review`. A captured source can be sealed only
when the fixed analysis policy passes, but this never turns it into SysON authority.
`architecture-sysml-source-analysis-capture/1.0` and the renderer's
`sysml-source-capture/1.0` are distinct envelopes.

## SysON native API versus our adapter

The configured provider advertises a wider inventory, but this repository composes a
fixed subset of calls. For architecture it uses only structure reads, the pinned AQL
typing query and controlled SysML insertion; seed, PartDefinition capture and
requirements use their own fixed call subsets. The browser has no direct provider
access, and an agent cannot choose native tool names, AQL, UUIDs, endpoints or raw
payloads.

Consequently, a SysON feature visible in its UI or native API is not evidence that the
Digital Thread can create, preserve, capture or recover it. Exact call names, response
validators, WAL/recovery and the complete configured subset are maintained in the
[SysON provider reference](../../providers/syson/README.md), especially its
[modelling surface](../../providers/syson/modeling-surface.md) and
[authority/runtime boundary](../../providers/syson/authority-and-runtime.md).

## Explicitly outside the current surface

- Arbitrary SysML text, arbitrary SysON tool calls, provider arguments, AQL, IDs,
  endpoints or retry instructions supplied by an agent.
- Ports, interfaces, item/flow/connection usages, allocations, multiplicity,
  inheritance, redefinition/subsetting, behaviors, actions, activities, states,
  interactions, views, diagrams, stereotypes and arbitrary annotations.
- Typed or valued architecture attributes, literals, dimensions, quantities,
  expressions, equations or value-flow semantics. The bare architecture `AttributeUsage`
  is a structural handle only. Probe 2026-08-21
  (`scripts/probes/probe-architecture-attribute-value.ts`) inserted
  `attribute probeHandle : LengthValue = 1 [mm];`: type reread `LengthValue`; value
  reread `OperatorExpression` without a scalar or unit (`unresolved`).
- Arbitrary requirement grammar or decimal thresholds; the current requirements writer
  is a separate, bounded integer scalar path.
- Delete, move, rename, retype or merge of an existing generic architecture construct;
  neither enrichment nor a replay is a repair API.
- Treating a source seal, SysON model, requirement capture or successful provider write
  as simulation evidence, a measurement, a compliance claim or an engineering verdict.
- Product-specific SysML recipes. `architecture.author-inspection-drone@3` and
  `model.capture-inspection-drone-part-definitions@1` are retired and unregistered.
  Generic SysML uses `model.write-architecture@1` or `model.seal-architecture-sysml@1`.

## Extension candidates, not commitments

The following name a possible _class_ of future bounded concepts. None is enabled by
native SysON capability, an extra JSON field or a successful experiment:

| Candidate                                                | Contract that would have to exist first                                                                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed/value-bearing attributes                           | A closed value/type/unit grammar, exact round-trip extraction, a semantic meaning and an identity-preserving migration/ratchet policy.                                                        |
| Additional structural relations                          | A finite IR and renderer/parser form for one relation family, exact ownership/typing readback and unambiguous adoption semantics.                                                             |
| Requirement vocabulary beyond integer scalar constraints | A closed proposal and native lowering/extraction contract, including value representation, units and change/replacement recovery.                                                             |
| Richer agent-authored SysML                              | A new versioned closed profile with lexical/parser/analysis semantics and documentary limits; it must remain distinct from renderer authority unless a separate write operation is qualified. |
| Controlled architecture correction                       | A dedicated reviewed operation with preconditions, mutation/recovery rules and proof that prior evidence is not silently rewritten.                                                           |

Use the [extension runbook](../../../how-to/extend/extend-generic-sysml-surface.md) before treating any
candidate as a product surface.
