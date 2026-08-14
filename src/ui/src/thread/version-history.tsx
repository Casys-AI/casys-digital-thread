/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useId } from "preact/hooks";
import type { ThreadGraphNode, ThreadGraphRef } from "./types.ts";
import {
  type VersionedEvidenceFamily,
  versionedRefKey,
  versionLabel,
} from "./versioned-provenance-model.ts";

export interface EvidenceVersionHistoryProps {
  family: VersionedEvidenceFamily;
  selectedRef?: ThreadGraphRef;
  onSelectVersion: (node: ThreadGraphNode) => void;
}

/** Compact revision browser embedded in the existing evidence inspector. */
export function EvidenceVersionHistory({
  family,
  selectedRef,
  onSelectVersion,
}: EvidenceVersionHistoryProps): JSX.Element {
  const titleId = useId();
  const currentKey = versionedRefKey(family.representative.ref);

  return (
    <section class="thread-version-history" aria-labelledby={titleId}>
      <header>
        <div>
          <p>VERSION HISTORY</p>
          <h4 id={titleId}>{versionLabel(family.members.length)}</h4>
        </div>
        <span>ONE GRAPH NODE</span>
      </header>
      <p class="thread-version-history-intro">
        Select a version to replace the graph with that version's recorded path
        — including the nodes that depended on it.
      </p>
      <ol aria-label="Recorded evidence versions">
        {family.members.map((node, index) => {
          const key = versionedRefKey(node.ref);
          const current = key === currentKey;
          const selected = selectedRef
            ? versionedRefKey(selectedRef) === key
            : current;
          return (
            <li key={key} data-current={current ? "true" : "false"}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectVersion(node);
                }}
              >
                <small>{current ? "CURRENT" : `VERSION ${index + 1}`}</small>
                <strong>{node.label}</strong>
                <span>{node.system} · {node.summary}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {family.internalEdges.length > 0 && (
        <details class="thread-version-relations">
          <summary>
            Recorded transitions ({family.internalEdges.length})
          </summary>
          <ul>
            {family.internalEdges.map((edge) => (
              <li key={edge.id}>
                <code>{relationLabel(edge.relation)}</code>
                <span>{edge.rationale}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function relationLabel(relation: string): string {
  return relation.replaceAll("_", " ").replaceAll("-", " ");
}
