# Project source workspace — coverage

Audience: both · Diátaxis: reference · Kind: coverage

## Implemented in Vertical 1 and Vertical 2

- One independent workspace per Engineering Project, outside Project and Thread state.
- Stable module and file identities with derived logical paths.
- Exact append-only revisions, predecessor chains, tombstones, dependencies and mutation
  replay.
- Hash-chained `project-source-workspace-event/3.0` events: `previousEventFingerprint`
  is null at revision 1 and the exact prior event fingerprint thereafter. `/2.0` and
  `/1.0` are not accepted.
- Versioned authoring attachments (`fileId` → exact SysML element) with put, detach,
  exact read and bounded list. Replay never contacts SysON, Graphology, or the role
  catalog.
- Product-navigation authoring-attachment page from an exact SysML node: MCP
  `project_product_navigation_authoring_attachments` and Workbench GET
  `view=authoring-attachments`. Distinct from Thread/admission evidence. Causal tests
  only; MCS-01 proof is still pending.
- Exact `AgentResourceReference` reopening before a file revision is accepted.
- Revision-anchored snapshot, tree, search and file reads with bounded pagination.
- Fail-closed recovery for gaps, corruption, incomplete claims and concurrent writers.

This surface gives an agent a scalable project source tree. It does **not** make draft
bytes admitted product evidence.

Vertical 2 is the only public technical-source authority for CAD, Modelica and SPICE:
`project_technical_source_capture` names `projectId`, `workspaceRevision`, `attachmentId`
and `attachmentRevision`. The server resolves the active attachment head, root file,
`captureRequest.profileId` and role against the registered catalogues, persists a
private `project-source-closure/1.0` plus `technical-source-analysis-capture/3.0`
document, and returns only `technical-source-analysis-capture-locator/3.0`. Preview,
MRTR, `compile.seal-admission@3`, admission read and reopen recross the exact attachment
and closure at that historical workspace revision. Preview and admission bundles require
one common workspace basis: the same `projectId`, `workspaceRevision` and
`workspaceEventFingerprint`. A multi-file closure may capture; preview and executable
admission stay `unresolved` / `source.dependency-lowering-unavailable` until
language-specific deterministic lowering exists. A later sibling or head bump does not
invalidate a sealed historical locator. Corrections return only through `AgentResource`
plus a successor file revision.

## Current runtime proof

MCS-01 reached workspace revision 12 through the loopback MCP on 2026-08-24: eight
modules, three active files, exact tree/search/read, and one stable file advanced from
revision 1 to revision 2 while its two sibling revisions remained unchanged. The
workspace store is local runtime state; this result proves Vertical 1, not admission or
execution.

## Not implemented yet

| Vertical | Missing capability                                                                                                 | Why it remains separate                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3        | MCS-01 CAD, FEA, Modelica and SPICE sources executed from workspace entries                                        | It is the first real-product proof of the bridge, not a workspace invariant                                                                                  |
| 3b       | MCS-01 proof of attachment-rooted capture, closure CAS and product-navigation authoring reads | Authoring heads and `project_product_source_closure` are attachment-rooted. Capture/admission recross the sealed closure. MCS-01 has not yet walked that MCP path. |
| 4        | Multi-file CAD bundle, placements and hierarchical assembly evidence                                               | Large assemblies must stay modular and bounded; one flat product manifest is rejected                                                                        |

Cross-file language imports, unlimited provider execution, and a mutable Workbench tree
are outside current coverage.

## Advancement rule

A vertical is covered only after its exact MCP path has run on MCS-01 and its stored
provenance can be reopened. Unit tests alone do not advance the coverage claim.
