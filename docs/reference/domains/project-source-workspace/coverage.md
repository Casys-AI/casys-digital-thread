# Project source workspace — coverage

Audience: both · Diátaxis: reference · Kind: coverage

## Implemented in Vertical 1 and Vertical 2

- One independent workspace per Engineering Project, outside Project and Thread state.
- Stable module and file identities with derived logical paths.
- Exact append-only revisions, predecessor chains, tombstones, dependencies and mutation
  replay.
- Hash-chained `project-source-workspace-event/4.0` writes: `previousEventFingerprint`
  is null at revision 1 and the exact prior event fingerprint thereafter. V3 is
  temporary replay-only history for pre-recross events; V3 writes and V3
  `attachment_recross` are refused. `/2.0` and `/1.0` are refused.
- Versioned authoring attachments (`fileId` → exact SysML element) with put, detach,
  exact read and bounded list. Replay never contacts SysON, Graphology, or the role
  catalog.
- Product-navigation authoring-attachment page from an exact SysML element: MCP
  `project_product_inspect` and Workbench GET `view=authoring-attachments`. Distinct
  from Thread/admission evidence. MCS-02 proved the earlier authoring-attachment read
  against active attachments on both their declared bases and a descendant Thread basis;
  the public tool is now `project_product_inspect`.
- Exact `AgentResourceReference` reopening before a file revision is accepted.
- Revision-anchored snapshot, tree, search and file reads with bounded pagination.
- Fail-closed recovery for gaps, corruption, incomplete claims and concurrent writers.

This surface gives an agent a scalable project source tree. It does **not** make draft
bytes admitted product evidence.

Vertical 2 is the only public technical-source authority for CAD, Modelica and SPICE:
`project_technical_source_capture` names `projectId`, `workspaceRevision`,
`attachmentId` and `attachmentRevision`. The server resolves the active attachment head,
root file, `captureRequest.profileId` against the registered technical-source catalogue,
persists a private `project-source-closure/1.0` plus
`technical-source-analysis-capture/4.0` document, and returns only
`technical-source-analysis-capture-locator/4.0`. Preview, MRTR,
`compile.seal-admission@3`, admission read and reopen recross the exact attachment and
closure at that historical workspace revision. Preview and admission bundles require one
common workspace basis: the same `projectId`, `workspaceRevision` and
`workspaceEventFingerprint`. A multi-file closure may capture; preview and executable
admission stay `unresolved` / `source.dependency-lowering-unavailable` until
language-specific deterministic lowering exists. A later sibling or head bump does not
invalidate a sealed historical locator. Corrections return only through `AgentResource`
plus a successor file revision.

## Current runtime proof

MCS-02 reached workspace r16 through the loopback MCP on 2026-08-25. Event fingerprint
`7a6352a1a22df54900d00bf0500f1fe88f227752ad7084f37fac7f3f07387757` seals five modules,
four active files and three active attachments. RailFrame kept its stable attachment
identity while its file advanced r1 → r2 and the attachment advanced r1 → r2. Modelica
and SPICE kept stable files while their attachment chains advanced to exact later Thread
bases.

Attachment-rooted v3 captures and `compile.seal-admission@3` produced the CAD, Modelica
and SPICE admissions at Thread r4–r6. The exact CAD admission produced the canonical
RailFrame geometry at r7. The downstream part-level FEA branch reached L5 at r12;
admitted Modelica motion reached L5 at r16; admitted SPICE current reached L5 at r20.
This is a real single-root bridge proof, not a complete assembly claim.

At Thread r20 the historical RailFrame attachment r1 remains observable as
`different-basis`; its closure drill-down returns `unavailable / basis.stale`, while the
already sealed admission remains historical evidence. The live recovery created
attachment successor r2 against the exact unchanged r20 architecture basis. Inspect then
returned `exact-basis`, and `project_source_closure` returned `observed` for one exact
CAD file, zero edges and closure fingerprint
`ad9c55638cb0d4003011bc059269456ce3e6750629ed11acbdeeb223fb0e51c6`.

PS-01 exercised the scalable path on 2026-08-25 through workspace r31: 8 modules, 6
active files, 6 active attachments and one five-file/five-edge verification closure.
Stable CAD, Modelica, SPICE and verification files advanced independently through
successor revisions. Architecture r4 resolved the nine exact SysML parameter joins.
Attachment-rooted, single-root SPICE and Modelica sources were admitted and executed at
Thread r5–r8; the single-root Frame CAD source was admitted at r9 and published
canonical PartDefinition geometry at r10. The separate Diverter multi-file CAD closure
stays explicitly `source.dependency-lowering-unavailable`. See
[PS-01 source workspace](../../../project-dossiers/desktop-parts-sorter-ps01/domains/source-workspace.md).

MSM01 exercised the product-navigation and immediate-module path on 2026-08-26. Its
workspace contains five active files and six active authoring attachments: three CAD
roots attach to their exact `PartDefinition`s, while one placement source attaches to
each of the three immediate `PartUsage`s. Through the MCP, the root, occurrences, source
tree, exact attachments and file revisions were navigated without loading a flat product
manifest. The SensorCradle source retained its stable file identity while its multi-file
revision advanced independently; its sibling CAD files did not change.

The first three CAD roots deliberately used a shared-dimensions dependency. Their
two-file/one-edge closures were navigable and were captured exactly, but compilation and
admission remained literally `unresolved /
source.dependency-lowering-unavailable`: a
workspace closure is not yet a Build123d import environment. Those historical revisions
remain readable. Separate root-only successor revisions for BasePlate, Riser and
SensorCradle were then admitted and sealed as three canonical PartDefinition geometries.
Before exporting their parent module, the current architecture required
`model.capture-part-definitions@1`; without that exact part-definitions capture the
module draft remained `unavailable`.

With the exact placement capture and child geometries reopened, MSM01 exported and
sealed one ModularSensorMount module STEP and GLB. Its separate assembly-integrity
branch reached L3 observation, L4 evaluation and L5 closeout as `pass`, limited to the
exact static basis: child import, immediate occurrence coverage, captured placements,
BRep reopening and the observer's intersection result. It does **not** evaluate joints,
clearance, motion, loads, fabricability or safety. That is a real module and provenance
proof, not a claim that arbitrary multi-file Build123d or mechanism analysis is
supported. See the compact
[MSM01 workspace dossier](../../../project-dossiers/modular-sensor-mount-msm01/domains/workspace.md)
for the exact observed files, attachments and literal lowering boundary.

## Not implemented yet

| Missing capability                                                                      | Why it remains separate                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic language-specific lowering for non-trivial multi-file executable closures | The workspace can seal and navigate the exact closure, but a compiler must explicitly lower every executable dependency; MSM01's shared-dimensions Build123d roots remain `source.dependency-lowering-unavailable` until that capability exists |
| Nested module promotion, incremental ancestor rebuild and unbounded assemblies          | MSM01 proves one immediate module only; these need exact child-module consumption and reverse impact beyond the bounded current export                                                                                                          |
| Assembly-level FEA targeting                                                            | The proven CalculiX `@3` branch is a single-part static proof downstream of canonical STEP                                                                                                                                                      |

Cross-file language imports, unlimited provider execution, and a mutable Workbench tree
are outside current coverage.

## Advancement rule

A vertical is covered only after its exact MCP path has run on a named current-contract
project and its stored provenance can be reopened. Unit tests alone do not advance the
coverage claim.
