# SysML product-structure projection

Status: exact roots, bounded read-side navigation and versioned authoring attachments
are implemented and runtime-proven on MCS-02. Multi-piece CAD/module builds and
hierarchical assembly evidence remain proposed.

## Sole authority

The exact SysML model stored in SysON is the sole authority for:

- `PartDefinition` identity;
- `PartUsage` identity;
- definition reuse by usages;
- ownership and containment hierarchy;
- the definition targeted by each usage.

The exact SysON capture sealed into the Engineering Thread fixes the structure basis for
one review or build. Source modules, filenames, CAD manifests, geometry assets and UI
trees cannot add, delete, move or retarget any of those elements.

## Exact roots

`architecture-capture/3.0` is insufficient for this projection because it records a
`systemName` and makes readers rediscover the product root by matching a
`PartDefinition.label`. The unique active capture is `architecture-capture/4.0`, with
two distinct exact references:

- `scopeRoot`: `{ id, kind: "Package", label? }` — compilation Package identity;
- `semanticRoot`: `{ id, kind: "PartDefinition", label? }` — product-structure root.

Each reference carries exact `id` and literal `kind`. Labels remain display text only.
`packageName`/`systemName` stay write/display context and are never read authority. The
parser requires exact keys, non-empty ids, `scopeRoot` corresponding to the attested
Package, and `semanticRoot` present exactly once among `partDefinitions`. Navigation,
catalog projection and source attachments consume `semanticRoot.id`. Compilation
consumes `scopeRoot.id`. Readers never repeat a name or topology lookup.

Version 3 captures are refused. There is no dual parser, alias, automatic migration, or
label/topology/`latest` fallback. Historical CAS bytes are left untouched; old projects
become `unavailable`. A new exact capture is required.

## Derived server view

One application read-side product-navigation service derives its answers from one exact
sealed SysON capture. For bounded joins, its read model may contain definition nodes,
usage nodes, exact owner and target links, immediate-child indexes, reverse parent
indexes and occurrence paths.

The service offers four composable reads:

- `project_product_explore` — unique root `PartDefinition` **element**, then bounded
  immediate `PartUsage` children / continue from one exact occurrence;
- `project_product_search` — exact-id or token discovery of exact element refs;
- `project_product_inspect` — one exact element or occurrence, definition-scoped
  Thread evidence, element-level authoring heads, ready/blocked actions;
- `project_source_closure` — technical DAG only after an exact attached source is
  selected.

A PartUsage occurrence path is nonempty and ends in its usage id. The root is never an
empty-path occurrence. Lean MCP controls expose these reads to the engineering agent.
Workbench GET/SSE exposes the same semantics to the UI. Neither adapter owns traversal
rules or a separate read model.

This projection is rebuildable, cacheable and disposable. Its only semantic identities
are the exact SysML element identities from its capture basis. A cache key includes the
exact SysON capture reference or fingerprint; it never uses a project label, timestamp
or implicit `latest`.

Every response publishes its exact sealed SysON basis. Reads that include source closure
also publish the exact workspace revision and closure basis. Callers cannot select a
provider, runtime, parser or lowering profile through this navigation surface.

Deleting or rebuilding the projection cannot change product truth. A projection that
cannot be reproduced from its exact capture is `unavailable` and must not be repaired
from CAD labels or workspace layout.

## Traversal index

Native SysON traversal APIs are the first choice. If they cannot provide bounded
immediate-child traversal, reverse indexes or occurrence paths efficiently, a read-side
adapter may derive a Graphology index from the exact sealed SysON capture.

The Graphology index is keyed by that exact capture and contains only derived identities
and edges. It is rebuildable, cacheable and disposable; it is never a domain object or
product authority, never merged back into SysON and never repaired from workspace files
or evidence labels. Deleting it must leave no product state to recover.

## Semantic navigation and attachments

Product and source navigation starts at the semantic-root `PartDefinition` representing
the system, any exact `PartDefinition`, or any exact `PartUsage` node in this
projection. From that node, server joins expose exact attachments for:

- workspace source roots and their revision bases;
- canonical geometry evidence;
- physics and solver evidence;
- evaluations and verdict evidence.

Attachments do not become structure edges. Each keeps its own exact provenance and
contract state. Selecting a source attachment may then open its workspace dependency
closure for imports or includes; the workspace DAG never navigates the product.

## Module scopes

A composite definition's build scope is derived as that exact `PartDefinition` plus its
immediate `PartUsage` children. A child usage targets another exact definition, which
may itself have an independently derived scope. This recursion permits nested assemblies
without flattening every descendant at the root.

An occurrence path is a derived sequence of exact `PartUsage` identities used for
navigation and occurrence-specific targeting. It is not a second mutable identity and
must be recomputed when the exact SysON basis changes.

MCS-02 proves navigation across eight separate SysML definitions and exact source
attachments. Its only canonical geometry is the RailFrame part. That is not evidence
that placements, a multi-piece CAD assembly or hierarchical geometry publication are
implemented.
