# Project source workspace — operations

Audience: agent · Diátaxis: reference · Kind: contract

All mutations are agent operations and grant none. They are not MRTR and not execution.

| Tool                                | Authority      | Effect                                                                                      |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `project_source_module_put`         | Agent mutation | Create or revise one module at an exact workspace revision                                  |
| `project_source_file_put`           | Agent mutation | Create or revise one file after reopening `resourceRef`                                     |
| `project_source_file_remove`        | Agent mutation | Explicit tombstone of the unique active file revision                                       |
| `project_source_attachment_put`     | Agent mutation | Create or revise one file-to-SysML authoring edge after recrossing the current Thread tip   |
| `project_source_attachment_detach`  | Agent mutation | Explicit tombstone of the unique active attachment revision                                 |
| `project_source_workspace_snapshot` | Read           | Identity, revision, roots, counts. Does not inline every file                               |
| `project_source_tree`               | Read           | Immediate children of one module at an exact revision                                       |
| `project_source_search`             | Read           | Filter one exact revision by path, module, domain, role, or inert `captureRequest` identity |
| `project_source_file_read`          | Read           | Exact file revision: content carries `AgentResourceReference`; tombstone has no bytes       |
| `project_source_attachment_read`    | Read           | Exact attachment revision; content or tombstone; source status at the named revision        |
| `project_source_attachment_list`    | Read           | Active heads filtered by exactly `fileId` or exactly `target`; includes `source-removed`    |

Tree and search are bounded and revision-anchored. The cursor binds workspace revision,
filter and last sort key. A mutation cannot make a later page silently cross revisions;
a mismatched cursor fails closed.

`pathPrefix` is a derived POSIX path and therefore starts with `/`, for example
`/product/mechanics`. It is not a host filesystem path.

`project_source_file_put` takes a full `AgentResourceReference` from
`project_resource_capture`. It does not accept `sourceText`, a local path, or a
caller-invented CAS URI. Optional `captureRequest` is caller-authored requested
parser/source identity. Vertical 1 does not register or resolve it. The file `role` is
a workspace classification used for navigation; it need not repeat the internal
analyzer role selected later by the registered profile.

A content file read includes the `AgentResourceReference`; bytes go through
`resources/read`. A tombstone read is still useful historical metadata and carries no
bytes.

`project_source_attachment_put` recrosses the unique current Thread tip, rereads that
snapshot, reopens `architecture-capture/4.0`, and requires exact `hasElement`. An
already accepted `mutationId` skips that recross. Detach never contacts SysON or the
traversal. List requires exactly `fileId` or exactly `target`. The five generic v1 roles
are `architecture-source`, `design-source`, `behavior-source`, `verification-source`,
and `supporting-document`; each is accepted against `PartDefinition` and `PartUsage`. No
per-project or per-provider role exists.
