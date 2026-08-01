# Graph-first Workbench UX: evidence arrives, the graph grows

The primary product surface is the linked engineering graph. It shows which recorded
fact depends on which source, what a change affects downstream, and where evidence is
still disconnected. The chronological feed remains a secondary lens over the same graph;
it never creates lineage.

The feed is not an agent transcript. Raw reasoning and transient console text do not
become engineering truth. Cards represent canonical changes, important artifacts,
unit-bearing observations, evaluations, violations, and actions. Supporting scripts,
capture artifacts, and consumption records remain available inside lineage without
turning the feed into a 39-row implementation log.

The page is not a passive dashboard either. It is the shared control surface for an
engineer and an agent: activity establishes what happened, lineage establishes what it
means for the chain, and the active tool context exposes the evidence and permitted next
actions. Execution is always distinguishable from inspection and remains gated by the
operator.

## Recommended shell

- **Compact command header:** subject identity, canonical source, evidence-channel
  state, current change, revision and update time. No marketing hero competes with the
  workspace.
- **Status strip:** linked evidence, freshness, requirement coverage and named
  violations stay visible as operational signals rather than a separate report.
- **Centre:** the complete subject graph. Selecting a fact preserves its recorded
  ancestors and descendants while the drawer changes context beside it.
- **Follow live:** enabled by default. A new persisted revision activates its newest
  meaningful fact; manual history selection pauses following until the operator resumes.
- **Feed:** a secondary tab for chronological review. Each active card owns a scoped
  graph containing every recorded ancestor and descendant, not only the shortest path.
- **Right drawer:** one sticky, resizable tool inspector. It follows selection without
  changing the feed or topology viewport.
- **Drawer rail:** SysON, build123d, CalculiX, Modelica and ERPNext remain visible as
  facets of the same engineering subject. A facet with no observed evidence stays
  visible but disabled.
- **Drawer body:** selected identity, provider role, related artifacts, observations,
  requirements, violations, attestations and proposed actions.
- **Full tool view:** an optional native route or workspace tab for geometry, mesh,
  plots, SysML diagrams or BOM tables. It replaces the centre viewport temporarily; it
  is never a mini-app embedded inside the drawer.

On a narrow screen the right drawer becomes a bottom sheet. Tabs should be reserved for
full native tool views, not used to keep five provider panels alive at once.

## Selection and tool-panel contract

The graph selection is authoritative for the right drawer. Selecting a node always opens
the panel for that node's recorded `system`, including graph-only entities such as
consumptions, evaluations and actions. When the node also projects an artifact,
observation, requirement, violation or change record, the drawer enables **Exact
record** as a second level of detail. Otherwise that tab stays disabled; the Workbench
must never leave a previous record visible under a new graph selection.

Selecting an edge opens the native handoff inspector with its source, result, relation
and optional producer/consumer attestation. Endpoint navigation returns to the selected
node and its owning-tool panel. Both node and edge inspectors read only the loaded
`ThreadWorkbenchSnapshot`: they do not embed a provider application, create an iframe,
or call MCP from the browser.

## Live transport boundary

The browser first reads `GET /api/thread/workbench`, then follows
`GET /api/thread/workbench/events` over SSE. The event ID is the canonical snapshot
revision. Each event carries a complete validated browser projection, so reconnect and
replay are deterministic and no half-written graph delta can become visible.

The current server observes the immutable snapshot store every 500 ms. It never invokes
an MCP tool. Therefore “live” currently means that an assembler or agent has persisted a
new canonical revision. A future executor may publish running placeholders, but those
must remain visibly provisional and must resolve to persisted evidence before supporting
a verdict.

`ToolInspectorPanel` is read-only by construction. It receives the latest loaded
`ThreadWorkbenchSnapshot`, the active graph node and its optional richer record,
performs no network call, and exposes callbacks for selection, preparing an action, and
host-owned navigation to a full native tool view. A branch that only shares the declared
subject identity is labelled independent until an explicit cross-tool dependency exists
in the Workbench projection.
