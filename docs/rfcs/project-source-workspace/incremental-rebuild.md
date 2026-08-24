# Incremental rebuild

Status: proposed · not implemented

## Derived impact, not new authority

Rebuild impact is derived from two exact inputs:

1. the `ProjectSourceWorkspace` dependency DAG at one exact revision;
2. the product-structure projection from one exact SysON capture.

The resulting reverse indexes and build plan are cacheable and disposable. They do not
become a second source tree or product model.

## Build identities

A definition build identity includes the exact structure basis, target
`PartDefinition`, admitted source-closure fingerprint and registered compiler profile.
A composite module build identity additionally includes the exact placement input and
the exact immediate-child geometry capture fingerprints.

Changing any input creates a successor candidate. Matching output bytes do not erase the
new provenance and do not merge different semantic targets.

## Impact rules

- A leaf source revision invalidates its dependent source closure, that definition build
  and the chain of ancestor module builds that consume it.
- An immediate placement change invalidates that composite module and its ancestors, but
  not an unchanged reusable child definition build.
- A SysML ownership, usage-target or reuse change is computed by diffing projections
  derived from the two exact SysON captures.
- An unrelated sibling definition and its evidence remain reusable when all exact build
  inputs are unchanged.

The server emits a bounded proposed plan with exact reasons and bases. It must not start
consequential builds, choose a correction or self-approve a review. Existing registered
decision and YOLO delegation rules still apply.

Until every affected successor is sealed, the new product basis must expose the missing
result literally as `unavailable` or `unresolved`. Previous evidence remains immutable
and readable with its older basis; it is not relabelled as current.

## Scale boundary

Planning may traverse server-side indexes, but agent and Workbench responses remain
bounded and paginated. The signed or delegated review names an exact plan artifact and a
small summary rather than a caller-authored flat list of thousands of operations.
