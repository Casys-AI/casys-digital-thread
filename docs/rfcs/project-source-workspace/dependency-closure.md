# Server-resolved source dependency closure

Status: implemented and runtime-proven on MCS-02 for attachment-rooted closure, CAS
persistence, technical capture and admission recross. Language-specific lowering for
non-trivial multi-file closures remains `unavailable`.

## Purpose

Product navigation first selects an exact semantic target from the exact SysML/SysON
graph. A versioned workspace attachment then identifies a bounded source root for that
target. Only at this point does the server resolve the root's technical dependency
closure from one exact `ProjectSourceWorkspace` revision instead of copying every source
file into one request.

This is the final composable read of the shared application product-navigation service.
The engineering agent reaches it through a lean MCP read control; the Workbench reaches
the same semantics through GET after node and attachment selection.

The workspace remains responsible only for:

- stable module and file identities;
- exact file revisions and immutable resource references;
- exact dependency edges between file revisions;
- acyclicity, project scope and mutation recovery.

The dependency DAG supports technical imports and includes after semantic selection. It
is not product navigation, a product hierarchy, a substitute SysML graph, an admission
or execution authority.

## Resolution contract

A closure request names the exact `projectId`, published architecture `expectedBasis`,
exact element or occurrence `selection`, `workspaceRevision`, `attachmentId` and
`attachmentRevision`. The server reopens the exact SysML and
workspace bases, verifies the active attachment and target, resolves its stable
`fileId` to the exact head at that workspace revision, walks only exact dependency
edges and emits a deterministic topological closure containing:

- the exact roots;
- every exact file revision and resource reference reached;
- the exact directed edges;
- the workspace event fingerprint and closure fingerprint;
- bounded diagnostics for a cycle, missing node, stale edge or server-owned limit.

An exact dependency may intentionally name a historical content revision even when that
file has a newer head. This is valid and reproducible. A missing revision, tombstone,
broken fingerprint or dependency outside the named workspace basis makes the closure
`unavailable`; labels, paths, timestamps, matching digests and an implicit `latest` must
not repair it.

`project_source_closure` returns that bounded closure as one discriminated, paginated
`entries` stream (files then edges), plus `fileCount`, `edgeCount` and the closure
fingerprint. An `observed` page never includes an unreachable edge. The opaque locator
belongs instead to `project_technical_source_capture`, which persists the private
closure for later admission recross. Neither operation grants permission to compile,
execute, seal or judge.

The response publishes the exact sealed SysON basis (including `threadSubjectId`),
selected semantic target, exact attachment, workspace revision and closure fingerprint.
The page cursor binds that full basis, the selection, the workspace revision, the
attachment revision and the closure fingerprint. It accepts no `latest`, label,
provider, runtime, parser or lowering-profile selection.

MCS-02 exercised both sides of the boundary. The initial RailFrame r1 root reached a
two-file closure and failed closed as `source.dependency-lowering-unavailable`; the
Build123d profile did not silently drop its support file. RailFrame r2 explicitly
removed that executable dependency, retained the stable attachment, and produced the
singular closure later sealed by `compile.seal-admission@3`.

A file tree may be displayed as a drill-down of this selected closure. It must not be an
independent entry point for navigating the product or choosing product structure.

## Deliberate limits

Resolution does not parse Python imports, Modelica `within`, SPICE `.include`, SysML
text or a universal AST. A registered domain compiler decides whether the resolved files
form a valid source set for its closed language and profile.

Node count, edge count, fan-out, depth and response size remain server-owned bounds. A
bound limits one closure operation, not the total number of project files. Larger source
trees are split through explicit dependency roots and modules; unsupported cross-file
language semantics remain `unavailable`.
