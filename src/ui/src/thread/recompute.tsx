import { CARD_SURFACE } from "../ui/cockpit.tsx";
import type { JSX } from "react";
import { cn } from "../lib/utils.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
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

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

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
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <article className="flex flex-col gap-2" key={group.id}>
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                Recorded correction
              </p>
              <strong className="text-sm font-semibold">{group.title}</strong>
            </div>
            <RevisionStatusBadge status={group.status} />
          </header>
          <p className="text-sm text-muted-foreground">{group.summary}</p>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Show {group.transitions.length} affected evidence record
              {group.transitions.length === 1 ? "" : "s"}
            </summary>
            <ol
              className="m-0 list-none divide-y divide-border p-0"
              aria-label="Affected evidence"
            >
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
      className={cn(
        "flex flex-col gap-3 py-3",
        active && "bg-muted/50",
        transition.state === "failed" && "border-l-2 border-destructive pl-3",
        transition.state === "recomputing" && "border-l-2 border-warning pl-3",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            Evidence revision
          </p>
          <strong className="text-sm font-semibold">{story.title}</strong>
        </div>
        <RevisionStatusBadge status={story.status} />
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-xs text-muted-foreground">Affected element</dt>
        <dd className="text-sm">
          <button
            type="button"
            className="text-sm font-medium text-brand hover:underline"
            onClick={() => onSelectNode(transition.historical)}
          >
            {story.affectedElement}
          </button>
        </dd>
        <dt className="text-xs text-muted-foreground">What changed</dt>
        <dd className="text-sm">{story.changeSummary}</dd>
        <dt className="text-xs text-muted-foreground">Evidence</dt>
        <dd className="text-sm">{story.evidence.label}</dd>
        <dt className="text-xs text-muted-foreground">Result</dt>
        <dd className="text-sm">{story.result}</dd>
      </dl>

      <div
        className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
        aria-label="Recorded evidence replacement"
      >
        <EvidenceButton
          node={transition.historical}
          role="historic"
          onSelectNode={onSelectNode}
        />
        <div className="text-center text-xs text-muted-foreground">
          <span>Revised evidence</span>
        </div>
        <EvidenceButton
          node={transition.successor}
          role="current"
          onSelectNode={onSelectNode}
        />
      </div>
      {transition.changes.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Triggered by recorded change</span>
          {transition.changes.map((change) => (
            <button
              type="button"
              key={change.id}
              className="text-sm font-medium text-brand hover:underline"
              onClick={() => onSelectNode(change)}
            >
              {change.label}
            </button>
          ))}
        </p>
      )}
      {transition.unaffectedSystems.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>No recorded dependency from this correction</span>
          {presentedUnaffectedSystems(transition).map((item) => (
            <Badge key={item.system} variant="outline">
              {item.system} · {item.evidenceCount} current record
              {item.evidenceCount === 1 ? "" : "s"}
            </Badge>
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
    <details>
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Technical provenance
      </summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 pt-2">
        <dt className="text-xs text-muted-foreground">Earlier evidence</dt>
        <dd>
          <code className="font-mono text-xs text-muted-foreground">
            {transition.historical.ref.kind}:{transition.historical.ref.id}
          </code>
        </dd>
        <dt className="text-xs text-muted-foreground">Successor evidence</dt>
        <dd>
          <code className="font-mono text-xs text-muted-foreground">
            {transition.successor.ref.kind}:{transition.successor.ref.id}
          </code>
        </dd>
        <dt className="text-xs text-muted-foreground">Recorded relation</dt>
        <dd>
          <code className="font-mono text-xs text-muted-foreground">
            {transition.relation.id}
          </code>
        </dd>
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
    <Badge variant={revisionToneVariant(status.tone)} data-tone={status.tone}>
      {status.label}
    </Badge>
  );
}

function revisionToneVariant(
  tone: RecomputeTransitionPresentation["status"]["tone"],
): BadgeVariant {
  if (tone === "published") return "success";
  if (tone === "failed") return "destructive";
  if (tone === "running" || tone === "awaiting") return "info";
  return "secondary";
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
      data-role={role}
      data-freshness={node.freshness}
      aria-label={`${roleLabel(role)} evidence: ${node.label}`}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 p-3 text-left shadow-sm hover:bg-muted/50",
        CARD_SURFACE,
      )}
      onClick={() => onSelectNode(node)}
    >
      <small className="text-xs font-medium text-muted-foreground">
        {roleLabel(role)}
      </small>
      <strong className="text-sm font-semibold">{node.label}</strong>
      <span className="font-mono text-xs text-muted-foreground">
        {node.system}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {node.summary}
      </span>
    </button>
  );
}

function roleLabel(role: "historic" | "current" | "stale"): string {
  if (role === "historic") return "Earlier evidence";
  if (role === "current") return "Current successor";
  return "Awaiting replacement";
}
