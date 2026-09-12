import type { JSX } from "react";
import { cn } from "../lib/utils.ts";
import { Notice } from "../ui/notice.tsx";
import { whiteboardTracePart } from "../ui/whiteboard.ts";
import { SensitivityMeasuredDeltaTable } from "../project/overview-sensitivity-journey-note.tsx";
import type {
  ThreadGraphRef,
  ThreadRequirementHistoricalChain,
  ThreadRequirementHistoricalEvaluation,
  ThreadRequirementHistoricalMeasuredSensitivity,
} from "./types.ts";

/**
 * Concise read-only disclosure of archived predecessor evaluations.
 * The current badge stays the live verdict.
 */
export function RequirementHistoricalUnjoinedContext({
  value,
  chain,
  onFollowEvidence,
}: {
  readonly value: readonly ThreadRequirementHistoricalEvaluation[];
  readonly chain?: ThreadRequirementHistoricalChain;
  readonly onFollowEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element | null {
  if (value.length === 0 && chain?.status !== "partial") return null;
  return (
    <section
      className={cn(
        "overview-thread-selection-historical-unjoined",
        whiteboardTracePart({ part: "root" }),
      )}
    >
      <Notice
        title={value.length === 0
          ? "Historical unjoined evaluations unavailable"
          : "Historical unjoined evaluations"}
        tone="info"
      >
        {value.length === 0
          ? "Predecessor history could not be completed. The live verdict is unchanged."
          : "Recorded predecessor evaluations. This is not a current join and does not change the live verdict."}
      </Notice>
      {chain
        ? (
          <p className={whiteboardTracePart({ part: "copy" })}>
            Chain {chain.status} · {chain.hops} hop{chain.hops === 1 ? "" : "s"}
            {chain.status === "partial"
              ? ` · ${chain.reason} at ${chain.stoppedAtRequirementId}`
              : ""}
          </p>
        )
        : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {value.map((item) => (
          <li key={item.evaluationId}>
            <HistoricalEvaluationItem
              value={item}
              onFollowEvidence={onFollowEvidence}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function HistoricalEvaluationItem({
  value,
  onFollowEvidence,
}: {
  readonly value: ThreadRequirementHistoricalEvaluation;
  readonly onFollowEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  const measured = value.sensitivity?.status === "measured"
    ? value.sensitivity
    : undefined;
  return (
    <article
      className={whiteboardTracePart({ part: "copy" })}
      data-historical-evaluation-id={value.evaluationId}
    >
      <p>
        Hop {value.hopIndex} · recorded {value.status}
        {value.evaluationFamily ? ` · ${value.evaluationFamily}` : ""}
        {" · "}
        evaluated {value.evaluatedAt}
      </p>
      <p>
        Predecessor requirement <code>{value.predecessorRequirementId}</code>
      </p>
      <p>
        Historical evaluation <code>{value.evaluationId}</code>
      </p>
      <p>
        Current architecture <code>{value.currentArchitecture.artifactId}</code>
      </p>
      <p>
        Predecessor architecture <code>{value.predecessorArchitecture.artifactId}</code>
      </p>
      <p>
        Native target <code>{value.native.targetElementId}</code>
        {" · "}
        RequirementUsage <code>{value.native.requirementUsageId}</code>
        {" · "}
        ConstraintUsage <code>{value.native.constraintUsageId}</code>
      </p>
      <HistoricalEvidenceLinks
        value={value}
        onFollowEvidence={onFollowEvidence}
      />
      {measured ? <HistoricalMeasuredSensitivity value={measured} /> : null}
      {value.sensitivity?.status === "unavailable"
        ? (
          <p>
            Historical sensitivity unavailable · {value.sensitivity.reason}
          </p>
        )
        : null}
    </article>
  );
}

function HistoricalEvidenceLinks({
  value,
  onFollowEvidence,
}: {
  readonly value: ThreadRequirementHistoricalEvaluation;
  readonly onFollowEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element | null {
  const refs = [
    ...value.evidence,
    ...value.observations.flatMap((item) => item.sourceArtifacts),
    ...(value.sensitivity?.status === "measured"
      ? [
        value.sensitivity.study,
        value.sensitivity.studyCase,
        value.sensitivity.baseEvaluation,
      ]
      : []),
  ];
  const seen = new Set<string>();
  const unique = refs.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  if (unique.length === 0) return null;
  return (
    <p>
      Evidence {unique.map((item, index) => (
        <span key={item.id}>
          {index > 0 ? " · " : null}
          {onFollowEvidence
            ? (
              <button
                type="button"
                className="font-mono underline-offset-2 hover:underline"
                onClick={() => onFollowEvidence({ kind: "artifact", id: item.id })}
              >
                {item.id}
              </button>
            )
            : <code>{item.id}</code>}
        </span>
      ))}
    </p>
  );
}

function HistoricalMeasuredSensitivity({
  value,
}: {
  readonly value: ThreadRequirementHistoricalMeasuredSensitivity;
}): JSX.Element {
  return (
    <section
      className="mt-2"
      aria-label="Historical measured sensitivity"
      data-historical-sensitivity="measured"
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-brand">
        Historical measured relation
      </p>
      <SensitivityMeasuredDeltaTable
        parameterLabel={value.parameter.id}
        lower={value.parameter.lower}
        upper={value.parameter.upper}
        measurement={value.measurement}
        responseLabel="Historical FEA response"
      />
    </section>
  );
}
