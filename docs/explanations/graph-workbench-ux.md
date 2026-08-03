# Activity-first Workbench UX: evidence arrives, contextual lineage grows

The primary product surface is the engineering activity feed: it lets a beginner follow
what the agent changed, what evidence appeared, and what needs review. The linked graph
explains why a selected fact depends on its sources, what it affects downstream, and
where evidence remains disconnected. The feed never creates lineage; both views project
the same canonical thread.

The feed is not an agent transcript. Raw reasoning and transient console text do not
become engineering truth. Cards represent canonical changes, important artifacts,
unit-bearing observations, evaluations, violations, and actions. Supporting scripts,
capture artifacts, and consumption records remain available inside lineage without
turning the feed into a 39-row implementation log.

The page is not a static dashboard. It is the shared live dossier for an engineer and an
agent: activity establishes what happened, lineage establishes what it means for the
chain, and the active tool context exposes the evidence behind the next conversational
decision. It remains read-only; execution and human authority stay in the paired agent
conversation.

## Recommended shell

- **Compact project header:** subject identity, canonical source, evidence-channel
  state, current change, revision and update time. No marketing hero competes with the
  workspace.
- **Status strip:** linked evidence, freshness, requirement coverage and named
  violations stay visible as operational signals rather than a separate report.
- **Centre:** the project path and chronological activity. Selecting a fact opens its
  bounded ancestor-and-descendant lineage without losing the current work context.
- **Follow live:** enabled by default. A new persisted revision activates its newest
  meaningful fact; manual history selection pauses following until the operator resumes.
- **Context graph:** each active card can reveal a scoped graph containing every
  recorded ancestor and descendant, not only the shortest path.
- **Full graph:** an explicit expanded workspace owns the available viewport, fit/zoom
  controls, legend, and large-topology inspection. It is not compressed into a card.
- **Right drawer:** one sticky, resizable tool inspector. It follows selection without
  changing the feed or topology viewport.
- **Provider facets:** SysON, build123d, CalculiX, Modelica and ERPNext remain available
  inside the inspector as compact context controls. They do not create another permanent
  vertical rail before the useful content. A facet with no observed evidence stays
  visible but disabled.
- **Drawer body:** selected identity, provider role, related artifacts, observations,
  requirements, violations, attestations and proposed actions.
- **Full tool view:** an optional native route or workspace tab for geometry, mesh,
  plots, SysML diagrams or BOM tables. It replaces the centre viewport temporarily; it
  is never a mini-app embedded inside the drawer.

On a narrow screen the right drawer becomes a bottom sheet. Tabs should be reserved for
full native tool views, not used to keep five provider panels alive at once. Nodes,
edges, relation colors, arrows, and legend samples must use the same visual tokens;
semantic edges are strokes, never decorative filled ribbons that imply an area value.

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
`GET /api/thread/workbench/events` over SSE. The event ID is
`<project-revision>:<thread-revision>:<live-sequence>`. Each event carries a complete
validated browser projection, so reconnect and replay are deterministic and no
half-written graph delta can become visible.

The current server observes the immutable thread, project, and live-update stores every
500 ms. It never invokes an MCP tool. Therefore “live” means that an assembler, an agent
control-plane command, or a registered backend operation has persisted a new revision.
Provisional run events must remain visibly provisional and must resolve to persisted
evidence before supporting a verdict or project completion.

`ToolInspectorPanel` is read-only by construction. It receives the latest loaded
`ThreadWorkbenchSnapshot`, the active graph node and its optional richer record,
performs no network call, and exposes callbacks for selection, preparing an action, and
host-owned navigation to a full native tool view. A branch that only shares the declared
subject identity is labelled independent until an explicit cross-tool dependency exists
in the Workbench projection.
