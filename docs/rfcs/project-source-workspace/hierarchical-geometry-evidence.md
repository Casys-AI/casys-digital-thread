# Hierarchical geometry evidence

Status: proposed · not implemented

## Bounded evidence unit

Large products must not produce one root document containing every descendant part and
occurrence. The proposed `geometry-module-capture/1.0` evidence unit represents one
exact composite `PartDefinition` and only its immediate children.

Each capture records:

- the exact SysON structure capture reference and fingerprint;
- the exact target `PartDefinition`;
- exact admitted source-closure and placement-analysis references;
- one entry per immediate `PartUsage`, including its target definition, placement and
  exact child geometry reference;
- exact generated STEP and presentation assets;
- compiler and lowering profile identities;
- the predecessor capture for the same semantic target, when one exists.

A leaf definition capture records the same exact structure basis, target identity,
source provenance and assets without fabricating child entries.

## Thread lineage

The Engineering Thread preserves immutable evidence of the exact SysML structure and
the exact assets used at every level. A parent references exact child captures; it does
not copy their descendant manifests. Root evidence therefore grows with the root's
immediate children, not with the complete occurrence population.

An active lineage is selected by exact semantic target and explicit predecessor chain.
There is no global `latest`, label match, timestamp choice or digest-only join. Archived
families are not candidates for a current uniqueness check, but their immutable evidence
remains readable.

Two different `PartDefinition` targets remain distinct even if their geometry bytes are
identical. A newer capture supersedes only the same exact module target and never mutates
old evidence.

## Failure boundary

Missing structure, child geometry, placement, provenance or exact predecessor makes the
new capture `unavailable` or `unresolved` according to the registered contract. A parent
must not silently fall back to a similarly named or older child artifact.
