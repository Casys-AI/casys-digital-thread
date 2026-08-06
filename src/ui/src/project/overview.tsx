/** @jsxImportSource preact */

import type { ComponentChildren, JSX } from "preact";
import type {
  EngineeringAgentRun,
  EngineeringBlocker,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { DecisionCenter } from "./control-center.tsx";
import { ProjectBriefRecord } from "./brief-record.tsx";
import type { ProjectWorkspaceView } from "./navigation.tsx";
import {
  agentRunSummary,
  buildCurrentProjectWork,
  buildProjectBrief,
  buildProjectPath,
  projectPathStatusLabel,
  projectStatusTone,
  verificationChainDetail,
  workOwnerLabel,
  workStatusLabel,
} from "./model.ts";

export interface ProjectOverviewProps {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadWorkbenchSnapshot;
  readonly onNavigate: (view: ProjectWorkspaceView) => void;
  readonly onOpenActivity?: (decisionId?: string) => void;
  readonly onOpenSpecification?: (decisionId: string) => void;
}

export function ProjectOverview({
  project,
  thread,
  onNavigate,
  onOpenActivity,
  onOpenSpecification,
}: ProjectOverviewProps): JSX.Element {
  const brief = buildProjectBrief(project);
  const currentWork = buildCurrentProjectWork(project);
  const projectPath = buildProjectPath(project, thread);
  const leadRun = brief.activeRuns[0];
  const openBlocker = brief.openBlockers[0];

  return (
    <main class="project-overview" id="project-workspace-panel">
      <section
        class="project-objective"
        aria-labelledby="project-objective-title"
      >
        <div class="project-objective-index" aria-hidden="true">
          <span>MISSION</span>
          <strong>{String(project.revision).padStart(2, "0")}</strong>
        </div>
        <div class="project-objective-copy">
          <p>CURRENT PROJECT BRIEF</p>
          <h3 id="project-objective-title">
            {project.project.objective.title}
          </h3>
          <blockquote>{project.project.objective.statement}</blockquote>
        </div>
        <div
          class="project-status-seal"
          data-tone={projectStatusTone(projectPath.status)}
          aria-label={`Project status: ${projectPathStatusLabel(projectPath)}`}
        >
          <i aria-hidden="true" />
          <span>PROJECT PATH</span>
          <strong>{projectPathStatusLabel(projectPath)}</strong>
          <small>
            {projectPath.status === "completed"
              ? "Concept/integration proof only · not certification or release"
              : `${projectPath.completedPhases}/${projectPath.phases.length} macro gates satisfied`}
          </small>
        </div>
      </section>

      <DecisionCenter
        project={project}
        onOpenActivity={onOpenActivity}
        onOpenSpecification={onOpenSpecification}
      />

      <ProjectBriefRecord project={project} />

      <section
        class="project-phase-section"
        aria-labelledby="project-phase-title"
      >
        <header class="project-section-label">
          <div>
            <p>PROJECT PATH</p>
            <h3 id="project-phase-title">From intent to industrial proof</h3>
          </div>
          <span>
            Macro gates only. Component revisions and retries stay with their
            evidence lifecycle.
          </span>
        </header>
        {
          /*
          Sous ~900px le rail deborde et devient une zone a defilement
          horizontal. Sans tabindex, les phases hors ecran sont inatteignables
          au clavier seul (WCAG 2.1.1).
        */
        }
        <ol
          class="project-phase-rail"
          tabIndex={0}
          aria-label="Project phases, scrolls horizontally"
        >
          {projectPath.phases.map((item, index) => (
            <li key={item.phase.id} data-state={item.status}>
              <div class="project-phase-node">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i aria-hidden="true" />
              </div>
              <div class="project-phase-copy">
                <small>{phaseStatusLabel(item.status)}</small>
                <strong>{item.phase.name}</strong>
                <p>{item.phase.description}</p>
                <dl>
                  <div>
                    <dt>Work</dt>
                    <dd>{item.completedWorkItems}/{item.totalWorkItems}</dd>
                  </div>
                  {item.requiredDecisions > 0 && (
                    <div>
                      <dt>Decisions</dt>
                      <dd>{item.approvedDecisions}/{item.requiredDecisions}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Evidence</dt>
                    <dd>{item.evidenceCount}</dd>
                  </div>
                  {item.lifecycle && (
                    <div
                      class="project-phase-lifecycle"
                      data-state={item.lifecycle.state}
                    >
                      <dt>
                        {item.lifecycle.affectedComponentIds.length > 0
                          ? "Component"
                          : "Lifecycle"}
                      </dt>
                      <dd>{projectPhaseLifecycleLabel(item.lifecycle)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        class="project-control-grid"
        aria-label="Current project control"
      >
        <ProjectControlPanel
          className="is-now"
          index="AGENT"
          title="What the agent is doing"
          empty="No active work or agent run is recorded."
          onOpen={() => onNavigate("work")}
          actionLabel="Open activity"
        >
          {leadRun
            ? <AgentRunSummary run={leadRun} project={project} />
            : brief.currentWork[0]
            ? <WorkItemSummary item={brief.currentWork[0]} />
            : null}
        </ProjectControlPanel>

        <ProjectControlPanel
          className="is-next"
          index="NEXT"
          title="Next current work"
          empty="No further current work is recorded. Historical retries remain in Activity."
          onOpen={() => onNavigate("work")}
          actionLabel="Inspect agent plan"
        >
          {currentWork.nextWork[0]
            ? <WorkItemSummary item={currentWork.nextWork[0]} />
            : null}
        </ProjectControlPanel>

        <ProjectControlPanel
          className={openBlocker ? "is-blocked" : "is-clear"}
          index="RISK"
          title="What blocks progress"
          empty="No open blocker is recorded."
          onOpen={() => onNavigate("work")}
          actionLabel="Inspect blockers"
        >
          {openBlocker ? <BlockerSummary blocker={openBlocker} /> : null}
        </ProjectControlPanel>
      </section>

      <section
        class="project-evidence-overview"
        aria-labelledby="evidence-overview-title"
      >
        <header>
          <div>
            <p>LINKED TECHNICAL TRUTH</p>
            <h3 id="evidence-overview-title">
              One product, three ways to inspect it
            </h3>
          </div>
          <span>{thread.sourceLabel}</span>
        </header>
        <div class="project-evidence-routes">
          <EvidenceRoute
            index="A"
            title="Product definition"
            detail={productDefinitionDetail(thread)}
            action="Explore product"
            onOpen={() => onNavigate("product")}
          />
          <EvidenceRoute
            index="B"
            title="Verification chain"
            detail={verificationChainDetail(thread)}
            action="Trace evidence"
            onOpen={() => onNavigate("verification")}
          />
          <EvidenceRoute
            index="C"
            title="Live engineering work"
            detail={`${thread.graph.nodes.length} recorded facts. Latest change: ${thread.change.title}.`}
            action="Follow activity"
            onOpen={() => onNavigate("work")}
          />
        </div>
        <details class="project-technical-record">
          <summary>Exact project and thread revisions</summary>
          <dl>
            <div>
              <dt>Project snapshot</dt>
              <dd>
                <code>{project.id}@{project.revision}</code>
              </dd>
            </div>
            <div>
              <dt>Thread projection</dt>
              <dd>
                <code>{thread.id}</code>
              </dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>
                <code>{project.project.subjectId}</code>
              </dd>
            </div>
          </dl>
        </details>
      </section>
    </main>
  );
}

function ProjectControlPanel({
  className,
  index,
  title,
  empty,
  children,
  actionLabel,
  onOpen,
}: {
  className: string;
  index: string;
  title: string;
  empty: string;
  children?: ComponentChildren;
  actionLabel: string;
  onOpen: () => void;
}): JSX.Element {
  return (
    <article class={`project-control-panel ${className}`}>
      <header>
        <span>{index}</span>
        <h3>{title}</h3>
      </header>
      <div class="project-control-body">
        {children ?? <p class="project-control-empty">{empty}</p>}
      </div>
      <button type="button" onClick={onOpen}>
        {actionLabel}
        <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}

function AgentRunSummary({ run, project }: {
  run: EngineeringAgentRun;
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  return (
    <div class="project-control-record" data-state={run.status}>
      <span>{run.status.replaceAll("-", " ")}</span>
      <strong>{workItem?.title ?? run.workItemId}</strong>
      <p>{agentRunSummary(project, run)}</p>
      <small>
        Agent run · {formatShortTime(run.startedAt ?? run.queuedAt)}
      </small>
    </div>
  );
}

function WorkItemSummary({ item }: { item: EngineeringWorkItem }): JSX.Element {
  return (
    <div class="project-control-record" data-state={item.status}>
      <span>{workStatusLabel(item.status)}</span>
      <strong>{item.title}</strong>
      <p>{item.description}</p>
      <small>{workOwnerLabel(item.owner)} · {item.kind}</small>
    </div>
  );
}

function BlockerSummary(
  { blocker }: { blocker: EngineeringBlocker },
): JSX.Element {
  return (
    <div class="project-control-record" data-state="blocked">
      <span>{blocker.kind.replaceAll("-", " ")}</span>
      <strong>{blocker.title}</strong>
      <p>{blocker.description}</p>
      <small>Open since {formatShortDate(blocker.openedAt)}</small>
    </div>
  );
}

function EvidenceRoute({ index, title, detail, action, onOpen }: {
  index: string;
  title: string;
  detail: string;
  action: string;
  onOpen: () => void;
}): JSX.Element {
  return (
    <button type="button" class="project-evidence-route" onClick={onOpen}>
      <span aria-hidden="true">{index}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        <small>
          {action} <b aria-hidden="true">→</b>
        </small>
      </div>
    </button>
  );
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

function productDefinitionDetail(thread: ThreadWorkbenchSnapshot): string {
  const labels = [
    ...new Set(
      thread.components.components.flatMap((component) =>
        component.bindings.filter((binding) => binding.status === "verified")
          .map((binding) => providerLabel(binding.provider))
      ),
    ),
  ];
  const scope = labels.length > 0
    ? joinLabels(labels)
    : "recorded source facets";
  return `${thread.components.components.length} reviewed component records across ${scope}.`;
}

function providerLabel(
  provider: "syson" | "erpnext" | "build123d" | "digital-thread" | string,
): string {
  if (provider === "syson") return "SysON";
  if (provider === "build123d") return "CAD";
  if (provider === "digital-thread") return "Thread";
  return "ERP";
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length < 2) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
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
