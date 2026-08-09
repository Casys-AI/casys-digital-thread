/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { buildProjectBriefRecord } from "./brief-record-model.ts";

/**
 * Read-only project framing inside the canonical Cockpit Project surface.
 * Legacy projects deliberately render no empty substitute: they predate the
 * living-brief contract and must not be presented as if one had been captured.
 */
export function ProjectBriefRecord({
  project,
}: {
  readonly project: EngineeringProjectSnapshot;
}): JSX.Element | null {
  const record = buildProjectBriefRecord(project.framing);
  if (!record) return null;

  return (
    <section class="project-brief-record" aria-labelledby="project-brief-title">
      <header class="project-section-label">
        <div>
          <p>COMPLETE ENGINEERING BRIEF</p>
          <h3 id="project-brief-title">Approved engineering project brief</h3>
        </div>
        <span class="project-brief-status" data-state={record.status}>
          {record.statusLabel}
        </span>
      </header>

      <div class="project-brief-record-body">
        <section
          class="project-brief-intent"
          aria-labelledby="project-brief-intent-title"
        >
          <p>STARTING INTENT</p>
          <blockquote id="project-brief-intent-title">
            {record.intent}
          </blockquote>
          <small>{record.statusDetail}</small>
        </section>

        {record.sections.length > 0 && (
          <div class="project-brief-sections">
            {record.sections.map((section) => (
              <section
                key={section.id}
                aria-labelledby={`project-brief-${section.id}`}
              >
                <h4 id={`project-brief-${section.id}`}>{section.title}</h4>
                <ul>
                  {section.items.map((item) => (
                    <li key={item.id}>{item.statement}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {record.openQuestions.length > 0 && (
          <section
            class="project-brief-open-questions"
            aria-labelledby="project-brief-open-title"
          >
            <p>STILL TO RESOLVE WITH THE AGENT</p>
            <h4 id="project-brief-open-title">Open points stay visible</h4>
            <ul>
              {record.openQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer class="project-brief-record-footer">
        <span>
          Brief revision {record.revision}
          {record.confirmedAt
            ? ` · confirmed ${formatShortDate(record.confirmedAt)}`
            : ""}
        </span>
        {record.sourceLabels.length > 0 && (
          <span>Built from {record.sourceLabels.join(" · ")}</span>
        )}
        <small>
          Discuss a correction with the agent; this Cockpit follows the saved
          record.
        </small>
      </footer>
    </section>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
