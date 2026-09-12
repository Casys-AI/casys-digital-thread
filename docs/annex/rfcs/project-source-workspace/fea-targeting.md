# FEA targeting in a product hierarchy

Status: proposed extension · assembly-level FEA not implemented

## Current semantic target

The existing part-oriented FEA path selects canonical geometry by exact
`PartDefinition` and asset identity. It must not select a STEP by digest alone, because
different definitions may legitimately produce byte-identical geometry.

A proof against reusable definition geometry is definition-level evidence. Reusing that
definition at several `PartUsage` occurrences does not manufacture separate
occurrence-level proofs.

## Occurrence-specific analysis

Loads or boundary conditions that depend on assembly placement require a future explicit
target contract containing:

- the exact SysON structure capture;
- the exact occurrence path of `PartUsage` identities;
- the exact hierarchical geometry captures on that path;
- the exact FEA source closure, method and admitted solver profile.

Names, display paths, array indexes and workspace modules cannot choose the occurrence.
An occurrence target that cannot be recrossed to the exact SysML basis is `unresolved`.

## Preservation and invalidation

A placement-only change does not by itself change an unchanged definition's local
geometry proof. It does change the consuming module evidence and may affect an
occurrence-specific or assembly load case. Cross-domain impact review determines what
can be preserved; matching digests do not decide it.

Contact, joint, multi-body, assembly-modal and other assembly-level solver capabilities
remain literally `unavailable` until a registered method, closed input contract,
qualified runtime and real proof exist. Product hierarchy alone must never imply solver
coverage.
