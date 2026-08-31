# Project source workspace

Audience: agent · Diátaxis: reference · Kind: contract

The project source workspace is the agent-owned **draft source tree** for one
Engineering Project. It is not product evidence and grants no permission to compile,
execute, seal, or judge anything.

Read:

1. [Authority](authority.md) — four boundaries; `captureRequest` is caller-authored
   identity only and is not registered in Vertical 1.
2. [Model](model.md) — aggregate, modules, files, authoring attachments, derived paths,
   mutation id.
3. [Operations](operations.md) — MCP tools and bounded pagination.
4. [Persistence](persistence.md) — append-only events and fail-closed recovery.
5. [Coverage](coverage.md) — current vertical, deliberately missing bridges, and the
   next proof.

How-to:
[author and revise a project source workspace](../../../how-to/compile/author-project-source-workspace.md).

Internal planning history for this vertical is intentionally not exported; the public
runtime contract is this reference and its linked model, operations, persistence, and
coverage pages.

Byte ingress remains [`project_resource_capture`](../../agent/agent-workspace.md). This
vertical does not call technical source capture, compilation admission, CAD, FEA,
Modelica, or SPICE.

For the one `mechanism-source@1` bridge, see
[prescribed-kinematics case and architecture binding](../mechanism/prescribed-kinematics-case-and-architecture-binding.md).
The workspace contributes L1 source identity only; it never authorizes provider dispatch.
