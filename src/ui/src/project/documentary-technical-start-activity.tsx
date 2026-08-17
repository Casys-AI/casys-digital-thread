import type { JSX } from "react";
import { recordStatusVariant } from "./record-status.ts";
import type { EngineeringDocumentaryTechnicalStart } from "../thread/types.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

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
      data-state={technicalStart.state}
      aria-labelledby="documentary-technical-start-title"
      aria-live="polite"
    >
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 max-md:flex-col">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Live technical start
            </p>
            <CardTitle
              id="documentary-technical-start-title"
              className="text-base"
            >
              {technicalStartTitle(technicalStart.state)}
            </CardTitle>
          </div>
          <Badge variant={technicalStartVariant(technicalStart.state)}>
            {technicalStartStateLabel(technicalStart.state)}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          <CardDescription>{technicalStart.message}</CardDescription>

          {steps.length > 0
            ? (
              <ol
                className="divide-y divide-border"
                aria-label="Live SysON model-container activity"
              >
                {steps.map((step) => (
                  <li
                    key={step.id}
                    data-state={step.state}
                    className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          SysON · {stepKindLabel(step.id)}
                        </p>
                        <p className="text-sm font-semibold">{step.label}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Badge variant={recordStatusVariant(step.state)}>
                          {sentenceLabel(step.state)}
                        </Badge>
                        <time
                          className="font-mono text-xs text-muted-foreground"
                          dateTime={step.recordedAt}
                        >
                          {formatTime(step.recordedAt)}
                        </time>
                      </div>
                    </div>
                    {step.predecessor && (
                      <p className="text-xs text-muted-foreground">
                        contained in the preceding visible container
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {step.summary}
                    </p>
                  </li>
                ))}
              </ol>
            )
            : (
              <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                The agent has not started the server-owned SysON sequence yet.
              </p>
            )}
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            Live status is not a saved engineering claim. The record becomes
            inspectable evidence only after SysON has been read back and a new
            immutable thread revision is published.
          </p>
        </CardFooter>
      </Card>
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
  if (state === "queued") return "Queued";
  if (state === "running") return "Live";
  if (state === "publishing") return "Recording";
  return "Needs review";
}

function technicalStartVariant(
  state: EngineeringDocumentaryTechnicalStart["state"],
): BadgeVariant {
  if (state === "queued" || state === "running") return "info";
  if (state === "publishing") return "success";
  return "destructive";
}

function stepKindLabel(
  id: EngineeringDocumentaryTechnicalStart["activity"]["steps"][number]["id"],
): string {
  if (id === "project-container") return "Project";
  if (id === "sysml-document") return "Document";
  return "Root package";
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
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
