/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { EngineeringDocumentaryTechnicalStart } from "../thread/types.ts";

/**
 * A small live feed for the transition from durable discovery provenance to
 * the first editable SysON container. It intentionally renders only the
 * server-owned, public-safe sequence rather than a generic provider viewer.
 */
export function DocumentaryTechnicalStartActivity({
  technicalStart,
}: {
  technicalStart: EngineeringDocumentaryTechnicalStart;
}): JSX.Element {
  const steps = technicalStart.activity.steps;
  return (
    <section
      class="documentary-technical-start"
      data-state={technicalStart.state}
      aria-labelledby="documentary-technical-start-title"
      aria-live="polite"
    >
      <header>
        <div>
          <p>LIVE TECHNICAL START</p>
          <h3 id="documentary-technical-start-title">
            {technicalStartTitle(technicalStart.state)}
          </h3>
        </div>
        <span class="documentary-technical-start-state">
          {technicalStartStateLabel(technicalStart.state)}
        </span>
      </header>
      <p class="documentary-technical-start-message">
        {technicalStart.message}
      </p>

      {steps.length > 0
        ? (
          <ol
            class="documentary-technical-start-feed"
            aria-label="Live SysON model-container activity"
          >
            {steps.map((step) => (
              <li key={step.id} data-state={step.state}>
                <div
                  class="documentary-technical-start-rail"
                  aria-hidden="true"
                >
                  <i />
                </div>
                <article>
                  <header>
                    <span class="documentary-technical-start-provider">SY</span>
                    <div>
                      <small>SYSON · {stepKindLabel(step.id)}</small>
                      <strong>{step.label}</strong>
                    </div>
                    <time dateTime={step.recordedAt}>
                      {formatTime(step.recordedAt)}
                    </time>
                  </header>
                  {step.predecessor && (
                    <p class="documentary-technical-start-relation">
                      contained in the preceding visible container
                    </p>
                  )}
                  <p>{step.summary}</p>
                </article>
              </li>
            ))}
          </ol>
        )
        : (
          <p class="documentary-technical-start-empty">
            The agent has not started the server-owned SysON sequence yet.
          </p>
        )}
      <footer>
        Live status is not a saved engineering claim. The record becomes
        inspectable evidence only after SysON has been read back and a new
        immutable thread revision is published.
      </footer>
    </section>
  );
}

function technicalStartTitle(
  state: EngineeringDocumentaryTechnicalStart["state"],
): string {
  if (state === "queued") return "The first editable model container is queued";
  if (state === "running") return "The agent is preparing the model container";
  if (state === "publishing") {
    return "The read-back container is being recorded";
  }
  return "The model-container start needs review";
}

function technicalStartStateLabel(
  state: EngineeringDocumentaryTechnicalStart["state"],
): string {
  if (state === "queued") return "QUEUED";
  if (state === "running") return "LIVE";
  if (state === "publishing") return "RECORDING";
  return "NEEDS REVIEW";
}

function stepKindLabel(
  id: EngineeringDocumentaryTechnicalStart["activity"]["steps"][number]["id"],
): string {
  if (id === "project-container") return "PROJECT";
  if (id === "sysml-document") return "DOCUMENT";
  return "ROOT PACKAGE";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
