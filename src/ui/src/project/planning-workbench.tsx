/** @jsxImportSource preact */

import type { JSX } from "preact";
import type {
  EngineeringProjectPhase,
  EngineeringWorkItem,
} from "../../../domain/engineering-project.ts";
import {
  currentProjectAnswer,
  engineeringProjectFramingStatus,
  projectBriefItems,
  type ProjectBriefRevision,
} from "../../../domain/project-brief.ts";
import type { ThreadStreamStatus } from "../thread/client.ts";
import type { EngineeringPlanningWorkbenchSnapshot } from "../thread/types.ts";
import { BaselineRunActivity } from "./baseline-run-activity.tsx";
import {
  buildProjectBrief,
  projectBriefStatusLabel,
  projectStatusTone,
  workOwnerLabel,
  workStatusLabel,
} from "./model.ts";

/**
 * Native project surface for the period between approved discovery and the
 * first documentary baseline. It intentionally renders the durable project path
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
  const baseline = workbench.planning.technicalBaseline;
  const framing = project.framing;
  const framingStatus = framing
    ? engineeringProjectFramingStatus(framing)
    : undefined;
  const displayedBrief = framing?.proposedBrief ?? framing?.currentBrief;
  const displayedObjective = displayedBrief
    ? projectBriefItems(displayedBrief, "objective")[0]?.statement
    : framing?.intent.statement ?? project.project.objective.statement;
  const projectStateLabel = framingStatus && framingStatus !== "approved"
    ? framingStatusLabel(framingStatus)
    : projectBriefStatusLabel(brief);
  const projectStateDetail = hasPath
    ? `${brief.completedPhases}/${brief.phases.length} phase gates satisfied`
    : framingStatus === "awaiting-review"
    ? "Review the brief before planning"
    : framingStatus === "revision-requested"
    ? "Continue refining it with the agent"
    : "Shape the brief with the agent";

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
            <strong>{projectStateLabel}</strong>
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
            <p>
              {framingStatus === "awaiting-review"
                ? "BRIEF PROPOSED FOR REVIEW"
                : framingStatus === "revision-requested"
                ? "BRIEF REVISION REQUESTED"
                : framingStatus === "approved"
                ? "CANONICAL PROJECT BRIEF"
                : "INITIAL PROJECT INTENT"}
            </p>
            <h3 id="project-objective-title">
              {displayedObjective}
            </h3>
            <blockquote>
              {framing?.intent.statement ?? project.project.objective.statement}
            </blockquote>
          </div>
          <div
            class="project-status-seal"
            data-tone={projectStatusTone(brief.status)}
            aria-label={`Project status: ${projectStateLabel}`}
          >
            <i aria-hidden="true" />
            <span>PROJECT STATE</span>
            <strong>{projectStateLabel}</strong>
            <small>{projectStateDetail}</small>
          </div>
        </section>

        {framing && (
          <ProjectFraming
            projectId={project.project.id}
            brief={displayedBrief}
            status={framingStatus!}
            questions={framing.questions.filter((question) =>
              currentProjectAnswer(framing, question.id) === undefined
            )}
          />
        )}

        <section
          class="planning-baseline-notice"
          aria-labelledby="planning-baseline-title"
          role="status"
        >
          <div class="planning-baseline-mark" aria-hidden="true">01</div>
          <div>
            <p>BEFORE TECHNICAL EVIDENCE</p>
            <h3 id="planning-baseline-title">
              {technicalBaselineTitle(baseline.status)}
            </h3>
            <span>{baseline.message}</span>
          </div>
        </section>

        <BaselineRunActivity planning={workbench.planning} />

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
                : "The project brief is being shaped with the agent. No work path or technical evidence is recorded yet."}
            </span>
          </header>
          {hasPath
            ? (
              <ol
                class="project-phase-rail planning-phase-rail"
                tabIndex={0}
                aria-label="Project phases, scrolls horizontally"
              >
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
                Ask the agent to publish a bounded project path in your paired
                conversation. The recorded path will appear here.
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
            <h3 id="planning-next-title">
              {nextHumanMoveTitle(baseline.status)}
            </h3>
          </div>
          <p>
            {nextHumanMoveMessage(baseline.status)}
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
                <dt>
                  {project.plan.basis.kind === "approved-brief"
                    ? "Approved brief"
                    : "Historical discovery"}
                </dt>
                <dd>
                  <code>
                    {project.plan.basis.kind === "approved-brief"
                      ? `${project.plan.basis.briefId}@${project.plan.basis.briefRevision}`
                      : `${project.plan.basis.discoveryId}@${project.plan.basis.revision}`}
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

function ProjectFraming({
  projectId,
  brief,
  status,
  questions,
}: {
  projectId: string;
  brief?: ProjectBriefRevision;
  status: ReturnType<typeof engineeringProjectFramingStatus>;
  questions: NonNullable<
    EngineeringPlanningWorkbenchSnapshot["project"]["framing"]
  >["questions"];
}): JSX.Element {
  const sections = brief
    ? [{
      title: "Mission",
      items: projectBriefItems(brief, "mission-scenario"),
    }, {
      title: "Success criteria",
      items: projectBriefItems(brief, "success-criterion"),
    }, {
      title: "Constraints",
      items: projectBriefItems(brief, "constraint"),
    }, {
      title: "Out of scope",
      items: projectBriefItems(brief, "exclusion"),
    }, {
      title: "Assumptions to verify",
      items: projectBriefItems(brief, "assumption"),
    }, {
      title: "Compliance targets",
      items: projectBriefItems(brief, "compliance-target"),
    }].filter((section) => section.items.length > 0)
    : [];
  return (
    <section class="project-framing" aria-labelledby="project-framing-title">
      <header class="project-section-label">
        <div>
          <p>LIVING PROJECT BRIEF</p>
          <h3 id="project-framing-title">
            One project, from first intent onward
          </h3>
        </div>
        <span data-state={status}>{framingStatusLabel(status)}</span>
      </header>
      {brief
        ? (
          <>
            <div class="project-framing-sections">
              {sections.map((section) => (
                <section key={section.title}>
                  <h4>{section.title}</h4>
                  <ul>
                    {section.items.map((item) => (
                      <li key={item.id}>{item.statement}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <p class="project-framing-boundary">
              {status === "awaiting-review"
                ? "Review this proposal in the paired conversation. It does not replace the canonical brief until you confirm the exact revision."
                : status === "revision-requested"
                ? "Continue the conversation with the agent; the last approved brief remains canonical while this proposal is corrected."
                : "This approved brief anchors planning. Later technical facts stay in SysML, CAD, simulation and evidence records linked to this project."}
            </p>
          </>
        )
        : (
          <p class="project-framing-empty">
            Project {projectId}{" "}
            already exists. Continue describing the product in the paired
            conversation; the agent will add focused questions and consolidate
            the first reviewable brief here.
          </p>
        )}
      {questions.length > 0 && (
        <section class="project-framing-questions">
          <p>QUESTIONS TO DISCUSS WITH THE AGENT</p>
          <ol>
            {questions.slice(0, 3).map((question) => (
              <li key={question.id}>
                <strong>{question.prompt}</strong>
                <span>{question.whyItMatters}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}

function framingStatusLabel(
  status: ReturnType<typeof engineeringProjectFramingStatus>,
): string {
  if (status === "awaiting-review") return "Ready for conversation review";
  if (status === "revision-requested") return "Revision requested";
  if (status === "approved") return "Approved intent";
  return "Framing with agent";
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

function technicalBaselineTitle(status: string): string {
  if (status === "queued") return "Documentary baseline queued";
  if (status === "running") return "Documentary baseline in preparation";
  if (status === "publishing") return "Documentary baseline publishing";
  if (status === "failed") return "Documentary baseline needs review";
  return "Documentary baseline not created yet";
}

function nextHumanMoveTitle(status: string): string {
  if (status === "queued" || status === "running" || status === "publishing") {
    return "Follow the first baseline with your agent";
  }
  if (status === "failed") return "Review the stopped run with your agent";
  return "Review the path with your agent";
}

function nextHumanMoveMessage(status: string): string {
  if (status === "queued" || status === "running" || status === "publishing") {
    return "Keep the project intent under review while the agent works. Once the documentary baseline is durably published, the cockpit will show that record; it does not become technical evidence until a later bounded tool operation produces it.";
  }
  if (status === "failed") {
    return "Ask the agent to explain or revise the recorded path before authorizing another bounded run. This page deliberately does not expose provider diagnostics as evidence.";
  }
  return "Discuss the project intent with the agent in your paired conversation. The cockpit will show a documentary baseline after the first bounded operation; technical evidence remains a later, explicitly linked result.";
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
