import type { JSX, ReactNode } from "react";
import { whiteboardFlowItemPart } from "../../../ui/whiteboard.ts";
import { cn } from "../../../lib/utils.ts";
import type { EngineeringPhaseStatus } from "../../../../../domain/project/engineering-project.ts";

/**
 * Shared visible atom for a raw FlowNode and a structured hierarchy row.
 * Button shells keep their own actions and identities.
 */
export function FlowItemSurface(
  {
    density,
    hasViewer,
    nativeDetailLabel,
    label,
    detail,
    children,
    pending = false,
    status,
    emphasis = false,
  }: {
    readonly density: "point" | "listed";
    readonly hasViewer: boolean;
    /** Read-only inline detail; deliberately not a registered App viewer. */
    readonly nativeDetailLabel?: string;
    readonly label?: string;
    readonly detail?: string;
    readonly children?: ReactNode;
    readonly pending?: boolean;
    readonly status?: EngineeringPhaseStatus;
    readonly emphasis?: boolean;
  },
): JSX.Element {
  const markerStatus = status === "planned" || status === "active" ||
      status === "blocked"
    ? status
    : undefined;
  return (
    <>
      <span
        className={cn(
          "overview-thread-flow-node-dot",
          whiteboardFlowItemPart({
            part: pending ? "pendingMarker" : "marker",
            ...(pending || !markerStatus ? {} : { status: markerStatus }),
            emphasis: pending ? false : emphasis,
          }),
        )}
        aria-hidden="true"
      />
      {density === "listed" && (children ?? (
        <>
          {label && (
            <span
              className={cn(
                "overview-thread-flow-structure-label",
                whiteboardFlowItemPart({ part: "label" }),
              )}
            >
              {label}
            </span>
          )}
          {detail && (
            <small className={whiteboardFlowItemPart({ part: "detail" })}>
              {detail}
            </small>
          )}
        </>
      ))}
      {density === "listed" && (nativeDetailLabel || hasViewer) && !pending && (
        <span
          className={whiteboardFlowItemPart({ part: "viewer" })}
          aria-hidden="true"
        >
          {nativeDetailLabel ?? "Viewer"}
        </span>
      )}
    </>
  );
}
