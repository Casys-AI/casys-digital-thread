import type { CSSProperties, JSX, ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import {
  whiteboardNote,
  whiteboardNotePart,
  whiteboardNotePin,
  whiteboardNoteState,
} from "../ui/whiteboard.ts";
import type { ThreadGraphNode, ThreadGraphRef } from "../thread/types.ts";
import type { OverviewThreadSelectionConnection } from "./overview-thread-selection-model.ts";

/** A reading aid on the board, not another viewer or an evidence authority. */
export function OverviewThreadSelectionNote({
  node,
  connections,
  onFollow,
  onClose,
  pinned = false,
  onPinToggle,
  style,
  supplement,
  children,
}: {
  readonly node: ThreadGraphNode;
  readonly connections: readonly OverviewThreadSelectionConnection[];
  readonly onFollow: (reference: ThreadGraphRef) => void;
  readonly onClose: () => void;
  readonly pinned?: boolean;
  readonly onPinToggle?: () => void;
  readonly style?: CSSProperties;
  /** Optional read-only disclosure tied to the exact selected reference. */
  readonly supplement?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      className={cn(
        "overview-thread-selection-note",
        whiteboardNote,
        whiteboardNoteState({ pinned }),
      )}
      aria-label={`Read ${node.label}`}
      data-pinned={pinned ? "true" : "false"}
      style={style}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className={whiteboardNotePart({ part: "header" })}>
        <span>Selected on the board</span>
        <div className={whiteboardNotePart({ part: "headerActions" })}>
          {onPinToggle && (
            <button
              type="button"
              className={whiteboardNotePin({ pressed: pinned })}
              aria-pressed={pinned}
              aria-label={pinned ? "Unpin selection" : "Pin selection"}
              onClick={onPinToggle}
            >
              {pinned ? "Unpin" : "Pin"}
            </button>
          )}
          <button
            type="button"
            className={whiteboardNotePart({ part: "close" })}
            onClick={onClose}
            aria-label="Close selected record"
          >
            Close
          </button>
        </div>
      </header>
      <div
        className={cn(
          "overview-thread-selection-body",
          whiteboardNotePart({ part: "body" }),
        )}
      >
        <h4 className={whiteboardNotePart({ part: "title" })}>{node.label}</h4>
        <p
          className={cn(
            "overview-thread-selection-meta",
            whiteboardNotePart({ part: "meta" }),
          )}
        >
          {node.artifactKind ?? node.entityKind} · <span>{node.freshness}</span>
        </p>
        <div
          className={cn(
            "overview-thread-selection-actions",
            whiteboardNotePart({ part: "actions" }),
          )}
        >
          {children}
        </div>
        {node.summary && (
          <details
            className={cn(
              "overview-thread-selection-details",
              whiteboardNotePart({ part: "details" }),
            )}
          >
            <summary
              className={whiteboardNotePart({ part: "detailsSummary" })}
            >
              Record details
            </summary>
            <p
              className={cn(
                "overview-thread-selection-summary",
                whiteboardNotePart({ part: "summary" }),
              )}
            >
              {node.summary}
            </p>
          </details>
        )}
        {supplement}
      </div>
      <details
        className={cn(
          "overview-thread-selection-relations",
          whiteboardNotePart({ part: "relations" }),
        )}
      >
        <summary className={whiteboardNotePart({ part: "relationsSummary" })}>
          Follow a connection{" "}
          <span className={whiteboardNotePart({ part: "relationsCount" })}>
            {connections.length}
          </span>
        </summary>
        <p className={whiteboardNotePart({ part: "relationsHelp" })}>
          Direct recorded relations. Select a record to continue reading.
        </p>
        {connections.length === 0
          ? (
            <p className={whiteboardNotePart({ part: "relationsHelp" })}>
              No direct relation recorded for this object.
            </p>
          )
          : (
            <ul>
              {connections.map(({ occurrence, direction, edge, peer }) => (
                <li key={occurrence}>
                  <button
                    type="button"
                    className={whiteboardNotePart({ part: "relation" })}
                    onClick={() =>
                      onFollow(peer.ref)}
                    title={edge.rationale}
                    aria-label={`${direction}: ${edge.relation}, ${peer.label}`}
                  >
                    <small
                      className={whiteboardNotePart({ part: "relationMeta" })}
                    >
                      {direction === "incoming" ? "From" : "To"} · {edge.origin}
                      {edge.analysis && ` · ${edge.analysis.epistemicBasis}`}
                    </small>
                    <span>{peer.label}</span>
                    <strong
                      className={whiteboardNotePart({ part: "relationKind" })}
                    >
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
