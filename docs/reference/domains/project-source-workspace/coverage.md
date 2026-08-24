# Project source workspace — coverage

Audience: both · Diátaxis: reference · Kind: coverage

## Implemented in Vertical 1

- One independent workspace per Engineering Project, outside Project and Thread state.
- Stable module and file identities with derived logical paths.
- Exact append-only revisions, predecessor chains, tombstones, dependencies and mutation
  replay.
- Hash-chained `project-source-workspace-event/2.0` events: `previousEventFingerprint`
  is null at revision 1 and the exact prior event fingerprint thereafter. `/1.0` is not
  accepted.
- Exact `AgentResourceReference` reopening before a file revision is accepted.
- Revision-anchored snapshot, tree, search and file reads with bounded pagination.
- Fail-closed recovery for gaps, corruption, incomplete claims and concurrent writers.

This surface gives an agent a scalable project source tree. It does **not** make draft
bytes admitted product evidence.

## Current runtime proof

MCS-01 reached workspace revision 12 through the loopback MCP on 2026-08-24: eight
modules, three active files, exact tree/search/read, and one stable file advanced from
revision 1 to revision 2 while its two sibling revisions remained unchanged. The
workspace store is local runtime state; this result proves Vertical 1, not admission or
execution.

## Not implemented yet

| Vertical | Missing capability                                                                   | Why it remains separate                                                               |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 2        | Exact workspace file revision → registered technical capture → compilation admission | Parser/profile resolution and provenance belong to the server admission boundary      |
| 3        | MCS-01 CAD, FEA, Modelica and SPICE sources executed from workspace entries          | It is the first real-product proof of the bridge, not a workspace invariant           |
| 4        | Multi-file CAD bundle, placements and hierarchical assembly evidence                 | Large assemblies must stay modular and bounded; one flat product manifest is rejected |

Cross-file language imports, unlimited provider execution, and a mutable Workbench tree
are outside current coverage.

## Advancement rule

A vertical is covered only after its exact MCP path has run on MCS-01 and its stored
provenance can be reopened. Unit tests alone do not advance the coverage claim.
