import type { JSX } from "react";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringPlanningActivityMilestone,
  EngineeringPlanningAgentRunStatus,
  EngineeringPlanningWorkbenchSnapshot,
  EngineeringTechnicalBaselineStatus,
} from "../thread/types.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * Status-only view of the first documentary baseline attempt. It is
 * intentionally not a tool viewer: live graph patches, tool arguments and
 * provider output remain outside the planning surface until canonical records
 * are published.
 */
export function BaselineRunActivity({
  planning,
}: {
  planning: EngineeringPlanningWorkbenchSnapshot["planning"];
}): JSX.Element {
  const run = planning.baselineRun;
  const milestones = planning.activity.milestones;
  const status = planning.technicalBaseline.status;

  return (
    <section aria-labelledby="planning-baseline-activity-title">
      <Card data-state={status}>
        <CardHeader className="flex-row items-start justify-between gap-4 max-md:flex-col">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              First baseline run
            </p>
            <CardTitle
              id="planning-baseline-activity-title"
              className="text-base"
            >
              {baselineActivityTitle(status, run?.status)}
            </CardTitle>
          </div>
          <Badge variant={technicalBaselineVariant(status)}>
            {technicalBaselineStatusLabel(status)}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          {run
            ? (
              <div className="grid gap-3">
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Declared work
                  </p>
                  <p className="text-sm font-semibold">{run.workItem.title}</p>
                  <Badge variant={recordStatusVariant(run.status)}>
                    {runStatusLabel(run.status)}
                  </Badge>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <dt className="text-xs text-muted-foreground">Queued</dt>
                  <dd className="font-mono text-xs text-muted-foreground">
                    {formatTime(run.queuedAt)}
                  </dd>
                  {run.startedAt && (
                    <>
                      <dt className="text-xs text-muted-foreground">Started</dt>
                      <dd className="font-mono text-xs text-muted-foreground">
                        {formatTime(run.startedAt)}
                      </dd>
                    </>
                  )}
                  {run.completedAt && (
                    <>
                      <dt className="text-xs text-muted-foreground">
                        Finished
                      </dt>
                      <dd className="font-mono text-xs text-muted-foreground">
                        {formatTime(run.completedAt)}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            )
            : (
              <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                No first documentary baseline run is recorded yet. Review the
                path with your agent before authorizing one.
              </p>
            )}

          {run && run.statusHistory.length > 0 && (
            <ol
              className="divide-y divide-border"
              aria-label="Recorded run status"
            >
              {run.statusHistory.map((item, index) => (
                <li
                  key={`${item.status}:${item.at}:${index}`}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <Badge variant={recordStatusVariant(item.status)}>
                    {runStatusLabel(item.status)}
                  </Badge>
                  <time
                    className="font-mono text-xs text-muted-foreground"
                    dateTime={item.at}
                  >
                    {formatTime(item.at)}
                  </time>
                </li>
              ))}
            </ol>
          )}

          {milestones.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Live activity
                </p>
                <span className="text-xs text-muted-foreground">
                  {milestones.length}{" "}
                  status update{milestones.length === 1 ? "" : "s"}
                </span>
              </div>
              <ol
                className="mt-2 divide-y divide-border"
                aria-label="Live baseline activity"
              >
                {milestones.map((item) => (
                  <BaselineActivityMilestone
                    key={item.sequence}
                    item={item}
                  />
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function BaselineActivityMilestone({
  item,
}: {
  item: EngineeringPlanningActivityMilestone;
}): JSX.Element {
  return (
    <li
      data-state={item.state}
      className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
    >
      <Badge variant={liveActivityVariant(item.state)}>
        {liveActivityLabel(item.state)}
      </Badge>
      <time
        className="font-mono text-xs text-muted-foreground"
        dateTime={item.recordedAt}
      >
        {formatTime(item.recordedAt)}
      </time>
    </li>
  );
}

function baselineActivityTitle(
  status: EngineeringTechnicalBaselineStatus,
  runStatus: EngineeringPlanningAgentRunStatus | undefined,
): string {
  if (status === "queued") return "A documentary baseline is queued";
  if (status === "running") {
    return runStatus === "waiting-for-decision"
      ? "The first documentary baseline is waiting for a decision"
      : "The first documentary baseline is being prepared";
  }
  if (status === "publishing") return "Recording the documentary baseline";
  if (status === "failed") {
    return "The documentary baseline was not published";
  }
  if (runStatus === "cancelled") {
    return "The documentary baseline run was cancelled";
  }
  if (runStatus === "completed") {
    return "The recorded run did not publish a documentary baseline";
  }
  return "No documentary baseline has been created";
}

function technicalBaselineStatusLabel(
  status: EngineeringTechnicalBaselineStatus,
): string {
  if (status === "queued") return "Queued";
  if (status === "running") return "In progress";
  if (status === "publishing") return "Recording";
  if (status === "failed") return "Needs review";
  return "Planning only";
}

function technicalBaselineVariant(
  status: EngineeringTechnicalBaselineStatus,
): BadgeVariant {
  if (status === "queued" || status === "running") return "info";
  if (status === "publishing") return "success";
  if (status === "failed") return "destructive";
  return "outline";
}

function runStatusLabel(status: EngineeringPlanningAgentRunStatus): string {
  if (status === "waiting-for-decision") return "Waiting for a decision";
  return sentenceLabel(status);
}

function liveActivityLabel(
  state: EngineeringPlanningActivityMilestone["state"],
): string {
  if (state === "running") return "Agent activity started";
  if (state === "fresh") return "A live activity step was recorded";
  if (state === "failed") return "A live activity step stopped";
  return "Live activity reconciled";
}

function liveActivityVariant(
  state: EngineeringPlanningActivityMilestone["state"],
): BadgeVariant {
  if (state === "running") return "info";
  if (state === "failed") return "destructive";
  if (state === "fresh") return "success";
  return "secondary";
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
