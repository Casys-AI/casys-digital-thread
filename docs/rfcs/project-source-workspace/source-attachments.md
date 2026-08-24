# Versioned source attachments

Status: implemented and runtime-proven on MCS-02 for attachment creation and
successors, product-navigation authoring reads, attachment-rooted closure, technical
capture and admission recross. Authoring attachments inside context evidence groups
remain pending.

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
file therefore preserves its product attachment without a second bookkeeping mutation.
Technical admission seals the exact resolved file revision, resource fingerprint,
attachment revision, workspace basis, architecture basis and
`project-source-closure/1.0`.

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

The current read model derives only two target-basis states:

- `exact-basis`: the declared Thread and architecture basis is the opened basis;
- `different-basis`: at least one member of that exact tuple differs.

It does not infer lineage, carry-forward, or orphan repair. A closure read on a
`different-basis` attachment is `unavailable`; current recross requires an explicit
reviewed successor attachment revision against the current basis. No label or
occurrence path can repair or retarget the edge.

The initial implementation supports only element kinds sealed by the architecture
capture contract. Adding another SysML kind first extends that capture and its exact
parser; a provider inventory or UI label is not coverage.

## Separation from technical authority

An authoring attachment says only where a source belongs in the product workspace. It is
not a compiler relation such as `represents` or `parameterizes`. Attaching a Modelica,
CAD, SPICE, or supporting document still grants no execution right. Moving a file in the
module tree does not retarget the edge; updating file bytes preserves it.

`project_technical_source_capture` and `compile.seal-admission@3` reopen the exact
active attachment head and persist a `project-source-closure/1.0`. Product navigation
exposes authoring heads as a distinct collection from Thread evidence:
`project_product_navigation_authoring_attachments` and Workbench GET
`view=authoring-attachments`. `project_product_navigation_context` still reads
Thread/admission evidence. `project_product_source_closure` recrosses the named
authoring attachment, not a free file root. Graphology may later index the relation for
bounded reads; it must never own or repair it.

A draft edit still does not revoke a historical Thread admission. Refusing future use of
a sealed admission requires an explicit Thread invalidation or archive, not a hidden
lookup of the mutable workspace head.

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
  evidence groups (authoring stays a distinct collection; an exact attachment may
  expose a read-only `project_product_source_closure`).

MCS-02 observed `exact-basis` authoring reads before each admission. At Thread r20,
the active RailFrame attachment remains visible with `basisStatus: different-basis`;
the historical `project_product_source_closure` drill-down is `unavailable`. Neither
state invalidates the historical sealed admission carried by that descendant Thread.

Fail-closed catalogue decision: the five generic v1 roles (`architecture-source`,
`design-source`, `behavior-source`, `verification-source`, `supporting-document`) are
accepted against both `PartDefinition` and `PartUsage`. Unknown ids, version ≠ 1, or
other SysML kinds are refused. No per-project role exists.

Search labels may help discovery later, but every subsequent mutation already names the
exact architecture basis and element identity returned by the server.

All operations retain server-owned bounds. A bound constrains one page or traversal, not
the total number of product parts, files, or attachment edges.
