/**
 * Le déroulé des runs : combien de temps chacun a attendu, combien il a
 * calculé.
 *
 * Les quatre horodatages d'un run — mis en file, réclamé, démarré, terminé —
 * sont enregistrés mais nulle part lisibles. Or sur une session courante
 * l'attente dépasse largement le calcul, ce qu'aucune vue ne dit.
 *
 * Rien n'est extrapolé : un run sans `startedAt` n'a pas attendu « jusqu'à
 * maintenant », il n'a simplement pas de durée d'exécution. Une durée absente
 * reste absente.
 *
 * Les lignes suivent l'identité d'activité déjà persistée : une chaîne
 * predecessorRevisionId reste une seule entrée. Le statut courant est celui
 * de la feuille, jamais celui d'une révision antérieure.
 */

import {
  attemptIdsForRevision,
  collectEngineeringActivities,
  type EngineeringActivityRevisionRecord,
  leafRevisionIdsForActivity,
} from "../../../domain/project/engineering-activity.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";

export interface RunTimelineAttempt {
  readonly id: string;
  readonly revisionId: string;
  readonly status: EngineeringAgentRun["status"];
  /** Secondes passées en file avant démarrage, ou undefined si jamais démarré. */
  readonly waitSeconds?: number;
  /** Secondes d'exécution, ou undefined si le run n'est pas terminé. */
  readonly runSeconds?: number;
}

export interface RunTimelineRow {
  readonly id: string;
  readonly label: string;
  readonly status:
    | EngineeringWorkItem["status"]
    | EngineeringAgentRun["status"];
  readonly revisionCount: number;
  readonly attemptCount: number;
  /** Attempt shown on the row; historical details exclude this id. */
  readonly currentAttemptId: string;
  /** Secondes passées en file avant démarrage, ou undefined si jamais démarré. */
  readonly waitSeconds?: number;
  /** Secondes d'exécution, ou undefined si le run n'est pas terminé. */
  readonly runSeconds?: number;
  readonly attempts: readonly RunTimelineAttempt[];
}

export interface RunTimelineView {
  readonly rows: readonly RunTimelineRow[];
  readonly totalWaitSeconds: number;
  readonly totalRunSeconds: number;
  /**
   * La plus longue durée observée, toutes phases confondues. Les barres se
   * mesurent contre elle : à l'échelle d'une session, un axe absolu écrase
   * tous les runs contre le bord et ne montre plus rien.
   */
  readonly scaleSeconds: number;
}

function secondsBetween(
  from: string | undefined,
  to: string | undefined,
): number | undefined {
  if (from === undefined || to === undefined) return undefined;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  const seconds = (end - start) / 1000;
  return seconds < 0 ? undefined : seconds;
}

function attemptFromRun(run: EngineeringAgentRun): RunTimelineAttempt {
  return {
    id: run.id,
    revisionId: run.workItemId,
    status: run.status,
    waitSeconds: secondsBetween(run.queuedAt, run.startedAt),
    runSeconds: secondsBetween(run.startedAt, run.completedAt),
  };
}

function activityRecords(
  items: readonly EngineeringWorkItem[],
): EngineeringActivityRevisionRecord[] {
  return items.flatMap((item) =>
    typeof item.activityId === "string" && item.activityId.length > 0
      ? [{
        id: item.id,
        activityId: item.activityId,
        ...(item.predecessorRevisionId
          ? { predecessorRevisionId: item.predecessorRevisionId }
          : {}),
      }]
      : []
  );
}

function latestAttempt(
  attempts: readonly RunTimelineAttempt[],
): RunTimelineAttempt | undefined {
  return attempts.at(-1);
}

const LEAF_STATUS_PRIORITY = [
  "in-progress",
  "waiting-for-decision",
  "ready",
  "planned",
] as const;

function leafStatus(
  leaves: readonly EngineeringWorkItem[],
  leafAttempts: readonly RunTimelineAttempt[],
): RunTimelineRow["status"] {
  if (leaves.length === 0) {
    if (leafAttempts.every((attempt) => attempt.status === "completed")) {
      return latestAttempt(leafAttempts)?.status ?? "queued";
    }
    return "planned";
  }
  if (leaves.every((item) => item.status === "completed")) {
    return "completed";
  }
  for (const status of LEAF_STATUS_PRIORITY) {
    if (leaves.some((item) => item.status === status)) return status;
  }
  return "planned";
}

function rowFromAttempts(
  id: string,
  label: string,
  status: RunTimelineRow["status"],
  revisionCount: number,
  attempts: readonly RunTimelineAttempt[],
  current: RunTimelineAttempt,
): RunTimelineRow {
  return {
    id,
    label,
    status,
    revisionCount,
    attemptCount: attempts.length,
    currentAttemptId: current.id,
    waitSeconds: current.waitSeconds,
    runSeconds: current.runSeconds,
    attempts,
  };
}

function rowFromRun(
  run: EngineeringAgentRun,
  labelFor: (run: EngineeringAgentRun) => string,
): RunTimelineRow {
  const attempt = attemptFromRun(run);
  return rowFromAttempts(
    run.id,
    labelFor(run),
    run.status,
    1,
    [attempt],
    attempt,
  );
}

export function buildRunTimeline(
  project: EngineeringProjectSnapshot,
  labelFor: (run: EngineeringAgentRun) => string,
): RunTimelineView {
  const workItems = project.workItems ?? [];
  const records = activityRecords(workItems);
  const rows = records.length === 0
    ? project.agentRuns.map((run) => rowFromRun(run, labelFor))
    : groupedActivityRows(project.agentRuns, workItems, records, labelFor);

  let totalWaitSeconds = 0;
  let totalRunSeconds = 0;
  let scaleSeconds = 0;
  for (const row of rows) {
    for (const attempt of row.attempts) {
      totalWaitSeconds += attempt.waitSeconds ?? 0;
      totalRunSeconds += attempt.runSeconds ?? 0;
      scaleSeconds = Math.max(
        scaleSeconds,
        (attempt.waitSeconds ?? 0) + (attempt.runSeconds ?? 0),
      );
    }
  }

  return { rows, totalWaitSeconds, totalRunSeconds, scaleSeconds };
}

function groupedActivityRows(
  runs: readonly EngineeringAgentRun[],
  workItems: readonly EngineeringWorkItem[],
  records: readonly EngineeringActivityRevisionRecord[],
  labelFor: (run: EngineeringAgentRun) => string,
): RunTimelineRow[] {
  const workById = new Map(workItems.map((item) => [item.id, item]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const grouped = new Set<string>();
  const rows: RunTimelineRow[] = [];

  for (const activity of collectEngineeringActivities(records)) {
    const revisions = activity.revisionIds.flatMap((id) => {
      const item = workById.get(id);
      return item
        ? [{
          id: item.id,
          activityId: activity.id,
          ...(item.predecessorRevisionId
            ? { predecessorRevisionId: item.predecessorRevisionId }
            : {}),
        }]
        : [];
    });
    const attempts = activity.revisionIds.flatMap((revisionId) =>
      attemptIdsForRevision(runs, revisionId).flatMap((runId) => {
        const run = runById.get(runId);
        if (!run) return [];
        grouped.add(run.id);
        return [attemptFromRun(run)];
      })
    );
    if (attempts.length === 0) continue;

    const leafIds = leafRevisionIdsForActivity(revisions);
    const leaves = leafIds.flatMap((id) => {
      const item = workById.get(id);
      return item ? [item] : [];
    });
    const leafAttempts = attempts.filter((attempt) =>
      leafIds.includes(attempt.revisionId)
    );
    const current = latestAttempt(leafAttempts) ?? attempts[0]!;
    const labelRun = runById.get(current.id);
    rows.push(rowFromAttempts(
      activity.id,
      labelRun ? labelFor(labelRun) : activity.id,
      leafStatus(leaves, leafAttempts),
      revisions.length,
      attempts,
      current,
    ));
  }

  for (const run of runs) {
    if (grouped.has(run.id)) continue;
    rows.push(rowFromRun(run, labelFor));
  }
  return rows;
}

/** Part d'attente sur le temps de travail cumulé, ou undefined si rien n'a duré. */
export function waitShare(view: RunTimelineView): number | undefined {
  const total = view.totalWaitSeconds + view.totalRunSeconds;
  return total === 0 ? undefined : view.totalWaitSeconds / total;
}
