import type { JSX } from "react";
import { useId } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
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
    <section
      className="flex flex-col gap-3 border-b border-border px-5 py-4"
      aria-labelledby={titleId}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            Version history
          </p>
          <h4 id={titleId} className="text-sm font-semibold">
            {versionLabel(family.members.length)}
          </h4>
        </div>
        <span className="text-xs text-muted-foreground">One graph node</span>
      </header>
      <p className="text-sm text-muted-foreground">
        Select a version to replace the graph with that version's recorded path
        — including the nodes that depended on it.
      </p>
      <ol
        className="m-0 list-none divide-y divide-border p-0"
        aria-label="Recorded evidence versions"
      >
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
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left",
                  selected && "bg-muted/50",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectVersion(node);
                }}
              >
                {current
                  ? <Badge variant="success">Current</Badge>
                  : (
                    <span className="font-mono text-xs text-muted-foreground">
                      Version {index + 1}
                    </span>
                  )}
                <strong className="text-sm font-semibold">{node.label}</strong>
                <span className="font-mono text-xs text-muted-foreground">
                  {node.system} · {node.summary}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {family.internalEdges.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Recorded transitions ({family.internalEdges.length})
          </summary>
          <ul className="m-0 list-none divide-y divide-border p-0">
            {family.internalEdges.map((edge) => (
              <li key={edge.id} className="flex flex-col gap-0.5 py-2">
                <code className="font-mono text-xs">
                  {relationLabel(edge.relation)}
                </code>
                <span className="text-xs text-muted-foreground">
                  {edge.rationale}
                </span>
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
