import type { JSX } from "react";
import { whiteboardFlowItemPart } from "../../../ui/whiteboard.ts";
import { cn } from "../../../lib/utils.ts";
import type { OverviewHeroNode } from "../../overview-thread-hero-model.ts";
import { overviewThreadHullNameParts } from "../../overview-thread-hull-model.ts";
import { overviewActivityStatusCaption } from "../activity-status-caption.ts";

/**
 * The contents of one listed row: status, name, and the one figure that dates
 * it. The name's distinguishing tail is lifted out of the ellipsis so a long
 * title loses its middle rather than the part that tells it from its siblings.
 */
export function FlowRowBody(
  { item }: { readonly item: OverviewHeroNode },
): JSX.Element {
  const label = item.kind === "activity" ? item.activity.title : item.label;
  const { head, tail } = overviewThreadHullNameParts(label);
  const meta = flowRowMeta(item);
  const live = item.kind === "recorded" && item.node.freshness === "running";
  return (
    <>
      <span
        className={cn(
          "overview-thread-flow-row-name",
          whiteboardFlowItemPart({ part: "name" }),
        )}
        title={label}
      >
        <span
          className={cn(
            "overview-thread-flow-row-head",
            whiteboardFlowItemPart({ part: "nameHead" }),
          )}
        >
          {head}
        </span>
        {tail && (
          <span
            className={cn(
              "overview-thread-flow-row-tail",
              whiteboardFlowItemPart({ part: "nameTail" }),
            )}
          >
            {tail}
          </span>
        )}
      </span>
      {meta && (
        <small
          className={cn(
            "overview-thread-flow-row-meta",
            whiteboardFlowItemPart({ part: "detail", live }),
          )}
          data-live={live ? "true" : "false"}
        >
          {meta}
        </small>
      )}
    </>
  );
}

/** The single figure a row carries: what it is doing, or when it settled. */
function flowRowMeta(item: OverviewHeroNode): string {
  if (item.kind === "activity") {
    return overviewActivityStatusCaption(item.activity.status);
  }
  if (item.kind === "brief-source") return item.sourceItem.kind;
  if (item.node.freshness === "running") return "RUNNING";
  if (item.node.freshness === "failed") return "échec";
  const at = overviewThreadRecordedTime(item.node.recordedAt);
  if (!at) return item.node.freshness === "stale" ? "périmé" : "";
  return item.node.freshness === "stale" ? `${at} périmé` : `${at} ✓`;
}

/** Wall-clock only: a compact row shows a time, never a full timestamp. */
function overviewThreadRecordedTime(
  recordedAt: string | undefined,
): string | undefined {
  if (!recordedAt) return undefined;
  const parsed = new Date(recordedAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return `${String(parsed.getHours()).padStart(2, "0")}:${
    String(parsed.getMinutes()).padStart(2, "0")
  }`;
}
