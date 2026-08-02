/** @jsxImportSource preact */

import type { JSX } from "preact";
import type {
  EngineeringPlanningActivityMilestone,
  EngineeringPlanningAgentRunStatus,
  EngineeringPlanningWorkbenchSnapshot,
  EngineeringTechnicalBaselineStatus,
} from "../thread/types.ts";

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
    <section
      class="planning-baseline-activity"
      data-state={status}
      aria-labelledby="planning-baseline-activity-title"
    >
      <header>
        <div>
          <p>FIRST BASELINE RUN</p>
          <h3 id="planning-baseline-activity-title">
            {baselineActivityTitle(status, run?.status)}
          </h3>
        </div>
        <span class="planning-baseline-state">
          {technicalBaselineStatusLabel(status)}
        </span>
      </header>

      {run
        ? (
          <div class="planning-baseline-run">
            <div class="planning-baseline-run-copy">
              <small>DECLARED WORK</small>
              <strong>{run.workItem.title}</strong>
              <span>{runStatusLabel(run.status)}</span>
            </div>
            <dl class="planning-baseline-run-times">
              <div>
                <dt>Queued</dt>
                <dd>{formatTime(run.queuedAt)}</dd>
              </div>
              {run.startedAt && (
                <div>
                  <dt>Started</dt>
                  <dd>{formatTime(run.startedAt)}</dd>
                </div>
              )}
              {run.completedAt && (
                <div>
                  <dt>Finished</dt>
                  <dd>{formatTime(run.completedAt)}</dd>
                </div>
              )}
            </dl>
          </div>
        )
        : (
          <p class="planning-baseline-empty">
            No first documentary baseline run is recorded yet. Review the path
            with your agent before authorizing one.
          </p>
        )}

      {run && run.statusHistory.length > 0 && (
        <ol class="planning-baseline-history" aria-label="Recorded run status">
          {run.statusHistory.map((item, index) => (
            <li key={`${item.status}:${item.at}:${index}`}>
              <i aria-hidden="true" />
              <span>{runStatusLabel(item.status)}</span>
              <time dateTime={item.at}>{formatTime(item.at)}</time>
            </li>
          ))}
        </ol>
      )}

      {milestones.length > 0 && (
        <div class="planning-baseline-live">
          <div>
            <small>LIVE ACTIVITY</small>
            <span>
              {milestones.length}{" "}
              status update{milestones.length === 1 ? "" : "s"}
            </span>
          </div>
          <ol aria-label="Live baseline activity">
            {milestones.map((item) => (
              <BaselineActivityMilestone key={item.sequence} item={item} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function BaselineActivityMilestone({
  item,
}: {
  item: EngineeringPlanningActivityMilestone;
}): JSX.Element {
  return (
    <li data-state={item.state}>
      <i aria-hidden="true" />
      <span>{liveActivityLabel(item.state)}</span>
      <time dateTime={item.recordedAt}>{formatTime(item.recordedAt)}</time>
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

function runStatusLabel(status: EngineeringPlanningAgentRunStatus): string {
  if (status === "waiting-for-decision") return "Waiting for a decision";
  return status.replaceAll("-", " ");
}

function liveActivityLabel(
  state: EngineeringPlanningActivityMilestone["state"],
): string {
  if (state === "running") return "Agent activity started";
  if (state === "fresh") return "A live activity step was recorded";
  if (state === "failed") return "A live activity step stopped";
  return "Live activity reconciled";
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
