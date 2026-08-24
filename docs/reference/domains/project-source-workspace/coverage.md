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
  `view=authoring-attachments`. Distinct from Thread/admission evidence. MCS-02 proved
  the MCP read against active attachments on both their declared bases and a descendant
  Thread basis.
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

MCS-02 reached workspace r15 through the loopback MCP on 2026-08-25. Event fingerprint
`0cb8b448174c7bb18af9584d7a2b03a1af1dc23219437f118dcc892252806092`
seals five modules, four active files and three active attachments. RailFrame kept its
attachment while its file advanced r1 → r2. Modelica and SPICE kept stable files while
their attachment chains advanced to exact later Thread bases.

Attachment-rooted v3 captures and `compile.seal-admission@3` produced the CAD,
Modelica and SPICE admissions at Thread r4–r6. The exact CAD admission produced the
canonical RailFrame geometry at r7. The downstream part-level FEA branch reached L5 at
r12; admitted Modelica motion reached L5 at r16; admitted SPICE current reached L5 at
r20. This is a real single-root bridge proof, not a complete assembly claim.

At Thread r20 the active RailFrame attachment is still observable with
`basisStatus: different-basis`. A closure drill-down against that historical attachment
is currently `unavailable`; the already sealed admission remains historical evidence.

## Not implemented yet

| Missing capability | Why it remains separate |
| ------------------ | ----------------------- |
| Deterministic language-specific lowering for non-trivial multi-file closures | The workspace can seal the exact closure, but a compiler must explicitly lower every executable dependency; it may not drop files |
| Multi-file CAD bundles and typed placements | MCS-02 produced one canonical RailFrame part only |
| Hierarchical assembly evidence and incremental rebuild | These require exact child-module consumption and reverse impact, not a flat product manifest |
| Assembly-level FEA targeting | The proven CalculiX `@3` branch is a single-part static proof downstream of canonical STEP |

Cross-file language imports, unlimited provider execution, and a mutable Workbench tree
are outside current coverage.

## Advancement rule

A vertical is covered only after its exact MCP path has run on a named current-contract
project and its stored provenance can be reopened. Unit tests alone do not advance the
coverage claim.
