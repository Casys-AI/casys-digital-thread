/** @jsxImportSource preact */

import type { JSX } from "preact";
import type {
  EngineeringProjectPhase,
  EngineeringWorkItem,
} from "../../../domain/engineering-project.ts";
import type { ThreadStreamStatus } from "../thread/client.ts";
import type { EngineeringPlanningWorkbenchSnapshot } from "../thread/types.ts";
import {
  buildProjectBrief,
  projectBriefStatusLabel,
  projectStatusTone,
  workOwnerLabel,
  workStatusLabel,
} from "./model.ts";

/**
 * Native project surface for the period between approved discovery and the
 * first technical baseline. It intentionally renders the durable project path
 * rather than manufacturing an empty graph, component list or tool result.
 */
export function PlanningWorkbench({
  workbench,
  streamStatus,
}: {
  workbench: EngineeringPlanningWorkbenchSnapshot;
  streamStatus: ThreadStreamStatus | "snapshot";
}): JSX.Element {
  const project = workbench.project;
  const brief = buildProjectBrief(project);
  const phases = [...brief.phases];
  const items = sortWorkItems(project.workItems, project.phases);
  const hasPath = phases.length > 0;

  return (
    <div class="thread-workbench mcp-view-surface planning-workbench">
      <header class="thread-cockpit-header">
        <div class="thread-cockpit-identity">
          <div class="thread-kicker">
            <span class="thread-coordinate">ENGINEERING PROJECT COCKPIT</span>
          </div>
          <div class="thread-subject-heading">
            <span class="thread-subject-mark" aria-hidden="true">DT</span>
            <div>
              <p class="thread-program">
                PROJECT {project.project.id} · REVISION {project.revision}
              </p>
              <h2>{project.project.name}</h2>
              <span class="thread-subject-context">
                Planning subject · {project.project.subjectId}
              </span>
            </div>
          </div>
        </div>
        <div class="thread-session-panel">
          <div class="thread-session-state" data-state={streamStatus}>
            <i aria-hidden="true" />
            <div>
              <small>LIVE PROJECT PATH</small>
              <strong>{planningStreamLabel(streamStatus)}</strong>
            </div>
          </div>
          <div class="thread-session-change">
            <small>PROJECT STATE</small>
            <strong>{projectBriefStatusLabel(brief)}</strong>
          </div>
          <dl class="thread-session-facts">
            <div>
              <dt>Updated</dt>
              <dd>{formatTime(project.generatedAt)}</dd>
            </div>
          </dl>
        </div>
      </header>

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
            <p>ENGINEERING OBJECTIVE</p>
            <h3 id="project-objective-title">
              {project.project.objective.title}
            </h3>
            <blockquote>{project.project.objective.statement}</blockquote>
          </div>
          <div
            class="project-status-seal"
            data-tone={projectStatusTone(brief.status)}
            aria-label={`Project status: ${projectBriefStatusLabel(brief)}`}
          >
            <i aria-hidden="true" />
            <span>PROJECT STATE</span>
            <strong>{projectBriefStatusLabel(brief)}</strong>
            <small>
              {brief.completedPhases}/{brief.phases.length}{" "}
              phase gates satisfied
            </small>
          </div>
        </section>

        <section
          class="planning-baseline-notice"
          aria-labelledby="planning-baseline-title"
          role="status"
        >
          <div class="planning-baseline-mark" aria-hidden="true">01</div>
          <div>
            <p>BEFORE ENGINEERING EVIDENCE</p>
            <h3 id="planning-baseline-title">
              Technical baseline not created yet
            </h3>
            <span>{workbench.planning.technicalBaseline.message}</span>
          </div>
        </section>

        <section
          class="project-phase-section"
          aria-labelledby="project-phase-title"
        >
          <header class="project-section-label">
            <div>
              <p>PROJECT PATH</p>
              <h3 id="project-phase-title">
                {hasPath
                  ? "The agent’s proposed path"
                  : "The agent has not published a path yet"}
              </h3>
            </div>
            <span>
              {hasPath
                ? "This path is durable planning intent. It is not proof that a technical operation ran."
                : "The approved discovery is linked to this project, but no work path or technical evidence is recorded yet."}
            </span>
          </header>
          {hasPath
            ? (
              <ol class="project-phase-rail planning-phase-rail">
                {phases.map((item, index) => (
                  <li key={item.phase.id} data-state={item.status}>
                    <div class="project-phase-node">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <i aria-hidden="true" />
                    </div>
                    <div class="project-phase-copy">
                      <small>{planningPhaseLabel(item.status)}</small>
                      <strong>{item.phase.name}</strong>
                      <p>{item.phase.description}</p>
                      <dl>
                        <div>
                          <dt>Planned work</dt>
                          <dd>{item.totalWorkItems}</dd>
                        </div>
                        {item.requiredDecisions > 0 && (
                          <div>
                            <dt>Review gates</dt>
                            <dd>{item.requiredDecisions}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </li>
                ))}
              </ol>
            )
            : (
              <p class="planning-empty-path">
                Ask the agent to publish a bounded project path before reviewing
                or authorizing the first engineering operation.
              </p>
            )}
        </section>

        {hasPath && (
          <section
            class="project-work-plan planning-work-plan"
            aria-labelledby="planning-work-title"
          >
            <header>
              <div>
                <p>DECLARED WORK</p>
                <h4 id="planning-work-title">What the path contains</h4>
              </div>
              <span>
                {items.length} planned item{items.length === 1 ? "" : "s"}
              </span>
            </header>
            <ol class="planning-work-list">
              {items.map((item) => (
                <PlanningWorkItem
                  key={item.id}
                  item={item}
                  phase={project.phases.find((phase) =>
                    phase.id === item.phaseId
                  )}
                />
              ))}
            </ol>
          </section>
        )}

        <section
          class="planning-next-step"
          aria-labelledby="planning-next-title"
        >
          <div>
            <p>NEXT HUMAN MOVE</p>
            <h3 id="planning-next-title">Review the path with your agent</h3>
          </div>
          <p>
            You can question or correct the project intent here. The cockpit
            will show technical evidence only after a bounded operation has
            produced and recorded an exact baseline.
          </p>
        </section>

        {project.plan && (
          <details class="project-technical-record planning-provenance">
            <summary>Planning provenance</summary>
            <dl>
              <div>
                <dt>Starting point</dt>
                <dd>{startingPointLabel(project.plan.startingPoint)}</dd>
              </div>
              <div>
                <dt>Approved discovery</dt>
                <dd>
                  <code>
                    {project.plan.basis.discoveryId}@{project.plan.basis
                      .revision}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Path published</dt>
                <dd>{formatTime(project.plan.publishedAt)}</dd>
              </div>
            </dl>
          </details>
        )}
      </main>
    </div>
  );
}

function PlanningWorkItem({
  item,
  phase,
}: {
  item: EngineeringWorkItem;
  phase?: EngineeringProjectPhase;
}): JSX.Element {
  return (
    <li data-state={item.status}>
      <span>{phase?.name ?? item.phaseId}</span>
      <div>
        <strong>{item.title}</strong>
        <p>{item.description}</p>
        <small>
          {workOwnerLabel(item.owner)} · {item.kind}
          {item.operation && (
            <>· reviewed {item.operation.id}@{item.operation.version}</>
          )}
        </small>
      </div>
      <b>{workStatusLabel(item.status)}</b>
    </li>
  );
}

function sortWorkItems(
  items: readonly EngineeringWorkItem[],
  phases: readonly EngineeringProjectPhase[],
): EngineeringWorkItem[] {
  const phaseOrder = new Map(phases.map((phase) => [phase.id, phase.order]));
  return [...items].sort((left, right) =>
    (phaseOrder.get(left.phaseId) ?? Number.MAX_SAFE_INTEGER) -
      (phaseOrder.get(right.phaseId) ?? Number.MAX_SAFE_INTEGER) ||
    left.title.localeCompare(right.title)
  );
}

function planningPhaseLabel(status: string): string {
  if (status === "completed") return "Gate satisfied";
  if (status === "active") return "In progress";
  if (status === "blocked") return "Needs review";
  return "Planned";
}

function planningStreamLabel(status: ThreadStreamStatus | "snapshot"): string {
  if (status === "live") return "Path updates are live";
  if (status === "connecting") return "Connecting to project updates";
  if (status === "reconnecting") return "Restoring project updates";
  return "Project path snapshot";
}

function startingPointLabel(value: string): string {
  if (value === "existing-cad") return "Existing CAD";
  if (value === "existing-product") return "Existing product";
  return "Idea or specification";
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
