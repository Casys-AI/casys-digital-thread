import type { JSX } from "react";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { Badge } from "../ui/badge.tsx";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { Separator } from "../ui/separator.tsx";
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

  const statusVariant = record.status === "confirmed" ? "success" : "warning";

  return (
    <Card aria-labelledby="project-brief-title">
      {
        /* Le brief est la référence immuable du projet : replié par défaut,
          il s'ouvre à la demande — et reste déplié tant qu'il est en cours
          de discussion. */
      }
      <details
        className="group"
        {...(record.status !== "confirmed" ? { open: true } : {})}
      >
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <CardHeader className="flex-row items-start justify-between gap-4 px-5 pt-5 max-md:flex-col">
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Complete engineering brief
              </p>
              <CardTitle id="project-brief-title" className="text-base">
                Approved engineering project brief
              </CardTitle>
              <p className="text-xs text-muted-foreground group-open:hidden">
                Open to read the approved direction the agent plans against.
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant={statusVariant} data-state={record.status}>
                {record.statusLabel}
              </Badge>
              <svg
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
            </span>
          </CardHeader>
        </summary>

        <CardContent className="grid gap-6 px-5 pb-5">
          <section
            className="border-l-2 border-brand pl-4"
            aria-labelledby="project-brief-intent-title"
          >
            <p className="text-xs font-medium text-muted-foreground">
              Starting intent
            </p>
            <blockquote
              id="project-brief-intent-title"
              className="mt-1.5 text-sm leading-relaxed"
            >
              {record.intent}
            </blockquote>
            <p className="mt-2 text-xs text-muted-foreground">
              {record.statusDetail}
            </p>
          </section>

          {record.questionBranches.length > 0 && (
            <section aria-labelledby="project-brief-questions-title">
              <h4
                id="project-brief-questions-title"
                className="text-sm font-semibold"
              >
                Independent questions
              </h4>
              <ul className="mt-2 list-none space-y-2 text-sm text-muted-foreground">
                {record.questionBranches.map((branch) => (
                  <li key={branch.successCriterionId}>
                    <p>{branch.statement}</p>
                    <p className="mt-0.5 font-mono text-xs">
                      {branch.state}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {record.sections.length > 0 && (
            <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
              {record.sections.map((section) => (
                <section
                  key={section.id}
                  aria-labelledby={`project-brief-${section.id}`}
                >
                  <h4
                    id={`project-brief-${section.id}`}
                    className="text-sm font-semibold"
                  >
                    {section.title}
                  </h4>
                  <ul className="mt-2 list-none space-y-1.5 text-sm text-muted-foreground">
                    {section.items.map((item) => (
                      <li
                        key={item.id}
                        className="before:mr-2 before:text-muted-foreground/60 before:content-['•']"
                      >
                        {item.statement}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {record.openQuestions.length > 0 && (
            <section aria-labelledby="project-brief-open-title">
              <p className="text-xs font-medium text-muted-foreground">
                Still to resolve with the agent
              </p>
              <h4
                id="project-brief-open-title"
                className="mt-1.5 text-sm font-semibold"
              >
                Open points stay visible
              </h4>
              <ul className="mt-2 list-none space-y-1.5 text-sm text-muted-foreground">
                {record.openQuestions.map((question) => (
                  <li
                    key={question}
                    className="before:mr-2 before:text-muted-foreground/60 before:content-['•']"
                  >
                    {question}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </CardContent>

        <Separator />

        <CardFooter className="flex-col items-start gap-1.5 px-5 pb-5 pt-4 text-xs text-muted-foreground">
          <span>
            Brief revision <span className="font-mono">{record.revision}</span>
            {record.confirmedAt
              ? (
                <>
                  {" · confirmed "}
                  <span className="font-mono">
                    {formatShortDate(record.confirmedAt)}
                  </span>
                </>
              )
              : ""}
          </span>
          {record.sourceLabels.length > 0 && (
            <span>Built from {record.sourceLabels.join(" · ")}</span>
          )}
          <span>
            Discuss a correction with the agent; this Cockpit follows the saved
            record.
          </span>
        </CardFooter>
      </details>
    </Card>
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
