import type { JSX } from "react";
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
  onSelectRequirement,
  onInspectClaim,
}: {
  readonly item: OverviewBriefSourceHeroNode;
  readonly onClose: () => void;
  readonly onSelectRequirement: (threadRequirementId: string) => void;
  readonly onInspectClaim: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  const claims = uniqueDocumentaryClaims(item);
  return (
    <section
      className="overview-thread-selection-note overview-thread-brief-source-note"
      aria-label={`Read brief source ${item.sourceItem.id}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header>
        <span>Brief source on the board</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close brief source"
        >
          Close
        </button>
      </header>
      <div className="overview-thread-selection-body">
        <h4>{item.sourceItem.id}</h4>
        <p className="overview-thread-selection-meta">
          Brief r{item.brief.revision} · <code>{item.brief.snapshotId}</code>
        </p>
        <p className="overview-thread-selection-meta">
          {item.sourceItem.kind}
        </p>
        <p className="overview-thread-selection-summary">
          {item.sourceItem.statement}
        </p>
        {item.sourceItem.sourceRefs.length > 0 && (
          <section className="overview-thread-brief-source-references">
            <h5>Source references</h5>
            <ul>
              {item.sourceItem.sourceRefs.map((source, index) => (
                <li key={`${source.kind}:${source.reference}:${index}`}>
                  {source.kind}: {source.reference}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="overview-thread-brief-source-requirements">
          <h5>Linked requirements</h5>
          <ul>
            {item.correspondences.map((correspondence) => (
              <li key={correspondence.threadRequirementId}>
                <button
                  type="button"
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
            <h5>Documentary claims</h5>
            <ul>
              {claims.map((claim) => (
                <li key={claim.artifactId}>
                  <code>{claim.claimId}</code> · r{claim.revision}
                  <button
                    type="button"
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
