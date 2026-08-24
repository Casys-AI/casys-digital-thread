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
source id.

For a revision, keep the same `fileId`, supply the unique active
`predecessorFileRevision`, and point to newly captured bytes. Sibling files are not
rewritten. A deliberate removal uses `project_source_file_remove` and creates a
tombstone; it does not erase history or CAS bytes.

## 5. Navigate without loading the project at once

- `project_source_tree` lists one module's immediate children.
- `project_source_search` filters one exact revision. `pathPrefix` starts with `/`.
- `project_source_file_read` returns one exact content revision or tombstone.
- `resources/read` reopens the bytes named by a content revision.

Tree and search are paginated. Keep their revision-anchored cursor; do not reuse it with
another revision or filter.

## Technical capture

Call `project_technical_source_capture` with `projectId`, `workspaceRevision`, `fileId`
and `fileRevision` only. The named revision must be the active content at that snapshot.
The server resolves `captureRequest.profileId` and role; it refuses MIME, path,
`sourceText`, caller `profileId`/`sourceId`/`resourceRef`. Pass `result.reference` to
`project_technical_compilation_preview`. Never infer admission from workspace
membership, MIME, path or a successful isolated run. A later correction is a new
`project_resource_capture` plus a successor file revision, then a new capture.

## Common workspace basis

Keep sources modular: one file per logical assembly, subsystem, analysis or support
area. A compilation preview may name several locators only when they share one project
and one workspace snapshot (`workspaceRevision` plus `workspaceEventFingerprint`). After
a sibling file is bumped, recapture every included file at the new common revision. Do
not mix historical locators from different workspace heads.
