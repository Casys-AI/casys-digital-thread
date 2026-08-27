import { PAGE_EYEBROW, SECTION_LABEL } from "../ui/cockpit.tsx";
import type { JSX } from "react";
import type { EngineeringProjectFraming } from "../../../domain/project/project-brief.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Card, CardContent, CardFooter } from "../ui/card.tsx";
import {
  type BriefElicitationQuestion,
  buildProjectBriefElicitation,
} from "./brief-elicitation-model.ts";

/**
 * Read-only two-column framing surface used before a brief is canonical.
 * Confirmation stays in the paired conversation; this view never writes.
 */
export function ProjectBriefElicitation({
  projectId,
  framing,
}: {
  readonly projectId: string;
  readonly framing: EngineeringProjectFraming;
}): JSX.Element | null {
  const view = buildProjectBriefElicitation(framing);
  if (!view) return null;

  return (
    <section
      aria-labelledby="brief-elicitation-title"
      className="grid gap-3"
    >
      <header className="min-w-0">
        <p className={cn("mb-1", PAGE_EYEBROW)}>
          Framing · the brief follows the conversation
        </p>
        <h3
          id="brief-elicitation-title"
          className="m-0 text-lg font-semibold tracking-tight"
        >
          {view.headline}
        </h3>
      </header>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
            <span className={SECTION_LABEL}>
              Framing questions
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              <span className="text-success">
                {view.answeredCount} answered
              </span>
              {" · "}
              <span className="text-warning">{view.openCount} open</span>
            </span>
          </div>
          {view.questions.length > 0
            ? (
              <ol className="divide-y divide-border">
                {view.questions.map((question) => (
                  <QuestionRow key={question.id} question={question} />
                ))}
              </ol>
            )
            : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No framing questions are recorded yet.
              </p>
            )}
        </Card>

        <Card
          className="gap-0 overflow-hidden"
          data-authority={view.assemblingAuthority}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2">
            <span className={SECTION_LABEL}>
              {view.revision === undefined
                ? "Living brief"
                : `Living brief · rev ${view.revision}`}
            </span>
            <Badge variant="warning" data-state={view.status}>
              {view.statusLabel}
            </Badge>
          </div>
          {view.assemblingAuthority === "empty"
            ? (
              <CardContent className="px-3.5 pb-5 pt-4">
                <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                  Project {projectId}{" "}
                  already exists. Continue describing the product in the paired
                  conversation; the agent will add focused questions and
                  consolidate the first reviewable brief here.
                </p>
              </CardContent>
            )
            : (
              <>
                <blockquote className="mx-3.5 mt-3 border-l-2 border-brand pl-3 text-[12.5px] leading-relaxed">
                  {view.intent}
                </blockquote>
                {view.sections.length > 0 && (
                  <div className="grid gap-x-6 gap-y-3.5 px-3.5 pb-1.5 pt-3.5 sm:grid-cols-2">
                    {view.sections.map((section) => (
                      <section
                        key={section.id}
                        aria-labelledby={`brief-elicitation-${section.id}`}
                      >
                        <h4
                          id={`brief-elicitation-${section.id}`}
                          className={cn("m-0", SECTION_LABEL)}
                        >
                          {section.title}
                        </h4>
                        <ul className="mt-1.5 list-none space-y-1.5">
                          {section.items.map((item) => (
                            <li
                              key={item.id}
                              className="text-xs leading-relaxed text-muted-foreground"
                            >
                              <span>{item.statement}</span>
                              {item.sourceLabels.map((label) => (
                                <Badge
                                  key={label}
                                  variant="outline"
                                  className="ml-1 align-middle font-mono text-[8px] uppercase tracking-wide text-muted-foreground"
                                >
                                  {label}
                                </Badge>
                              ))}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
                {view.openCallouts.length > 0 && (
                  <div className="mx-3.5 mb-3.5 mt-2.5 rounded-md border border-dashed border-warning/40 bg-warning/10 px-2.5 py-2">
                    <ul className="list-none space-y-1.5">
                      {view.openCallouts.map((statement) => (
                        <li
                          key={statement}
                          className="text-[11px] leading-relaxed text-warning"
                        >
                          {statement}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          <CardFooter className="flex-wrap justify-between gap-3 border-t border-border bg-muted/30 px-3.5 py-2.5 font-mono text-[10px] text-muted-foreground">
            <span className="uppercase tracking-wide">
              {view.revision === undefined
                ? view.footerStatus
                : `Rev ${view.revision} · ${view.footerStatus}`}
            </span>
            <span className="text-right text-muted-foreground/80">
              {view.confirmationLabel}
            </span>
          </CardFooter>
        </Card>
      </div>
    </section>
  );
}

function QuestionRow({
  question,
}: {
  readonly question: BriefElicitationQuestion;
}): JSX.Element {
  const answered = question.state === "answered";
  const detail = answered
    ? question.recordedValue ?? question.recordedExplanation
    : question.recordedOpenCopy;

  return (
    <li
      data-state={question.state}
      className={cn(
        "px-3 py-2.5",
        !answered && "bg-warning/10",
      )}
    >
      <div className="flex gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 pt-0.5 font-mono text-[11px] font-semibold",
            answered ? "text-success" : "text-warning",
          )}
        >
          {answered ? "✓" : "?"}
        </span>
        <div className="min-w-0">
          <span className="sr-only">
            {answered ? "Answered. " : "Open. "}
          </span>
          <p className="m-0 text-xs font-medium">{question.prompt}</p>
          {detail && (
            <p
              className={cn(
                "mt-0.5 mb-0 text-[11.5px] leading-relaxed",
                answered ? "text-muted-foreground" : "text-warning",
              )}
            >
              {detail}
            </p>
          )}
          {answered &&
            question.recordedValue &&
            question.recordedExplanation && (
            <p className="mt-0.5 mb-0 text-[11.5px] leading-relaxed text-muted-foreground">
              {question.recordedExplanation}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
