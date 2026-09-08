import type { JSX } from "react";
import { cn } from "../lib/utils.ts";
import { whiteboardBriefPart } from "../ui/whiteboard.ts";
import type { ProjectBriefRevision } from "../../../domain/project/project-brief.ts";
import { overviewBriefSectionLabel } from "./overview/hulls/current-brief.ts";
import {
  overviewCurrentBriefDocument,
  overviewCurrentBriefViewerTitle,
} from "./overview-thread-current-brief.ts";

/** Exact current ProjectBriefRevision, read-only, never an MCP App session. */
export function OverviewCurrentBriefDocument(
  { brief }: { readonly brief: ProjectBriefRevision },
): JSX.Element {
  const document = overviewCurrentBriefDocument(brief);
  return (
    <div
      className={cn(
        "overview-thread-current-brief",
        whiteboardBriefPart({ part: "root" }),
      )}
      data-brief-snapshot={document.snapshotId}
    >
      <header>
        <p className={whiteboardBriefPart({ part: "title" })}>
          {overviewCurrentBriefViewerTitle(document.revision)}
        </p>
        <p className={whiteboardBriefPart({ part: "meta" })}>
          <code>{document.briefId}</code>
          {" · "}
          <code>{document.snapshotId}</code>
          {" · contract "}
          {document.contractVersion}
        </p>
      </header>
      <ol className={whiteboardBriefPart({ part: "list" })}>
        {document.items.map((item) => (
          <li key={item.id}>
            <h5 className={whiteboardBriefPart({ part: "heading" })}>
              {overviewBriefSectionLabel(item.kind)}
              <small className={whiteboardBriefPart({ part: "id" })}>
                {item.id}
              </small>
            </h5>
            <p className={whiteboardBriefPart({ part: "statement" })}>
              {item.statement}
            </p>
            {item.sourceRefs.length > 0 && (
              <p className={whiteboardBriefPart({ part: "statement" })}>
                Sources: {item.sourceRefs.map((ref) =>
                  `${ref.kind}:${ref.reference}`
                )
                  .join(" · ")}
              </p>
            )}
            {item.owner && (
              <p className={whiteboardBriefPart({ part: "statement" })}>
                Owner: {item.owner}
              </p>
            )}
            {item.reviewTrigger && (
              <p className={whiteboardBriefPart({ part: "statement" })}>
                Review: {item.reviewTrigger}
              </p>
            )}
            {item.dependsOnItemIds && item.dependsOnItemIds.length > 0 && (
              <p className={whiteboardBriefPart({ part: "statement" })}>
                Depends on: {item.dependsOnItemIds.join(" · ")}
              </p>
            )}
            {item.verificationAuthority && (
              <p className={whiteboardBriefPart({ part: "statement" })}>
                Authority: {item.verificationAuthority.id}@
                {item.verificationAuthority.version}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
