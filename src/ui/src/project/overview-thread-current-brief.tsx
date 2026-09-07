import type { JSX } from "react";
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
      className="overview-thread-current-brief"
      data-brief-snapshot={document.snapshotId}
    >
      <header>
        <p>
          {overviewCurrentBriefViewerTitle(document.revision)}
        </p>
        <p>
          <code>{document.briefId}</code>
          {" · "}
          <code>{document.snapshotId}</code>
          {" · contract "}
          {document.contractVersion}
        </p>
      </header>
      <ol>
        {document.items.map((item) => (
          <li key={item.id}>
            <h5>
              {overviewBriefSectionLabel(item.kind)}
              <small>{item.id}</small>
            </h5>
            <p>{item.statement}</p>
            {item.sourceRefs.length > 0 && (
              <p>
                Sources:{" "}
                {item.sourceRefs.map((ref) => `${ref.kind}:${ref.reference}`)
                  .join(" · ")}
              </p>
            )}
            {item.owner && <p>Owner: {item.owner}</p>}
            {item.reviewTrigger && <p>Review: {item.reviewTrigger}</p>}
            {item.dependsOnItemIds && item.dependsOnItemIds.length > 0 && (
              <p>Depends on: {item.dependsOnItemIds.join(" · ")}</p>
            )}
            {item.verificationAuthority && (
              <p>
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
