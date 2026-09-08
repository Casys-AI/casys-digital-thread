import type { JSX } from "react";
import type { OverviewHullContentRow } from "./types.ts";
import { overviewHullRowPresentation } from "./row.ts";

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
