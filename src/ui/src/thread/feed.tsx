import type { JSX } from "react";
import { useMemo } from "react";
import { cn } from "../lib/utils.ts";
import { ActivityReviewFeedCard } from "../project/control-center.tsx";
import {
  type ActivityReviewStatus,
  activityReviewStatus,
  activityReviewStatusLabel,
  type ProjectReviewRecord,
} from "../project/review-decision-model.ts";
import { Badge } from "../ui/badge.tsx";
import { Select } from "../ui/select.tsx";
import { Button } from "../ui/button.tsx";
import type { ThreadStreamStatus } from "./client.ts";
import {
  activityCurrency,
  activityFeedNodes,
  activityKindLabel,
  buildActivityTimeline,
  buildFeedComponentCounts,
  buildFilterOptions,
  compactLineageCounters,
  compactLineageProjection,
  filterFeedNodesByScope,
  isActivityEntryExpanded,
  isArchitectureSysmlSealArtifactId,
  refKey,
  traceThreadLineage,
} from "./feed-model.ts";
import {
  compactEmbeddedFingerprints,
  compactTechnicalSummary,
} from "./compact-identifier-model.ts";
import { ThreadGraph, type ThreadGraphSelection } from "./graph.tsx";
import { EvidenceExploration } from "./evidence-exploration.tsx";
import type { EvidenceGraphModel } from "./evidence-graph-model.ts";
import type { EvidenceCanvasProjection } from "./evidence-canvas-model.ts";
import { RecomputeHistoryPanel } from "./recompute.tsx";
import type {
  ThreadComponentCatalog,
  ThreadEvidenceFamilyGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRef,
} from "./types.ts";
import type { FeedScope } from "./feed-model.ts";
import type { PartAnchorageResolution } from "./part-anchorage-model.ts";

export interface ThreadFeedProps {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  focus?: ThreadGraphRef;
  selection?: ThreadGraphSelection;
  followLive: boolean;
  streamStatus: ThreadStreamStatus | "snapshot";
  /**
   * Recorded snapshot identity for the feed footer (`<id>@<revision>`).
   * Absent hides the footer — the feed never invents an identity.
   */
  threadIdentity?: { id: string; revision: string };
  /**
   * When provided, the active card's lineage is rendered as a local sigma
   * view (one instance only, mounted on expand and killed on collapse) instead
   * of the SVG canvas. Reuses the same EvidenceExploration component and
   * dagre layout as the Evidence Exploration mode.
   */
  evidenceModel?: EvidenceGraphModel;
  /**
   * Component filter for the feed entries. When set, only activity events
   * anchored to this component are shown. Conflicting and absent anchors have
   * explicit, separate filter scopes and are never treated as assembly.
   * undefined = "Tout le projet" (no filter).
   */
  filterComponentId?: FeedScope;
  /**
   * Complete anchorage outcome used to filter feed entries. Must be provided
   * together with filterComponentId so unique, ambiguous and orphan outcomes
   * retain their distinct meaning.
   */
  anchorage?: PartAnchorageResolution;
  /**
   * Component catalog for the filter selector labels. Must be provided when
   * anchorage is present.
   */
  components?: ThreadComponentCatalog;
  /**
   * Evidence family graph already projected on the workbench snapshot.
   * Activity currency reads `historicalRefs` from it; the feed does not
   * reconstruct supersession from labels or timestamps.
   */
  familyGraph?: ThreadEvidenceFamilyGraph;
  /** Durable human reviews merged into the same chronological Activity rail. */
  reviewRecords?: readonly ProjectReviewRecord[];
  /** Fires when the user changes the component filter in the feed toolbar. */
  onFilterChange?: (componentId: FeedScope | undefined) => void;
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
  /** Opens the exact published result attached to a validated review. */
  onOpenReviewEvidence?: (ref: ThreadGraphRef) => void;
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
  threadIdentity,
  evidenceModel,
  filterComponentId,
  anchorage,
  components,
  familyGraph,
  reviewRecords = [],
  onFilterChange,
  onFollowLiveChange,
  onSelectNode,
  onSelectEdge,
  onInspect,
  onOpenEvidenceAnchored,
  onOpenReviewEvidence,
}: ThreadFeedProps): JSX.Element {
  const allFeedNodes = activityFeedNodes(nodes, edges);

  // Counts per component target across ALL feed events (before filtering).
  // Used to populate the selector with only meaningful options + true counts.
  const componentCounts = anchorage
    ? buildFeedComponentCounts(allFeedNodes, anchorage)
    : undefined;

  // Apply a component or explicit non-anchored scope filter. The complete
  // resolution prevents ambiguous/orphan facts acquiring assembly scope.
  const feedNodes = filterComponentId !== undefined && anchorage
    ? filterFeedNodesByScope(allFeedNodes, anchorage, filterComponentId)
    : allFeedNodes;

  // A component filter is authoritative. Keeping an old global focus by
  // prepending it here made Activity show an out-of-filter fact while every
  // counter still claimed the filtered total.
  const entries = buildActivityTimeline(
    feedNodes,
    reviewRecords,
    filterComponentId === undefined,
  );
  // Build component options for the filter selector.
  // Only parts with >= 1 event appear; counts are shown in the label.
  const filterOptions = components
    ? buildFilterOptions(components, componentCounts)
    : undefined;

  if (entries.length === 0 && !filterOptions) {
    return (
      <div
        className="px-8 py-8 text-sm text-muted-foreground"
        role="status"
      >
        Waiting for the first linked engineering fact.
      </div>
    );
  }

  // Chronological day groups (mockup 7a): a mono header per recorded day,
  // counting only that day's recorded facts. Entries stay in timeline order.
  type FeedRow =
    | {
      kind: "day";
      key: string;
      label: string;
      count: number;
      first: boolean;
    }
    | { kind: "entry"; entry: (typeof entries)[number]; index: number };
  const rows: FeedRow[] = [];
  let currentDay: Extract<FeedRow, { kind: "day" }> | undefined;
  let entryIndex = 0;
  for (const entry of entries) {
    const recordedAt = entry.kind === "review"
      ? entry.recordedAt
      : entry.node.recordedAt;
    const label = feedDayLabel(recordedAt);
    if (!currentDay || currentDay.label !== label) {
      currentDay = {
        kind: "day",
        key: `day:${label}:${rows.length}`,
        label,
        count: 0,
        first: rows.length === 0,
      };
      rows.push(currentDay);
    }
    currentDay.count += 1;
    rows.push({ kind: "entry", entry, index: entryIndex });
    entryIndex += 1;
  }

  return (
    <div
      className="thread-feed"
      data-follow-live={followLive ? "true" : "false"}
      data-stream={streamStatus}
    >
      {filterOptions && onFilterChange && (
        <div
          className="thread-feed-component-filter flex items-center gap-2"
          aria-label="Filter by part"
        >
          <span
            id="feed-component-filter-label"
            className="text-xs font-medium text-muted-foreground"
          >
            Part
          </span>
          <Select
            aria-labelledby="feed-component-filter-label"
            className="min-w-44"
            value={filterComponentId ?? "entire-project"}
            options={[
              { value: "entire-project", label: "Entire project" },
              ...filterOptions.map((opt) => ({
                value: opt.id,
                label: opt.label,
              })),
            ]}
            onValueChange={(value) => {
              onFilterChange(
                value === "entire-project" ? undefined : value as FeedScope,
              );
            }}
          />
        </div>
      )}

      {entries.length === 0 && (
        <div
          className="px-8 py-8 text-sm text-muted-foreground"
          role="status"
        >
          {filterComponentId
            ? "No event is recorded for this scope."
            : "Waiting for the first linked engineering fact."}
        </div>
      )}

      <div className="thread-feed-rail-grid">
        <div className="thread-feed-rail-line" aria-hidden="true" />
        <ol
          className="thread-feed-list"
          aria-label="Linked engineering activity"
        >
          {rows.map((row) => {
            if (row.kind === "day") {
              return (
                <li key={row.key} className="thread-feed-dayhead">
                  <span>
                    {row.label} · {row.count} recorded fact
                    {row.count === 1 ? "" : "s"}
                  </span>
                  {row.first && (
                    <span className="flex items-center gap-2">
                      <span
                        className={livePulseClass(streamStatus, followLive)}
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        aria-pressed={followLive}
                        className="cursor-pointer font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground hover:text-foreground"
                        onClick={() => onFollowLiveChange(!followLive)}
                      >
                        {followLive ? "Pause follow" : "Resume live"}
                      </button>
                    </span>
                  )}
                </li>
              );
            }
            const { entry, index } = row;
            if (entry.kind === "review") {
              const status = activityReviewStatus(entry.review);
              return (
                <li
                  id={entry.review.anchorId}
                  key={entry.key}
                  className="thread-feed-entry"
                  data-review-status={status}
                  data-canonical-review-status={status}
                  style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}
                >
                  <span className="thread-feed-dot" aria-hidden="true" />
                  <div className="thread-feed-event">
                    <ActivityReviewFeedCard
                      record={entry.review}
                      onOpenEvidence={onOpenReviewEvidence}
                    />
                  </div>
                </li>
              );
            }
            const node = entry.node;
            const attachedReview = entry.review;
            const reviewStatus = attachedReview
              ? activityReviewStatus(attachedReview)
              : undefined;
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
            const currency = activityCurrency(node, familyGraph);
            // 7a: a pending decision reads as ONE warning-bordered card —
            // the fact button and its review composer share the outline.
            const needsReviewBorder = reviewStatus === "to-review" ||
              reviewStatus === "revision-requested";

            return (
              <li
                id={attachedReview?.anchorId}
                key={entry.key}
                className="thread-feed-entry"
                data-active={active ? "true" : "false"}
                data-kind={node.entityKind}
                data-authority={node.entityKind === "artifact" &&
                    node.artifactKind === "document" &&
                    isArchitectureSysmlSealArtifactId(node.ref.id)
                  ? "documentary"
                  : undefined}
                data-currency={currency}
                data-freshness={currency}
                data-review-status={reviewStatus}
                data-canonical-review-status={reviewStatus}
                style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}
              >
                <span className="thread-feed-dot" aria-hidden="true" />
                <div className="thread-feed-event">
                  <button
                    type="button"
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg border bg-card px-3.5 py-3 text-left shadow-sm",
                      "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      needsReviewBorder ? "border-warning/40" : "border-border",
                      active && "rounded-b-none bg-muted/50",
                      attachedReview && "rounded-b-none",
                    )}
                    aria-expanded={active}
                    onClick={() => onSelectNode(node, "feed")}
                  >
                    <span className="grid min-w-0 gap-1.5">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span
                          className="shrink-0 font-mono text-[10px] text-muted-foreground"
                          title={node.recordedAt}
                        >
                          {formatFeedTime(node.recordedAt)}
                        </span>
                        <span className="thread-feed-eyebrow shrink-0">
                          {activityKindLabel(node)}
                        </span>
                        <span
                          className="min-w-0 truncate text-[12.5px] font-medium"
                          title={node.label}
                        >
                          {compactEmbeddedFingerprints(node.label)}
                        </span>
                      </span>
                      <span
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={`${node.system} · ${node.summary}`}
                      >
                        {node.system} · {compactTechnicalSummary(node.summary)}
                      </span>
                    </span>
                    <span className="grid justify-items-end gap-1 text-xs">
                      {reviewStatus && (
                        <Badge
                          variant={reviewDisplayBadgeVariant(reviewStatus)}
                          data-review-status={reviewStatus}
                        >
                          {activityReviewStatusLabel(reviewStatus)}
                        </Badge>
                      )}
                      <span
                        data-state={currency}
                        className={freshnessClass(currency)}
                      >
                        {currency}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {lineageCount} linked
                      </span>
                    </span>
                  </button>

                  {attachedReview && (
                    <ActivityReviewFeedCard
                      record={attachedReview}
                      onOpenEvidence={onOpenReviewEvidence}
                    />
                  )}

                  {active && lineage && (
                    <section
                      className="thread-feed-lineage"
                      aria-label={`Live lineage for ${node.label}`}
                    >
                      <header>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Lineage assembled from recorded relations
                          </p>
                          <p className="text-sm font-semibold">
                            Complete chain for this event
                          </p>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          {compact
                            ? (
                              <span className="text-xs text-muted-foreground">
                                {compact.total} items · depth 2 ·{" "}
                                {compact.upstream} upstream /{" "}
                                {compact.downstream} downstream
                              </span>
                            )
                            : (
                              <span className="text-xs text-muted-foreground">
                                {lineage.upstream.length} upstream ·{" "}
                                {lineage.downstream.length} downstream
                              </span>
                            )}
                          {onOpenEvidenceAnchored && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onOpenEvidenceAnchored(node.ref)}
                            >
                              Open evidence canvas
                            </Button>
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
                          <p className="px-8 py-8 text-sm text-muted-foreground">
                            This fact is recorded, but no causal relation
                            connects it to another fact yet.
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
                              ...lineage.feedback.map((step) =>
                                step.node
                              ),
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
                                const edge = next.occurrence?.edge ??
                                  edges.find((item) => item.id === next.id);
                                if (edge) {
                                  onSelectEdge(edge);
                                }
                              } else if (next?.kind === "node") {
                                const selected = nodes.find((item) =>
                                  refKey(item.ref) === refKey(next.ref)
                                );
                                if (selected) {
                                  onSelectNode(selected, "lineage");
                                }
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
      {threadIdentity && (
        <p className="mt-3.5 font-mono text-[10px] text-muted-foreground">
          {feedStreamFooterLabel(streamStatus, followLive)} ·{" "}
          {threadIdentity.id}@{threadIdentity.revision}
        </p>
      )}
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
  // The shared essential mask then folds display-only plumbing exactly as it
  // does for the counters in the card header.
  const neighborhood = useMemo(
    () => compactLineageProjection(evidenceModel, focusRef),
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
      supportingNodeCount: neighborhood.hiddenSupportingCount,
    };
  }, [neighborhood]);

  // Fall back gracefully when the focus node is not in the visible graph.
  if (neighborhood.nodes.length === 0) {
    return (
      <p className="px-8 py-8 text-sm text-muted-foreground">
        This fact is recorded, but it is not currently present in the evidence
        graph (it may be a folded historical version).
      </p>
    );
  }

  return (
    <div className="thread-feed-lineage-sigma" aria-label={ariaLabel}>
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

function livePulseClass(
  status: ThreadStreamStatus | "snapshot",
  followLive: boolean,
): string {
  const tone = !followLive
    ? "bg-border"
    : status === "reconnecting"
    ? "bg-warning"
    : status === "live"
    ? "bg-success"
    : "bg-border";
  return cn("size-2 shrink-0 rounded-full", tone);
}

function reviewDisplayBadgeVariant(
  status: ActivityReviewStatus,
): "warning" | "success" | "secondary" {
  if (status === "to-review" || status === "revision-requested") {
    return "warning";
  }
  if (status === "validated") return "success";
  return "secondary";
}

function freshnessClass(freshness: string): string {
  if (freshness === "fresh") return "font-medium text-success";
  if (freshness === "failed") return "font-medium text-destructive";
  if (freshness === "stale" || freshness === "running") {
    return "font-medium text-warning";
  }
  return "text-muted-foreground";
}

/**
 * Day header of the 7a feed. "Today" is resolved against the reader's clock,
 * never stamped into the record.
 */
function feedDayLabel(value: string | undefined): string {
  if (!value) return "Not dated";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not dated";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
  return sameDay ? `Today · ${formatted}` : formatted;
}

/** Live transport state for the feed footer; never an invented behaviour. */
function feedStreamFooterLabel(
  status: ThreadStreamStatus | "snapshot",
  followLive: boolean,
): string {
  if (!followLive) return "History paused";
  if (status === "live") return "SSE live";
  if (status === "reconnecting") return "SSE reconnecting";
  if (status === "connecting") return "SSE connecting";
  return "Snapshot history";
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
