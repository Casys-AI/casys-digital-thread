import type { JSX, ReactNode } from "react";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringAgentRun,
  EngineeringBlocker,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { productDefinitionSummary } from "../thread/product-anchor-model.ts";
import { cn } from "../lib/utils.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { DecisionCenter } from "./control-center.tsx";
import { ProjectBriefRecord } from "./brief-record.tsx";
import type { ProjectWorkspaceView } from "./navigation.tsx";
import {
  hasDistinctProjectObjectiveStatement,
  type ProjectDeepLinkTarget,
} from "./navigation-model.ts";
import {
  agentRunRecordedAt,
  agentRunSummary,
  buildCurrentProjectWork,
  buildProjectBrief,
  buildProjectPath,
  projectPathStatusLabel,
  projectStatusTone,
  selectCurrentProjectFocus,
  verificationChainDetail,
  workOwnerLabel,
  workStatusLabel,
} from "./model.ts";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export interface ProjectOverviewProps {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadWorkbenchSnapshot;
  readonly onNavigate: (view: ProjectWorkspaceView) => void;
  readonly onOpenActivity?: (decisionId?: string) => void;
  readonly onOpenDeepLink?: (target: ProjectDeepLinkTarget) => void;
  readonly onOpenEvidence?: (reference: EngineeringThreadEntityRef) => void;
}

export function ProjectOverview({
  project,
  thread,
  onNavigate,
  onOpenActivity,
  onOpenDeepLink,
  onOpenEvidence,
}: ProjectOverviewProps): JSX.Element {
  const brief = buildProjectBrief(project);
  const currentWork = buildCurrentProjectWork(project);
  const projectPath = buildProjectPath(project, thread);
  const currentFocus = selectCurrentProjectFocus(project);
  const leadRun = currentFocus.activeRun;
  const openBlocker = brief.openBlockers[0];
  const statusTone = projectStatusTone(projectPath.status);
  const statusLabel = projectPathStatusLabel(projectPath);

  return (
    <main className="grid gap-4" id="project-workspace-panel">
      <section
        className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-start md:justify-between"
        aria-labelledby="project-objective-title"
      >
        <div className="min-w-0 [&>h3]:m-0 [&>h3]:max-w-3xl [&>h3]:text-lg [&>h3]:font-semibold [&>h3]:tracking-tight">
          <p className="text-xs font-medium text-muted-foreground">
            Project objective
          </p>
          <h3 id="project-objective-title">
            {project.project.objective.title}
          </h3>
          {hasDistinctProjectObjectiveStatement(
            project.project.objective.title,
            project.project.objective.statement,
          ) && (
            <blockquote className="mt-3 max-w-3xl text-sm text-muted-foreground">
              {project.project.objective.statement}
            </blockquote>
          )}
        </div>
        <div
          className="flex shrink-0 flex-col items-start gap-1.5 md:items-end"
          data-tone={statusTone}
          aria-label={`Project status: ${statusLabel}`}
        >
          <Badge
            variant={projectToneVariant(statusTone)}
            className="gap-1.5 px-2.5 py-1 text-sm"
          >
            <i
              aria-hidden="true"
              className={cn("size-1.5 rounded-full", toneDotClass(statusTone))}
            />
            {statusLabel}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {projectPath.status === "completed"
              ? "Concept/integration proof only · not certification or release"
              : `${projectPath.completedPhases}/${projectPath.phases.length} macro gates satisfied`}
          </p>
        </div>
      </section>

      <DecisionCenter
        project={project}
        thread={thread}
        onOpenActivity={onOpenActivity}
        onOpenReview={(kind) => onOpenDeepLink?.(reviewDeepLinkTarget(kind))}
        onOpenEvidence={onOpenEvidence}
      />

      <section
        className="grid gap-4 md:grid-cols-3"
        aria-label="Current project control"
      >
        <ProjectControlPanel
          title="Agent now"
          empty="No active work or agent run is recorded."
          href="#work"
          onOpen={() => onNavigate("work")}
          actionLabel="Open activity"
        >
          {leadRun
            ? <AgentRunSummary run={leadRun} project={project} />
            : currentFocus.work
            ? <WorkItemSummary item={currentFocus.work} />
            : brief.lastSettledRun
            ? (
              <AgentRunSummary
                run={brief.lastSettledRun}
                project={project}
                settled
              />
            )
            : null}
        </ProjectControlPanel>

        <ProjectControlPanel
          title="Up next"
          empty="No further current work is recorded. Historical retries remain in Activity."
          href="#work"
          onOpen={() => onNavigate("work")}
          actionLabel="Open activity"
        >
          {currentWork.nextWork[0]
            ? <WorkItemSummary item={currentWork.nextWork[0]} />
            : null}
        </ProjectControlPanel>

        <ProjectControlPanel
          title="Blockers"
          empty="No open blocker is recorded."
          href="#work"
          onOpen={() => onNavigate("work")}
          actionLabel="Open activity"
        >
          {openBlocker ? <BlockerSummary blocker={openBlocker} /> : null}
        </ProjectControlPanel>
      </section>

      <section aria-labelledby="project-phase-title">
        <Card>
          <CardHeader className="px-5 pt-5 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold [&>h3]:tracking-tight">
            <h3 id="project-phase-title">Project path</h3>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {
              /*
              Sous ~900px le rail deborde et devient une zone a defilement
              horizontal. Sans tabindex, les phases hors ecran sont
              inatteignables au clavier seul (WCAG 2.1.1).
            */
            }
            <ol
              className="flex items-start overflow-x-auto"
              tabIndex={0}
              aria-label="Project phases, scrolls horizontally"
            >
              {projectPath.phases.map((item, index) => (
                <li
                  key={item.phase.id}
                  data-state={item.status}
                  className="flex min-w-[8.5rem] flex-1 flex-col gap-1.5"
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        item.status === "completed" ||
                          item.status === "active"
                          ? "bg-success"
                          : "bg-muted-foreground",
                      )}
                    />
                    {index < projectPath.phases.length - 1 && (
                      <span
                        className="h-px flex-1 bg-border"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <span className="text-xs font-medium">
                    {item.phase.name}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {phaseCounterLabel(item)}
                  </p>
                  {item.lifecycle && (
                    <p
                      className="text-xs text-muted-foreground"
                      data-state={item.lifecycle.state}
                    >
                      {item.lifecycle.affectedComponentIds.length > 0
                        ? "Component"
                        : "Lifecycle"}
                      {" · "}
                      {projectPhaseLifecycleLabel(item.lifecycle)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <section
        className="grid gap-3 [&>h3]:m-0 [&>h3]:text-lg [&>h3]:font-semibold [&>h3]:tracking-tight"
        aria-labelledby="evidence-overview-title"
      >
        <h3 id="evidence-overview-title">Technical record</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <EvidenceRoute
            title="Product"
            detail={productDefinitionSummary(thread)}
            action="Explore product"
            href="#product"
            onOpen={() => onNavigate("product")}
          />
          <EvidenceRoute
            title="Evidence"
            detail={verificationChainDetail(thread)}
            action="Trace evidence"
            href="#verification"
            onOpen={() => onNavigate("verification")}
          />
          <EvidenceRoute
            title="Activity"
            detail={`${thread.graph.nodes.length} recorded facts. Latest change: ${thread.change.title}.`}
            action="Follow activity"
            href="#work"
            onOpen={() => onNavigate("work")}
          />
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Exact project and thread revisions
          </summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <dt>Project snapshot</dt>
              <dd className="font-mono text-xs">
                {project.id}@{project.revision}
              </dd>
            </div>
            <div>
              <dt>Thread projection</dt>
              <dd className="font-mono text-xs">{thread.id}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd className="font-mono text-xs">
                {project.project.subjectId}
              </dd>
            </div>
          </dl>
        </details>
      </section>
      <div
        id={project.framing?.proposalReview?.status === "pending"
          ? "current-brief-record"
          : "review-brief"}
      >
        <ProjectBriefRecord project={project} />
      </div>
    </main>
  );
}

function ProjectControlPanel({
  title,
  empty,
  children,
  actionLabel,
  href,
  onOpen,
}: {
  title: string;
  empty: string;
  children?: ReactNode;
  actionLabel: string;
  href: string;
  onOpen: () => void;
}): JSX.Element {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="gap-2 px-5 pt-5">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {children ?? <p className="text-sm text-muted-foreground">{empty}</p>}
      </CardHeader>
      <CardFooter className="mt-auto px-5 pb-5 pt-4">
        <CardActionLink href={href} onOpen={onOpen}>
          {actionLabel}&nbsp;→
        </CardActionLink>
      </CardFooter>
    </Card>
  );
}

function AgentRunSummary({ run, project, settled }: {
  run: EngineeringAgentRun;
  project: EngineeringProjectSnapshot;
  /** A settled run is history, never presented as in-flight activity. */
  settled?: boolean;
}): JSX.Element {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  return (
    <div className="flex flex-col gap-2" data-state={run.status}>
      <Badge variant={recordStatusVariant(run.status)}>
        {sentenceLabel(run.status)}
      </Badge>
      <p className="text-sm font-semibold">
        {workItem?.title ?? run.workItemId}
      </p>
      <p className="text-sm text-muted-foreground">
        {agentRunSummary(project, run)}
      </p>
      <p className="text-xs text-muted-foreground">
        {settled
          ? `Last agent run · ${formatShortTime(agentRunRecordedAt(run))}`
          : `Agent run · ${formatShortTime(run.startedAt ?? run.queuedAt)}`}
      </p>
    </div>
  );
}

function WorkItemSummary({ item }: { item: EngineeringWorkItem }): JSX.Element {
  return (
    <div className="flex flex-col gap-2" data-state={item.status}>
      <Badge variant={recordStatusVariant(item.status)}>
        {sentenceLabel(workStatusLabel(item.status))}
      </Badge>
      <p className="text-sm font-semibold">{item.title}</p>
      <p className="text-sm text-muted-foreground">{item.description}</p>
      <p className="text-xs text-muted-foreground">
        {workOwnerLabel(item.owner)} · {item.kind}
      </p>
    </div>
  );
}

function BlockerSummary(
  { blocker }: { blocker: EngineeringBlocker },
): JSX.Element {
  return (
    <div className="flex flex-col gap-2" data-state="blocked">
      <Badge variant="destructive">
        {sentenceLabel(blocker.kind)}
      </Badge>
      <p className="text-sm font-semibold">{blocker.title}</p>
      <p className="text-sm text-muted-foreground">{blocker.description}</p>
      <p className="text-xs text-muted-foreground">
        Open since {formatShortDate(blocker.openedAt)}
      </p>
    </div>
  );
}

function EvidenceRoute({ title, detail, action, href, onOpen }: {
  title: string;
  detail: string;
  action: string;
  href: string;
  onOpen: () => void;
}): JSX.Element {
  return (
    <Card className="flex h-full flex-col transition-colors hover:bg-accent/50">
      <a
        href={href}
        className="flex h-full flex-col"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onOpen();
        }}
      >
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </CardHeader>
        <CardFooter className="mt-auto px-5 pb-5 pt-4">
          <span className="text-sm font-medium text-brand">
            {action}&nbsp;→
          </span>
        </CardFooter>
      </a>
    </Card>
  );
}

function CardActionLink({
  href,
  onOpen,
  children,
}: {
  href: string;
  onOpen: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <a
      href={href}
      className="text-sm font-medium text-brand hover:underline"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        onOpen();
      }}
    >
      {children}
    </a>
  );
}

function reviewDeepLinkTarget(
  kind: "brief" | "architecture" | "requirements" | "geometry",
): ProjectDeepLinkTarget {
  return kind === "brief" ? "review/brief" : `review/${kind}`;
}

function projectToneVariant(
  tone: ReturnType<typeof projectStatusTone>,
): BadgeVariant {
  if (tone === "active" || tone === "complete") return "success";
  if (tone === "attention") return "warning";
  if (tone === "blocked") return "destructive";
  // Le ton neutre (Planned…) doit rester lisible sur le fond canvas : une
  // bordure, pas un fond gris quasi invisible.
  return "outline";
}

function toneDotClass(tone: ReturnType<typeof projectStatusTone>): string {
  if (tone === "active" || tone === "complete") return "bg-success";
  if (tone === "attention") return "bg-warning";
  if (tone === "blocked") return "bg-destructive";
  return "bg-muted-foreground";
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function phaseCounterLabel(
  item: ReturnType<typeof buildProjectPath>["phases"][number],
): string {
  const parts = [
    phaseStatusLabel(item.status),
    `${item.completedWorkItems}/${item.totalWorkItems} work`,
    `${item.evidenceCount} evidence`,
  ];
  if (item.requiredDecisions > 0) {
    parts.splice(
      2,
      0,
      `${item.approvedDecisions}/${item.requiredDecisions} decisions`,
    );
  }
  return parts.join(" · ");
}

function phaseStatusLabel(status: string): string {
  if (status === "completed") return "Gate satisfied";
  if (status === "active") return "In progress";
  if (status === "blocked") return "Blocked";
  return "Planned";
}

function projectPhaseLifecycleLabel(
  lifecycle: NonNullable<
    ReturnType<typeof buildProjectPath>["phases"][number]["lifecycle"]
  >,
): string {
  const componentCount = lifecycle.affectedComponentIds.length;
  const enrichmentCount = lifecycle.modelEnrichmentCount ?? 0;
  const subject = componentCount > 0
    ? `${componentCount} component${componentCount === 1 ? "" : "s"}`
    : enrichmentCount > 0 && lifecycle.correctionCount === 0
    ? `${enrichmentCount} model enrichment${enrichmentCount === 1 ? "" : "s"}`
    : `${lifecycle.correctionCount} evidence update${
      lifecycle.correctionCount === 1 ? "" : "s"
    }`;
  if (lifecycle.state === "current") return `${subject} updated`;
  if (lifecycle.state === "attention") return `${subject} needs review`;
  return `${subject} retained`;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
