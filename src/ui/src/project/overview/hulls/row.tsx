import type { JSX } from "react";
import type { OverviewHullContentRow } from "./types.ts";
import { overviewHullRowPresentation } from "./row.ts";

/** Shared visible content of one hull tree/list row. Surfaces own the chrome. */
export function OverviewHullRowBody(
  { row, hierarchical = true }: {
    readonly row: OverviewHullContentRow;
    readonly hierarchical?: boolean;
  },
): JSX.Element {
  const presentation = overviewHullRowPresentation(row);
  return (
    <>
      {hierarchical && (
        <span
          className="overview-thread-flow-structure-mark"
          aria-hidden="true"
        >
          {row.depth === 0 ? "▾" : "└"}
        </span>
      )}
      <span className="overview-thread-flow-structure-label">
        {presentation.label}
      </span>
      {presentation.detail && <small>{presentation.detail}</small>}
      {presentation.hasViewer && <span aria-hidden="true">↗</span>}
    </>
  );
}

export function OverviewHullMenuRowBody(
  { row }: { readonly row: OverviewHullContentRow },
): JSX.Element {
  const presentation = overviewHullRowPresentation(row);
  return (
    <>
      <span>{presentation.label}</span>
      <small>{presentation.caption}</small>
    </>
  );
}
