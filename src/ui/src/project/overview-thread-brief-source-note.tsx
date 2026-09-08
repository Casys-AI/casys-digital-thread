import type { CSSProperties, JSX } from "react";
import { cn } from "../lib/utils.ts";
import {
  whiteboardNote,
  whiteboardNoteLink,
  whiteboardNotePart,
  whiteboardNotePin,
  whiteboardNoteState,
} from "../ui/whiteboard.ts";
import type { ThreadGraphRef } from "../thread/types.ts";
import type { OverviewBriefSourceHeroNode } from "./overview-thread-hero-model.ts";

/**
 * Read-only note for one server-sealed brief clause represented on the board.
 * It deliberately accepts no synthetic Thread reference: navigation remains
 * limited to the exact requirement ids and documentary artifact ids supplied
 * by the brief-correspondence projection.
 */
export function OverviewThreadBriefSourceNote({
  item,
  onClose,
  pinned = false,
  onPinToggle,
  style,
  onSelectRequirement,
  onInspectClaim,
}: {
  readonly item: OverviewBriefSourceHeroNode;
  readonly onClose: () => void;
  readonly pinned?: boolean;
  readonly onPinToggle?: () => void;
  readonly style?: CSSProperties;
  readonly onSelectRequirement: (threadRequirementId: string) => void;
  readonly onInspectClaim: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  const claims = uniqueDocumentaryClaims(item);
  return (
    <section
      className={cn(
        "overview-thread-selection-note overview-thread-brief-source-note",
        whiteboardNote,
        whiteboardNoteState({ pinned }),
      )}
      aria-label={`Read brief source ${item.sourceItem.id}`}
      data-pinned={pinned ? "true" : "false"}
      style={style}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className={whiteboardNotePart({ part: "header" })}>
        <span>Brief source on the board</span>
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
            aria-label="Close brief source"
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
        <h4 className={whiteboardNotePart({ part: "title" })}>
          {item.sourceItem.id}
        </h4>
        <p
          className={cn(
            "overview-thread-selection-meta",
            whiteboardNotePart({ part: "meta" }),
          )}
        >
          Brief r{item.brief.revision} · <code>{item.brief.snapshotId}</code>
        </p>
        <p
          className={cn(
            "overview-thread-selection-meta",
            whiteboardNotePart({ part: "meta" }),
          )}
        >
          {item.sourceItem.kind}
        </p>
        <p
          className={cn(
            "overview-thread-selection-summary",
            whiteboardNotePart({ part: "summary" }),
          )}
        >
          {item.sourceItem.statement}
        </p>
        {item.sourceItem.sourceRefs.length > 0 && (
          <section className="overview-thread-brief-source-references">
            <h5 className={whiteboardNotePart({ part: "heading" })}>
              Source references
            </h5>
            <ul className={whiteboardNotePart({ part: "list" })}>
              {item.sourceItem.sourceRefs.map((source, index) => (
                <li
                  key={`${source.kind}:${source.reference}:${index}`}
                  className={whiteboardNotePart({ part: "listItem" })}
                >
                  {source.kind}: {source.reference}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="overview-thread-brief-source-requirements">
          <h5 className={whiteboardNotePart({ part: "heading" })}>
            Linked requirements
          </h5>
          <ul className={whiteboardNotePart({ part: "list" })}>
            {item.correspondences.map((correspondence) => (
              <li
                key={correspondence.threadRequirementId}
                className={whiteboardNotePart({ part: "listItem" })}
              >
                <button
                  type="button"
                  className={whiteboardNoteLink}
                  onClick={() =>
                    onSelectRequirement(correspondence.threadRequirementId)}
                >
                  {correspondence.requirementId}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {claims.length > 0 && (
          <section className="overview-thread-brief-source-claims">
            <h5 className={whiteboardNotePart({ part: "heading" })}>
              Documentary claims
            </h5>
            <ul className={whiteboardNotePart({ part: "list" })}>
              {claims.map((claim) => (
                <li
                  key={claim.artifactId}
                  className={whiteboardNotePart({ part: "listItem" })}
                >
                  <code>{claim.claimId}</code> · r{claim.revision}
                  <button
                    type="button"
                    className={whiteboardNoteLink}
                    onClick={() =>
                      onInspectClaim({
                        kind: "artifact",
                        id: claim.artifactId,
                      })}
                  >
                    Inspect claim
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}

function uniqueDocumentaryClaims(item: OverviewBriefSourceHeroNode): readonly {
  readonly artifactId: string;
  readonly claimId: string;
  readonly revision: number;
}[] {
  const claims = new Map<string, {
    readonly artifactId: string;
    readonly claimId: string;
    readonly revision: number;
  }>();
  for (const { trace } of item.correspondences) {
    if (!trace.declaration) continue;
    claims.set(trace.declaration.artifactId, {
      artifactId: trace.declaration.artifactId,
      claimId: trace.declaration.claimId,
      revision: trace.declaration.revision,
    });
  }
  return [...claims.values()].toSorted((left, right) =>
    right.revision - left.revision ||
    left.artifactId.localeCompare(right.artifactId)
  );
}
