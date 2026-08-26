# How-to: author and revise a project source workspace

Audience: agent · Diátaxis: how-to · Kind: how-to

Use this surface to keep a project's agent-authored SysML, CAD, FEA, Modelica, SPICE and
supporting sources modular. The workspace is draft authoring state. It grants no
admission, execution, MRTR or Thread evidence.

Contract:
[project source workspace](../../reference/domains/project-source-workspace/README.md).

## 1. Upload exact bytes

Call `project_resource_capture` with `name`, `mimeType`, and exactly one of `text` or
`blob`. Keep the returned full `reference`; do not reduce it to a URI or digest.

## 2. Read the exact workspace revision

Call `project_source_workspace_snapshot`. New workspaces start at revision `0`. Every
mutation names `expectedWorkspaceRevision`; `latest` is never accepted.

## 3. Build bounded modules

Call `project_source_module_put` once per module. Give each logical assembly, subsystem,
analysis or supporting area a stable `moduleId`. The caller supplies a slug and parent,
not a path. The server derives paths from the module tree.

Large products use nested modules and many small resources. Do not encode the whole
product, every part, or every analysis in one source file or one flat manifest.

## 4. Attach or revise one file

Call `project_source_file_put` with the current workspace revision, stable `fileId`,
module, logical name, role, exact dependencies, and the full resource reference.
Optional `captureRequest` is exactly `{profileId}`. `fileId` is the sole technical
authoring-file id; a technical capture derives its separate
`technical-unit:<closure sha256>` from the sealed closure. Choose `role` as a useful
workspace classification such as `modelica-source` or `verification-plan`; do not copy
an internal analyzer role. The registered capture profile owns analyzer language and
role later.

For a revision, keep the same `fileId`, supply the unique active
`predecessorFileRevision`, and point to newly captured bytes. Sibling files are not
rewritten. A deliberate removal uses `project_source_file_remove` and creates a
tombstone; it does not erase history or CAS bytes.

### Build123d direct closure V1

For an executable multi-file Build123d source, put one attached root and zero or more
direct scalar-leaf dependencies in the same exact workspace revision. Declare each
root-to-leaf dependency by exact `fileId@revision`; the root imports it only through the
fixed virtual-module form defined in
[Build123d workspace-closure lowering v1](../../reference/domains/cad/build123d-workspace-closure-lowering-v1.md).
Do not supply a path, module name, lowerer, provider, tool or runtime. The Build123d 3.0
profile owns the 32-file, root, aggregate and effective-script limits.

Attach the root, not a synthetic generated script. Its V4 capture preserves the authored
closure and attachment, derives the effective technical unit and persists the full
lowering manifest. Correct a rejected leaf or root by capturing new bytes and creating a
successor file revision; do not edit the sealed closure or manifest.

## 5. Attach the source to an exact SysML element

Call `project_source_attachment_put` with a stable `attachmentId`, the stable `fileId`,
a registered attachment role, and an exact `PartDefinition` or `PartUsage` target.
`declaredAgainst` must name the unique current Thread tip and its exact
`architecture-capture/4.0`; do not reconstruct either identity from a label.

When the same source must be recrossed on a later Thread tip, keep `attachmentId` and
`fileId`, set `predecessorAttachmentRevision` to the active head, and create the exact
successor edge. This revises authoring location evidence; it does not rewrite the file
or invalidate a sealed historical admission.

For a current `different-basis` head, prefer `project_source_attachment_recross`. Give
it the exact workspace revision, a new mutation id, and one or more
`{attachmentId, activeAttachmentRevision}` selections. Do not send `fileId`, role,
target or `declaredAgainst`: the server recrosses the unique current Thread tip once,
derives the current architecture basis, and copies those immutable edge fields. The
whole selection becomes one workspace event or none of it does. It refuses an
`exact-basis`, detached, source-removed, non-head or no-longer-valid target. Reuse the
same request and mutation id after acknowledgement loss; do not retry with a later
workspace revision unless the first request was not accepted. A batch names at most 32
heads and a newly accepted result is persisted as one
`project-source-workspace-event/4.0` record.

## 6. Navigate without loading the project at once

- `project_source_tree` lists one module's immediate children.
- `project_source_search` filters one exact revision. `pathPrefix` starts with `/`.
- `project_source_file_read` returns one exact content revision or tombstone.
- `resources/read` reopens the bytes named by a content revision.
- `project_product_explore` starts at the unique root `PartDefinition` **element**
  (`{projectId}`) then continues from a pasteable `PartUsage` occurrence plus
  `expectedBasis`.
- `project_product_search` returns exact element refs (exact-id or label/id tokens).
- `project_product_inspect` lists element-level authoring heads of one exact SysML
  selection and offers ready capture/closure actions per exact-basis active attachment.
- `project_source_closure` opens the exact technical DAG only after one attachment is
  selected, with the same `expectedBasis` and exact element/occurrence. It pages files
  and edges as one `entries` stream.

Product identities use `elementKind` `PartDefinition` | `PartUsage`. A PartUsage
occurrence path is nonempty and ends in its usage id. The root is never an empty-path
occurrence.

Tree and search are paginated. Keep their revision-anchored cursor; do not reuse it with
another revision or filter.

## Technical capture

Call `project_technical_source_capture` with `projectId`, `workspaceRevision`,
`attachmentId` and `attachmentRevision` only. The named attachment revision must be the
unique active head at that snapshot. The server resolves the root file, registered
profile and `project-source-closure/1.0`; it refuses MIME, path, `sourceText`,
`fileId`/`fileRevision`, caller `profileId`/`sourceId`/`resourceRef`. Pass
`result.reference` from the V4 review to `project_technical_compilation_preview`. For a
Build123d direct closure, capture reopens every exact closure byte, lowers and analyses
the one effective script, and records its full manifest. Never infer admission from
workspace membership, MIME, path or a successful isolated run. A later correction is a
new `project_resource_capture` plus a successor file revision, then a new capture.

Only stop for dependency lowering when the returned preview literally reports
`source.dependency-lowering-unavailable`. That remains expected for Modelica and
circuit-only SPICE multi-file closures. A Build123d direct closure uses the active V1
path; other Build123d shapes fail at capture/analysis under their literal refusal rather
than gaining an implicit alternative lowering route.

Every admission seal advances the Thread. Before sealing another source whose attachment
names an earlier tip, use `project_source_attachment_recross` for that head or for the
bounded set that must move together, then recapture it. Seal all planned sources first
when possible; this reduces attachment rebases between sequential admissions. Later
executions may reopen those historical admissions from descendant Thread tips. A
`different-basis` authoring read does not invalidate a sealed admission, but a current
closure drill-down may stay `unavailable`.

## Common workspace basis

Keep sources modular: one file per logical assembly, subsystem, analysis or support
area. A compilation preview may name several locators only when they share one project
and one workspace snapshot (`workspaceRevision` plus `workspaceEventFingerprint`). After
a sibling file is bumped, recapture every included file at the new common revision. Do
not mix historical locators from different workspace heads.

## Assemble immediate CAD occurrences

For a bounded immediate module, keep one admitted CAD root per child `PartDefinition`.
Each root is independently captured, admitted and sealed as canonical geometry; revising
one child keeps its stable file identity and does not rewrite its siblings. A workspace
dependency closure remains navigable and historically readable. Only the Build123d V1
direct scalar-leaf form is additionally executable through its profile-owned lowering;
it is still not a Python import environment. Other closures, including Modelica and
circuit-only SPICE multi-file closures, keep
`source.dependency-lowering-unavailable` literal.

Before capturing placements or exporting the module, run the registered
`model.capture-part-definitions@1` operation for the current architecture. The module
export requires that exact structural capture; a missing or stale capture is
`unavailable`, not an instruction to reconstruct the structure from labels.

Capture one `cad-immediate-placement-source/1.0` resource, store it with role
`cad-placement-source`, then attach the same file to every exact immediate `PartUsage`.
Use the resulting exact placement-capture locator with `project_geometry_module_export`.
The server, rather than the caller, reopens the child canonical STEP assets, immediate
usages and placements. Seal a successful draft only through `design.write-geometry@1`.

This produces a canonical static module, not a physical product verdict. If needed,
assembly-integrity remains a later, separate evidence branch. Its current positive scope
is limited to exact child import, occurrence coverage, placement, BRep reopening and
static intersection observation; joints, clearance, motion, loads, fabricability and
safety remain `not-evaluated` unless another bounded capability proves them.
