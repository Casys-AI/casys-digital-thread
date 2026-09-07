import type { JSX } from "react";
import type {
  EngineeringWorkbenchRequirementsBriefTrace,
  ThreadGraphRef,
} from "../thread/types.ts";
import { overviewBriefSourceKey } from "./overview-thread-brief-correspondence.ts";

/**
 * Neutral disclosure for the server-sealed brief source of a selected
 * requirements record. It does not create a graph relation or navigation.
 */
export function OverviewThreadRequirementsBriefTrace({
  reference,
  traces,
  onFollowBriefSource,
}: {
  readonly reference: ThreadGraphRef;
  readonly traces: readonly EngineeringWorkbenchRequirementsBriefTrace[];
  /** Selects the exact presentation-only brief-source node, if it is visible. */
  readonly onFollowBriefSource?: (key: string) => void;
}): JSX.Element | null {
  const { claims, originals } = selectRequirementsBriefTraces(
    reference,
    traces,
  );
  if (claims.length === 0 && originals.length === 0) return null;

  return (
    <section className="overview-thread-selection-brief-trace">
      {claims.map((trace) => (
        <AvailableBriefTrace
          key={trace.artifactId}
          reference={reference}
          trace={trace}
          onFollowBriefSource={onFollowBriefSource}
        />
      ))}
      {originals.map((trace) => (
        <OriginalBriefTrace
          key={trace.artifactId}
          reference={reference}
          trace={trace}
          onFollowBriefSource={onFollowBriefSource}
        />
      ))}
    </section>
  );
}

/**
 * A later documentary claim is selected before the original capture source.
 * This remains a disclosure only: it neither rewrites original provenance nor
 * asserts continuity, satisfaction, or qualification.
 */
export function selectRequirementsBriefTraces(
  reference: ThreadGraphRef,
  traces: readonly EngineeringWorkbenchRequirementsBriefTrace[],
): {
  readonly claims: readonly DocumentaryClaimTrace[];
  readonly originals: readonly EngineeringWorkbenchRequirementsBriefTrace[];
} {
  const claims = traces.filter(isDocumentaryClaimTrace).filter((trace) =>
    matchesDocumentaryClaim(reference, trace)
  ).toSorted((left, right) =>
    right.declaration.revision - left.declaration.revision ||
    left.artifactId.localeCompare(right.artifactId)
  );
  return {
    claims,
    originals: traces.filter((trace) => !isDocumentaryClaimTrace(trace)).filter(
      (trace) => matchesOriginalTrace(reference, trace),
    ),
  };
}

type DocumentaryClaimTrace =
  & Extract<
    EngineeringWorkbenchRequirementsBriefTrace,
    { readonly status: "available" }
  >
  & {
    readonly declaration: NonNullable<
      Extract<
        EngineeringWorkbenchRequirementsBriefTrace,
        { readonly status: "available" }
      >["declaration"]
    >;
  };

function isDocumentaryClaimTrace(
  trace: EngineeringWorkbenchRequirementsBriefTrace,
): trace is DocumentaryClaimTrace {
  return trace.status === "available" && trace.declaration !== undefined;
}

function matchesDocumentaryClaim(
  reference: ThreadGraphRef,
  trace: DocumentaryClaimTrace,
): boolean {
  return reference.kind === "artifact"
    ? trace.artifactId === reference.id ||
      trace.declaration.requirementsArtifactId === reference.id
    : reference.kind === "requirement" &&
      trace.threadRequirementIds.includes(reference.id);
}

function matchesOriginalTrace(
  reference: ThreadGraphRef,
  trace: EngineeringWorkbenchRequirementsBriefTrace,
): boolean {
  return reference.kind === "artifact"
    ? trace.artifactId === reference.id
    : reference.kind === "requirement" &&
      trace.threadRequirementIds.includes(reference.id);
}

function OriginalBriefTrace({
  reference,
  trace,
  onFollowBriefSource,
}: {
  readonly reference: ThreadGraphRef;
  readonly trace: EngineeringWorkbenchRequirementsBriefTrace;
  readonly onFollowBriefSource?: (key: string) => void;
}): JSX.Element {
  if (trace.status === "TRACE GAP") {
    return (
      <details className="overview-thread-selection-brief-trace">
        <summary>Initial brief source: TRACE GAP</summary>
        <p>
          This requirements capture did not seal an approved-brief clause. No
          clause has been inferred from its requirement text or label.
        </p>
      </details>
    );
  }

  return (
    <AvailableBriefTrace
      reference={reference}
      trace={trace}
      onFollowBriefSource={onFollowBriefSource}
    />
  );
}

function AvailableBriefTrace({
  reference,
  trace,
  onFollowBriefSource,
}: {
  readonly reference: ThreadGraphRef;
  readonly trace: Extract<
    EngineeringWorkbenchRequirementsBriefTrace,
    { readonly status: "available" }
  >;
  readonly onFollowBriefSource?: (key: string) => void;
}): JSX.Element {
  const requirements = reference.kind === "requirement"
    ? trace.requirements.filter((entry) =>
      entry.threadRequirementId === reference.id
    )
    : trace.requirements;
  const isDocumentaryClaim = trace.declaration !== undefined;
  return (
    <details className="overview-thread-selection-brief-trace">
      <summary>
        {isDocumentaryClaim
          ? "Documentary requirement correspondence"
          : "Initial approved brief source"}
      </summary>
      {isDocumentaryClaim && (
        <p>
          <strong>Documentary claim</strong> ·{" "}
          <code>{trace.declaration.claimId}</code>
          {" · revision r"}
          {trace.declaration.revision}
        </p>
      )}
      {isDocumentaryClaim && (
        <p>
          Declared {trace.declaration.linkedAt} · documentary artifact{"  "}
          <code>{trace.declaration.artifactId}</code>
        </p>
      )}
      {isDocumentaryClaim && (
        <p>
          Requirements capture{" "}
          <code>{trace.declaration.requirementsArtifactId}</code>
        </p>
      )}
      <p>
        {isDocumentaryClaim ? "Declared brief" : "Initial brief"}{" "}
        <code>{trace.originalBrief.briefId}</code> · snapshot{" "}
        <code>{trace.originalBrief.snapshotId}</code>{" "}
        · r{trace.originalBrief.revision}
      </p>
      {trace.currentBrief && (
        <p>
          Current approved brief <code>{trace.currentBrief.briefId}</code>{" "}
          · snapshot <code>{trace.currentBrief.snapshotId}</code>{" "}
          · r{trace.currentBrief.revision}
        </p>
      )}
      {reference.kind === "requirement" &&
        requirements[0] !== undefined && onFollowBriefSource && (
        <button
          type="button"
          className="overview-thread-selection-brief-source-link"
          onClick={() =>
            onFollowBriefSource(
              overviewBriefSourceKey(
                trace.originalBrief.snapshotId,
                requirements[0]!.sourceItemId,
              ),
            )}
        >
          Brief r{trace.originalBrief.revision} ·{" "}
          {requirements[0]!.sourceItemId}
        </button>
      )}
      <BriefClause
        title="Container"
        sourceItem={trace.container.originalSourceItem}
        state={trace.container.state}
      />
      {requirements.map((entry) => (
        <BriefClause
          key={entry.threadRequirementId}
          title={`Requirement ${entry.requirementId}`}
          sourceItem={entry.originalSourceItem}
          state={entry.state}
        />
      ))}
    </details>
  );
}

function BriefClause({
  title,
  sourceItem,
  state,
}: {
  readonly title: string;
  readonly sourceItem: {
    readonly id: string;
    readonly kind: string;
    readonly statement: string;
    readonly sourceRefs: readonly {
      readonly kind: string;
      readonly reference: string;
    }[];
  };
  readonly state: string;
}): JSX.Element {
  return (
    <section className="overview-thread-selection-brief-clause">
      <h5>{title}</h5>
      <p>
        <code>{sourceItem.id}</code> · {sourceItem.kind} · {state}
      </p>
      <p>{sourceItem.statement}</p>
      <ul>
        {sourceItem.sourceRefs.map((source, index) => (
          <li key={`${source.kind}:${source.reference}:${index}`}>
            {source.kind}: {source.reference}
          </li>
        ))}
      </ul>
    </section>
  );
}
