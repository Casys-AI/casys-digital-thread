/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { ThreadStreamStatus } from "../thread/client.ts";
import type { EngineeringDocumentaryWorkbenchSnapshot } from "../thread/types.ts";
import { DocumentaryTechnicalStartActivity } from "./documentary-technical-start-activity.tsx";
import {
  buildProjectBrief,
  type ProjectBrief,
  projectBriefStatusLabel,
  projectStatusTone,
} from "./model.ts";
import { ProjectNavigation, type ProjectWorkspaceView } from "./navigation.tsx";
import { ProjectWorkRibbon } from "./work.tsx";

/**
 * The pre-technical state of the same project cockpit. A documentary starting
 * record does not get a second UI: it keeps the standard project navigation,
 * while the technical areas honestly explain what has not been recorded yet.
 */
export function DocumentaryBaselineWorkbench({
  workbench,
  streamStatus,
  activeView,
  onChangeView,
}: {
  workbench: EngineeringDocumentaryWorkbenchSnapshot;
  streamStatus: ThreadStreamStatus | "snapshot";
  activeView: ProjectWorkspaceView;
  onChangeView: (view: ProjectWorkspaceView) => void;
}): JSX.Element {
  const project = workbench.project;
  const brief = buildProjectBrief(project);
  const { documentary } = workbench;
  const { record } = documentary;
  const technicalStart = documentary.technicalStart;
  const statusSeal = documentaryProjectStatusSeal(brief, technicalStart);
  return (
    <div class="thread-workbench mcp-view-surface documentary-baseline-workbench">
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
                Documentary starting record · {project.project.subjectId}
              </span>
            </div>
          </div>
        </div>
        <div class="thread-session-panel">
          <div class="thread-session-state" data-state={streamStatus}>
            <i aria-hidden="true" />
            <div>
              <small>PROJECT RECORD</small>
              <strong>{documentaryStreamLabel(streamStatus)}</strong>
            </div>
          </div>
          <div class="thread-session-change">
            <small>TECHNICAL PROOF</small>
            <strong>Not recorded yet</strong>
          </div>
          <dl class="thread-session-facts">
            <div>
              <dt>Recorded</dt>
              <dd>{formatTime(record.recordedAt)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <ProjectNavigation activeView={activeView} onChange={onChangeView} />

      {activeView === "overview"
        ? (
          <main
            class="project-overview documentary-baseline-main"
            id="project-workspace-panel"
          >
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
                data-tone={statusSeal.tone}
                aria-label={`Project status: ${statusSeal.label}`}
              >
                <i aria-hidden="true" />
                <span>PROJECT STATE</span>
                <strong>{statusSeal.label}</strong>
                <small>
                  {brief.completedPhases}/{brief.phases.length}{" "}
                  phase gates satisfied
                </small>
              </div>
            </section>

            <ProjectWorkRibbon project={project} />

            <DocumentaryProjectPath brief={brief} />

            {technicalStart && (
              <DocumentaryTechnicalStartActivity
                technicalStart={technicalStart}
              />
            )}

            <section
              class="documentary-baseline-notice"
              aria-labelledby="documentary-baseline-title"
              role="status"
            >
              <div class="documentary-baseline-mark" aria-hidden="true">01</div>
              <div>
                <p>DURABLE STARTING RECORD</p>
                <h3 id="documentary-baseline-title">
                  Your reviewed starting point is now traceable
                </h3>
                <span>{documentary.message}</span>
              </div>
            </section>

            <section
              class="documentary-record-card"
              aria-labelledby="documentary-record-title"
            >
              <header>
                <div>
                  <p>RECORDED PROVENANCE</p>
                  <h3 id="documentary-record-title">{record.label}</h3>
                </div>
                <span class="documentary-record-state">IMMUTABLE RECORD</span>
              </header>
              <dl class="documentary-record-facts">
                <div>
                  <dt>Record type</dt>
                  <dd>Approved project brief and reviewed path</dd>
                </div>
                <div>
                  <dt>Snapshot</dt>
                  <dd>Revision {record.snapshotRevision}</dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd>
                    <code>{shortFingerprint(record.fingerprint)}</code>
                  </dd>
                </div>
              </dl>
            </section>

            <section
              class="documentary-boundary-grid"
              aria-label="Meaning of the documentary baseline"
            >
              <article class="documentary-boundary-card is-recorded">
                <p>WHAT IS NOW DURABLE</p>
                <h3>The project’s approved starting point</h3>
                <ul>
                  <li>
                    The approved project brief is retained with its project
                    path.
                  </li>
                  <li>The record has one exact, checkable fingerprint.</li>
                  <li>Later technical work can name this starting record.</li>
                </ul>
              </article>
              <article class="documentary-boundary-card is-not-evidence">
                <p>WHAT THIS DOES NOT PROVE</p>
                <h3>Engineering claims still need a bounded run</h3>
                <ul>
                  <li>No SysML model or CAD geometry is recorded.</li>
                  <li>
                    No simulation, measurement or physical behaviour is
                    recorded.
                  </li>
                  <li>
                    No requirement, compliance or certification verdict exists.
                  </li>
                </ul>
              </article>
            </section>

            <section
              class="documentary-next-step"
              aria-labelledby="documentary-next-step-title"
            >
              <div>
                <p>NEXT WITH YOUR AGENT</p>
                <h3 id="documentary-next-step-title">
                  {technicalStart
                    ? "Follow the bounded technical start"
                    : "Choose the first bounded technical operation"}
                </h3>
              </div>
              <p>
                {technicalStart
                  ? "The activity above is the only live view of this narrow operation. It remains provisional until a read-back, hash-addressed record becomes the next thread revision."
                  : (
                    <>
                      {documentary.technicalEvidence.message}{" "}
                      Ask the agent to propose a concrete model, CAD or analysis
                      step in your paired conversation. Its recorded scope and
                      results will appear here.
                    </>
                  )}
              </p>
            </section>

            <details class="project-technical-record documentary-record-details">
              <summary>Exact documentary record</summary>
              <dl>
                <div>
                  <dt>Snapshot</dt>
                  <dd>
                    <code>{record.snapshotId}@{record.snapshotRevision}</code>
                  </dd>
                </div>
                <div>
                  <dt>Artifact</dt>
                  <dd>
                    <code>{record.artifactId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd>
                    <code>{record.fingerprint}</code>
                  </dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd>{formatDateTime(record.recordedAt)}</dd>
                </div>
                {record.uri && (
                  <div>
                    <dt>Record URI</dt>
                    <dd>
                      <code>{record.uri}</code>
                    </dd>
                  </div>
                )}
              </dl>
            </details>
          </main>
        )
        : (
          <DocumentaryWorkspace
            activeView={activeView}
            project={project}
            technicalStart={technicalStart}
            technicalEvidenceMessage={documentary.technicalEvidence.message}
          />
        )}
    </div>
  );
}

function DocumentaryProjectPath(
  { brief }: { brief: ProjectBrief },
): JSX.Element {
  return (
    <section
      class="project-phase-section"
      aria-labelledby="documentary-project-path-title"
    >
      <header class="project-section-label">
        <div>
          <p>PROJECT PATH</p>
          <h3 id="documentary-project-path-title">
            From reviewed intent to technical proof
          </h3>
        </div>
        <span>
          Progress comes from recorded work and evidence, not a checklist.
        </span>
      </header>
      <ol
        class="project-phase-rail"
        tabIndex={0}
        aria-label="Project phases, scrolls horizontally"
      >
        {brief.phases.map((item, index) => (
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
                <div>
                  <dt>Evidence</dt>
                  <dd>{item.evidenceCount}</dd>
                </div>
              </dl>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DocumentaryWorkspace({
  activeView,
  project,
  technicalStart,
  technicalEvidenceMessage,
}: {
  activeView: Exclude<ProjectWorkspaceView, "overview">;
  project: EngineeringDocumentaryWorkbenchSnapshot["project"];
  technicalStart:
    EngineeringDocumentaryWorkbenchSnapshot["documentary"]["technicalStart"];
  technicalEvidenceMessage: string;
}): JSX.Element {
  const copy = documentaryWorkspaceCopy(activeView);
  return (
    <section
      class={`thread-flow-section project-workspace-page is-${activeView}`}
      id="project-workspace-panel"
      aria-labelledby="documentary-workspace-title"
    >
      <div class="thread-section-heading">
        <div>
          <p>{copy.eyebrow}</p>
          <h3 id="documentary-workspace-title">{copy.title}</h3>
        </div>
      </div>
      <div class="thread-workspace-meta">
        <p class="thread-flow-explanation">{copy.description}</p>
        <div class="thread-operator-contract" aria-label="Cockpit mode">
          <span data-state="history">
            <i aria-hidden="true" />
            Reviewing recorded project state
          </span>
          <span>
            <b>YOUR ROLE</b>{" "}
            inspect the record and discuss intent with the agent
          </span>
        </div>
      </div>
      <div class="thread-graph-workspace is-wide">
        <div class={`thread-graph-stage thread-graph-stage-${activeView}`}>
          {activeView === "work"
            ? (
              <>
                <ProjectWorkRibbon project={project} />
                {technicalStart
                  ? (
                    <DocumentaryTechnicalStartActivity
                      technicalStart={technicalStart}
                    />
                  )
                  : (
                    <DocumentaryUnavailable
                      title="No live engineering activity yet"
                      detail={technicalEvidenceMessage}
                    />
                  )}
              </>
            )
            : activeView === "operations"
            ? <DocumentaryExecution project={project} />
            : (
              <DocumentaryUnavailable
                title={copy.unavailableTitle}
                detail={copy.unavailableDetail}
              />
            )}
        </div>
      </div>
    </section>
  );
}

function DocumentaryUnavailable({ title, detail }: {
  title: string;
  detail: string;
}): JSX.Element {
  return (
    <section
      class="project-operations-panel documentary-unavailable"
      role="status"
    >
      <header>
        <div>
          <p>NOT RECORDED YET</p>
          <h4>{title}</h4>
        </div>
      </header>
      <p class="project-operations-empty">{detail}</p>
      <p class="project-operations-empty">
        Ask your agent to propose the next bounded operation; its recorded
        result will appear in this project cockpit.
      </p>
    </section>
  );
}

function DocumentaryExecution({ project }: {
  project: EngineeringDocumentaryWorkbenchSnapshot["project"];
}): JSX.Element {
  return (
    <div class="project-operations">
      <ProjectWorkRibbon project={project} />
      <section
        class="project-operations-panel"
        aria-labelledby="documentary-execution-title"
      >
        <header>
          <div>
            <p>RECORDED EXECUTION</p>
            <h4 id="documentary-execution-title">Project run journal</h4>
          </div>
          <span>{project.agentRuns.length} recorded</span>
        </header>
        <p class="project-operations-empty">
          This project has a durable starting record. No technical tool run has
          produced evidence yet.
        </p>
      </section>
    </div>
  );
}

function documentaryWorkspaceCopy(
  view: Exclude<ProjectWorkspaceView, "overview">,
): {
  eyebrow: string;
  title: string;
  description: string;
  unavailableTitle: string;
  unavailableDetail: string;
} {
  if (view === "work") {
    return {
      eyebrow: "AGENT ACTIVITY · SHARED RECORD",
      title: "Follow the work as it happens",
      description:
        "Recorded activity appears here as the agent works. This project has not produced technical evidence yet.",
      unavailableTitle: "No live engineering activity yet",
      unavailableDetail:
        "The documentary baseline is complete; the next technical operation has not been recorded.",
    };
  }
  if (view === "product") {
    return {
      eyebrow: "PRODUCT EXPLORER",
      title: "Explore one product across its tools",
      description:
        "Components appear only after an explicit model or CAD operation records them.",
      unavailableTitle: "No product definition is recorded yet",
      unavailableDetail:
        "There is no SysML model, CAD geometry or ERP component record to inspect.",
    };
  }
  if (view === "verification") {
    return {
      eyebrow: "EVIDENCE & IMPACT",
      title: "Understand evidence and impact",
      description:
        "Traceability appears after a bounded technical result links a fact to its sources and consequences.",
      unavailableTitle: "No verification chain is recorded yet",
      unavailableDetail:
        "There are no requirements, measurements or evidence relations to trace from the documentary baseline.",
    };
  }
  return {
    eyebrow: "EXECUTION HISTORY",
    title: "Review execution history and the work plan",
    description:
      "The cockpit records what the agent has run and what is explicitly planned next.",
    unavailableTitle: "No technical execution is recorded yet",
    unavailableDetail:
      "The only recorded operation established the approved starting point; it did not produce technical evidence.",
  };
}

function phaseStatusLabel(status: string): string {
  if (status === "completed") return "Gate satisfied";
  if (status === "active") return "In progress";
  if (status === "blocked") return "Blocked";
  return "Planned";
}

/**
 * A live technical-start failure is a narrower, more immediate review signal
 * than the aggregate project status. Keep the domain run unchanged: this is
 * only the documentary surface refusing to present an active seal while its
 * one visible operation needs human attention.
 */
function documentaryProjectStatusSeal(
  brief: ProjectBrief,
  technicalStart:
    EngineeringDocumentaryWorkbenchSnapshot["documentary"]["technicalStart"],
): {
  readonly tone: ReturnType<typeof projectStatusTone>;
  readonly label: string;
} {
  if (technicalStart?.state === "failed") {
    return { tone: "attention", label: "Review required" };
  }
  return {
    tone: projectStatusTone(brief.status),
    label: projectBriefStatusLabel(brief),
  };
}

function documentaryStreamLabel(
  status: ThreadStreamStatus | "snapshot",
): string {
  if (status === "live") return "Project record is current";
  if (status === "connecting") return "Connecting to project updates";
  if (status === "reconnecting") return "Restoring project updates";
  return "Durable project record";
}

function shortFingerprint(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 12)}…${value.slice(-7)}`;
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
