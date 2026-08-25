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
source id. Choose `role` as a useful workspace classification such as
`modelica-source` or `verification-plan`; do not copy an internal analyzer role. The
registered capture profile owns analyzer language and role later.

For a revision, keep the same `fileId`, supply the unique active
`predecessorFileRevision`, and point to newly captured bytes. Sibling files are not
rewritten. A deliberate removal uses `project_source_file_remove` and creates a
tombstone; it does not erase history or CAS bytes.

## 5. Attach the source to an exact SysML element

Call `project_source_attachment_put` with a stable `attachmentId`, the stable `fileId`,
a registered attachment role, and an exact `PartDefinition` or `PartUsage` target.
`declaredAgainst` must name the unique current Thread tip and its exact
`architecture-capture/4.0`; do not reconstruct either identity from a label.

When the same source must be recrossed on a later Thread tip, keep `attachmentId` and
`fileId`, set `predecessorAttachmentRevision` to the active head, and create the exact
successor edge. This revises authoring location evidence; it does not rewrite the file
or invalidate a sealed historical admission.

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
`result.reference` to `project_technical_compilation_preview`. Never infer admission
from workspace membership, MIME, path or a successful isolated run. A later correction
is a new `project_resource_capture` plus a successor file revision, then a new capture.

Every admission seal advances the Thread. Before sealing another source whose
attachment names an earlier tip, create an attachment successor against the current tip
and recapture it. Seal all planned sources first when possible; this reduces attachment
rebases between sequential admissions. Later executions may reopen those historical
admissions from descendant Thread tips. A `different-basis` authoring read does not
invalidate a sealed admission, but a current closure drill-down may stay
`unavailable`.

## Common workspace basis

Keep sources modular: one file per logical assembly, subsystem, analysis or support
area. A compilation preview may name several locators only when they share one project
and one workspace snapshot (`workspaceRevision` plus `workspaceEventFingerprint`). After
a sibling file is bumped, recapture every included file at the new common revision. Do
not mix historical locators from different workspace heads.
