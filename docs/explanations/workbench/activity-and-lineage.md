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
chain, and the active record inspector exposes fields and relations already loaded for
the next conversational decision. It remains read-only; execution and human authority
stay in the paired agent conversation.

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
- **Evidence graph:** one generic graph canvas owns the Evidence space, fit/zoom
  controls, legend and large-topology inspection. Revision history is folded into its
  current evidence node instead of creating a second graph mode. The canvas paints the
  Thread dossier (`origin: provenance` and `structure`) as one Graphology
  `MultiDirectedGraph`. `AnalysisGraph` stays a semantic index: its `analysis-node`
  overlay is not painted, so a sensitivity study cannot appear as a second disconnected
  graph. Graphology never grants admission, a join, or an execution.
- **Right drawer:** one sticky, resizable generic record inspector. It follows selection
  without changing the feed or topology viewport and exposes the selected node's exact
  recorded versions and their internal transition relations.
- **Recorded context:** provider identities such as SysON, build123d, CalculiX, Modelica
  and ERPNext may appear only as compact identity/provenance fields. They do not render
  a provider surface or imply that an App binding exists.
- **Drawer body:** selected identity, raw graph and record fields, exact incident
  relations, loaded neighbour records and recorded attestations.
- **Whole App handoff:** a complete geometry, mesh, plot, SysML or BOM surface belongs
  to its versioned MCP App. Product lists only exact registered descriptors and returns
  to the Project whiteboard, where the generic sandboxed frame hosts that App.

On a narrow screen the right drawer becomes a bottom sheet. The same generic inspector
continues to show graph fields, exact record fields, and recorded relations; it does not
keep a second native record renderer alive. Nodes, edges, relation colors, arrows, and
legend samples must use the same visual tokens; semantic edges are strokes, never
decorative filled ribbons that imply an area value.

## Selection and record-panel contract

The graph selection is authoritative for the right drawer. Selecting a node always opens
the panel for that exact graph reference, including graph-only entities such as
consumptions, evaluations and actions. The recorded `system` is displayed only as a raw
field; it does not choose a renderer or classify a provider facet. When the node also
projects an artifact, observation, requirement, violation or change record, the same
generic panel lists that record's stored fields. The Workbench must never leave a
previous record visible under a new graph selection.

Selecting an edge opens the generic relation inspector with its source, result, relation
and optional producer/consumer attestation. Endpoint navigation returns to the selected
node and its generic record panel. Both node and edge inspectors read only the loaded
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
historical predecessors. Selecting the node opens the generic record inspector, where
the internal canonical relations explain each transition.

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

`RecordInspectorPanel` is read-only by construction. It receives the latest loaded
`ThreadWorkbenchSnapshot`, the active graph node and its optional richer record,
performs no network call, and exposes callbacks only for exact record and graph
selection. It neither classifies the selection by producer nor prepares actions or
navigates to a native domain view.

The data model behind this UX — four layers, three `origin` vocabularies, and what a
live head actually emits — is inventoried in
[`docs/reference/contracts/graph-data-model.md`](../../reference/contracts/graph-data-model.md).

## Evidence canvas: one Graphology dossier

The BFF still projects `AnalysisGraph` as browser-safe `origin: "analysis"` data.
Product and tests may inspect that index. The Evidence canvas does not paint it.
Painting those nodes created disconnected islands (brief, FEA sensitivity, other
analysis families) that looked like three graphs.

The presentation model is a Graphology `MultiDirectedGraph` loaded from the Thread
dossier after closed actions and the analysis index are omitted from the main canvas.
Connected components, neighbourhood, and the Sigma canvas all read that same directed
multigraph. Positions come from one deterministic dagre LR layout. Evidence no longer
has a second SVG Map organisation of the same dossier. Activity may still render a small
SVG fallback when no Evidence model is available. Parallel recorded relations stay
distinct edges. The canvas does not invent an analysis→Thread join to re-attach an
island. It also does not hide a record because its id, producer, or `artifactKind`
resembles a campaign, solver envelope, mesh, or preview. Literal recorded nodes and
relations remain visible; the browser never collapses them into a synthetic CAD, SysML,
solver, or requirements identity. An exact domain presentation belongs to a separately
registered whole MCP App.
