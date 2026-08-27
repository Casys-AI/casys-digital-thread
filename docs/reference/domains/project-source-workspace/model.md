# Project source workspace — model

Audience: agent · Diátaxis: reference · Kind: contract

`ProjectSourceWorkspace` is the consistency boundary for one project source tree. Every
mutation carries an exact `expectedWorkspaceRevision` and a stable `mutationId`. The log
stores one bounded `project-source-workspace-event/4.0` record per newly accepted
mutation. Events are hash-chained: revision 1 has `previousEventFingerprint: null`;
later revisions name the exact prior event fingerprint, which is included in the event
body fingerprint. `/3.0` is temporary replay-only history for the pre-recross mutation
vocabulary: no V3 event is newly written and V3 explicitly refuses `attachment_recross`.
`/2.0` and `/1.0` events are refused. There is no automatic historical-byte migration.

## Modules and files

A module has a stable `moduleId`, optional parent, POSIX-safe slug unique among
siblings, display name, and optional generic domain slug. Domain is not a product enum.
No module may contain itself transitively. Depth is bounded.

A file has a stable `fileId`, owning module, and POSIX-safe logical name unique in that
module. Module slugs and file logical names share one POSIX namespace under the same
parent: a child module slug may not collide with a sibling file name, and the reverse is
also refused. The derived path at one workspace revision is the module-slug chain plus
that name. Callers never supply a second path. Path is a navigation label, never a
server filesystem path.

Each accepted content change creates a file revision with exact predecessor (absent only
on create), full `AgentResourceReference`, role, optional inert `captureRequest`, exact
dependency revisions, and the fingerprint of the canonical revision record. Rename or
move preserves `fileId` and creates a successor. Remove records a tombstone. History and
CAS bytes remain.

An attachment is a separately revisioned authoring edge from a stable `fileId` to one
exact SysML `PartDefinition` or `PartUsage`. `fileId` cannot change along the chain.
Role or target change is an explicit successor. Detach writes a tombstone. File remove
does not cascade; reads publish `source-removed`. Snapshot schema is
`project-source-workspace-snapshot/2.0` and includes `activeAttachmentCount`.

`attachment_recross` is an internal, one-event successor batch generated only by
`project_source_attachment_recross`. Its public intent is the exact workspace revision
and a nonempty bounded set of `{attachmentId, activeAttachmentRevision}` selections; the
enclosing event retains `projectId` and `mutationId`. The server derives and persists
the current Thread/architecture basis plus each copied `fileId`, role and target. It can
therefore recross one or many stale active heads without letting an agent retarget an
edge.

## Invariants

- Predecessor must be the unique active revision of the same `fileId`.
- Branch ambiguity is refused. Tombstoned ids cannot be revived as a new branch.
- Dependencies are an exact `fileId@fileRevision` DAG, including historical revisions.
  An older revision of the same file may be an exact dependency and is not a cycle. A
  future or missing revision is refused.
- After a module move, depth is validated for the whole module graph, not only the moved
  node.
- Resource URI, digest, size, representation, name and MIME are reopened exactly before
  a `file_put` is accepted.
- An attachment recross selection is unique, bounded by `maxAttachmentRecrossItems`, and
  names only active content heads with active source files. Every selected head must be
  `different-basis`, still occur on the current architecture capture, and retain an
  accepted role.
- One attachment recross publishes exactly one workspace event and one workspace
  revision. Its successors preserve `fileId`, role and target; failure of any selected
  head publishes none of them.
- Closed server-owned bounds constrain one operation, not the total file count.
- Event revision 1 requires `previousEventFingerprint: null`. Later events require the
  Object.is-equivalent prior event fingerprint. A broken chain is
  `event_chain_mismatch`.

Replaying the same `mutationId` with the same canonical command returns the snapshot at
that mutation's accepted `event.workspaceRevision`, even if later events now exist.
Reusing it with different content fails closed. This is distinct from
`expectedWorkspaceRevision`, which serialises concurrent mutations. AgentResource is
reopened only for a new mutation, after determining it is not already accepted.

For `project_source_attachment_recross`, retry comparison uses the persisted public
intent before any current Thread, snapshot, traversal or role-catalog read. A concurrent
winner with that same intent is returned at its accepted workspace revision; another
workspace mutation remains `stale_revision`. A later Thread advance can make the new
head `different-basis` again, but does not rewrite the exact basis retained by the
accepted event.
