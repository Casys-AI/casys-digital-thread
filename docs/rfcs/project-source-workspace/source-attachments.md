# Versioned source attachments

Status: proposed for breaking implementation

## Purpose

A project file must be attachable to one exact element of the sealed SysML product
structure before that file has been technically admitted. This is an authoring and
navigation relation only. It grants no permission to compile, execute, seal, or judge
the file.

The relation belongs to `ProjectSourceWorkspace`. It is not stored inside a file
revision, a Thread artifact, the Graphology index, or the browser projection.

## Stable edge identity

One attachment is one stable, revisioned edge between:

- a stable workspace `fileId`; and
- one exact captured SysML element identity.

The edge has its own `attachmentId`, predecessor chain, fingerprint, active head, and
detached tombstone. One edge revision contains:

- `attachmentId` and positive `attachmentRevision`;
- the exact predecessor attachment revision, absent only on creation;
- stable `fileId`;
- a versioned, server-catalogued product relation role;
- `target.elementId` and the exact supported `target.elementKind`;
- the architecture artifact id and fingerprint against which the target was checked;
- the exact Thread basis carrying that architecture artifact; and
- the canonical edge-revision fingerprint.

Many files may attach to one element. One file may attach to several elements. Each
file-to-element edge has a distinct stable attachment identity. An identical active
`fileId + role + target` edge may not be declared twice.

The attachment role is not the file role. The file role describes the source bytes and
capture profile, such as a CAD script or Modelica model. The attachment role describes
the product relation, such as design source, behavior source, verification source, or
supporting document. Roles are generic `{id, version}` references resolved through one
server-owned catalogue; they are never configured per project. A role still grants no
technical authority by itself.

The edge points to `fileId`, not `fileId@fileRevision`. At a named workspace revision,
the read side resolves that stable identity to its exact active file head. Editing a
file therefore preserves its product attachment without a second bookkeeping mutation. A
technical admission remains stricter: it seals the exact resolved file revision,
resource fingerprint, attachment revision, workspace basis, and architecture basis.

## Lifecycle

`attachment_put` creates an edge or revises its unique active head. The stable file id
cannot change across that chain. A role or target change is an explicit successor
revision; labels, paths, timestamps, or matching bytes can never retarget an edge.

`attachment_detach` writes a tombstone. It does not delete file bytes, architecture
captures, prior edge revisions, admissions, or Thread evidence. Detached identities are
not revived as a new branch.

A file tombstone does not cascade into its attachments. The edge remains visible with
`source-removed` status so history cannot disappear silently. A new file must use a new
`fileId` and a new attachment edge.

## Exact target and recross

The application validates a new edge against bytes reopened from one exact sealed
architecture capture. The target must occur exactly once with the declared semantic
kind. Pure workspace replay trusts the already accepted, hash-chained event and never
calls SysON, Graphology, or an adapter.

Against a later valid architecture capture, target status is derived as:

- `exact-basis`: the declared capture is still selected;
- `carried-forward`: the same `elementId` and semantic kind exist in an exact descendant
  capture;
- `orphaned`: an exact descendant capture is readable and the id or kind is absent;
- `unresolved`: lineage, capture bytes, selection, or uniqueness cannot be proved.

No label or occurrence path repairs an orphan. Replacing a SysML element with a new id
requires a reviewed successor attachment revision.

The initial implementation supports only element kinds sealed by the architecture
capture contract. Adding another SysML kind first extends that capture and its exact
parser; a provider inventory or UI label is not coverage.

## Separation from technical authority

An authoring attachment says only where a source belongs in the product workspace. It is
not a compiler relation such as `represents` or `parameterizes`.

`project_technical_source_capture` reopens an exact active attachment at a named
workspace revision, resolves its active file head, and then applies the registered
technical profile. The resulting admission may seal exact semantic bindings discovered
by its parser. Those admitted bindings are projected separately from the authoring edge.

Consequently:

- moving a file in the module tree does not retarget it;
- updating its bytes preserves the authoring edge; current context marks an older
  admission `superseded` and requires a new admission for new work;
- attaching a Modelica, CAD, SPICE, or supporting document grants no execution right;
- Graphology may index the relation for bounded reads but never owns or repairs it.

A draft edit does not revoke or rewrite a historical Thread admission. That admission
continues to reopen the exact attachment, file revision, closure and workspace revision
it sealed. Refusing future use of it requires an explicit Thread invalidation or
archive, not a hidden lookup of the mutable workspace head.

## Bounded operations

The minimal agent surface is:

- `project_source_attachment_put`;
- `project_source_attachment_detach`;
- one exact attachment read;
- one bounded attachment list filtered by exact `fileId` or exact element identity;
- dependency closure selected by exact attachment identity and workspace revision.

Product context returns authoring attachments and admitted semantic bindings as distinct
collections. Search labels may help discovery, but every subsequent mutation names the
exact architecture basis and element identity returned by the server.

All operations retain server-owned bounds. A bound constrains one page or traversal, not
the total number of product parts, files, or attachment edges.
