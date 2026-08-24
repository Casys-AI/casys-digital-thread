# Domain model

## Aggregate

`ProjectSourceWorkspace` is the consistency boundary for one project source tree. Every
mutation uses an exact expected workspace revision and a stable mutation id. The
persisted log contains one small event per accepted mutation; it does not copy the full
tree on every revision.

The aggregate exposes a materialised read model for navigation, but the event log is the
recovery authority. Each accepted mutation publishes one
`project-source-workspace-event/2.0` record. Revision 1 has
`previousEventFingerprint: null`. Later revisions name the exact prior event
fingerprint, which is part of the hashed event body. A broken chain is refused. `/1.0`
events are not accepted.

## Stable entities

### `ProjectSourceModule`

A module is a stable grouping identity with:

- `moduleId`, unique inside the project;
- a parent module or the workspace root;
- a POSIX-safe slug, unique among siblings, and a short display name;
- an optional domain classification such as `sysml`, `cad`, `fea`, `modelica`, `spice`,
  or `supporting`.

Modules contain identities, not source bytes. A large product is split into nested
subsystems and subassemblies. No module may contain itself transitively.

### `ProjectSourceFile`

A file has a stable `fileId`, an owning module and a POSIX-safe logical name unique in
that module. Its logical path is derived at one exact workspace revision from the
module-slug chain plus that name. The caller never supplies a second independent path.
The derived path is a project navigation label, never a server filesystem path and never
provider authority.

Each accepted content change creates a `ProjectSourceFileRevision` containing:

- `fileId` and positive file revision;
- exact predecessor revision, absent only on creation;
- full `AgentResourceReference`;
- owning `moduleId` and logical name;
- source role and optional caller-authored `captureRequest` containing requested
  parser/source identities;
- exact dependency file-revision references;
- fingerprint of the canonical revision record.

Every accepted change to bytes, module, logical name, role, capture identity or
dependencies increments the file revision. Renaming or moving therefore preserves
`fileId` but creates a successor. Removing a file records a tombstone; it never deletes
CAS bytes or history.

## Invariants

- A module slug is unique among active sibling modules.
- A logical file name is unique among active files in one module; the derived path is
  consequently unique in one exact workspace revision.
- A predecessor must be the unique active revision of the same `fileId`.
- Dependencies name exact revisions in the same project and form an acyclic graph.
- A module parent graph is acyclic.
- Resource reference URI, digest, size, representation, name and MIME are re-opened
  exactly before a revision is accepted.
- Branch ambiguity is refused; labels, timestamps and matching hashes never choose a
  successor.
- A `captureRequest` is inert draft metadata in Vertical 1 and grants nothing. The later
  capture bridge resolves it fail-closed against the server registry. A file revision
  cannot select a compilation profile, provider, tool, image, executable, endpoint,
  credentials or expected output.
- Identifiers, names, dependency fan-out, module depth and mutation payloads have closed
  server-owned bounds. Bounds constrain one operation, not the total number of project
  files.

## Mutation identity

Every command carries a project-scoped `mutationId`. Replaying the same id with the same
canonical command after an acknowledgement loss returns the already accepted workspace
revision. Reusing it with different content fails closed. This is distinct from
`expectedWorkspaceRevision`, which prevents concurrent branches.

## Why this is not a single resource-set document

A flat manifest would grow with every part and would need to be rewritten for every
small edit. The append-only workspace instead gives the agent stable file identities,
small diffs and bounded reads. Exact source sets are assembled only for the operation
that consumes them.
