# Commands and navigation

## Mutation surface

All mutations are agent operations and grant no MRTR or execution authority.

### `project_source_module_put`

Takes `projectId`, `mutationId`, `expectedWorkspaceRevision`, `moduleId`, parent,
slug, display name and optional domain. It creates or revises one stable module after
checking the exact workspace revision and parent graph.

### `project_source_file_put`

Takes `projectId`, `mutationId`, `expectedWorkspaceRevision`, `fileId`, exact optional
predecessor, `moduleId`, logical name, role, exact dependencies, optional registered
source-capture profile/source identity, and a full `AgentResourceReference`. The
server re-opens the CAS bytes and persists one workspace event. It never accepts a
local path or infers project structure from the resource name.

### `project_source_file_remove`

Takes `projectId`, `mutationId`, `expectedWorkspaceRevision`, `fileId` and the exact
active file revision. It records an explicit tombstone. The history and raw CAS bytes
remain recoverable.

The first implementation may expose these as separate commands. A later batch command
may apply several already-validated mutations atomically, but it must preserve the same
per-file identities and events.

## Read surface

### `project_source_workspace_snapshot`

Returns workspace identity, exact revision, roots and counts. It does not inline every
file or expose a mutable tip as product evidence.

### `project_source_tree`

Lists immediate children of one module at an exact workspace revision with a cursor
and bounded page size. Recursive loading is caller-controlled.

### `project_source_search`

Filters one exact workspace revision by derived path prefix, module, domain, role,
capture profile or source id. Results are paginated and return exact active
file-revision references.

Tree and search cursors bind the workspace revision, filter and last sort key. A
mutation cannot make a later page silently cross revisions; a mismatched cursor fails
closed.

### `project_source_file_read`

Returns metadata for one exact revision plus its full `AgentResourceReference`. The
agent reads the bytes through the existing MCP resource URI.

## Technical capture bridge

The target technical-capture command takes:

```text
projectId + exact workspace revision + exact file revision
```

The server derives the source id, registered profile and resource reference from that
revision, re-opens the bytes, and emits the existing source-local analysis. The profile
is explicitly a source-capture parser/policy profile, never compilation or runtime
selection. A revision without the required registered capture identity fails closed;
the server does not invent it from a path or MIME. Callers no longer repeat a
free-standing `profileId`, `sourceId`, and `resourceRef` tuple.

The returned review keeps its opaque locator. A new version of the technical capture
locator and `technical-compilation-admission` grammar preserves the exact workspace
revision and file revision alongside byte, analysis and SysML fingerprints. Provenance
is never smuggled into `sourceId` and an existing sealed schema is never reinterpreted.
