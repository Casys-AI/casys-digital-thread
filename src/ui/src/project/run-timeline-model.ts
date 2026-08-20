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
 */

import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";

export interface RunTimelineRow {
  readonly id: string;
  readonly label: string;
  readonly status: EngineeringAgentRun["status"];
  /** Secondes passées en file avant démarrage, ou undefined si jamais démarré. */
  readonly waitSeconds?: number;
  /** Secondes d'exécution, ou undefined si le run n'est pas terminé. */
  readonly runSeconds?: number;
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

export function buildRunTimeline(
  project: EngineeringProjectSnapshot,
  labelFor: (run: EngineeringAgentRun) => string,
): RunTimelineView {
  const rows: RunTimelineRow[] = project.agentRuns.map((run) => ({
    id: run.id,
    label: labelFor(run),
    status: run.status,
    waitSeconds: secondsBetween(run.queuedAt, run.startedAt),
    runSeconds: secondsBetween(run.startedAt, run.completedAt),
  }));

  let totalWaitSeconds = 0;
  let totalRunSeconds = 0;
  let scaleSeconds = 0;
  for (const row of rows) {
    totalWaitSeconds += row.waitSeconds ?? 0;
    totalRunSeconds += row.runSeconds ?? 0;
    scaleSeconds = Math.max(
      scaleSeconds,
      (row.waitSeconds ?? 0) + (row.runSeconds ?? 0),
    );
  }

  return { rows, totalWaitSeconds, totalRunSeconds, scaleSeconds };
}

/** Part d'attente sur le temps de travail cumulé, ou undefined si rien n'a duré. */
export function waitShare(view: RunTimelineView): number | undefined {
  const total = view.totalWaitSeconds + view.totalRunSeconds;
  return total === 0 ? undefined : view.totalWaitSeconds / total;
}
