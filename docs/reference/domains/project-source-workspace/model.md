# Project source workspace — model

Audience: agent · Diátaxis: reference · Kind: contract

`ProjectSourceWorkspace` is the consistency boundary for one project source tree. Every
mutation carries an exact `expectedWorkspaceRevision` and a stable `mutationId`. The log
stores one bounded event per accepted mutation.

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
- Closed server-owned bounds constrain one operation, not the total file count.

Replaying the same `mutationId` with the same canonical command returns the snapshot at
that mutation's accepted `event.workspaceRevision`, even if later events now exist.
Reusing it with different content fails closed. This is distinct from
`expectedWorkspaceRevision`, which serialises concurrent mutations. AgentResource is
reopened only for a new mutation, after determining it is not already accepted.
