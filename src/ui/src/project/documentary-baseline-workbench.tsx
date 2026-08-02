/** @jsxImportSource preact */

import type { JSX } from "preact";
import type { ThreadStreamStatus } from "../thread/client.ts";
import type { EngineeringDocumentaryWorkbenchSnapshot } from "../thread/types.ts";
import { DocumentaryTechnicalStartActivity } from "./documentary-technical-start-activity.tsx";
import type {
  OperatorCommandCapabilities,
  ProjectOperatorCommand,
} from "./command-contract.ts";
import type { ProjectCommandFeedback } from "./control-center.tsx";
import {
  buildProjectBrief,
  type ProjectBrief,
  projectBriefStatusLabel,
  projectStatusTone,
} from "./model.ts";

/**
 * The bridge between an approved project definition and the first technical
 * operation. It deliberately renders one immutable document record, rather
 * than adapting the evidence cockpit around an empty graph.
 */
export function DocumentaryBaselineWorkbench({
  workbench,
  streamStatus,
  capability,
  actorId,
  onActorIdChange,
  feedback,
  onCommand,
}: {
  workbench: EngineeringDocumentaryWorkbenchSnapshot;
  streamStatus: ThreadStreamStatus | "snapshot";
  capability?: OperatorCommandCapabilities;
  actorId: string;
  onActorIdChange: (value: string) => void;
  feedback: ProjectCommandFeedback;
  onCommand: (
    commandKey: string,
    command: ProjectOperatorCommand,
  ) => Promise<void>;
}): JSX.Element {
  const project = workbench.project;
  const brief = buildProjectBrief(project);
  const { documentary } = workbench;
  const { record } = documentary;
  const technicalStart = documentary.technicalStart;
  const statusSeal = documentaryProjectStatusSeal(brief, technicalStart);
  const readySeed = project.workItems.find((item) =>
    item.status === "ready" &&
    item.operation?.id === "architecture.seed-syson-model" &&
    item.operation.version === "1"
  );
  const canAuthorizeSeed = capability?.enabled === true &&
    capability.intents.includes("agent-run.queue") && readySeed !== undefined;

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

        {technicalStart && (
          <DocumentaryTechnicalStartActivity technicalStart={technicalStart} />
        )}

        {canAuthorizeSeed && readySeed && (
          <section
            class="documentary-technical-start-authorization"
            aria-labelledby="documentary-technical-start-authorization-title"
          >
            <div>
              <p>READY FOR YOUR REVIEW</p>
              <h3 id="documentary-technical-start-authorization-title">
                Authorize the first editable system-model container
              </h3>
              <span>
                The agent can only create and read back a blank SysON project,
                document, and root package. It will not add a drone
                architecture, requirement, CAD model, simulation, or verdict.
              </span>
            </div>
            <label>
              <span>Reviewer identity</span>
              <input
                value={actorId}
                onInput={(event) =>
                  onActorIdChange(
                    (event.currentTarget as HTMLInputElement).value,
                  )}
                placeholder="Your name or review ID"
                autocomplete="name"
              />
            </label>
            <button
              type="button"
              class="documentary-technical-start-authorize-button"
              disabled={!actorId.trim() || feedback.state === "submitting"}
              onClick={() =>
                onCommand(`queue:${readySeed.id}`, {
                  type: "agent-run.queue",
                  workItemId: readySeed.id,
                  summary:
                    "Human authorized the bounded SysON model-container seed.",
                })}
            >
              {feedback.state === "submitting"
                ? "Recording authorization…"
                : "Authorize model-container start"}
            </button>
            {feedback.state !== "idle" && feedback.message && (
              <small
                class="documentary-technical-start-command-feedback"
                data-state={feedback.state}
                role={feedback.state === "error" ? "alert" : "status"}
              >
                {feedback.message}
              </small>
            )}
          </section>
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
              <dd>Approved discovery and reviewed path</dd>
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
              <li>The reviewed discovery is retained with its project path.</li>
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
                No simulation, measurement or physical behaviour is recorded.
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
                  step, then review its scope before authorizing it.
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
    </div>
  );
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
