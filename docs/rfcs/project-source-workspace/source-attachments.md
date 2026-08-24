# Versioned source attachments

Status: aggregate, workspace MCP, and product-navigation authoring-attachment reads
implemented · source closure/admission recross of attachment revisions and real-project
proof remain pending

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
later technical admission, not this vertical, is expected to be stricter: it would seal
the exact resolved file revision, resource fingerprint, attachment revision, workspace
basis, and architecture basis.

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
not a compiler relation such as `represents` or `parameterizes`. Attaching a Modelica,
CAD, SPICE, or supporting document still grants no execution right. Moving a file in the
module tree does not retarget the edge; updating file bytes preserves it.

`project_technical_source_capture` and `compile.seal-admission` still ignore
`state.attachments`. A later admission vertical may reopen an exact active attachment,
resolve its file head, and seal parser bindings separately from the authoring edge.
Product navigation now exposes authoring heads as a distinct collection from Thread
evidence: `project_product_navigation_authoring_attachments` and Workbench GET
`view=authoring-attachments`. `project_product_navigation_context` and
`project_product_source_closure` still read only Thread/admission evidence. Graphology
may later index the relation for bounded reads; it must never own or repair it.

A draft edit still does not revoke a historical Thread admission. When admission later
seals an attachment revision, refusing future use of that sealed admission will require
an explicit Thread invalidation or archive, not a hidden lookup of the mutable workspace
head.

## Bounded operations

The workspace MCP surface implemented now is:

- `project_source_attachment_put`;
- `project_source_attachment_detach`;
- `project_source_attachment_read` (exact `attachmentId` + `attachmentRevision`);
- `project_source_attachment_list` filtered by exact `fileId` or exact element identity.

Product-navigation authoring reads implemented now:

- `project_product_navigation_authoring_attachments` (MCP, grants none);
- Workbench GET `/api/thread/product-navigation?view=authoring-attachments`.

Both consume `ProductNavigationUseCase.authoringAttachments`. The first page selects the
server workspace head then recrosses it. `nextCursor` is an HMAC-sealed server envelope
covering project, exact target, workspace revision and the internal domain sort key; a
domain attachment-list cursor is refused. Page two reopens that pinned revision via
`loadAtFresh`. `PartUsage` keeps `usageId` and is never reduced to `definitionId`.
`basisStatus` is `exact-basis` or `different-basis` against the opened Thread
architecture; SysON/Graphology are not called to repair or infer. Detached heads are
omitted; `source-removed` stays visible.

The HMAC key is ephemeral and local to one server process. A restart or another process
invalidates an in-flight page cursor; cursors are pagination continuity, never durable
project authority.

Pending, not implemented:

- `project_product_navigation_context` / Workbench reading authoring attachments as
  evidence groups;
- `project_technical_source_capture` and `compile.seal-admission` recrossing an
  attachment revision;
- dependency closure selected by exact attachment identity and workspace revision;
- MCS-01 / real-project proof of this product-navigation read.

Fail-closed catalogue decision: the five generic v1 roles (`architecture-source`,
`design-source`, `behavior-source`, `verification-source`, `supporting-document`) are
accepted against both `PartDefinition` and `PartUsage`. Unknown ids, version ≠ 1, or
other SysML kinds are refused. No per-project role exists.

Search labels may help discovery later, but every subsequent mutation already names the
exact architecture basis and element identity returned by the server.

All operations retain server-owned bounds. A bound constrains one page or traversal, not
the total number of product parts, files, or attachment edges.
