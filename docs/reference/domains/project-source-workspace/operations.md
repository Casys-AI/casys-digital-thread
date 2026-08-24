# Project source workspace — operations

Audience: agent · Diátaxis: reference · Kind: contract

All mutations are agent operations and grant none. They are not MRTR and not execution.

| Tool                                | Authority      | Effect                                                                                      |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `project_source_module_put`         | Agent mutation | Create or revise one module at an exact workspace revision                                  |
| `project_source_file_put`           | Agent mutation | Create or revise one file after reopening `resourceRef`                                     |
| `project_source_file_remove`        | Agent mutation | Explicit tombstone of the unique active file revision                                       |
| `project_source_workspace_snapshot` | Read           | Identity, revision, roots, counts. Does not inline every file                               |
| `project_source_tree`               | Read           | Immediate children of one module at an exact revision                                       |
| `project_source_search`             | Read           | Filter one exact revision by path, module, domain, role, or inert `captureRequest` identity |
| `project_source_file_read`          | Read           | Exact file revision: content carries `AgentResourceReference`; tombstone has no bytes       |

Tree and search are bounded and revision-anchored. The cursor binds workspace revision,
filter and last sort key. A mutation cannot make a later page silently cross revisions;
a mismatched cursor fails closed.

`project_source_file_put` takes a full `AgentResourceReference` from
`project_resource_capture`. It does not accept `sourceText`, a local path, or a
caller-invented CAS URI. Optional `captureRequest` is caller-authored requested
parser/source identity. Vertical 1 does not register or resolve it.

A content file read includes the `AgentResourceReference`; bytes go through
`resources/read`. A tombstone read is still useful historical metadata and carries no
bytes.
