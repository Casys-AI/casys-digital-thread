/** @jsxImportSource preact */

import type { JSX } from "preact";
import {
  buildRecomputeHistory,
  presentRecomputeTransition,
  recomputeGroupsForFocus,
  type RecomputeHistoryInput,
  type RecomputeTransition,
  type RecomputeTransitionPresentation,
} from "./recompute-model.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./types.ts";

export interface RecomputeHistoryPanelProps
  extends Omit<RecomputeHistoryInput, "nodes" | "edges"> {
  readonly nodes: readonly ThreadGraphNode[];
  readonly edges: readonly ThreadGraphEdge[];
  readonly focus?: ThreadGraphRef;
  readonly onSelectNode: (node: ThreadGraphNode) => void;
}

/**
 * A compact, read-only correction note inside the affected feed item's lineage.
 * It is intentionally absent until that item is open: revisions are context,
 * not a second activity dashboard.
 */
export function RecomputeHistoryPanel({
  nodes,
  edges,
  focus,
  snapshotHistory,
  currentSnapshot,
  onSelectNode,
}: RecomputeHistoryPanelProps): JSX.Element | null {
  const history = buildRecomputeHistory({
    nodes,
    edges,
    snapshotHistory,
    currentSnapshot,
  });
  if (
    history.transitions.length === 0 &&
    history.awaitingSuccessor.length === 0 &&
    history.historicalSnapshots.length === 0
  ) return null;

  const groups = recomputeGroupsForFocus(history, focus);
  if (groups.length === 0) return null;

  return (
    <div class="thread-recompute-context">
      {groups.map((group) => (
        <article class="thread-recompute-cluster" key={group.id}>
          <header>
            <div>
              <small>RECORDED CORRECTION</small>
              <strong>{group.title}</strong>
            </div>
            <RevisionStatusBadge status={group.status} />
          </header>
          <p>{group.summary}</p>
          <details>
            <summary>
              Show {group.transitions.length} affected evidence record
              {group.transitions.length === 1 ? "" : "s"}
            </summary>
            <ol class="thread-recompute-list" aria-label="Affected evidence">
              {group.transitions.map((transition) => (
                <RecomputeTransitionCard
                  key={transition.id}
                  transition={transition}
                  active={false}
                  onSelectNode={onSelectNode}
                />
              ))}
            </ol>
          </details>
        </article>
      ))}
    </div>
  );
}

function RecomputeTransitionCard({
  transition,
  active,
  onSelectNode,
}: {
  transition: RecomputeTransition;
  active: boolean;
  onSelectNode: (node: ThreadGraphNode) => void;
}): JSX.Element {
  const story = presentRecomputeTransition(transition);
  return (
    <li
      data-state={transition.state}
      data-active={active ? "true" : "false"}
    >
      <header class="thread-recompute-transition-heading">
        <div>
          <small>EVIDENCE REVISION</small>
          <strong>{story.title}</strong>
        </div>
        <RevisionStatusBadge status={story.status} />
      </header>

      <dl class="thread-recompute-story-facts">
        <div>
          <dt>Affected element</dt>
          <dd>
            <button
              type="button"
              onClick={() => onSelectNode(transition.historical)}
            >
              {story.affectedElement}
            </button>
          </dd>
        </div>
        <div>
          <dt>What changed</dt>
          <dd>{story.changeSummary}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{story.evidence.label}</dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd>{story.result}</dd>
        </div>
      </dl>

      <div
        class="thread-recompute-path"
        aria-label="Recorded evidence replacement"
      >
        <EvidenceButton
          node={transition.historical}
          role="historic"
          onSelectNode={onSelectNode}
        />
        <div class="thread-recompute-bridge">
          <span>Revised evidence</span>
        </div>
        <EvidenceButton
          node={transition.successor}
          role="current"
          onSelectNode={onSelectNode}
        />
      </div>
      {transition.changes.length > 0 && (
        <p class="thread-recompute-changes">
          <span>Triggered by recorded change</span>
          {transition.changes.map((change) => (
            <button
              type="button"
              key={change.id}
              onClick={() => onSelectNode(change)}
            >
              {change.label}
            </button>
          ))}
        </p>
      )}
      {transition.unaffectedSystems.length > 0 && (
        <p class="thread-recompute-unaffected">
          <span>No recorded dependency from this correction</span>
          {presentedUnaffectedSystems(transition).map((item) => (
            <b key={item.system}>
              {item.system} · {item.evidenceCount} current record
              {item.evidenceCount === 1 ? "" : "s"}
            </b>
          ))}
        </p>
      )}
      <TransitionTechnicalProvenance transition={transition} />
    </li>
  );
}

function TransitionTechnicalProvenance({
  transition,
}: {
  transition: RecomputeTransition;
}): JSX.Element {
  return (
    <details class="thread-recompute-technical">
      <summary>Technical provenance</summary>
      <dl>
        <div>
          <dt>Earlier evidence</dt>
          <dd>
            <code>
              {transition.historical.ref.kind}:{transition.historical.ref.id}
            </code>
          </dd>
        </div>
        <div>
          <dt>Successor evidence</dt>
          <dd>
            <code>
              {transition.successor.ref.kind}:{transition.successor.ref.id}
            </code>
          </dd>
        </div>
        <div>
          <dt>Recorded relation</dt>
          <dd>
            <code>{transition.relation.id}</code>
          </dd>
        </div>
      </dl>
    </details>
  );
}

function RevisionStatusBadge({
  status,
}: {
  status: RecomputeTransitionPresentation["status"];
}): JSX.Element {
  return (
    <span class="thread-recompute-status" data-tone={status.tone}>
      {status.label}
    </span>
  );
}

function presentedUnaffectedSystems(
  transition: RecomputeTransition,
): RecomputeTransition["unaffectedSystems"] {
  const preferred = transition.unaffectedSystems.filter((item) => {
    const system = item.system.toLowerCase();
    return system.includes("modelica") || system.includes("erpnext");
  });
  return preferred.length > 0 ? preferred : transition.unaffectedSystems;
}

function EvidenceButton({
  node,
  role,
  onSelectNode,
}: {
  node: ThreadGraphNode;
  role: "historic" | "current" | "stale";
  onSelectNode: (node: ThreadGraphNode) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="thread-recompute-evidence"
      data-role={role}
      data-freshness={node.freshness}
      aria-label={`${roleLabel(role)} evidence: ${node.label}`}
      onClick={() => onSelectNode(node)}
    >
      <small>{roleLabel(role)}</small>
      <strong>{node.label}</strong>
      <span>{node.system}</span>
      <span>{node.summary}</span>
    </button>
  );
}

function roleLabel(role: "historic" | "current" | "stale"): string {
  if (role === "historic") return "Earlier evidence";
  if (role === "current") return "Current successor";
  return "Awaiting replacement";
}
