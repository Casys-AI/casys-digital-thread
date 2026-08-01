/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { ThreadStreamStatus } from "./client.ts";
import { activityFeedNodes, refKey, traceThreadLineage } from "./feed-model.ts";
import { ThreadGraph, type ThreadGraphSelection } from "./graph.tsx";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRef,
} from "./types.ts";

export interface ThreadFeedProps {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  focus?: ThreadGraphRef;
  selection?: ThreadGraphSelection;
  followLive: boolean;
  streamStatus: ThreadStreamStatus | "snapshot";
  onFollowLiveChange: (follow: boolean) => void;
  onSelectNode: (node: ThreadGraphNode, origin: "feed" | "lineage") => void;
  onSelectEdge: (edge: ThreadGraphEdge) => void;
  onInspect: (selection: ThreadRef, node: ThreadGraphNode) => void;
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
  onFollowLiveChange,
  onSelectNode,
  onSelectEdge,
  onInspect,
}: ThreadFeedProps): JSX.Element {
  const feedNodes = activityFeedNodes(nodes);
  const focusNode = focus
    ? nodes.find((node) => refKey(node.ref) === refKey(focus))
    : undefined;
  const focusIsPrimary = focusNode &&
    feedNodes.some((node) => refKey(node.ref) === refKey(focusNode.ref));
  const entries = focusNode && !focusIsPrimary
    ? [focusNode, ...feedNodes]
    : feedNodes;

  if (entries.length === 0) {
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

      <ol class="thread-feed-list" aria-label="Linked engineering activity">
        {entries.map((node, index) => {
          const active = focus && refKey(node.ref) === refKey(focus);
          const lineage = active
            ? traceThreadLineage(nodes, edges, focus)
            : undefined;
          const lineageCount = lineage
            ? lineage.upstream.length + lineage.downstream.length +
              lineage.feedback.length
            : traceThreadLineage(nodes, edges, node.ref).upstream.length +
              traceThreadLineage(nodes, edges, node.ref).downstream.length;
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
                      <span>
                        {lineage.upstream.length} upstream ·{" "}
                        {lineage.downstream.length} downstream
                      </span>
                    </header>
                    {lineageCount === 0
                      ? (
                        <p class="thread-feed-unlinked">
                          This fact is recorded, but no causal relation connects
                          it to another fact yet.
                        </p>
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

function kindLabel(node: ThreadGraphNode): string {
  return node.entityKind === "artifact" && node.artifactKind
    ? node.artifactKind
    : node.entityKind;
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
