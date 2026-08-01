/** @jsxImportSource preact */

import type { JSX } from "preact";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { buildProjectBrief, workOwnerLabel, workStatusLabel } from "./model.ts";

export function ProjectWorkRibbon({ project }: {
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  const brief = buildProjectBrief(project);
  const activeRun = brief.activeRuns[0];
  const decision = brief.pendingDecisions[0];
  const blocker = brief.openBlockers[0];
  return (
    <section class="project-work-ribbon" aria-label="Shared work plan">
      <div class="project-work-ribbon-cell is-agent">
        <span>AGENT NOW</span>
        <strong>
          {activeRun ? workTitle(project, activeRun) : "No active run"}
        </strong>
        <small>
          {activeRun?.summary ??
            "The project records no current agent execution."}
        </small>
      </div>
      <div class="project-work-ribbon-cell is-human">
        <span>HUMAN INPUT</span>
        <strong>{decision?.title ?? "No decision waiting"}</strong>
        <small>
          {decision?.question ??
            "No required or proposed decision is recorded."}
        </small>
      </div>
      <div class="project-work-ribbon-cell is-blocker">
        <span>OPEN BLOCKER</span>
        <strong>{blocker?.title ?? "Clear"}</strong>
        <small>{blocker?.description ?? "No open blocker is recorded."}</small>
      </div>
    </section>
  );
}

export function ProjectOperations({ project, thread }: {
  project: EngineeringProjectSnapshot;
  thread: ThreadWorkbenchSnapshot;
}): JSX.Element {
  const systems = uniqueSystems(thread);
  return (
    <div class="project-operations">
      <section
        class="project-operations-panel"
        aria-labelledby="project-runs-title"
      >
        <header>
          <div>
            <p>PROJECT EXECUTIONS</p>
            <h4 id="project-runs-title">Agent run journal</h4>
          </div>
          <span>{project.agentRuns.length} recorded</span>
        </header>
        {project.agentRuns.length
          ? (
            <ol class="project-run-list">
              {[...project.agentRuns].reverse().map((run) => (
                <li key={run.id} data-state={run.status}>
                  <i aria-hidden="true" />
                  <div>
                    <span>{run.status.replaceAll("-", " ")}</span>
                    <strong>{workTitle(project, run)}</strong>
                    <p>{run.summary}</p>
                    <small>
                      {formatDateTime(run.startedAt ?? run.queuedAt)} ·{" "}
                      {run.evidenceRefs.length}{" "}
                      published evidence ref{run.evidenceRefs.length === 1
                        ? ""
                        : "s"}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )
          : <p class="project-operations-empty">No agent run is recorded.</p>}
      </section>

      <section
        class="project-operations-panel"
        aria-labelledby="project-tools-title"
      >
        <header>
          <div>
            <p>ENGINEERING SURFACES</p>
            <h4 id="project-tools-title">Tools contributing evidence</h4>
          </div>
          <span>{systems.length} observed</span>
        </header>
        <div class="project-tool-matrix">
          {systems.map((system, index) => (
            <article key={system.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{system.label}</strong>
                <small>
                  {system.stages}{" "}
                  projected stage{system.stages === 1 ? "" : "s"}
                </small>
              </div>
              <i data-state={system.freshness} aria-label={system.freshness} />
            </article>
          ))}
        </div>
        {!systems.length && (
          <p class="project-operations-empty">
            No tool contribution is projected in the current thread.
          </p>
        )}
      </section>

      <section class="project-work-plan" aria-labelledby="project-plan-title">
        <header>
          <div>
            <p>SHARED PLAN</p>
            <h4 id="project-plan-title">Declared work items</h4>
          </div>
          <span>{project.workItems.length} items</span>
        </header>
        <div class="project-work-item-list">
          {project.workItems.map((item) => (
            <WorkItemRow key={item.id} item={item} project={project} />
          ))}
        </div>
      </section>
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
    <article data-state={item.status}>
      <span>{phase?.name ?? item.phaseId}</span>
      <div>
        <strong>{item.title}</strong>
        <small>{workOwnerLabel(item.owner)} · {item.kind}</small>
      </div>
      <b>{workStatusLabel(item.status)}</b>
    </article>
  );
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
