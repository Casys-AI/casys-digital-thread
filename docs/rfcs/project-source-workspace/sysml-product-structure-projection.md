# SysML product-structure projection

Status: proposed · not implemented

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

## Derived server view

For bounded joins, the server may derive a read model from one exact SysON capture. It
may contain definition nodes, usage nodes, exact owner and target links, immediate-child
indexes, reverse parent indexes and occurrence paths.

This projection is rebuildable, cacheable and disposable. Its only semantic identities
are the exact SysML element identities from its capture basis. A cache key includes the
exact SysON capture reference or fingerprint; it never uses a project label, timestamp
or implicit `latest`.

Deleting or rebuilding the projection cannot change product truth. A projection that
cannot be reproduced from its exact capture is `unavailable` and must not be repaired
from CAD labels or workspace layout.

## Traversal index

Native SysON traversal APIs are the first choice. If they cannot provide bounded
immediate-child traversal, reverse indexes or occurrence paths efficiently, the server
may derive a Graphology index from the exact SysON capture.

The Graphology index is keyed by that exact capture and contains only derived identities
and edges. It is rebuildable, cacheable and disposable; it is never product authority,
never merged back into SysON and never repaired from workspace files or evidence labels.
Deleting it must leave no product state to recover.

## Semantic navigation and attachments

Product and source navigation starts at an exact `System`, `PartUsage` or
`PartDefinition` node in this projection. From that node, server joins expose exact
attachments for:

- workspace source roots and their revision bases;
- canonical geometry evidence;
- physics and solver evidence;
- evaluations and verdict evidence.

Attachments do not become structure edges. Each keeps its own exact provenance and
contract state. Selecting a source attachment may then open its workspace dependency
closure for imports or includes; the workspace DAG never navigates the product.

## Module scopes

A composite definition's build scope is derived as that exact `PartDefinition` plus its
immediate `PartUsage` children. A child usage targets another exact definition, which may
itself have an independently derived scope. This recursion permits nested assemblies
without flattening every descendant at the root.

An occurrence path is a derived sequence of exact `PartUsage` identities used for
navigation and occurrence-specific targeting. It is not a second mutable identity and
must be recomputed when the exact SysON basis changes.
