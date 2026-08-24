# Large-assembly implementation plan

Status: in progress · Phase A is implemented in code and causal tests · real MCP/runtime
proof on the proving vehicle and phases B-G remain pending

The plan extends the existing workspace and registered engineering paths without a
parallel product authority or a universal engineering AST.
`motorized-camera-slider-mcs01` is the proving vehicle; advancement requires evidence
from the real MCP and runtime path, not fixtures or UI copy.

## Phase A: exact SysML navigation projection

- Derive definition, usage, owner, target and immediate-child traversal from one exact
  SysON capture.
- Prefer native SysON traversal; add a Graphology index only where bounded traversal,
  reverse indexes or paths require it.
- Prove deterministic rebuild and deletion of every cache without loss of product truth.
- Refuse every workspace, CAD or label-based attempt to repair missing structure.

## Phase B: semantic attachments and exact source closure

- Implemented: stable, separately revisioned `ProjectSourceWorkspace` edge from `fileId`
  to one exact captured SysML element, with workspace MCP put/detach/read/list. Preserve
  it across file edits and never infer a retarget from labels.
- Pending: from exact `System`, `PartUsage` and `PartDefinition` nodes, expose attached
  source, geometry, physics and verdict references with their exact bases.
- Pending: resolve a bounded technical dependency closure only after selecting an
  attached source root from an exact semantic target.
- Pending: return an opaque locator and bounded diagnostics; keep the closure
  non-authoritative and permission-free.
- Pending: prove cycle, stale edge, missing resource, bound and recovery behavior on the
  proving vehicle.

## Phase C: reusable definition builds

- Attach each admitted CAD source closure to one exact `PartDefinition`.
- Reuse the current targeted canonical CAD path where its registered contract applies.
- Prove two semantic targets remain distinct when output bytes are identical.

## Phase D: one-level module build

- Admit one typed placement input for the exact immediate `PartUsage` set.
- Build one modest composite definition from exact child-definition geometry.
- Seal the first bounded module evidence with exact structure, source and asset bases.

## Phase E: hierarchy and incremental rebuild

- Let a parent consume exact child-module captures without descendant inlining.
- Derive reverse impact from the source DAG and exact SysML projection.
- Change one leaf and prove that only its definition plus consuming ancestors require
  successors while unchanged siblings remain reusable.

## Phase F: large-assembly Workbench

- Make the exact SysML/SysON graph the only product-navigation entry point.
- Add lazy immediate-child expansion, pagination and definition/occurrence distinction.
- Reveal attached sources, geometry, physics and verdicts from each semantic node; open
  the workspace DAG only as a technical source drill-down.
- Project exact availability and gap labels without browser-owned product state.
- Prove a reload from the same exact bases reproduces the same view.

## Phase G: FEA recross

- Recross current part-level FEA selection against hierarchical geometry evidence.
- Define occurrence targeting only when an occurrence-dependent method is qualified.
- Keep assembly-level solver families `unavailable` until separately registered and
  proven.

## Exit criteria

The large-assembly path is not complete until a real run proves all of the following:

- product and source navigation begins at an exact SysML/SysON semantic node;
- Graphology, when needed, can be deleted and rebuilt from the exact SysON capture;
- the workspace DAG appears only after an attached source is selected and cannot act as
  product hierarchy;
- the agent submits bounded roots rather than a flat product manifest;
- every product-structure decision reopens one exact SysON capture;
- CAD sources and placements cannot create or delete structure;
- root evidence references immediate children rather than inlining descendants;
- one leaf change rebuilds that leaf and its consuming ancestors, not unrelated
  siblings;
- no join relies on `latest`, labels, timestamps, array order or digest alone;
- exact source, structure, admission, runtime and asset provenance can be reopened;
- unsupported multi-file, hierarchy or FEA surfaces remain literally `unavailable`.

After the proving run, retire any temporary parallel manifest or compatibility path
rather than maintaining two authority models.
