import type { JSX } from "react";
import { whiteboardNotePart } from "../ui/whiteboard.ts";
import type { ThreadAnalysisQuantity } from "../../../presentation/workbench/thread/graph.ts";
import type { OverviewSensitivityJourney } from "./overview-sensitivity-journey.ts";

export function OverviewSensitivityJourneyDisclosure({
  journey,
}: {
  readonly journey: OverviewSensitivityJourney;
}): JSX.Element {
  const perturbedPoint = {
    value: journey.measurement.basePoint.value +
      journey.measurement.perturbationStep.value,
    unit: journey.measurement.basePoint.unit,
  };
  return (
    <section
      className="overview-sensitivity-journey mt-3 overflow-hidden rounded-md border border-brand/25 bg-brand/[0.025]"
      aria-label={`Related sensitivity FEA for ${journey.requirement.label}`}
      data-sensitivity-journey-id={journey.id}
    >
      <header className="flex items-center justify-between gap-2 border-b border-brand/15 bg-brand/[0.045] px-2.5 py-2">
        <strong className="flex items-center gap-1.5 text-[10px] font-bold text-brand">
          <i
            className="size-1.5 rounded-[2px] bg-brand shadow-[0_0_0_2px_color-mix(in_srgb,var(--ui-brand)_18%,transparent)]"
            aria-hidden="true"
          />
          Sensitivity FEA
        </strong>
        <span className="font-mono text-[8px] uppercase tracking-[0.07em] text-muted-foreground">
          Related study
        </span>
      </header>
      <div className="px-2.5 py-2.5">
        <ol
          className="m-0 mb-3 grid list-none grid-cols-3 gap-1 p-0"
          aria-label="Recorded sensitivity FEA journey"
        >
          <JourneyState
            label="Available"
            detail={`Case r${journey.case.revision}`}
          />
          <JourneyState label="Measured" detail="2 FEA points" />
          <JourneyState
            label="Used"
            detail={`${verdictLabel(journey.evaluation.verdict)} verdict`}
          />
        </ol>

        <p className="mb-2 text-[11px] font-semibold text-foreground">
          {journey.parameter.label}
        </p>
        <SensitivityResponsePlot
          base={journey.measurement.responseAtBase}
          perturbed={journey.measurement.responseAtPerturbed}
          responseLabel={journey.responseLabel}
        />

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]">
          <dt className="text-muted-foreground">Local range</dt>
          <dd className="m-0 font-mono text-right">
            {formatQuantity(journey.parameter.lower)} →{" "}
            {formatQuantity(journey.parameter.upper)}
          </dd>
          <dt className="text-muted-foreground">Base</dt>
          <dd className="m-0 font-mono text-right">
            {formatQuantity(journey.measurement.basePoint)} →{" "}
            {formatQuantity(journey.measurement.responseAtBase)}
          </dd>
          <dt className="text-muted-foreground">Perturbed</dt>
          <dd className="m-0 font-mono text-right">
            {formatQuantity(perturbedPoint)} →{" "}
            {formatQuantity(journey.measurement.responseAtPerturbed)}
          </dd>
          <dt className="text-muted-foreground">Local derivative</dt>
          <dd className="m-0 font-mono text-right font-semibold text-brand">
            {formatQuantity(journey.measurement.derivative)}
          </dd>
        </dl>

        <div className="mt-3 rounded-md border border-border bg-muted/45 p-2">
          <p className="m-0 text-[10px] font-semibold">
            {journey.requirement.label} ·{" "}
            {verdictLabel(journey.evaluation.verdict)}
          </p>
          <p className="mt-1 mb-0 font-mono text-[9px] text-muted-foreground [overflow-wrap:anywhere]">
            {journey.requirement.expression}
          </p>
        </div>
        <p className="mt-2 mb-0 text-[9px] leading-normal text-muted-foreground">
          Observed forward finite difference. This is a local two-point response
          linked through the exact requirement, not the original mechanical
          verdict or a global engineering qualification.
        </p>
        <details className={whiteboardNotePart({ part: "details" })}>
          <summary className={whiteboardNotePart({ part: "detailsSummary" })}>
            Exact evidence
          </summary>
          <p className="m-0 font-mono text-[9px] [overflow-wrap:anywhere]">
            {journey.evidence.studyArtifactId}
            <br />
            {journey.evidence.evaluationArtifactId}
          </p>
        </details>
      </div>
    </section>
  );
}

function JourneyState({
  label,
  detail,
}: {
  readonly label: string;
  readonly detail: string;
}): JSX.Element {
  return (
    <li className="rounded-md border border-brand/20 bg-brand/[0.045] px-1.5 py-1.5 text-center">
      <span className="block text-[9px] font-bold uppercase tracking-[0.06em] text-brand">
        {label}
      </span>
      <span className="mt-0.5 block text-[8px] text-muted-foreground">
        {detail}
      </span>
    </li>
  );
}

function SensitivityResponsePlot({
  base,
  perturbed,
  responseLabel,
}: {
  readonly base: ThreadAnalysisQuantity;
  readonly perturbed: ThreadAnalysisQuantity;
  readonly responseLabel: string;
}): JSX.Element {
  const equal = Object.is(base.value, perturbed.value);
  const baseY = equal ? 38 : base.value > perturbed.value ? 18 : 58;
  const perturbedY = equal ? 38 : base.value > perturbed.value ? 58 : 18;
  return (
    <figure className="m-0 rounded-md border border-border bg-card px-2 py-1.5">
      <figcaption className="mb-1 truncate text-[9px] text-muted-foreground">
        {responseLabel}
      </figcaption>
      <svg
        viewBox="0 0 200 76"
        className="block h-[72px] w-full text-brand"
        role="img"
        aria-label={`Response changed from ${formatQuantity(base)} to ${
          formatQuantity(perturbed)
        }`}
      >
        <path
          d="M18 64H188 M18 8V64"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
        />
        <path
          d={`M42 ${baseY} L164 ${perturbedY}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="42" cy={baseY} r="4" fill="currentColor" />
        <circle cx="164" cy={perturbedY} r="4" fill="currentColor" />
        <text
          x="42"
          y="73"
          textAnchor="middle"
          fontSize="8"
          fill="currentColor"
        >
          Base
        </text>
        <text
          x="164"
          y="73"
          textAnchor="middle"
          fontSize="8"
          fill="currentColor"
        >
          Perturbed
        </text>
      </svg>
    </figure>
  );
}

function verdictLabel(
  verdict: OverviewSensitivityJourney["evaluation"]["verdict"],
): string {
  return `${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}`;
}

function formatQuantity(quantity: ThreadAnalysisQuantity): string {
  return `${
    new Intl.NumberFormat("en-US", {
      maximumSignificantDigits: 7,
    }).format(quantity.value)
  } ${quantity.unit}`;
}
