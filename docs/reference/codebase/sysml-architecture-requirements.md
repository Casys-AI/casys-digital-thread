# Reference: source map — SysML architecture and requirements

Audience: agent · Diátaxis: reference · Kind: contract

Census of renderer, agent-seal, seed, requirements, and part-definition files. Those
authorities are not interchangeable.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays on
[engineering domains](../domains/README.md).

## Source map

#### [`src/domain/architecture/`](../../../src/domain/architecture)

Architecture authorities: `renderer/` (`model.write-architecture@1` +
`sysml-source-capture/1.0`), `agent-seal/` (`model.seal-architecture-sysml@1` +
agent-authored CAS, never SysON), `seed/` (`architecture.seed-syson-model@2`),
`requirements/` (`model.write-requirements@1`), `part-definitions/`
(`model.capture-part-definitions@1`). `product-structure-ref.ts` owns exact
`ProductStructureElementRef` / `ProductStructureOccurrenceRef` (PartUsage path nonempty;
a PartDefinition is never an occurrence). Not interchangeable. Product
`architecture.author-inspection-drone@3` /
`model.capture-inspection-drone-part-definitions@1` are retired and unregistered

#### [`src/application/ports/in/product-navigation/`](../../../src/application/ports/in/product-navigation)

Read-only SysML-first product navigation port. MCP tools and the standalone
`/api/thread/product-navigation` query are thin consumers. The generic Workbench
snapshot does not embed this projection. Not a domain aggregate. Authoring attachments
and Thread evidence are distinct reads.

#### [`src/application/ports/out/product-navigation/`](../../../src/application/ports/out/product-navigation)

Outbound traversal plus two attachment readers: evidence (Thread/admission) and
authoring (ProjectSourceWorkspace heads). They are not substitutes.

#### [`src/application/use-cases/product-navigation/`](../../../src/application/use-cases/product-navigation)

Selects the unique Thread tip and unique `architecture-capture/4.0`, then queries a
disposable capture-keyed traversal index.

#### [`src/adapters/architecture/renderer/architecture-capture-structure.ts`](../../../src/adapters/architecture/renderer/architecture-capture-structure.ts)

Navigability of one exact `architecture-capture/4.0`: missing root, inexact target,
cycle, or unreachable definition. Navigation calls this before Graphology.
`reopenVerifiedArchitectureCapture` does not.

#### [`src/adapters/architecture/renderer/architecture-capture-navigation-index.ts`](../../../src/adapters/architecture/renderer/architecture-capture-navigation-index.ts)

Graphology traversal index for one exact architecture capture. Algorithmic, disposable.
Not product authority. Not imported into `src/domain`. `hasElement` matches an exact
`ProductStructureElementRef`. Search matches exact ids or normalized label/id tokens
without expanding the occurrence tree. Occurrences are a bounded page, not a full
materialization. The unique root is a `PartDefinition` element. Exposed by MCP tools and
the standalone product-navigation query, not the generic Workbench snapshot. The
existing SysML catalog view is not a second product tree.

#### [`src/adapters/architecture/renderer/capture-product-structure-traversal.ts`](../../../src/adapters/architecture/renderer/capture-product-structure-traversal.ts)

Reopens the unique `architecture-capture/4.0` tip, rejects a cyclic or unreachable
definition graph, then caches a bounded LRU of Graphology indexes by capture
fingerprint. Not a storage subsystem. Does not call `buildCatalog`.

#### [`src/adapters/thread/product-navigation-workbench.ts`](../../../src/adapters/thread/product-navigation-workbench.ts)

Shared catalog + admission/requirements/case recross used by inspect evidence. Evidence
attachments only. The standalone query is not a command surface and its projection is
not embedded in the generic Workbench snapshot.

#### [`src/adapters/project-source-workspace/product-navigation-authoring-attachment-reader.ts`](../../../src/adapters/project-source-workspace/product-navigation-authoring-attachment-reader.ts)

Outbound adapter: active workspace attachment heads for one exact SysML target. Shared
by MCP `project_product_inspect` and the standalone product-navigation query with
`view=authoring-attachments`. No evidence, no admission.

#### [`src/tools/project-control/product-navigation-tools.ts`](../../../src/tools/project-control/product-navigation-tools.ts)

Four closed MCP reads: `project_product_explore`, `project_product_search`,
`project_product_inspect`, `project_source_closure`. Grants none. The standalone
product-navigation query stays GET-only. The retired `project_product_navigation_*`
names are not aliases.

#### [`src/application/ports/in/architecture/`](../../../src/application/ports/in/architecture)

Inbound architecture ports split by authority: renderer brief-review ≠ agent-seal
capture/preview ≠ requirements brief-review

#### [`src/application/ports/out/architecture/`](../../../src/application/ports/out/architecture)

Outbound agent-seal readers: source-analysis reopen and seal-capture reopen

#### [`src/application/use-cases/architecture/`](../../../src/application/use-cases/architecture)

Renderer brief-architecture review, agent-seal SysML preview, requirements brief review

#### [`src/adapters/architecture/`](../../../src/adapters/architecture)

Architecture adapters by authority: `renderer/`, `agent-seal/`, `seed/`,
`requirements/`, `part-definitions/`. Not a flat `captures/` / `executors/` dump.
Retired product inspection-drone adapters are not present

#### [`src/domain/architecture/seed/syson-model-seed.ts`](../../../src/domain/architecture/seed/syson-model-seed.ts)

Closed r1-to-r2 SysON container identity capture and materializer

#### [`src/domain/architecture/seed/syson-model-seed-proposal.ts`](../../../src/domain/architecture/seed/syson-model-seed-proposal.ts)

Closed MRTR grammar for `architecture.seed-syson-model@2`: server-owned keys, pinned
`model.name` role, envelope digest. The executor does not consume these parameters

#### `deno task probe:constraint-solver --editing-context-id=<id> --element-id=<id>`

Read-only z3 diagnostic with explicit SysON context and element; no product default and
no publication

#### [`src/adapters/architecture/renderer/rendered-architecture-sysml-analyzer.ts`](../../../src/adapters/architecture/renderer/rendered-architecture-sysml-analyzer.ts)

Compiler companion for the bounded server-rendered SysML forms; consumes the typed
renderer manifest and never claims to parse arbitrary SysML

#### [`src/domain/architecture/agent-seal/architecture-sysml-lexical.ts`](../../../src/domain/architecture/agent-seal/architecture-sysml-lexical.ts)

Fail-closed tokenizer for the locked architecture SysML closed subset: package, part def
empty-or-block, and `part usage : Type;` only

#### [`src/domain/architecture/agent-seal/architecture-sysml-parse.ts`](../../../src/domain/architecture/agent-seal/architecture-sysml-parse.ts)

Pure parser of the three renderer write forms; extra constructs are first-class
`unresolved` and never omitted

#### [`src/adapters/architecture/agent-seal/qualified-architecture-sysml-analyzer.ts`](../../../src/adapters/architecture/agent-seal/qualified-architecture-sysml-analyzer.ts)

Parser-backed frontend `sysml-architecture-closed-subset-v1`; emits symbol ids and
structural incidences, never label bindings

#### [`src/adapters/architecture/agent-seal/architecture-sysml-source-analysis-capture.ts`](../../../src/adapters/architecture/agent-seal/architecture-sysml-source-analysis-capture.ts)

Agent-authored architecture SysML CAS capture distinct from `sysml-source-capture/1.0`
renderer envelopes

#### [`src/adapters/architecture/agent-seal/architecture-sysml-source-analysis-composition.ts`](../../../src/adapters/architecture/agent-seal/architecture-sysml-source-analysis-composition.ts)

Closed pairing of `sysml-architecture-closed-subset-v1` with its exact frontend and two
CAS stores

#### [`src/adapters/architecture/server-composition.ts`](../../../src/adapters/architecture/server-composition.ts)

Architecture foundation and project construction: renderer vs agent-seal stores stay
distinct; SysON write/seed/part-definitions are optional; requirements CAS is created
once for FEA, compile basis, and ROP. Returns explicit review/capture/executor
contributions, never ProjectControlToolDependencies.

#### [`src/application/ports/in/architecture/agent-seal/project-architecture-sysml-source-capture.ts`](../../../src/application/ports/in/architecture/agent-seal/project-architecture-sysml-source-capture.ts)

Inward capture port: profile id, source id and exact UTF-8 only

#### [`src/application/ports/in/architecture/agent-seal/project-architecture-sysml-preview.ts`](../../../src/application/ports/in/architecture/agent-seal/project-architecture-sysml-preview.ts)

Inward preview port: raw text or opaque capture reference; unresolved is always returned

#### [`src/application/ports/out/architecture/agent-seal/architecture-sysml-source-analysis-reader.ts`](../../../src/application/ports/out/architecture/agent-seal/architecture-sysml-source-analysis-reader.ts)

Outward reopen of a captured architecture SysML source and its analysis

#### [`src/application/ports/in/architecture/renderer/project-brief-architecture-review.ts`](../../../src/application/ports/in/architecture/renderer/project-brief-architecture-review.ts)

Inward brief-compilation port for architecture: package, system and typed component
rows, each citing the exact brief item that states it

#### [`src/application/use-cases/architecture/renderer/prepare-project-brief-architecture-review.ts`](../../../src/application/use-cases/architecture/renderer/prepare-project-brief-architecture-review.ts)

Reopens the human-approved canonical brief server-side and compiles
`model.write-architecture@1` parameters through the production grammar; read-only, calls
no SysON

#### [`src/application/ports/in/architecture/requirements/project-brief-requirements-review.ts`](../../../src/application/ports/in/architecture/requirements/project-brief-requirements-review.ts)

Inward brief-compilation port: typed criteria plus the exact brief item stating each
one; no brief bytes, parameter keys or unit policy from the caller

#### [`src/application/use-cases/architecture/requirements/prepare-project-brief-requirements-review.ts`](../../../src/application/use-cases/architecture/requirements/prepare-project-brief-requirements-review.ts)

Reopens the human-approved canonical brief server-side, checks each declaration's
provenance, and compiles `model.write-requirements@1` parameters through the production
grammar; read-only, no MRTR authority

#### [`src/application/use-cases/architecture/agent-seal/preview-project-architecture-sysml.ts`](../../../src/application/use-cases/architecture/agent-seal/preview-project-architecture-sysml.ts)

Provider-free preview; decision parameters exist only for a reopened passed capture

#### [`src/domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts`](../../../src/domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts)

Closed MRTR grammar for `model.seal-architecture-sysml@1`; signs exact CAS identities
only

#### [`src/adapters/architecture/agent-seal/model-seal-architecture-sysml-run-executor.ts`](../../../src/adapters/architecture/agent-seal/model-seal-architecture-sysml-run-executor.ts)

Provider-free sealer that writes a Thread document only; no SysON insertion and no
`compile.seal-admission@3` reuse

#### [`src/tools/project-control/architecture-sysml-tools.ts`](../../../src/tools/project-control/architecture-sysml-tools.ts)

MCP capture and preview tools for agent-authored architecture SysML

#### [`src/adapters/architecture/renderer/sysml-source-analysis-capture.ts`](../../../src/adapters/architecture/renderer/sysml-source-analysis-capture.ts)

Current bounded SysML source boundary: re-renders from reviewed proposal plus selector,
captures/readbacks exact bytes, captures manifest-attested local facts, and exposes a
read-only reopen port used by architecture, requirements, geometry and Product Structure

#### [`src/adapters/architecture/seed/syson-model-seed-run-executor.ts`](../../../src/adapters/architecture/seed/syson-model-seed-run-executor.ts)

Fixed SysON project/document/root-package seed executor

#### [`src/domain/architecture/renderer/architecture-proposal.ts`](../../../src/domain/architecture/renderer/architecture-proposal.ts)

Generic architecture proposal types, `planArchitectureInsertion`, and server-fixed SysML
renderer

#### [`src/domain/architecture/renderer/architecture-graph-ratchet.ts`](../../../src/domain/architecture/renderer/architecture-graph-ratchet.ts)

Predecessor / proposal / live SysML architecture ratchet over already-parsed
PartDefinition, PartUsage and AttributeUsage projections. Re-exports presence. No I/O.

#### [`src/domain/architecture/renderer/architecture-graph-delta.ts`](../../../src/domain/architecture/renderer/architecture-graph-delta.ts)

Closed architecture delta types, builders and sort. Package plus PartDefinition /
PartUsage / AttributeUsage.

#### [`src/domain/architecture/renderer/architecture-graph-selection.ts`](../../../src/domain/architecture/renderer/architecture-graph-selection.ts)

Rank-then-canonical-context failure selection. No graph vocabulary.

#### [`src/domain/architecture/renderer/architecture-proposal-presence.ts`](../../../src/domain/architecture/renderer/architecture-proposal-presence.ts)

Post-insertion proposal-label presence of PartDefinitions and PartUsages.

#### [`src/domain/architecture/renderer/architecture-thread-extension.ts`](../../../src/domain/architecture/renderer/architecture-thread-extension.ts)

Deterministic Thread extension for a sealed generic architecture capture. Construction
only; does not sort, rename or reconstruct provider identities.

#### [`src/adapters/architecture/renderer/architecture-structure-extractor.ts`](../../../src/adapters/architecture/renderer/architecture-structure-extractor.ts)

Reads SysON children to extract the architecture package structure

#### [`src/adapters/architecture/renderer/model-write-architecture-run-executor.ts`](../../../src/adapters/architecture/renderer/model-write-architecture-run-executor.ts)

Generic trusted executor for `model.write-architecture@1`

#### [`src/adapters/architecture/renderer/file-architecture-attempt-store.ts`](../../../src/adapters/architecture/renderer/file-architecture-attempt-store.ts)

Write-ahead no-blind-retry store for generic architecture insertions

#### [`src/adapters/architecture/renderer/product-structure-catalog.ts`](../../../src/adapters/architecture/renderer/product-structure-catalog.ts)

Generic projector reading current `architecture-capture/4.0` only: causal tip, PartUsage
occurrence hierarchy, exact seed/predecessor and source-analysis evidence; quantity is
one reviewed occurrence, never inferred BOM/provider multiplicity

#### [`src/domain/architecture/requirements/requirements-proposal.ts`](../../../src/domain/architecture/requirements/requirements-proposal.ts)

Generic integer scalar-requirements proposal grammar, target derivation, enrichment
plan, and fail-closed parser

#### [`src/adapters/extractors/syson-requirements-extractor.ts`](../../../src/adapters/extractors/syson-requirements-extractor.ts)

Re-extracts SysON constraints and verifies their exact metric, operator, threshold, and
unit

#### [`src/adapters/architecture/requirements/model-write-requirements-run-executor.ts`](../../../src/adapters/architecture/requirements/model-write-requirements-run-executor.ts)

Generic trusted executor for `model.write-requirements@1`

#### [`src/adapters/architecture/requirements/file-requirements-attempt-store.ts`](../../../src/adapters/architecture/requirements/file-requirements-attempt-store.ts)

Write-ahead no-blind-retry and quarantine state for generic requirements writes

#### [`src/adapters/architecture/seed/file-syson-model-seed-attempt-store.ts`](../../../src/adapters/architecture/seed/file-syson-model-seed-attempt-store.ts)

Write-ahead no-blind-retry state for non-idempotent SysON writes
