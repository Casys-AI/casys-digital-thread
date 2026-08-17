import type { JSX } from "react";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { cn } from "../lib/utils.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import {
  agentRunRecordedAt,
  agentRunSummary,
  buildAgentNowPresentation,
  buildProjectBrief,
  selectCurrentProjectFocus,
  workOwnerLabel,
  workStatusLabel,
} from "./model.ts";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export function ProjectWorkRibbon({ project }: {
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  const brief = buildProjectBrief(project);
  const agentNow = buildAgentNowPresentation(project);
  const currentFocus = selectCurrentProjectFocus(project);
  const decisionToReview = currentFocus.proposedDecision;
  const decisionBeingPrepared = currentFocus.work?.decisionIds
    .map((id) => project.decisions.find((decision) => decision.id === id))
    .find((decision) =>
      decision?.status === "required" || decision?.status === "rejected"
    );
  const blocker = brief.openBlockers[0];
  const decisionBadge = decisionToReview
    ? { variant: "warning" as const, label: "Needs review" }
    : decisionBeingPrepared
    ? { variant: "secondary" as const, label: "Pending" }
    : { variant: "success" as const, label: "Clear" };
  const blockerBadge = blocker
    ? {
      variant: "destructive" as const,
      label: sentenceLabel(blocker.kind),
    }
    : { variant: "success" as const, label: "Clear" };
  return (
    <section
      className="grid grid-cols-1 gap-3 md:grid-cols-3"
      aria-label="Shared work plan"
    >
      <div className="rounded-lg border border-border bg-card p-3">
        <AgentNowRibbon project={project} presentation={agentNow} />
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <RibbonFacts
          label={decisionToReview ? "Agent question" : "Decision status"}
          value={decisionToReview?.title ??
            (decisionBeingPrepared
              ? "Agent proposal in preparation"
              : "Nothing needs discussion")}
          detail={decisionToReview?.question ??
            (decisionBeingPrepared
              ? `The agent still owes you a concrete proposal for ${decisionBeingPrepared.title}.`
              : "Discuss any change of intent with the agent; this cockpit follows the recorded plan.")}
          badge={decisionBadge.label}
          badgeVariant={decisionBadge.variant}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <RibbonFacts
          label="Open blocker"
          value={blocker?.title ?? "Clear"}
          detail={blocker?.description ?? "No open blocker is recorded."}
          badge={blockerBadge.label}
          badgeVariant={blockerBadge.variant}
        />
      </div>
    </section>
  );
}

function AgentNowRibbon({
  project,
  presentation,
}: {
  project: EngineeringProjectSnapshot;
  presentation: ReturnType<typeof buildAgentNowPresentation>;
}): JSX.Element {
  if (presentation.kind === "active-run") {
    return (
      <RibbonFacts
        label="Agent now"
        value={workTitle(project, presentation.run)}
        detail={agentRunSummary(project, presentation.run)}
        badge={sentenceLabel(presentation.run.status)}
        badgeVariant={recordStatusVariant(presentation.run.status)}
      />
    );
  }
  if (presentation.kind === "current-work") {
    return (
      <RibbonFacts
        label="Agent now"
        value={presentation.work.title}
        detail={`Current work · ${workOwnerLabel(presentation.work.owner)}`}
        badge={sentenceLabel(workStatusLabel(presentation.work.status))}
        badgeVariant={recordStatusVariant(presentation.work.status)}
      />
    );
  }
  if (presentation.kind === "last-settled-run") {
    return (
      <RibbonFacts
        label="Last agent run"
        value={workTitle(project, presentation.run)}
        detail={`${presentation.run.status.replaceAll("-", " ")} · ${
          formatDateTime(agentRunRecordedAt(presentation.run))
        }`}
        badge={sentenceLabel(presentation.run.status)}
        badgeVariant={recordStatusVariant(presentation.run.status)}
      />
    );
  }
  return (
    <RibbonFacts
      label="Agent now"
      value="No active run"
      detail="The project records no current agent execution."
      badge="Idle"
      badgeVariant="secondary"
    />
  );
}

function RibbonFacts({
  label,
  value,
  detail,
  badge,
  badgeVariant,
}: {
  label: string;
  value: string;
  detail: string;
  badge: string;
  badgeVariant: BadgeVariant;
}): JSX.Element {
  return (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-sm font-medium">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      <Badge className="mt-2" variant={badgeVariant}>{badge}</Badge>
    </>
  );
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function ProjectOperations({
  project,
  thread,
}: {
  project: EngineeringProjectSnapshot;
  thread: ThreadWorkbenchSnapshot;
}): JSX.Element {
  const systems = uniqueSystems(thread);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card aria-labelledby="project-runs-title">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Project executions
            </p>
            <CardTitle id="project-runs-title" className="text-base">
              Agent run journal
            </CardTitle>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            <span className="font-mono">{project.agentRuns.length}</span>{" "}
            recorded
          </span>
        </CardHeader>
        <CardContent>
          {project.agentRuns.length
            ? (
              <ol className="divide-y divide-border">
                {[...project.agentRuns].reverse().map((run) => (
                  <li
                    key={run.id}
                    data-state={run.status}
                    className="py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {workTitle(project, run)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {agentRunSummary(project, run)}
                        </p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Queued{" "}
                          <span className="font-mono">
                            {formatDateTime(run.queuedAt)}
                          </span>
                          {" · "}
                          <span className="font-mono">
                            {run.evidenceRefs.length}
                          </span>{" "}
                          published evidence ref
                          {run.evidenceRefs.length === 1 ? "" : "s"}
                        </p>
                        <AgentRunLifecycle run={run} />
                      </div>
                      <Badge variant={recordStatusVariant(run.status)}>
                        {sentenceLabel(run.status)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ol>
            )
            : (
              <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                No agent run is recorded.
              </p>
            )}
        </CardContent>
      </Card>

      <Card aria-labelledby="project-tools-title">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Engineering surfaces
            </p>
            <CardTitle id="project-tools-title" className="text-base">
              Tools contributing evidence
            </CardTitle>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            <span className="font-mono">{systems.length}</span> observed
          </span>
        </CardHeader>
        <CardContent>
          {systems.length
            ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {systems.map((system, index) => (
                  <article
                    key={system.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{system.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {system.stages}{" "}
                        projected stage{system.stages === 1 ? "" : "s"}
                      </p>
                    </div>
                    <i
                      data-state={system.freshness}
                      aria-label={system.freshness}
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        freshnessDotClass(system.freshness),
                      )}
                    />
                  </article>
                ))}
              </div>
            )
            : (
              <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                No tool contribution is projected in the current thread.
              </p>
            )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2" aria-labelledby="project-plan-title">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Shared plan
            </p>
            <CardTitle id="project-plan-title" className="text-base">
              Declared work items
            </CardTitle>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            <span className="font-mono">{project.workItems.length}</span> items
          </span>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {project.workItems.map((item) => (
              <WorkItemRow
                key={item.id}
                item={item}
                project={project}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WorkItemRow({ item, project }: {
  item: EngineeringWorkItem;
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  const phase = project.phases.find((candidate) =>
    candidate.id === item.phaseId
  );
  return (
    <article
      data-state={item.status}
      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="min-w-0">
        <p
          className={cn(
            "text-xs text-muted-foreground",
            !phase?.name && "font-mono",
          )}
        >
          {phase?.name ?? item.phaseId}
        </p>
        <p className="mt-1 text-sm font-semibold">{item.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {workOwnerLabel(item.owner)} · {item.kind}
        </p>
      </div>
      <Badge variant={recordStatusVariant(item.status)}>
        {sentenceLabel(workStatusLabel(item.status))}
      </Badge>
    </article>
  );
}

function AgentRunLifecycle({ run }: { run: EngineeringAgentRun }): JSX.Element {
  const history = run.statusHistory?.length ? run.statusHistory : [{
    commandId: run.id,
    status: "queued" as const,
    at: run.queuedAt,
    actor: { id: "recorded operator", origin: "human" as const },
    summary: "Run entered the agent queue.",
  }];
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        {history.length} lifecycle transition{history.length === 1 ? "" : "s"}
      </summary>
      <ol className="mt-2 space-y-2">
        {history.map((transition) => (
          <li
            key={`${transition.commandId}:${transition.status}`}
            data-state={transition.status}
          >
            <p className="text-xs font-medium">
              {sentenceLabel(transition.status)}
            </p>
            <p className="text-xs text-muted-foreground">
              {transition.actor.origin} ·{" "}
              <span className="font-mono">{transition.actor.id}</span>
              {" · "}
              <span className="font-mono">
                {formatDateTime(transition.at)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {transition.summary}
            </p>
          </li>
        ))}
      </ol>
      {run.claimedBy && (
        <p className="mt-2 text-xs text-muted-foreground">
          Claimed by <code className="font-mono">{run.claimedBy.id}</code>
          {run.claimedAt ? ` at ${formatDateTime(run.claimedAt)}` : ""}
        </p>
      )}
      {run.waitingForDecisionIds?.length
        ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Waiting for{" "}
            <span className="font-mono">
              {run.waitingForDecisionIds.join(", ")}
            </span>
          </p>
        )
        : null}
      {run.resultSnapshot && (
        <p className="mt-2 text-xs text-muted-foreground">
          Result{" "}
          <code className="font-mono">
            {run.resultSnapshot.snapshotId}@{run.resultSnapshot.revision}
          </code>
        </p>
      )}
      {run.failure && (
        <p
          className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          <strong>{run.failure.code}</strong> {run.failure.message}
        </p>
      )}
    </details>
  );
}

function freshnessDotClass(
  freshness: "fresh" | "stale" | "running" | "failed",
): string {
  if (freshness === "failed") return "bg-destructive";
  if (freshness === "stale" || freshness === "running") return "bg-warning";
  return "bg-success";
}

function workTitle(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): string {
  return project.workItems.find((item) => item.id === run.workItemId)?.title ??
    run.workItemId;
}

function uniqueSystems(thread: ThreadWorkbenchSnapshot): Array<{
  id: string;
  label: string;
  stages: number;
  freshness: "fresh" | "stale" | "running" | "failed";
}> {
  const systems = new Map<string, ReturnType<typeof uniqueSystems>[number]>();
  for (const stage of thread.flow) {
    const id = stage.system.toLowerCase();
    const existing = systems.get(id);
    if (existing) {
      existing.stages += 1;
      if (stage.freshness !== "fresh") existing.freshness = stage.freshness;
      continue;
    }
    systems.set(id, {
      id,
      label: stage.system,
      stages: 1,
      freshness: stage.freshness,
    });
  }
  return [...systems.values()];
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
