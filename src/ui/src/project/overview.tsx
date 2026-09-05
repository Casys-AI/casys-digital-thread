import { compactEmbeddedFingerprints } from "../thread/compact-identifier-model.ts";
import type { JSX, MouseEvent } from "react";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringAgentRun,
  EngineeringBlocker,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type {
  EngineeringWorkbenchActivity,
  EngineeringWorkbenchCaseActivityJoin,
  EngineeringWorkbenchPhaseLane,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import { activityFeedNodes } from "../thread/feed-model.ts";
import type { ThreadViewerSessionsProjection } from "../thread/viewer-sessions-client.ts";
import { OverviewThreadHero } from "./overview-thread-hero.tsx";
import type { OverviewThreadStageSummary } from "./overview-thread-d3-flow.tsx";
import { cn } from "../lib/utils.ts";
import {
  CARD_SURFACE,
  PAGE_EYEBROW,
  PanelFoot,
  SECTION_LABEL,
} from "../ui/cockpit.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent } from "../ui/card.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog.tsx";
import type { ProjectWorkspaceView } from "./navigation.tsx";
import {
  hasDistinctProjectObjectiveStatement,
  type ProjectDeepLinkTarget,
} from "./navigation-model.ts";
import {
  buildProjectReviewRecords,
  currentProjectReview,
} from "./review-decision-model.ts";
import {
  agentRunRecordedAt,
  buildCurrentProjectWork,
  buildProjectBrief,
  buildProjectPath,
  groupProjectPathGatesByLane,
  type ProjectPathLaneGroup,
  projectPathLaneStageStatus,
  type ProjectPathStageStatus,
  projectPathStatusLabel,
  projectStatusTone,
  selectCurrentProjectFocus,
  workOwnerLabel,
} from "./model.ts";
import { PROJECT_PATH_STAGE_LABELS } from "./overview-lanes.ts";

export interface ProjectOverviewProps {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadWorkbenchSnapshot;
  readonly phaseLanes: readonly EngineeringWorkbenchPhaseLane[];
  readonly activities: readonly EngineeringWorkbenchActivity[];
  readonly caseActivityJoins: readonly EngineeringWorkbenchCaseActivityJoin[];
  /** Exact browser-safe session descriptors from the read-only Workbench BFF. */
  readonly viewerSessions?: ThreadViewerSessionsProjection;
  readonly onNavigate: (view: ProjectWorkspaceView) => void;
  readonly onOpenActivity?: (decisionId?: string) => void;
  readonly onOpenDeepLink?: (target: ProjectDeepLinkTarget) => void;
  readonly onOpenEvidence?: (reference: ThreadGraphRef) => void;
}

/**
 * Grammaire 2a : thread-first. Une bannière de review, le bandeau cinq
 * étapes, le graphe enregistré (ThreadGraph), l'activité enregistrée et Now. Les
 * surfaces de détail appartiennent aux viewers contextuels du graphe.
 */
export function ProjectOverview({
  project,
  thread,
  phaseLanes,
  activities,
  caseActivityJoins,
  viewerSessions,
  onNavigate,
  onOpenActivity,
  onOpenDeepLink,
  onOpenEvidence,
}: ProjectOverviewProps): JSX.Element {
  const brief = buildProjectBrief(project);
  const currentWork = buildCurrentProjectWork(project);
  const projectPath = buildProjectPath(
    project,
    thread,
    activities,
    caseActivityJoins,
  );
  const recordedActivity = activityFeedNodes(thread.graph.nodes);
  const currentFocus = selectCurrentProjectFocus(project);
  const openBlocker = brief.openBlockers[0];
  const statusTone = projectStatusTone(projectPath.status);
  const statusLabel = projectPathStatusLabel(projectPath);
  const pathStages = groupProjectPathGatesByLane(
    projectPath.activities,
    phaseLanes,
  );
  const overviewStages: readonly OverviewThreadStageSummary[] = pathStages.map(
    (group) => ({
      lane: group.id,
      label: PROJECT_PATH_STAGE_LABELS[group.id],
      status: projectPathLaneStageStatus(group),
      count: `${group.satisfiedGates}/${group.totalGates}`,
    }),
  );
  const openOverviewEvidence = (reference: ThreadGraphRef) => {
    if (onOpenEvidence) {
      onOpenEvidence(reference);
      return;
    }
    onNavigate("verification");
  };
  const openOverviewActivity = () => {
    if (onOpenActivity) {
      onOpenActivity();
      return;
    }
    onNavigate("work");
  };

  // minmax(0,1fr) : sans lui, un contenu large imposerait sa largeur
  // min-content à toute la colonne (piège grid).
  return (
    <main
      className="overview-2a project-thread-page grid grid-cols-[minmax(0,1fr)]"
      id="project-workspace-panel"
      tabIndex={-1}
    >
      <section
        className="project-thread-canvas"
        aria-labelledby="project-objective-title"
        data-tone={statusTone}
        data-surface="digital-thread-whiteboard"
      >
        <section
          id="project-thread-whiteboard"
          className="project-thread-board"
          aria-labelledby="project-phase-title"
          data-viewer-layer="reserved"
        >
          <h3 id="project-phase-title" className="sr-only">
            Project path and digital thread
          </h3>
          <div className="project-thread-top-hud">
            <header className="project-thread-hud">
              <div className="project-thread-mission">
                <p className={cn("m-0", PAGE_EYEBROW)}>
                  Project control
                </p>
                <h2 id="project-objective-title">
                  {project.project.objective.title}
                </h2>
                {hasDistinctProjectObjectiveStatement(
                  project.project.objective.title,
                  project.project.objective.statement,
                ) && (
                  <blockquote className="project-thread-mission-statement">
                    {project.project.objective.statement}
                  </blockquote>
                )}
                <p
                  className="project-thread-context-meta"
                  title={`${project.id}@${project.revision} · ${thread.id} · ${project.project.subjectId}`}
                >
                  {project.id}@{project.revision}
                  <span aria-hidden="true">·</span>
                  {thread.id}
                  <span aria-hidden="true">·</span>
                  {project.project.subjectId}
                  {projectPath.status === "completed" && (
                    <>
                      <span aria-hidden="true">—</span>
                      Concept/integration proof only · not certification or
                      release
                    </>
                  )}
                </p>
              </div>
              <div className="project-thread-hud-controls">
                <div
                  className="overview-status-cluster project-thread-status-hud"
                  aria-label={`Project path: ${statusLabel}`}
                >
                  <dl
                    className={cn(
                      "overview-status-grid project-thread-status-grid",
                      CARD_SURFACE,
                    )}
                  >
                    <div>
                      <dt>Project path</dt>
                      <dd>
                        <i
                          aria-hidden="true"
                          className={cn(
                            "project-thread-status-dot",
                            toneDotClass(statusTone),
                          )}
                        />
                        <span title={statusLabel}>{statusLabel}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Thread records</dt>
                      <dd className="font-mono tabular-nums">
                        {thread.graph.nodes.length} records ·{" "}
                        {thread.graph.edges.length} links
                      </dd>
                    </div>
                    <div>
                      <dt>Activity</dt>
                      <dd className="font-mono tabular-nums">
                        {recordedActivity.length} recorded
                        {recordedActivity[0]?.recordedAt
                          ? ` · ${
                            formatShortTime(recordedActivity[0].recordedAt)
                          }`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Snapshot</dt>
                      <dd className="font-mono tabular-nums">
                        @{project.revision}
                      </dd>
                    </div>
                  </dl>
                </div>
                <nav
                  className="project-thread-destination-dock"
                  aria-label="Project destinations"
                >
                  <button
                    type="button"
                    onClick={() => onNavigate("product")}
                  >
                    Product
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate("verification")}
                  >
                    Evidence
                  </button>
                  <button type="button" onClick={() => onNavigate("work")}>
                    Activity
                  </button>
                </nav>
              </div>
            </header>

            <div className="project-thread-review-rail">
              <OverviewReviewBanner
                project={project}
                thread={thread}
                onOpenActivity={onOpenActivity}
                onOpenDeepLink={onOpenDeepLink}
                onOpenEvidence={onOpenEvidence}
              />
            </div>
          </div>

          <OverviewThreadHero
            thread={thread}
            projectId={project.project.id}
            viewerSessions={viewerSessions}
            activities={projectPath.activities}
            immersive
            stages={overviewStages}
            onOpenEvidence={openOverviewEvidence}
            onOpenActivity={openOverviewActivity}
          />
          <div className="project-thread-bottom-hud">
            <div className="project-thread-now-hud">
              <NowPanel
                compact
                project={project}
                activeRun={currentFocus.activeRun}
                focusWork={currentFocus.work}
                lastSettledRun={brief.lastSettledRun}
                nextWork={currentWork.nextWork[0]}
                openBlocker={openBlocker}
                onNavigate={onNavigate}
              />
            </div>
            <div className="project-thread-records-hud">
              <OverviewRecordedActivity
                thread={thread}
                onOpenActivity={openOverviewActivity}
                onOpenRecord={openOverviewEvidence}
              />
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

/**
 * Bande cinq étapes : un nœud par lane persistée, x/y d'activités stables.
 * `flex` et `role="list"` conservent le rôle liste ; `display:grid` le
 * retirerait sous VoiceOver/Safari.
 */
export function ProjectPathStageBand(
  { groups }: { readonly groups: readonly ProjectPathLaneGroup[] },
): JSX.Element {
  return (
    <ol
      className="project-path-stage-band flex items-center gap-0 overflow-x-auto px-4 py-2 tabular-nums"
      role="list"
    >
      {groups.map((group, index) => {
        const label = PROJECT_PATH_STAGE_LABELS[group.id];
        const status = projectPathLaneStageStatus(group);
        const count = `${group.satisfiedGates}/${group.totalGates}`;
        const suffix = status === "active" || status === "blocked"
          ? status.toUpperCase()
          : undefined;
        return (
          <li
            key={group.id}
            data-lane={group.id}
            data-state={status}
            aria-current={status === "active" ? "step" : undefined}
            aria-label={`${label} ${count} ${status}`}
            className="flex min-w-[6.75rem] shrink-0 flex-1 items-center"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                stageNodeClass(status),
              )}
            />
            <div className="mx-1.5 min-w-0">
              <span className={cn("block truncate", SECTION_LABEL)}>
                {label}
              </span>
              <span
                className={cn(
                  "block font-mono text-[10.5px] font-medium tabular-nums",
                  stageCountClass(status),
                )}
              >
                {count}
                {suffix ? ` ${suffix}` : ""}
              </span>
            </div>
            {index < groups.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "project-path-stage-connector mx-1.5 h-px min-w-3 flex-1",
                  status === "completed" ? "bg-success/40" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function OverviewReviewBanner({
  project,
  thread,
  onOpenActivity,
  onOpenDeepLink,
  onOpenEvidence,
}: {
  project: EngineeringProjectSnapshot;
  thread: ThreadWorkbenchSnapshot;
  onOpenActivity?: (decisionId?: string) => void;
  onOpenDeepLink?: (target: ProjectDeepLinkTarget) => void;
  onOpenEvidence?: (reference: EngineeringThreadEntityRef) => void;
}): JSX.Element {
  const records = buildProjectReviewRecords(project, thread);
  const nextReview = currentProjectReview(records);
  const needsReviewCount =
    records.filter((record) => record.state === "needs-review").length;
  const pendingResultCount =
    records.filter((record) => record.state === "approved-awaiting-result")
      .length;
  return (
    <Card
      className={cn(
        "overview-review-banner gap-0 py-0 shadow-sm",
        nextReview && "border-warning/40",
      )}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-4 px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <i
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              nextReview ? "bg-warning" : "bg-muted-foreground",
            )}
          />
          <span className="shrink-0 text-[13px] font-semibold">
            {nextReview
              ? "Needs your review"
              : "No proposal is waiting for review"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {nextReview ? nextReview.title : "Past reviews remain in Activity."}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {needsReviewCount} waiting · {pendingResultCount} pending
          </span>
          {nextReview?.resultEvidence && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => onOpenEvidence?.(nextReview.resultEvidence!)}
            >
              Open published result
            </Button>
          )}
          {nextReview
            ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    className="h-7 bg-zinc-900 px-3 text-xs text-zinc-50 hover:bg-zinc-800"
                  >
                    Inspect review
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-[13px]">
                      {nextReview.title}
                    </DialogTitle>
                    <DialogDescription className="text-[11.5px] leading-relaxed">
                      {nextReview.question}
                    </DialogDescription>
                  </DialogHeader>
                  {nextReview.summary && (
                    <p className="m-0 text-[11.5px] text-muted-foreground">
                      {nextReview.summary}
                    </p>
                  )}
                  <p className="m-0 font-mono text-[10px] text-muted-foreground">
                    Signing happens in the paired conversation, never here.
                  </p>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline" size="sm" className="h-7">
                        Close
                      </Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button
                        size="sm"
                        className="h-7 bg-zinc-900 px-3 text-xs text-zinc-50 hover:bg-zinc-800"
                        onClick={() => {
                          onOpenDeepLink?.(reviewDeepLinkTarget(nextReview.id));
                          onOpenActivity?.(nextReview.decision?.id);
                        }}
                      >
                        Open in Activity →
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )
            : (
              <Button
                size="sm"
                className="h-7 bg-zinc-900 px-3 text-xs text-zinc-50 hover:bg-zinc-800"
                onClick={() => onOpenActivity?.()}
              >
                Open Activity
              </Button>
            )}
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewRecordedActivity({
  thread,
  onOpenActivity,
  onOpenRecord,
}: {
  thread: ThreadWorkbenchSnapshot;
  onOpenActivity: () => void;
  onOpenRecord: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  const records = activityFeedNodes(thread.graph.nodes)
    .slice(0, 12);
  return (
    <section
      className="overview-records-hud-content"
      aria-labelledby="overview-records-title"
    >
      <div className="overview-records-heading">
        <h3 id="overview-records-title" className={cn("m-0", SECTION_LABEL)}>
          Recorded activity
        </h3>
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={onOpenActivity}
        >
          Activity →
        </Button>
      </div>
      {records.length === 0
        ? (
          <p className="overview-records-empty">
            No Activity record is projected.
          </p>
        )
        : (
          <div
            className="overview-record-chip-rail"
            role="list"
            aria-label="Recent recorded activity"
            tabIndex={0}
          >
            {records.map((record) => (
              <article
                key={`${record.ref.kind}:${record.ref.id}`}
                className="overview-record-chip"
                role="listitem"
              >
                <OverviewRecordChip
                  record={record}
                  onOpen={() => onOpenRecord(record.ref)}
                />
              </article>
            ))}
          </div>
        )}
    </section>
  );
}

function OverviewRecordChip({
  record,
  onOpen,
}: {
  record: ThreadGraphNode;
  onOpen: () => void;
}): JSX.Element {
  const exactIdentity = `${record.ref.kind}:${record.ref.id}`;
  return (
    <button
      type="button"
      className="overview-record-chip-action"
      title={`${exactIdentity} · ${record.freshness}`}
      onClick={onOpen}
    >
      <span className="overview-record-chip-label">{record.label}</span>
      <Badge
        className="overview-record-chip-badge"
        variant={recordStatusVariant(record.freshness)}
      >
        {record.freshness}
      </Badge>
      <span className="overview-record-chip-value">
        {sentenceLabel(record.entityKind)} ·{" "}
        {compactEmbeddedFingerprints(record.ref.id)}
        {record.recordedAt ? ` · ${formatShortTime(record.recordedAt)}` : ""}
      </span>
      <span className="sr-only">Exact record {exactIdentity}</span>
    </button>
  );
}

/**
 * Le pouls en feed mono 4 colonnes. Review est la bannière au-dessus —
 * Now expose les entrées enregistrées : run actif, dernier run settled,
 * prochain work item, blocker ouvert. Glyphes : ▸ brand (running),
 * ✓ success (settled/sealed), ⧗ muted (queued), • destructive (blocked).
 */
function NowPanel({
  project,
  activeRun,
  focusWork,
  lastSettledRun,
  nextWork,
  openBlocker,
  onNavigate,
  compact = false,
}: {
  project: EngineeringProjectSnapshot;
  activeRun?: EngineeringAgentRun;
  focusWork?: EngineeringWorkItem;
  lastSettledRun?: EngineeringAgentRun;
  nextWork?: EngineeringWorkItem;
  openBlocker?: EngineeringBlocker;
  onNavigate: (view: ProjectWorkspaceView) => void;
  compact?: boolean;
}): JSX.Element {
  const liveRunCount = project.agentRuns.filter(
    (r) => r.status === "running",
  ).length;

  type FeedEntry = {
    time?: string;
    glyph: "running" | "settled" | "queued" | "blocked";
    description: string;
    tag?: string;
  };
  const feed: FeedEntry[] = [];

  if (activeRun) {
    const wi = project.workItems.find((w) => w.id === activeRun.workItemId);
    feed.push({
      time: activeRun.startedAt ?? activeRun.queuedAt ??
        agentRunRecordedAt(activeRun),
      glyph: "running",
      description: wi?.title ?? activeRun.workItemId,
      tag: "Agent",
    });
  } else if (focusWork) {
    feed.push({
      glyph: "queued",
      description: focusWork.title,
      tag: workOwnerLabel(focusWork.owner),
    });
  }

  if (lastSettledRun) {
    const wi = project.workItems.find(
      (w) => w.id === lastSettledRun.workItemId,
    );
    feed.push({
      time: agentRunRecordedAt(lastSettledRun),
      glyph: "settled",
      description: wi?.title ?? lastSettledRun.workItemId,
      tag: sentenceLabel(lastSettledRun.status),
    });
  }

  if (nextWork) {
    feed.push({
      glyph: "queued",
      description: nextWork.title,
      tag: workOwnerLabel(nextWork.owner),
    });
  }

  if (openBlocker) {
    feed.push({
      glyph: "blocked",
      description: openBlocker.title,
      tag: sentenceLabel(openBlocker.kind),
    });
  }

  const openActivity = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onNavigate("work");
  };

  if (compact) {
    return (
      <section
        className="project-now-panel project-now-panel--compact"
        aria-label="Current project control"
      >
        <div className="project-now-heading">
          <p className={cn("m-0", SECTION_LABEL)}>NOW</p>
          {liveRunCount > 0 && (
            <span className="project-now-live">
              <i aria-hidden="true" />
              {liveRunCount} RUN LIVE
            </span>
          )}
        </div>
        <div className="project-now-feed-rail" tabIndex={0} title="Agent now">
          {feed.length === 0
            ? (
              <p className="project-now-empty">
                No active work or agent run is recorded.
              </p>
            )
            : feed.map((entry, index) => {
              const glyph = entry.glyph === "running"
                ? "▸"
                : entry.glyph === "settled"
                ? "✓"
                : entry.glyph === "blocked"
                ? "•"
                : "⧗";
              return (
                <span
                  key={index}
                  className="project-now-feed-chip"
                  data-state={entry.glyph}
                  title={[entry.time, entry.description, entry.tag]
                    .filter(Boolean).join(" · ")}
                >
                  <span aria-hidden="true" className="project-now-feed-glyph">
                    {glyph}
                  </span>
                  {entry.time && (
                    <time dateTime={entry.time}>
                      {formatShortTime(entry.time)}
                    </time>
                  )}
                  <span className="project-now-feed-description">
                    {entry.description}
                  </span>
                  {entry.tag && (
                    <span className="project-now-feed-tag">{entry.tag}</span>
                  )}
                </span>
              );
            })}
        </div>
        <a href="#work" className="project-now-open" onClick={openActivity}>
          Activity →
        </a>
      </section>
    );
  }

  return (
    <section className="project-now-panel" aria-label="Current project control">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-2">
        <p className={cn("m-0", SECTION_LABEL)}>
          NOW
        </p>
        {liveRunCount > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-[9.5px] text-brand">
            <i
              aria-hidden="true"
              className="size-[5px] rounded-full bg-brand"
            />
            {liveRunCount} RUN LIVE
          </span>
        )}
      </div>
      <div className="py-1 tabular-nums" title="Agent now">
        {feed.length === 0
          ? (
            <p className="px-3.5 py-2 text-sm text-muted-foreground">
              No active work or agent run is recorded.
            </p>
          )
          : feed.map((entry, i) => <NowFeedRow key={i} entry={entry} />)}
      </div>
      <PanelFoot>
        <a
          href="#work"
          className="text-[12px] font-medium text-brand hover:underline"
          onClick={openActivity}
        >
          Open activity →
        </a>
      </PanelFoot>
    </section>
  );
}

function NowFeedRow({ entry }: {
  entry: {
    time?: string;
    glyph: "running" | "settled" | "queued" | "blocked";
    description: string;
    tag?: string;
  };
}): JSX.Element {
  const glyph = entry.glyph === "running"
    ? "▸"
    : entry.glyph === "settled"
    ? "✓"
    : entry.glyph === "blocked"
    ? "•"
    : "⧗";
  return (
    <div className="grid grid-cols-[42px_14px_minmax(0,1fr)_auto] items-baseline gap-x-2 px-3.5 py-[5px]">
      <span className="pt-px font-mono text-[10.5px] text-muted-foreground">
        {entry.time ? formatShortTime(entry.time) : ""}
      </span>
      <span
        className={cn(
          "font-mono text-[10.5px] font-medium",
          entry.glyph === "running" && "text-brand",
          entry.glyph === "settled" && "text-success",
          entry.glyph === "queued" && "text-muted-foreground",
          entry.glyph === "blocked" && "text-destructive",
        )}
      >
        {glyph}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[12px]",
          entry.glyph === "running"
            ? "text-foreground"
            : "text-muted-foreground",
        )}
      >
        {entry.description}
      </span>
      {entry.tag && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {entry.tag}
        </span>
      )}
    </div>
  );
}

function reviewDeepLinkTarget(
  kind: "brief" | "architecture" | "requirements" | "geometry",
): ProjectDeepLinkTarget {
  return kind === "brief" ? "review/brief" : `review/${kind}`;
}

function toneDotClass(tone: ReturnType<typeof projectStatusTone>): string {
  if (tone === "active" || tone === "complete") return "bg-success";
  if (tone === "attention") return "bg-warning";
  if (tone === "blocked") return "bg-destructive";
  return "bg-muted-foreground";
}

function stageNodeClass(status: ProjectPathStageStatus): string {
  if (status === "completed") return "bg-success";
  if (status === "active") {
    return "border-2 border-success bg-background ring-4 ring-success/15";
  }
  if (status === "blocked") return "bg-destructive";
  return "border border-muted-foreground/40 bg-background";
}

function stageCountClass(status: ProjectPathStageStatus): string {
  if (status === "active") return "text-success";
  if (status === "blocked") return "text-destructive";
  return "text-muted-foreground";
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
