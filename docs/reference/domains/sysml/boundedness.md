# SysML boundedness inventory (H01)

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory of architecture proposal and live-graph size. It records enforced
shapes, missing cardinalities, and whether a later number can be derived. It does not
invent a limit. Status words: **enforced** (code-owned value/shape and authority),
**physical-only** (bytes or runtime exist, no semantic cardinality), **unbounded**
(no ceiling at this boundary), **needs decision** (missing semantic bound; product or
storage must choose it — SysON capacity in this repo does not).

The agent proposes registered operations only. The human signs the flat proposal. The
server owns parsing, rendering, insertion, and the ratchet. `unavailable` and
`unresolved` stay literal.

Sibling contracts: [coverage](coverage.md),
[SysON modelling surface](../../providers/syson/modeling-surface.md). Cross-domain
storage: [isolation and Thread boundedness](../../runtime/isolation-and-thread-boundedness.md).

## Renderer proposal and live graph

Authority:
[`architecture-proposal.ts`](../../../../src/domain/architecture/renderer/architecture-proposal.ts),
[`architecture-graph-ratchet.ts`](../../../../src/domain/architecture/renderer/architecture-graph-ratchet.ts).

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Flat MRTR parameters | Non-empty list; keys limited to `architecture.package`, `system.name`, `component.<slug>.(name\|usage\|parent)`, `attribute.<slug>.(name\|parent)`; values are strings | Enforced uniqueness and key shape; **unbounded** count | Needs an explicit product/storage decision. No SysON capacity in this repo justifies a number. |
| Components | Zero or more; `(parentName, usageName)` unique; parent exists; no self-parent; no cycle; identifier regex `^[A-Za-z][A-Za-z0-9_]*$` / usage `^[a-z][A-Za-z0-9_]*$` | Enforced uniqueness and identifiers; **unbounded** count and identifier length | Same: cannot derive from a fixed runtime or profile. |
| Attributes | Zero or more; name unique in the whole proposal; parent is a declared definition | Enforced uniqueness; **unbounded** count | Same. |
| Live SysON graph (package, PartDefinitions, PartUsages, AttributeUsages) | Duplicate PartDef labels fail closed. Before each live index, PartDefinition, PartUsage and AttributeUsage counts may not exceed the attested predecessor union the reviewed proposal. | Enforced identity/uniqueness failures; **derived cardinality** from predecessor∪proposal, not a fixed quota | A numeric ceiling still needs an explicit product/storage decision. No SysON capacity in this repo justifies a number. |
| Rendered SysML manifest entries | Non-empty; selector-exact | Enforced non-empty; **unbounded** upper count | Follows proposal size; no separate ceiling. |

The provider pages document “zero or more” constructs and no element quota. `mcp-syson`
is a published image outside this repository. That is not a hidden capacity we can
copy.

## Agent-authored closed-subset path (not the renderer)

Authority:
[`architecture-sysml-lexical.ts`](../../../../src/domain/architecture/agent-seal/architecture-sysml-lexical.ts)
(`MAX_ARCHITECTURE_SYSML_SOURCE_BYTES = 262_144`). This path seals documentary SysML
and never calls SysON. It does not cap renderer proposal cardinality.

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Agent-authored SysML UTF-8 | At most 262144 bytes | Enforced | None for bytes. Token/node cardinality is **physical-only** behind that ceiling. |
