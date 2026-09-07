import type { JSX, ReactNode } from "react";
import type { ThreadGraphNode, ThreadGraphRef } from "../thread/types.ts";
import type { OverviewThreadSelectionConnection } from "./overview-thread-selection-model.ts";

/** A reading aid on the board, not another viewer or an evidence authority. */
export function OverviewThreadSelectionNote({
  node,
  connections,
  onFollow,
  onClose,
  supplement,
  children,
}: {
  readonly node: ThreadGraphNode;
  readonly connections: readonly OverviewThreadSelectionConnection[];
  readonly onFollow: (reference: ThreadGraphRef) => void;
  readonly onClose: () => void;
  /** Optional read-only disclosure tied to the exact selected reference. */
  readonly supplement?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      className="overview-thread-selection-note"
      aria-label={`Read ${node.label}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header>
        <span>Selected on the board</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close selected record"
        >
          Close
        </button>
      </header>
      <div className="overview-thread-selection-body">
        <h4>{node.label}</h4>
        <p className="overview-thread-selection-meta">
          {node.artifactKind ?? node.entityKind} · <span>{node.freshness}</span>
        </p>
        <div className="overview-thread-selection-actions">{children}</div>
        {node.summary && (
          <details className="overview-thread-selection-details">
            <summary>Record details</summary>
            <p className="overview-thread-selection-summary">{node.summary}</p>
          </details>
        )}
        {supplement}
      </div>
      <details className="overview-thread-selection-relations">
        <summary>
          Follow a connection <span>{connections.length}</span>
        </summary>
        <p>Direct recorded relations. Select a record to continue reading.</p>
        {connections.length === 0
          ? <p>No direct relation recorded for this object.</p>
          : (
            <ul>
              {connections.map(({ occurrence, direction, edge, peer }) => (
                <li key={occurrence}>
                  <button
                    type="button"
                    onClick={() =>
                      onFollow(peer.ref)}
                    title={edge.rationale}
                    aria-label={`${direction}: ${edge.relation}, ${peer.label}`}
                  >
                    <small>
                      {direction === "incoming" ? "From" : "To"} · {edge.origin}
                      {edge.analysis && ` · ${edge.analysis.epistemicBasis}`}
                    </small>
                    <span>{peer.label}</span>
                    <strong>
                      {edge.relation.replaceAll("_", " ").replaceAll("-", " ")}
                    </strong>
                    {edge.attestation?.status === "mismatch" && (
                      <em>Fingerprint mismatch</em>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </details>
    </section>
  );
}
