/**
 * L'étape de projet dont relève un enregistrement.
 *
 * Le fil se lisait par disciplines inventées ici, alors que la page affiche
 * juste au-dessus le bandeau des gates : deux axes qui ne se répondaient pas.
 * Les colonnes suivent désormais les phases DÉCLARÉES du projet, donc le fil
 * et les gates parlent enfin de la même chose.
 *
 * La provenance est complète et enregistrée, jamais devinée :
 * artefact → `producerRunId` → run → `workItemId` → work item → `phaseId`.
 * Un enregistrement qui n'est pas un artefact — une exigence, une mesure, un
 * verdict — prend l'étape de l'artefact qui l'a produit, lue sur les arêtes.
 */

import type {
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";

export interface PhaseResolution {
  /** Étape de chaque nœud, par clé de référence. */
  readonly phaseIdByRefKey: ReadonlyMap<string, string>;
  /** Titre de chaque étape, dans l'ordre déclaré du projet. */
  readonly orderedPhases: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function resolveThreadPhases(
  project: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot,
): PhaseResolution {
  const runById = new Map(project.agentRuns.map((run) => [run.id, run]));
  const workItemById = new Map(
    project.workItems.map((item) => [item.id, item]),
  );

  // Étape d'un artefact : son run producteur cite le work item, qui cite la
  // phase. Chaque maillon est déclaré ; aucun n'est reconstruit d'un libellé.
  const phaseByArtifactId = new Map<string, string>();
  for (const artifact of thread.artifacts) {
    const runId = artifact.producerRunId;
    if (runId === undefined) continue;
    const workItemId = runById.get(runId)?.workItemId;
    if (workItemId === undefined) continue;
    const phaseId = workItemById.get(workItemId)?.phaseId;
    if (phaseId !== undefined) phaseByArtifactId.set(artifact.id, phaseId);
  }

  const producersByRefKey = new Map<string, ThreadGraphNode[]>();
  const nodeByRefKey = new Map(
    thread.graph.nodes.map((node) => [refKey(node.ref), node]),
  );
  for (const edge of thread.graph.edges) {
    const producer = nodeByRefKey.get(refKey(edge.from));
    if (!producer) continue;
    const target = refKey(edge.to);
    const producers = producersByRefKey.get(target) ?? [];
    producers.push(producer);
    producersByRefKey.set(target, producers);
  }

  const directPhase = (node: ThreadGraphNode): string | undefined =>
    node.ref.kind === "artifact"
      ? phaseByArtifactId.get(node.ref.id)
      : undefined;

  const phaseIdByRefKey = new Map<string, string>();
  for (const node of thread.graph.nodes) {
    const own = directPhase(node);
    if (own !== undefined) {
      phaseIdByRefKey.set(refKey(node.ref), own);
      continue;
    }
    for (const producer of producersByRefKey.get(refKey(node.ref)) ?? []) {
      const inherited = directPhase(producer);
      if (inherited !== undefined) {
        phaseIdByRefKey.set(refKey(node.ref), inherited);
        break;
      }
    }
  }

  return {
    phaseIdByRefKey,
    orderedPhases: project.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
    })),
  };
}
