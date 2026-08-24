# Server-resolved source dependency closure

Status: proposed · not implemented

## Purpose

Product navigation first selects an exact semantic target from the exact SysML/SysON
graph. A reviewed attachment then identifies a bounded source root for that target. Only
at this point does the server resolve the root's technical dependency closure from one
exact `ProjectSourceWorkspace` revision instead of copying every source file into one
request.

The workspace remains responsible only for:

- stable module and file identities;
- exact file revisions and immutable resource references;
- exact dependency edges between file revisions;
- acyclicity, project scope and mutation recovery.

The dependency DAG supports technical imports and includes after semantic selection. It
is not product navigation, a product hierarchy, a substitute SysML graph, an admission
or execution authority.

## Proposed resolution contract

A closure request names the exact `projectId`, `workspaceRevision`, reviewed semantic
attachment and bounded root file revisions. The server reopens the exact SysON and
workspace bases, verifies that the roots are attached to the selected semantic target,
walks only exact dependency edges and emits a deterministic topological closure
containing:

- the exact roots;
- every exact file revision and resource reference reached;
- the exact directed edges;
- the workspace event fingerprint and closure fingerprint;
- bounded diagnostics for a cycle, missing node, stale edge or server-owned limit.

Every referenced dependency revision must be active at that exact workspace snapshot.
Otherwise the closure is `unavailable`; labels, paths, timestamps, matching digests and
an implicit `latest` must not repair it.

The public operation should return an opaque locator plus a bounded summary. The full
closure may be retained in CAS for review and later reopened by exact reference. It
grants no permission to compile, execute, seal or judge.

A file tree may be displayed as a drill-down of this selected closure. It must not be an
independent entry point for navigating the product or choosing product structure.

## Deliberate limits

Resolution does not parse Python imports, Modelica `within`, SPICE `.include`, SysML text
or a universal AST. A registered domain compiler decides whether the resolved files form
a valid source set for its closed language and profile.

Node count, edge count, fan-out, depth and response size remain server-owned bounds. A
bound limits one closure operation, not the total number of project files. Larger source
trees are split through explicit dependency roots and modules; unsupported cross-file
language semantics remain `unavailable`.
