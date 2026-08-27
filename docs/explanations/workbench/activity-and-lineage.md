# Activity-first Workbench UX: evidence arrives, contextual lineage grows

Audience: both · Diátaxis: explanation · Kind: explanation

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
- **Evidence graph:** one native canvas owns the Evidence space, fit/zoom controls,
  legend and large-topology inspection. Revision history is folded into its current
  evidence node instead of creating a second graph mode. The canvas paints the
  Thread dossier (`origin: provenance` and `structure`) as one Graphology
  `MultiDirectedGraph`. `AnalysisGraph` stays a semantic index: its
  `analysis-node` overlay is not painted, so a sensitivity study cannot appear
  as a second disconnected graph. Graphology never grants admission, a join,
  or an execution.
- **Right drawer:** one sticky, resizable tool inspector. It follows selection without
  changing the feed or topology viewport and exposes the selected node's exact recorded
  versions and their internal transition relations.
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

## Versioned provenance graph (`thread-evidence-family-graph/1.0`)

`thread-evidence-family-graph/1.0` is a BFF presentation policy, not another source of
engineering truth. The canonical graph remains immutable and complete. The Workbench
renders one provenance graph in which an explicitly declared **direct** `supersedes`
lineage becomes one current evidence node carrying its revision history. Every canonical
node, edge, and exact reference remains available through that node's inspector.

Family membership is proved only by those explicit direct relations and stable entity
references. Matching labels, provider, URI, content hash, timestamp, or `freshness` are
never proof that two records are the same evidence family. The projection must not take
a transitive closure through `derived_from`, `uses`, or `input_to`: a correction can fan
out to several independent CAD, proof, STEP, and result families without becoming one
large connected-component card.

The visible graph is a quotient DAG. A version count inside a node shows that earlier
records were replaced, but the projection never emits a literal loop, self-edge, or
invented causal edge. A topology may explicitly converge several historical records on
one successor; that preserves one current record without inventing an order between the
historical predecessors. Selecting the node opens the existing tool inspector, where the
internal canonical relations explain each transition.

There is no alternate "all versions" graph. External relations which repeat across
versions share one visible handoff; the edge inspector retains the exact member edges.
Relations with different attestation states remain separate so a historic mismatch can
never be visually merged into a verified current handoff. Failed attempts, observations,
and evaluations stay their own recorded facts unless the canonical model explicitly
places them in a compatible supersession family.

There is a current contract limit: canonical `supersedes` records a relation and a
factual rationale, but not yet a typed semantic distinction such as invalidation,
evidence replacement, or identity repair. Until that semantic kind and a stable
evidence-lineage identity are recorded, the BFF must leave ambiguous edges ungrouped. It
must not parse rationale text or infer a family from labels or hashes.

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

The data model behind this UX — four layers, three `origin` vocabularies, and
what a live head actually emits — is inventoried in
[`docs/reference/contracts/graph-data-model.md`](../../reference/contracts/graph-data-model.md).

## Evidence canvas: one Graphology dossier

The BFF still projects `AnalysisGraph` as browser-safe `origin: "analysis"`
data. Product and tests may inspect that index. The Evidence canvas does not
paint it. Painting those nodes created disconnected islands (brief, FEA
sensitivity, other analysis families) that looked like three graphs.

The presentation model is a Graphology `MultiDirectedGraph` loaded from the
Thread dossier after closed actions and the analysis overlay are removed.
Connected components, neighbourhood, and the Sigma canvas all read that
same directed multigraph. Positions come from one deterministic dagre LR
layout. Evidence no longer has a second SVG Map organisation of the same
dossier. Activity may still render a small SVG fallback when no Evidence
model is available. Parallel recorded relations stay distinct edges. The
canvas does not invent an analysis→Thread join to re-attach a sensitivity
island. The sensitivity *campaign* (case, study, edges, join capture,
instrument observations) is folded from Evidence: it is accumulated
neighbourhood experience, not a second construction study. Study-base
evaluations stay on the Thread requirements they evaluate, so the experience
remains attached to the dossier instead of floating as a separate graph.
Provider solver envelopes (`solver-input`, `solver-result`) are folded
the same way: `CalculiX input.step` is a byte-identical copy of the
authoritative STEP, and `result.json` is the raw container of the
already-painted observations. They are not a second build123d product.
An authoritative STEP and its GLB preview are two recorded artifacts
(the agent still publishes both hashes). The canvas draws them as one
node so the dossier does not look like two CAD products. Focusing the
node restores both identities.
