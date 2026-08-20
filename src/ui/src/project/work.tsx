import { CARD_SURFACE, SECTION_LABEL } from "../ui/cockpit.tsx";
import type { JSX } from "react";
import type {
  CockpitFleetProjection,
} from "../../../presentation/workbench/fleet/projection.ts";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecision,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { cn } from "../lib/utils.ts";
import { buildRunTimeline, waitShare } from "./run-timeline-model.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Card, CardContent, CardHeader } from "../ui/card.tsx";
import {
  agentRunRecordedAt,
  agentRunSummary,
  buildAgentNowPresentation,
  buildProjectBrief,
  projectPulseStatus,
  selectCurrentProjectFocus,
  workOwnerLabel,
} from "./model.ts";
import {
  buildOperationsFleetView,
  type FleetCardView,
} from "./operations-fleet-model.ts";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

// ---------------------------------------------------------------------------
// Work ribbon
// ---------------------------------------------------------------------------

export function ProjectWorkRibbon({
  project,
}: {
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  const brief = buildProjectBrief(project);
  const agentNow = buildAgentNowPresentation(project);
  const currentFocus = selectCurrentProjectFocus(project);
  const decisionToReview = currentFocus.proposedDecision;
  const decisionBeingPrepared = currentFocus.work?.decisionIds
    .map((id) => project.decisions.find((d) => d.id === id))
    .find((d) => d?.status === "required" || d?.status === "rejected");
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
      <Card className="p-3">
        <AgentNowRibbon project={project} presentation={agentNow} />
      </Card>
      <Card className="p-3">
        <RibbonFacts
          label="AGENT QUESTION"
          value={decisionToReview?.title ??
            (decisionBeingPrepared
              ? "Agent proposal in preparation"
              : "Nothing needs discussion")}
          detail={decisionToReview?.question ??
            (decisionBeingPrepared
              ? `The agent still owes you a concrete proposal for ${decisionBeingPrepared.title}.`
              : "Discuss any change of intent with the agent; " +
                "this cockpit follows the recorded plan.")}
          badge={decisionBadge.label}
          badgeVariant={decisionBadge.variant}
        />
      </Card>
      <Card className="p-3">
        <RibbonFacts
          label="OPEN BLOCKER"
          value={blocker?.title ?? "Clear"}
          detail={blocker?.description ?? "No open blocker is recorded."}
          badge={blockerBadge.label}
          badgeVariant={blockerBadge.variant}
        />
      </Card>
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
  const pulse = projectPulseStatus(presentation);
  if (presentation.kind === "active-run") {
    return (
      <RibbonFacts
        label="AGENT NOW"
        value={workTitle(project, presentation.run)}
        detail={agentRunSummary(project, presentation.run)}
        badge={pulse.label}
        badgeVariant={recordStatusVariant(pulse.status)}
      />
    );
  }
  if (presentation.kind === "current-work") {
    return (
      <RibbonFacts
        label="AGENT NOW"
        value={presentation.work.title}
        detail={`Current work · ${workOwnerLabel(presentation.work.owner)}`}
        badge={pulse.label}
        badgeVariant={recordStatusVariant(pulse.status)}
      />
    );
  }
  if (presentation.kind === "last-settled-run") {
    return (
      <RibbonFacts
        label="AGENT NOW"
        value={workTitle(project, presentation.run)}
        detail={`${presentation.run.status.replaceAll("-", " ")} · ${
          formatDateTime(agentRunRecordedAt(presentation.run))
        }`}
        badge={pulse.label}
        badgeVariant={recordStatusVariant(pulse.status)}
      />
    );
  }
  return (
    <RibbonFacts
      label="AGENT NOW"
      value="No active run"
      detail="The project records no current agent execution."
      badge={pulse.label}
      badgeVariant={recordStatusVariant(pulse.status)}
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
      <p className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-sm font-medium">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      <Badge className="mt-2" variant={badgeVariant}>{badge}</Badge>
    </>
  );
}

// ---------------------------------------------------------------------------
// Exported helpers (used in other components and tests)
// ---------------------------------------------------------------------------

export function agentRunJournalItemName(
  title: string,
  status: EngineeringAgentRun["status"],
): string {
  return `${title} · ${sentenceLabel(status)}`;
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Operations view
// ---------------------------------------------------------------------------

export function ProjectOperations({
  project,
  thread,
  fleet,
  onOpenWork,
}: {
  project: EngineeringProjectSnapshot;
  thread: ThreadWorkbenchSnapshot;
  /** Declared fleet topology; absent when the BFF serves no manifest. */
  fleet?: CockpitFleetProjection;
  /** Opens the Work space (run journal cross-link). */
  onOpenWork?: () => void;
}): JSX.Element {
  const view = buildOperationsFleetView(fleet, thread, project);
  const pendingDecisions = project.decisions.filter(
    (d) => d.status === "proposed" || d.status === "required",
  );
  const activeRuns = project.agentRuns.filter(
    (r) => r.status === "queued" || r.status === "running",
  );
  const runningCount = activeRuns.filter(
    (r) => r.status === "running",
  ).length;
  const queuedCount = activeRuns.filter(
    (r) => r.status === "queued",
  ).length;

  return (
    <div className="flex flex-col gap-3.5">
      {
        /* Le titre porte les chiffres de la flotte : « combien, dans quel
          état » est ce qu'on vient lire ici, pas le mot « flotte ». */
      }
      {/* Fleet cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
        {view.cards.map((card) => (
          <FleetServerCard
            key={card.id}
            card={card}
          />
        ))}
      </div>
      {view.declaredIdle.length > 0 && (
        <p className="font-mono text-[10px] text-muted-foreground">
          {"declared · no project records — "}
          {view.declaredIdle.join(", ")}
        </p>
      )}

      {/* MRTR + Queue */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <MrtrCard decisions={pendingDecisions} />
        <QueueCard
          runs={activeRuns}
          runningCount={runningCount}
          queuedCount={queuedCount}
          onOpenWork={onOpenWork}
          project={project}
        />
      </div>

      <RunTimelineCard project={project} />

      {/* Full run journal — collapsed by default */}
      <details className={cn("overflow-hidden", CARD_SURFACE)}>
        <summary className="cursor-pointer px-4 py-3 font-mono text-[10px] text-muted-foreground select-none">
          {"Full run journal · "}
          <span className="tabular-nums">{project.agentRuns.length}</span>
          {" recorded"}
        </summary>
        <div className="px-4 pb-4">
          {project.agentRuns.length
            ? (
              <ol className="divide-y divide-border">
                {[...project.agentRuns].reverse().map((run) => {
                  const title = workTitle(project, run);
                  return (
                    <li
                      key={run.id}
                      data-state={run.status}
                      aria-label={agentRunJournalItemName(
                        title,
                        run.status,
                      )}
                      className="py-4 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="flex items-start gap-2 text-sm font-semibold">
                          <Badge
                            aria-hidden="true"
                            variant={recordStatusVariant(
                              run.status,
                            )}
                          >
                            {sentenceLabel(run.status)}
                          </Badge>
                          <span className="min-w-0">{title}</span>
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
                          <span className="font-mono tabular-nums">
                            {run.evidenceRefs.length}
                          </span>{" "}
                          published evidence ref
                          {run.evidenceRefs.length === 1 ? "" : "s"}
                        </p>
                        <AgentRunLifecycle run={run} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )
            : (
              <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                No agent run is recorded.
              </p>
            )}
        </div>
      </details>

      {/* Page footer */}
      <p className="font-mono text-[10px] text-muted-foreground">
        declared fleet · config/mcp-fleet.json · no
        {" LLM inside any tool"}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fleet server card
// ---------------------------------------------------------------------------

function FleetServerCard({
  card,
}: {
  card: FleetCardView;
}): JSX.Element {
  const isRunning = card.state === "running";
  const hasEvidence = card.lastEvidenceAt !== undefined;
  return (
    <article
      data-state={card.state}
      className={cn(
        "rounded-lg p-2.5",
        isRunning
          ? "border border-brand/40 bg-brand/5"
          : hasEvidence
          ? "border border-border bg-card shadow-sm"
          : "border border-dashed border-border bg-card",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground leading-none">
          {card.displayName}
        </span>
        <StatusDot freshness={card.freshness} />
      </div>
      {card.role && (
        <p className="mt-1 font-mono text-[9.5px] text-muted-foreground">
          {card.role}
        </p>
      )}
      <p className="mt-1.5 font-mono text-[10px] text-muted-foreground tabular-nums">
        {hasEvidence
          ? `last evidence ${formatDateTime(card.lastEvidenceAt!)}`
          : "no recorded evidence"}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
        <span>{card.stageCount}</span>
        {card.stageCount === 1 ? " stage" : " stages"}
      </p>
    </article>
  );
}

function StatusDot({
  freshness,
}: {
  freshness: FleetCardView["freshness"];
}): JSX.Element {
  if (freshness === "running") {
    return (
      <i
        aria-label="running"
        className="size-2.5 shrink-0 rounded-full border-2 border-brand bg-transparent"
      />
    );
  }
  return (
    <i
      aria-label={freshness}
      className={cn(
        "size-2 shrink-0 rounded-full",
        freshness === "fresh" && "bg-success",
        freshness === "stale" && "bg-warning",
        freshness === "failed" && "bg-destructive",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// MRTR card
// ---------------------------------------------------------------------------

function MrtrCard({
  decisions,
}: {
  decisions: readonly EngineeringDecision[];
}): JSX.Element {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border px-3 py-2">
        <span className="font-mono text-[9.5px] tracking-[.1em] text-muted-foreground">
          PENDING HUMAN CONFIRMATIONS · MRTR
        </span>
        {decisions.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-warning">
            {decisions.length} {decisions.length === 1 ? "WAITING" : "WAITING"}
          </span>
        )}
      </CardHeader>
      <CardContent className="px-3 py-2.5 space-y-2">
        {decisions.length > 0
          ? decisions.map((d) => <DecisionRow key={d.id} decision={d} />)
          : (
            <p className="text-sm text-muted-foreground">
              No confirmation is waiting.
            </p>
          )}
        <p className="text-[11px] text-muted-foreground leading-snug pt-1">
          Signed retry via{" "}
          <span className="font-mono text-[10px]">elicitation</span>{" "}
          in the paired conversation — the cockpit only projects the pending
          state.
        </p>
      </CardContent>
      <div className="border-t border-border bg-muted/30 px-3 py-1.5 font-mono text-[9.5px] text-muted-foreground">
        MRTR · human-only rejection and cancellation
      </div>
    </Card>
  );
}

function DecisionRow({
  decision,
}: {
  decision: EngineeringDecision;
}): JSX.Element {
  const isProposed = decision.status === "proposed";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant={isProposed ? "warning" : "secondary"}>
        {isProposed ? "Needs review" : "Pending"}
      </Badge>
      <span className="text-sm font-medium text-foreground min-w-0">
        {decision.title}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatDateTime(decision.requestedAt)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue card
// ---------------------------------------------------------------------------

function QueueCard({
  runs,
  runningCount,
  queuedCount,
  onOpenWork,
  project,
}: {
  runs: readonly EngineeringAgentRun[];
  runningCount: number;
  queuedCount: number;
  onOpenWork?: () => void;
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  return (
    <Card className="overflow-hidden flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border px-3 py-2">
        <span className="font-mono text-[9.5px] tracking-[.1em] text-muted-foreground">
          QUEUE
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {runningCount} {runningCount === 1 ? "RUNNING" : "RUNNING"}·
          {queuedCount} {queuedCount === 1 ? "QUEUED" : "QUEUED"}
        </span>
      </CardHeader>
      <CardContent className="flex-1 px-0 py-1">
        {runs.length > 0
          ? (
            <ul>
              {runs.map((run) => (
                <QueueRow key={run.id} run={run} project={project} />
              ))}
            </ul>
          )
          : (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No run is queued or running.
            </p>
          )}
      </CardContent>
      <div className="border-t border-border bg-muted/30 px-3 py-1.5">
        <button
          type="button"
          onClick={() => onOpenWork?.()}
          className="font-medium text-sm text-brand hover:underline cursor-pointer bg-transparent border-0 p-0"
        >
          Run journal in Work →
        </button>
      </div>
    </Card>
  );
}

function QueueRow({
  run,
  project,
}: {
  run: EngineeringAgentRun;
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  const isRunning = run.status === "running";
  const title = workTitle(project, run);
  const timeLabel = isRunning
    ? `running since ${formatDateTime(runningStartTime(run))}`
    : `queued ${formatDateTime(run.queuedAt)}`;
  return (
    <li className="grid grid-cols-[14px_1fr_auto] gap-x-2 px-3 py-1.5">
      <span
        className={cn(
          "font-mono text-[10px] leading-5",
          isRunning ? "text-brand" : "text-muted-foreground",
        )}
      >
        {isRunning ? "▸" : "⧗"}
      </span>
      <span className="text-[11.5px] text-foreground leading-5 truncate">
        {title}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums leading-5 shrink-0">
        {timeLabel}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Run lifecycle (used in journal)
// ---------------------------------------------------------------------------

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
        {history.length} lifecycle transition
        {history.length === 1 ? "" : "s"}
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
              {transition.actor.origin}·
              <span className="font-mono">{transition.actor.id}</span>
              {" · "}
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

// ---------------------------------------------------------------------------
// Private utilities
// ---------------------------------------------------------------------------

/**
 * Le déroulé des runs : une barre par run, coupée entre l'attente en file et
 * l'exécution.
 *
 * Les barres se mesurent contre le run le plus long, pas contre l'horloge :
 * sur une session d'une demi-heure, un axe absolu écraserait des durées de
 * quelques secondes contre le bord gauche et ne montrerait rien.
 */
function RunTimelineCard(
  { project }: { project: EngineeringProjectSnapshot },
): JSX.Element | null {
  const view = buildRunTimeline(project, (run) => workTitle(project, run));
  if (view.scaleSeconds === 0) return null;
  const share = waitShare(view);
  const percent = (seconds: number) =>
    `${(seconds / view.scaleSeconds) * 100}%`;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className={SECTION_LABEL}>Run timeline · queued vs running</span>
        {share !== undefined && (
          <span className="font-mono text-[9.5px] text-muted-foreground">
            {Math.round(share * 100)}% waiting ·{" "}
            {view.totalRunSeconds.toFixed(1)}s computed
          </span>
        )}
      </div>
      <ol className="m-0 flex list-none flex-col gap-1 p-3">
        {view.rows.map((row) => {
          const wait = row.waitSeconds ?? 0;
          const ran = row.runSeconds ?? 0;
          return (
            <li
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3"
            >
              <span className="truncate text-[11.5px]" title={row.label}>
                {row.label}
              </span>
              <span
                className="flex h-2 items-stretch overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <i
                  className="bg-muted-foreground/35"
                  style={{ width: percent(wait) }}
                />
                <i className="bg-brand" style={{ width: percent(ran) }} />
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {row.waitSeconds === undefined
                  // Jamais démarré : pas de durée, et surtout pas un zéro qui
                  // se lirait « instantané ».
                  ? "not started"
                  : `${wait.toFixed(1)}s + ${
                    row.runSeconds === undefined ? "…" : `${ran.toFixed(1)}s`
                  }`}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function workTitle(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): string {
  return project.workItems.find((item) => item.id === run.workItemId)
    ?.title ?? run.workItemId;
}

function runningStartTime(run: EngineeringAgentRun): string {
  const transition = run.statusHistory?.find(
    (t) => t.status === "running",
  );
  return transition?.at ?? run.startedAt ?? run.queuedAt;
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
