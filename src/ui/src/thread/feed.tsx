/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import type { ThreadStreamStatus } from "./client.ts";
import {
  activityFeedNodes,
  buildFeedComponentCounts,
  compactLineageCounters,
  isActivityEntryExpanded,
  refKey,
  traceThreadLineage,
} from "./feed-model.ts";
import { ThreadGraph, type ThreadGraphSelection } from "./graph.tsx";
import { EvidenceExploration } from "./evidence-exploration.tsx";
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import { RecomputeHistoryPanel } from "./recompute.tsx";
import type {
  ThreadComponentCatalog,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRef,
} from "./types.ts";
import type { PartAnchor } from "./part-anchorage-model.ts";

export interface ThreadFeedProps {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  focus?: ThreadGraphRef;
  selection?: ThreadGraphSelection;
  followLive: boolean;
  streamStatus: ThreadStreamStatus | "snapshot";
  /**
   * When provided, the active card's lineage is rendered as a local sigma
   * view (one instance only, mounted on expand and killed on collapse) instead
   * of the SVG canvas. Reuses the same EvidenceExploration component and
   * dagre layout as the Evidence Exploration mode.
   */
  evidenceModel?: EvidenceGraphModel;
  /**
   * Component filter for the feed entries. When set, only activity events
   * anchored to this component are shown. Unanchored events are treated as
   * "assembly" scope (shown in project-wide and assembly views).
   * undefined = "Tout le projet" (no filter).
   */
  filterComponentId?: string;
  /**
   * Anchorage map (nodeKey → PartAnchor) used to filter feed entries by
   * component. Must be provided together with filterComponentId.
   */
  anchorage?: ReadonlyMap<string, PartAnchor>;
  /**
   * Component catalog for the filter selector labels. Must be provided when
   * anchorage is present.
   */
  components?: ThreadComponentCatalog;
  /** Fires when the user changes the component filter in the feed toolbar. */
  onFilterChange?: (componentId: string | undefined) => void;
  onFollowLiveChange: (follow: boolean) => void;
  onSelectNode: (node: ThreadGraphNode, origin: "feed" | "lineage") => void;
  onSelectEdge: (edge: ThreadGraphEdge) => void;
  onInspect: (selection: ThreadRef, node: ThreadGraphNode) => void;
  /**
   * Opens the evidence canvas anchored on the given node ref.
   * Used by both the "Open evidence canvas" button (anchored on the card's
   * fact) and by node clicks inside the vignette (anchored on the clicked node).
   * Implements changeView("verification") + setLineageFocus(ref) + setGraphSelection.
   */
  onOpenEvidenceAnchored?: (ref: ThreadGraphRef) => void;
}

/**
 * An activity feed whose active entry carries its complete recorded subgraph.
 * New snapshot facts appear automatically; selection is only for revisiting
 * history, never a prerequisite for building lineage.
 */
export function ThreadFeed({
  nodes,
  edges,
  focus,
  selection,
  followLive,
  streamStatus,
  evidenceModel,
  filterComponentId,
  anchorage,
  components,
  onFilterChange,
  onFollowLiveChange,
  onSelectNode,
  onSelectEdge,
  onInspect,
  onOpenEvidenceAnchored,
}: ThreadFeedProps): JSX.Element {
  const allFeedNodes = activityFeedNodes(nodes, edges);

  // Counts per component target across ALL feed events (before filtering).
  // Used to populate the selector with only meaningful options + true counts.
  // The anchorage map is keyed as "kind:id" (produced by buildPartAnchorage),
  // NOT the null-byte format used by the local refKey for lineage traversal.
  const componentCounts = anchorage
    ? buildFeedComponentCounts(allFeedNodes, anchorage)
    : undefined;

  // Apply component filter if requested. Unanchored nodes fall back to
  // "assembly" scope and are shown in the project-wide and assembly views.
  // Same key format as componentCounts: kind:id (matches anchorage map keys).
  const feedNodes = filterComponentId !== undefined && anchorage
    ? allFeedNodes.filter((node) => {
      const key = `${node.ref.kind}:${node.ref.id}`;
      const anchor = anchorage.get(key);
      const target = anchor ? anchor.target : "assembly";
      return target === filterComponentId;
    })
    : allFeedNodes;

  const focusNode = focus
    ? nodes.find((node) => refKey(node.ref) === refKey(focus))
    : undefined;
  const focusIsPrimary = focusNode &&
    feedNodes.some((node) => refKey(node.ref) === refKey(focusNode.ref));
  const entries = focusNode && !focusIsPrimary
    ? [focusNode, ...feedNodes]
    : feedNodes;

  // Build component options for the filter selector.
  // Only parts with >= 1 event appear; counts are shown in the label.
  const filterOptions = components
    ? buildFilterOptions(components, componentCounts)
    : undefined;

  if (entries.length === 0 && !filterOptions) {
    return (
      <div class="thread-feed-empty" role="status">
        Waiting for the first linked engineering fact.
      </div>
    );
  }

  return (
    <div
      class="thread-feed"
      data-follow-live={followLive ? "true" : "false"}
      data-stream={streamStatus}
    >
      <div class="thread-feed-toolbar">
        <div>
          <span class="thread-live-pulse" aria-hidden="true" />
          <strong>{streamLabel(streamStatus, followLive)}</strong>
          <small>
            {entries.length} meaningful events · support records on demand
          </small>
        </div>
        <button
          type="button"
          aria-pressed={followLive}
          onClick={() => onFollowLiveChange(!followLive)}
        >
          {followLive ? "Pause follow" : "Resume live"}
        </button>
      </div>

      {filterOptions && onFilterChange && (
        <div
          class="thread-feed-component-filter"
          aria-label="Filtrer par pièce"
        >
          <label for="feed-component-filter">PIÈCE</label>
          <select
            id="feed-component-filter"
            value={filterComponentId ?? ""}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              onFilterChange(val === "" ? undefined : val);
            }}
          >
            <option value="">Tout le projet</option>
            {filterOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {entries.length === 0 && (
        <div class="thread-feed-empty" role="status">
          {filterComponentId
            ? "Aucun événement pour cette pièce."
            : "Waiting for the first linked engineering fact."}
        </div>
      )}

      <ol class="thread-feed-list" aria-label="Linked engineering activity">
        {entries.map((node, index) => {
          const active = isActivityEntryExpanded(focus, node);
          const lineage = active
            ? traceThreadLineage(nodes, edges, focus)
            : undefined;
          // True upstream+downstream count for the collapsed card badge:
          // uses the raw graph lineage (full depth, not bounded).
          const lineageCount = lineage
            ? lineage.upstream.length + lineage.downstream.length +
              lineage.feedback.length
            : traceThreadLineage(nodes, edges, node.ref).upstream.length +
              traceThreadLineage(nodes, edges, node.ref).downstream.length;

          // Compact counters for the expanded lineage header: reflect what the
          // sigma vignette actually renders (bounded neighbourhood, depth 2).
          const compact = active && evidenceModel
            ? compactLineageCounters(evidenceModel, node.ref)
            : undefined;

          return (
            <li
              key={node.id}
              class="thread-feed-entry"
              data-active={active ? "true" : "false"}
              data-kind={node.entityKind}
              data-freshness={node.freshness}
              style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}
            >
              <div class="thread-feed-time" aria-label={node.recordedAt}>
                <strong>{formatFeedTime(node.recordedAt)}</strong>
                <span>{formatFeedDate(node.recordedAt)}</span>
              </div>
              <div class="thread-feed-rail" aria-hidden="true">
                <i />
              </div>
              <div class="thread-feed-event">
                <button
                  type="button"
                  class="thread-feed-card"
                  aria-expanded={active}
                  onClick={() => onSelectNode(node, "feed")}
                >
                  <span
                    class="thread-feed-provider"
                    data-system={systemKey(node.system)}
                  >
                    {providerMark(node.system)}
                  </span>
                  <span class="thread-feed-copy">
                    <small>
                      {node.system} · {kindLabel(node)}
                    </small>
                    <strong>{node.label}</strong>
                    <span>{node.summary}</span>
                  </span>
                  <span class="thread-feed-meta">
                    <i data-state={node.freshness}>{node.freshness}</i>
                    <b>{lineageCount} linked</b>
                  </span>
                </button>

                {active && lineage && (
                  <section
                    class="thread-feed-lineage"
                    aria-label={`Live lineage for ${node.label}`}
                  >
                    <header>
                      <div>
                        <small>LINEAGE ASSEMBLED FROM RECORDED RELATIONS</small>
                        <strong>Complete chain for this event</strong>
                      </div>
                      <div class="thread-feed-lineage-actions">
                        {compact
                          ? (
                            <span>
                              {compact.total} faits · profondeur 2 ·{" "}
                              {compact.upstream} amont / {compact.downstream}
                              {" "}
                              aval
                            </span>
                          )
                          : (
                            <span>
                              {lineage.upstream.length} upstream ·{" "}
                              {lineage.downstream.length} downstream
                            </span>
                          )}
                        {onOpenEvidenceAnchored && (
                          <button
                            type="button"
                            onClick={() => onOpenEvidenceAnchored(node.ref)}
                          >
                            Open evidence canvas
                          </button>
                        )}
                      </div>
                    </header>
                    <RecomputeHistoryPanel
                      nodes={nodes}
                      edges={edges}
                      focus={node.ref}
                      onSelectNode={(related) =>
                        onSelectNode(related, "lineage")}
                    />
                    {lineageCount === 0
                      ? (
                        <p class="thread-feed-unlinked">
                          This fact is recorded, but no causal relation connects
                          it to another fact yet.
                        </p>
                      )
                      : evidenceModel
                      ? (
                        <FeedLineageGraph
                          evidenceModel={evidenceModel}
                          focusRef={node.ref}
                          selection={selection}
                          onSelectNode={(related) =>
                            onSelectNode(related, "lineage")}
                          ariaLabel={`Complete recorded lineage for ${node.label}`}
                        />
                      )
                      : (
                        <ThreadGraph
                          key={refKey(node.ref)}
                          nodes={[
                            ...lineage.upstream.map((step) => step.node),
                            node,
                            ...lineage.feedback.map((step) => step.node),
                            ...lineage.downstream.map((step) => step.node),
                          ]}
                          edges={lineage.edges}
                          focus={node.ref}
                          selection={selection}
                          showSupporting
                          showDensityControl={false}
                          animate
                          ariaLabel={`Complete recorded lineage for ${node.label}`}
                          onSelectionChange={(next) => {
                            if (next?.kind === "edge") {
                              const edge = edges.find((item) =>
                                item.id === next.id
                              );
                              if (edge) onSelectEdge(edge);
                            } else if (next?.kind === "node") {
                              const selected = nodes.find((item) =>
                                refKey(item.ref) === refKey(next.ref)
                              );
                              if (selected) onSelectNode(selected, "lineage");
                            }
                          }}
                          onInspect={onInspect}
                        />
                      )}
                  </section>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeedLineageGraph — compact sigma view for the expanded card lineage
// ---------------------------------------------------------------------------

interface FeedLineageGraphProps {
  evidenceModel: EvidenceGraphModel;
  focusRef: ThreadGraphRef;
  selection?: ThreadGraphSelection;
  /**
   * Selects the clicked node's activity IN PLACE — the reader stays in the
   * Activity space (operator decision 2026-08-08: a vignette click must never
   * change space). Leaving for the Evidence canvas remains an explicit act:
   * the "Open evidence canvas" button on the card header.
   */
  onSelectNode: (node: ThreadGraphNode) => void;
  ariaLabel: string;
}

/**
 * Compact sigma view for a single expanded feed card.
 *
 * Uses `boundedNeighborhood(focusRef, 2)` from the evidence model. Depth 2
 * (direct neighbours + their direct neighbours) keeps the card view compact
 * and legible without losing the immediate causal context. The full graph is
 * available in the Evidence tab via the "Open evidence canvas" button.
 *
 * Layout: same dagre LR pipeline as the grand canvas via buildExplorationModel
 * (called inside EvidenceExploration). Causal origins land on the left;
 * observations and verdicts on the right. compact=true suppresses the
 * Composantes legend and sets labelRenderedSizeThreshold=0 so all labels are
 * always visible in the bounded view.
 *
 * Performance contract: only ONE instance is mounted at a time. This component
 * is rendered only when the card is expanded; it unmounts on collapse or on
 * selection of a different card (key={refKey(focusRef)} in the parent).
 *
 * Click contract: single click on a node selects the matching activity in
 * the feed and stays in Activity. No dblclick action, no space change.
 */
function FeedLineageGraph({
  evidenceModel,
  focusRef,
  selection,
  onSelectNode,
  ariaLabel,
}: FeedLineageGraphProps): JSX.Element {
  // Bounded neighborhood depth 2: direct neighbours + their direct neighbours.
  // Keeps the card-level sigma view compact (profondeur bornée à 2 sauts).
  const neighborhood = useMemo(
    () => evidenceModel.boundedNeighborhood(focusRef, 2),
    [evidenceModel, focusRef],
  );

  // Build the EvidenceCanvasProjection from the neighborhood.
  const projection = useMemo((): EvidenceCanvasProjection => {
    return {
      nodes: neighborhood.nodes,
      edges: neighborhood.edges,
      displayedCount: neighborhood.nodes.length,
      foldedInstrumentCount: 0,
      isFiltered: true,
      supportingNodeCount: 0,
    };
  }, [neighborhood]);

  // Fall back gracefully when the focus node is not in the visible graph.
  if (neighborhood.nodes.length === 0) {
    return (
      <p class="thread-feed-unlinked">
        This fact is recorded, but it is not currently present in the evidence
        graph (it may be a folded historical version).
      </p>
    );
  }

  return (
    <div class="thread-feed-lineage-sigma" aria-label={ariaLabel}>
      <EvidenceExploration
        evidenceModel={evidenceModel}
        projection={projection}
        selection={selection}
        compact
        onSelectionChange={(next) => {
          // Single click on a vignette node: select the matching activity and
          // STAY in the Activity space. Edge clicks and background clicks are
          // not handled in the vignette — the full Evidence tab is the
          // entry-point for those interactions.
          if (next?.kind === "node") {
            const selected = neighborhood.nodes.find(
              (candidate) =>
                candidate.ref.kind === next.ref.kind &&
                candidate.ref.id === next.ref.id,
            );
            if (selected) onSelectNode(selected);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindLabel(node: ThreadGraphNode): string {
  return node.entityKind === "artifact" && node.artifactKind
    ? node.artifactKind
    : node.entityKind;
}

/**
 * Build the list of options for the component filter selector.
 *
 * Assembly first ("Tout l'assemblage"), then parts sorted by label.
 * When `counts` is provided, options are filtered to only those with at least
 * one attributed activity event (count > 0). The count is displayed in the
 * option label so the reviewer knows at a glance how many events exist per part.
 * Parts with zero events are not actionable filter targets and are omitted.
 */
function buildFilterOptions(
  components: ThreadComponentCatalog,
  counts?: ReadonlyMap<string, number>,
): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  const assembly = components.components.find((c) => c.kind === "assembly");
  if (assembly) {
    const count = counts?.get("assembly") ?? 0;
    // Assembly option is always shown when there are counts available (even if
    // count is 0 — assembly is the scope for all unanchored events, so it
    // appears once the anchorage is in place). Without counts, always shown.
    if (!counts || count > 0) {
      const suffix = counts ? ` · ${count}` : "";
      result.push({
        id: "assembly",
        label: `${assembly.label} (assemblage)${suffix}`,
      });
    }
  }
  const parts = components.components
    .filter((c) => c.kind !== "assembly")
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const part of parts) {
    const count = counts?.get(part.id) ?? 0;
    // Only include parts with at least one attributed event in the feed.
    if (counts && count === 0) continue;
    const suffix = counts ? ` · ${count}` : "";
    result.push({ id: part.id, label: `${part.label}${suffix}` });
  }
  return result;
}

function streamLabel(
  status: ThreadStreamStatus | "snapshot",
  followLive: boolean,
): string {
  if (!followLive) return "History paused";
  if (status === "connecting") return "Connecting evidence stream";
  if (status === "reconnecting") return "Reconnecting evidence stream";
  if (status === "snapshot") return "Snapshot history";
  return "Following live evidence";
}

function providerMark(system: string): string {
  const normalized = system.toLowerCase();
  if (normalized.includes("build123d")) return "B3";
  if (normalized.includes("calculix")) return "CX";
  if (normalized.includes("modelica")) return "MO";
  if (normalized.includes("erpnext")) return "ER";
  if (normalized.includes("syson")) return "SY";
  if (normalized.includes("digital-thread")) return "DT";
  return system.slice(0, 2).toUpperCase();
}

function systemKey(system: string): string {
  return system.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function formatFeedTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatFeedDate(value: string | undefined): string {
  if (!value) return "not dated";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "not dated";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(date);
}
