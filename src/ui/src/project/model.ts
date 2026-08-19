import {
  deriveEngineeringPhaseStatus,
  deriveEngineeringProjectStatus,
  type EngineeringAgentRun,
  type EngineeringBlocker,
  type EngineeringDecision,
  type EngineeringPhaseStatus,
  type EngineeringProjectPhase,
  type EngineeringProjectSnapshot,
  type EngineeringProjectStatus,
  type EngineeringThreadEntityRef,
  type EngineeringWorkItem,
  isEngineeringDecisionSatisfied,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import { currentRequirements } from "../thread/versioned-provenance-model.ts";

export interface ProjectPhaseView {
  readonly phase: EngineeringProjectPhase;
  readonly status: EngineeringPhaseStatus;
  readonly completedWorkItems: number;
  readonly totalWorkItems: number;
  readonly approvedDecisions: number;
  readonly requiredDecisions: number;
  readonly evidenceCount: number;
}

export interface ProjectBrief {
  readonly status: EngineeringProjectStatus;
  readonly phases: readonly ProjectPhaseView[];
  readonly completedPhases: number;
  readonly currentWork: readonly EngineeringWorkItem[];
  readonly nextWork: readonly EngineeringWorkItem[];
  readonly activeRuns: readonly EngineeringAgentRun[];
  /**
   * Most recent settled run (completed, failed or cancelled). Runs finish in
   * seconds, so the agent panel is almost always between runs: showing the
   * last settled run keeps the panel factual without pretending activity.
   */
  readonly lastSettledRun: EngineeringAgentRun | undefined;
  readonly pendingDecisions: readonly EngineeringDecision[];
  readonly openBlockers: readonly EngineeringBlocker[];
}

/**
 * The one current operational focus rendered by every compact cockpit surface.
 *
 * A live run owns the focus while it exists. Between runs, project planning
 * order is authoritative: later phases take precedence and the work-item
 * order recorded by that phase is the stable tie-breaker. The physical order
 * of append-only `workItems` and `decisions` arrays is audit history, not UI
 * priority, so it must never decide what the cockpit calls current.
 */
export interface CurrentProjectFocus {
  readonly activeRun: EngineeringAgentRun | undefined;
  readonly work: EngineeringWorkItem | undefined;
  /** A concrete human review proposal explicitly linked to the current work. */
  readonly proposedDecision: EngineeringDecision | undefined;
}

/**
 * The single, factual priority for compact "agent now" surfaces. A settled
 * run is explicitly history: it is useful context between executions, never
 * a claim that an agent is still active.
 */
export type AgentNowPresentation =
  | { readonly kind: "active-run"; readonly run: EngineeringAgentRun }
  | { readonly kind: "current-work"; readonly work: EngineeringWorkItem }
  | { readonly kind: "last-settled-run"; readonly run: EngineeringAgentRun }
  | { readonly kind: "empty" };

/**
 * The operational subset of a project brief for a linked, current evidence
 * snapshot. It never removes immutable work or run history. It withholds a
 * ready item from "Up next" only when the snapshot already records either an
 * explicit successor reconciliation, or a later completed work item for the
 * same registered operation (`id@version`). Distinct versions stay distinct.
 */
export interface CurrentProjectWork {
  readonly nextWork: readonly EngineeringWorkItem[];
  /** Retained work items whose later, evidenced successor is complete. */
  readonly historicalWorkItemIds: readonly string[];
  /** Exact thread-entity targets whose proposed actions are now historical. */
  readonly closedActionTargetIds: readonly string[];
}

/**
 * The Project Path is a navigational projection, not the project audit log.
 *
 * A durable project snapshot records every reviewed operation, including a
 * component correction and a retained failed provider attempt. Rendering all
 * of those records as sibling phases turns one DripTray lifecycle into four
 * fake project gates. This policy keeps the original macro phase visible and
 * attaches a later lifecycle only when the snapshot proves all of the
 * following:
 *
 * - a correction graph node names an explicit affected component;
 * - the correction's `supersedes` relation reaches evidence owned by the
 *   macro phase; and
 * - a later operation is the exact same registered operation id at another
 *   version and explicitly consumes that correction record.
 *
 * A second bounded exception is a model enrichment: a later phase whose every
 * artifact evidence is a sysml-model derived (recorded `derived_from`
 * lineage) from a sysml-model owned by a strictly earlier visible phase. It
 * writes into that earlier phase's model rather than opening a new
 * engineering stage — requirement anchoring is the canonical case — so it
 * folds under the phase that owns the enriched model. Architecture captures
 * are not enrichments of the seed: they are a macro gate. A later
 * architecture-capture tip in the same BFF evidence family wraps under the
 * phase that owns the historical member.
 *
 * A cancelled-before-claim seed whose only work is superseded-by-successor and
 * whose own evidenceRefs are empty is not a satisfied gate. When a unique later
 * phase owns that successor evidence at the same registered operation
 * `id@version`, the seed folds under it as retained lifecycle. If that fold is
 * not unique, the seed stays visible as planned (never executed).
 *
 * It deliberately uses no labels, title fragments or loose identifiers. If a
 * future project does not provide this evidence, its phase remains visible.
 */
export const PROJECT_PATH_PRESENTATION_POLICY = {
  version: "project-path/1.0",
  macroStages: "initial project phases",
  lifecycleAttachments:
    "explicit correction component + supersedes lineage + versioned operation identity",
  modelEnrichment: {
    requiredLineage:
      "every artifact evidence is a non-architecture-capture sysml-model with recorded derived_from lineage to a sysml-model of a strictly earlier visible phase",
  },
  architectureVersion: {
    requiredLineage:
      "every artifact evidence belongs to one current architecture-capture family whose historical member is owned by a strictly earlier visible phase",
  },
  enrichmentMeasurement: {
    requiredLineage:
      "every artifact evidence is the recorded derived_from source of an already-folded model enrichment owned by a strictly earlier parent",
  },
  cancelledSuccessor: {
    requiredLineage:
      "empty-evidence phase whose only work is cancelled superseded-by-successor folds under the unique later phase that owns that successor evidence at the same registered operation id@version; a non-unique successor is planned, never completed",
  },
} as const;

export interface ProjectPhaseLifecycle {
  /** Explicit catalog identities; never derived from a friendly label. */
  readonly affectedComponentIds: readonly string[];
  readonly correctionCount: number;
  /** Historical operation attempts retained below this macro stage. */
  readonly revisionAttemptCount: number;
  /** Later phases that wrote into this phase's model (requirement anchoring). */
  readonly modelEnrichmentCount?: number;
  /** Measurement phases whose evidence fed a folded enrichment (sensitivity). */
  readonly modelMeasurementCount?: number;
  /**
   * The compact macro-stage reading state, not a replacement for its history.
   * All three states are durable readings of the versioned record: "current"
   * (the latest lifecycle record completed), "attention" (its latest run
   * failed), "retained" (history kept without a completed successor). Live
   * work never appears here — the phase work counters and "What the agent is
   * doing" own the in-flight story.
   */
  readonly state: "current" | "attention" | "retained";
}

export interface ProjectPathPhaseView extends ProjectPhaseView {
  readonly lifecycle?: ProjectPhaseLifecycle;
}

export interface ProjectPath {
  readonly status: EngineeringProjectStatus;
  readonly phases: readonly ProjectPathPhaseView[];
  readonly completedPhases: number;
  readonly pendingDecisions: readonly EngineeringDecision[];
}

/**
 * Compresse le passé de l'épine : au-delà d'un seuil d'affichage, la série
 * initiale de gates satisfaites se replie en une rangée-résumé, en gardant
 * les dernières satisfaites visibles pour le contexte. La phase active, une
 * phase bloquée ou toute gate non satisfaite ne sont jamais repliées — le
 * repli s'arrête à la première non-satisfaite.
 */
export function splitLeadingSatisfiedGates<
  T extends { readonly status: EngineeringPhaseStatus },
>(
  phases: readonly T[],
): { readonly collapsed: readonly T[]; readonly visible: readonly T[] } {
  const displayThreshold = 8;
  const keepVisible = 2;
  const minCollapsed = 3;
  if (phases.length <= displayThreshold) {
    return { collapsed: [], visible: phases };
  }
  let leading = 0;
  while (phases[leading]?.status === "completed") {
    leading++;
  }
  const collapsedEnd = leading - keepVisible;
  if (collapsedEnd < minCollapsed) return { collapsed: [], visible: phases };
  return {
    collapsed: phases.slice(0, collapsedEnd),
    visible: phases.slice(collapsedEnd),
  };
}

export function buildProjectBrief(
  snapshot: EngineeringProjectSnapshot,
): ProjectBrief {
  const phases = [...snapshot.phases]
    .sort((left, right) => left.order - right.order)
    .map((phase): ProjectPhaseView => {
      const workItems = phase.workItemIds.flatMap((id) => {
        const item = snapshot.workItems.find((candidate) =>
          candidate.id === id
        );
        return item ? [item] : [];
      });
      const decisions = phase.requiredDecisionIds.flatMap((id) => {
        const decision = snapshot.decisions.find((candidate) =>
          candidate.id === id
        );
        return decision ? [decision] : [];
      });
      return {
        phase,
        status: deriveEngineeringPhaseStatus(snapshot, phase.id),
        completedWorkItems: workItems.filter((item) =>
          item.status === "completed"
        ).length,
        totalWorkItems: workItems.length,
        approvedDecisions: decisions.filter((decision) =>
          isEngineeringDecisionSatisfied(snapshot, decision)
        ).length,
        requiredDecisions: decisions.length,
        evidenceCount: phase.evidenceRefs.length,
      };
    });

  return {
    status: deriveEngineeringProjectStatus(snapshot),
    phases,
    completedPhases: phases.filter((phase) => phase.status === "completed")
      .length,
    currentWork: currentWorkItemsInPriorityOrder(snapshot),
    nextWork: snapshot.workItems.filter((item) => item.status === "ready"),
    activeRuns: activeRunsInPriorityOrder(snapshot),
    lastSettledRun: snapshot.agentRuns
      .filter((run) =>
        run.status === "completed" || run.status === "failed" ||
        run.status === "cancelled"
      )
      .toSorted((left, right) =>
        agentRunRecordedAt(left).localeCompare(agentRunRecordedAt(right)) ||
        left.id.localeCompare(right.id)
      )
      .at(-1),
    pendingDecisions: snapshot.decisions.filter((decision) =>
      decision.status === "required" || decision.status === "proposed" ||
      decision.status === "rejected"
    ),
    openBlockers: snapshot.blockers.filter((blocker) =>
      blocker.status === "open"
    ),
  };
}

/**
 * Select the current work once for every cockpit projection.
 *
 * `EngineeringProjectSnapshot` keeps append-only records, therefore its raw
 * array order has no presentation authority. A live run is the only
 * execution-time override; otherwise the immutable phase plan is used.
 */
export function selectCurrentProjectFocus(
  snapshot: EngineeringProjectSnapshot,
): CurrentProjectFocus {
  const activeRun = activeRunsInPriorityOrder(snapshot)[0];
  const workById = new Map(snapshot.workItems.map((item) => [item.id, item]));
  const work = activeRun
    ? workById.get(activeRun.workItemId)
    : currentWorkItemsInPriorityOrder(snapshot)[0];
  const decisionsById = new Map(
    snapshot.decisions.map((decision) => [decision.id, decision]),
  );
  const proposedDecision = work?.decisionIds
    .map((id) => decisionsById.get(id))
    .find((decision) => decision?.status === "proposed");

  return { activeRun, work, proposedDecision };
}

export function buildAgentNowPresentation(
  snapshot: EngineeringProjectSnapshot,
): AgentNowPresentation {
  const focus = selectCurrentProjectFocus(snapshot);
  if (focus.activeRun) return { kind: "active-run", run: focus.activeRun };
  if (focus.work) return { kind: "current-work", work: focus.work };

  const brief = buildProjectBrief(snapshot);
  if (brief.lastSettledRun) {
    return { kind: "last-settled-run", run: brief.lastSettledRun };
  }
  return { kind: "empty" };
}

function currentWorkItemsInPriorityOrder(
  snapshot: EngineeringProjectSnapshot,
): readonly EngineeringWorkItem[] {
  const workById = new Map(snapshot.workItems.map((item) => [item.id, item]));
  return snapshot.phases
    .toSorted((left, right) =>
      right.order - left.order ||
      left.id.localeCompare(right.id)
    )
    .flatMap((phase) =>
      phase.workItemIds.flatMap((id) => {
        const item = workById.get(id);
        return item && isCurrentWork(item) ? [item] : [];
      })
    );
}

function activeRunsInPriorityOrder(
  snapshot: EngineeringProjectSnapshot,
): readonly EngineeringAgentRun[] {
  return snapshot.agentRuns
    .filter(isActiveRun)
    .toSorted((left, right) =>
      agentRunRecordedAt(right).localeCompare(agentRunRecordedAt(left)) ||
      left.id.localeCompare(right.id)
    );
}

function isCurrentWork(item: EngineeringWorkItem): boolean {
  return item.status === "in-progress" ||
    item.status === "waiting-for-decision";
}

function isActiveRun(run: EngineeringAgentRun): boolean {
  return run.status === "queued" || run.status === "running" ||
    run.status === "waiting-for-decision" || run.status === "publishing";
}

export function buildCurrentProjectWork(
  snapshot: EngineeringProjectSnapshot,
): CurrentProjectWork {
  const brief = buildProjectBrief(snapshot);
  const historicalWorkItemIds = new Set<string>();
  const closedActionTargetIds = new Set<string>();

  // A reconciliation is the domain's only closure contract here: the
  // cancelled work never produced successor evidence, but its exact operation
  // targets are closed by the separately completed successor named in the
  // immutable record.
  for (const item of snapshot.workItems) {
    if (
      item.status !== "cancelled" ||
      item.reconciliation?.kind !== "superseded-by-successor"
    ) continue;
    historicalWorkItemIds.add(item.id);
    for (const key of threadEntityReferenceKeys(item)) {
      closedActionTargetIds.add(key);
    }
  }

  // `project_change_append` is append-only: a later revision of the same
  // registered operation becomes a new work item and leaves the predecessor
  // `ready`. That leftover is not current work once a later evidenced
  // completion of the same `id@version` exists. Action targets stay open
  // unless a reconciliation named them: those bindings may still be current.
  for (const id of readyWorkItemIdsClosedByLaterCompletedOperation(snapshot)) {
    historicalWorkItemIds.add(id);
  }

  return {
    nextWork: brief.nextWork.filter((item) =>
      !historicalWorkItemIds.has(item.id)
    ),
    historicalWorkItemIds: [...historicalWorkItemIds].toSorted(),
    closedActionTargetIds: [...closedActionTargetIds].toSorted(),
  };
}

function registeredOperationKey(
  item: EngineeringWorkItem,
): string | undefined {
  return item.operation
    ? `${item.operation.id}@${item.operation.version}`
    : undefined;
}

function workItemPlanOrder(
  snapshot: EngineeringProjectSnapshot,
): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  for (
    const phase of snapshot.phases.toSorted((left, right) =>
      left.order - right.order || left.id.localeCompare(right.id)
    )
  ) {
    for (const id of phase.workItemIds) {
      if (!order.has(id)) order.set(id, index++);
    }
  }
  for (const item of snapshot.workItems) {
    if (!order.has(item.id)) order.set(item.id, index++);
  }
  return order;
}

/**
 * A ready, evidence-free predecessor is historical when a later work item
 * for the same registered operation already completed with evidence.
 * `@2` does not close `@3`, and an earlier completion does not close a
 * later ready revision that is still owed.
 */
function readyWorkItemIdsClosedByLaterCompletedOperation(
  snapshot: EngineeringProjectSnapshot,
): readonly string[] {
  const planOrder = workItemPlanOrder(snapshot);
  const completedOrdersByOperation = new Map<string, number[]>();
  for (const item of snapshot.workItems) {
    const key = registeredOperationKey(item);
    if (
      !key || item.status !== "completed" || item.evidenceRefs.length === 0
    ) continue;
    const existing = completedOrdersByOperation.get(key) ?? [];
    existing.push(planOrder.get(item.id) ?? Number.POSITIVE_INFINITY);
    completedOrdersByOperation.set(key, existing);
  }

  const closed: string[] = [];
  for (const item of snapshot.workItems) {
    const key = registeredOperationKey(item);
    if (
      !key || item.status !== "ready" || item.evidenceRefs.length !== 0
    ) continue;
    const itemOrder = planOrder.get(item.id) ?? Number.POSITIVE_INFINITY;
    const completedOrders = completedOrdersByOperation.get(key);
    if (completedOrders?.some((completedOrder) => completedOrder > itemOrder)) {
      closed.push(item.id);
    }
  }
  return closed;
}

/**
 * Produce the calm, human-facing project path from an immutable project
 * snapshot and its real evidence graph. Exact execution/retry history stays in
 * the component lifecycle and Activity views.
 */
export function buildProjectPath(
  snapshot: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot,
): ProjectPath {
  const brief = buildProjectBrief(snapshot);
  const phaseById = new Map(brief.phases.map((item) => [item.phase.id, item]));
  const artifactPhases = phaseIdsByArtifactLineage(snapshot, thread, brief);
  const corrections = correctionAttachments(thread, brief, artifactPhases);
  const correctionEvidenceKeys = new Set(
    corrections.flatMap((attachment) => attachment.evidenceKeys),
  );
  const revisions = revisionAttachments(
    snapshot,
    brief,
    correctionEvidenceKeys,
    corrections,
  );
  const revisionParentByPhaseId = new Map(
    revisions.map((
      attachment,
    ) => [attachment.phaseId, attachment.parentPhaseId]),
  );
  const supersededSeeds = cancelledSupersededSeedAttachments(snapshot, brief);
  const hiddenPhaseIds = new Set([
    ...corrections.map((attachment) => attachment.phaseId),
    ...revisions.map((attachment) => attachment.phaseId),
    ...supersededSeeds.folds.map((attachment) => attachment.phaseId),
  ]);
  const enrichments = modelEnrichmentAttachments(
    thread,
    brief,
    artifactPhases,
    hiddenPhaseIds,
  );
  enrichments.forEach((attachment) => hiddenPhaseIds.add(attachment.phaseId));
  const architectureVersions = architectureVersionAttachments(
    snapshot,
    thread,
    brief,
    hiddenPhaseIds,
  );
  architectureVersions.forEach((attachment) =>
    hiddenPhaseIds.add(attachment.phaseId)
  );
  const measurements = enrichmentMeasurementAttachments(
    thread,
    brief,
    enrichments,
    hiddenPhaseIds,
  );
  measurements.forEach((attachment) => hiddenPhaseIds.add(attachment.phaseId));
  const lifecycles = new Map<string, MutableProjectPhaseLifecycle>();

  for (const correction of corrections) {
    for (const phaseId of correction.parentPhaseIds) {
      const parentPhaseId = resolveMacroPhaseId(
        phaseId,
        revisionParentByPhaseId,
      );
      if (!phaseById.has(parentPhaseId) || hiddenPhaseIds.has(parentPhaseId)) {
        continue;
      }
      const lifecycle = mutableLifecycle(lifecycles, parentPhaseId);
      correction.evidenceKeys.forEach((key) =>
        lifecycle.correctionEvidenceKeys.add(key)
      );
      correction.affectedComponentIds.forEach((componentId) =>
        lifecycle.affectedComponentIds.add(componentId)
      );
    }
  }

  for (const revision of [...revisions, ...supersededSeeds.folds]) {
    const parentPhaseId = resolveMacroPhaseId(
      revision.parentPhaseId,
      revisionParentByPhaseId,
    );
    if (!phaseById.has(parentPhaseId) || hiddenPhaseIds.has(parentPhaseId)) {
      continue;
    }
    mutableLifecycle(lifecycles, parentPhaseId).revisionPhaseIds.add(
      revision.phaseId,
    );
  }

  for (const version of architectureVersions) {
    if (!phaseById.has(version.parentPhaseId)) continue;
    mutableLifecycle(lifecycles, version.parentPhaseId).revisionPhaseIds.add(
      version.phaseId,
    );
  }

  for (const enrichment of enrichments) {
    for (const parentPhaseId of enrichment.parentPhaseIds) {
      if (!phaseById.has(parentPhaseId)) continue;
      mutableLifecycle(lifecycles, parentPhaseId).enrichmentPhaseIds
        .add(enrichment.phaseId);
    }
  }

  for (const measurement of measurements) {
    for (const parentPhaseId of measurement.parentPhaseIds) {
      if (!phaseById.has(parentPhaseId)) continue;
      mutableLifecycle(lifecycles, parentPhaseId).measurementPhaseIds
        .add(measurement.phaseId);
    }
  }

  const phases = brief.phases
    .filter((item) => !hiddenPhaseIds.has(item.phase.id))
    .map((item): ProjectPathPhaseView => {
      const lifecycle = lifecycles.get(item.phase.id);
      const lifecycleView = lifecycle
        ? projectPhaseLifecycle(snapshot, lifecycle, phaseById)
        : undefined;
      const baseStatus = supersededSeeds.plannedPhaseIds.has(item.phase.id)
        ? "planned"
        : item.status;
      return {
        ...item,
        status: lifecycleView
          ? lifecycleEffectivePhaseStatus(baseStatus, lifecycleView)
          : baseStatus,
        ...(lifecycleView ? { lifecycle: lifecycleView } : {}),
      };
    });
  const visiblePhaseIds = new Set(phases.map((item) => item.phase.id));
  const pendingDecisions = snapshot.decisions.filter((decision) =>
    visiblePhaseIds.has(decision.phaseId) && isPendingDecision(decision)
  );
  const status = deriveProjectPathStatus(phases, pendingDecisions);

  return {
    status,
    phases,
    completedPhases: phases.filter((item) => item.status === "completed")
      .length,
    pendingDecisions,
  };
}

interface CorrectionAttachment {
  readonly phaseId: string;
  readonly evidenceKeys: readonly string[];
  readonly affectedComponentIds: readonly string[];
  readonly parentPhaseIds: readonly string[];
}

interface RevisionAttachment {
  readonly phaseId: string;
  readonly parentPhaseId: string;
}

interface MutableProjectPhaseLifecycle {
  readonly affectedComponentIds: Set<string>;
  readonly correctionEvidenceKeys: Set<string>;
  readonly revisionPhaseIds: Set<string>;
  readonly enrichmentPhaseIds: Set<string>;
  readonly measurementPhaseIds: Set<string>;
}

interface ModelEnrichmentAttachment {
  readonly phaseId: string;
  readonly parentPhaseIds: readonly string[];
}

interface EnrichmentMeasurementAttachment {
  readonly phaseId: string;
  readonly parentPhaseIds: readonly string[];
}

/**
 * A measurement phase exists to feed a model enrichment: its evidence is the
 * recorded `derived_from` source of an enrichment that already folded (the
 * sensitivity study feeding the anchored relations is the canonical case).
 * Measuring and anchoring are one gesture, so the measurement folds under the
 * same owner as its enrichment. The enrichment's own parent never folds into
 * itself, and only phases later than that parent qualify — instrumentation
 * follows the model it teaches, never the other way around.
 */
function enrichmentMeasurementAttachments(
  thread: ThreadWorkbenchSnapshot,
  brief: ProjectBrief,
  enrichments: readonly ModelEnrichmentAttachment[],
  hiddenPhaseIds: ReadonlySet<string>,
): readonly EnrichmentMeasurementAttachment[] {
  if (enrichments.length === 0) return [];
  const phaseById = new Map(brief.phases.map((item) => [item.phase.id, item]));
  const sourcesByEnrichment = new Map<string, Set<string>>();
  const enrichmentEvidence = new Map<string, ModelEnrichmentAttachment>();
  for (const enrichment of enrichments) {
    const view = phaseById.get(enrichment.phaseId);
    if (!view) continue;
    for (const ref of view.phase.evidenceRefs) {
      if (ref.kind !== "artifact") continue;
      enrichmentEvidence.set(graphRefKey(ref), enrichment);
    }
  }
  for (const edge of thread.graph.edges) {
    if (edge.relation !== "derived_from") continue;
    const target = graphRefKey(edge.to);
    if (!enrichmentEvidence.has(target)) continue;
    const sources = sourcesByEnrichment.get(target) ?? new Set<string>();
    sources.add(graphRefKey(edge.from));
    sourcesByEnrichment.set(target, sources);
  }
  const orderByPhaseId = new Map(
    brief.phases.map((item) => [item.phase.id, item.phase.order]),
  );

  const attachments: EnrichmentMeasurementAttachment[] = [];
  for (const view of brief.phases) {
    if (hiddenPhaseIds.has(view.phase.id)) continue;
    const evidenceKeys = view.phase.evidenceRefs
      .filter((ref) => ref.kind === "artifact")
      .map((ref) => graphRefKey(ref));
    if (evidenceKeys.length === 0) continue;

    const parentPhaseIds = new Set<string>();
    const everyEvidenceFeedsAnEnrichment = evidenceKeys.every((evidenceKey) => {
      for (const [target, sources] of sourcesByEnrichment) {
        if (!sources.has(evidenceKey)) continue;
        const enrichment = enrichmentEvidence.get(target);
        if (!enrichment) continue;
        const parents = enrichment.parentPhaseIds.filter((parentPhaseId) => {
          if (parentPhaseId === view.phase.id) return false;
          const parentOrder = orderByPhaseId.get(parentPhaseId);
          const candidateOrder = orderByPhaseId.get(view.phase.id);
          return parentOrder !== undefined && candidateOrder !== undefined &&
            parentOrder < candidateOrder;
        });
        if (parents.length === 0) continue;
        parents.forEach((parentPhaseId) => parentPhaseIds.add(parentPhaseId));
        return true;
      }
      return false;
    });
    if (!everyEvidenceFeedsAnEnrichment || parentPhaseIds.size === 0) continue;
    attachments.push({
      phaseId: view.phase.id,
      parentPhaseIds: [...parentPhaseIds],
    });
  }
  return attachments;
}

/**
 * A later phase whose every artifact evidence is a sysml-model derived from a
 * sysml-model owned by a strictly earlier visible phase writes into that
 * model instead of opening a new engineering stage, so it folds under the
 * owning phase. Requirement anchoring is the canonical case. Deriving from
 * your own phase (the architecture growing out of its seed) never counts.
 */
function modelEnrichmentAttachments(
  thread: ThreadWorkbenchSnapshot,
  brief: ProjectBrief,
  artifactPhases: ReadonlyMap<string, ReadonlySet<string>>,
  hiddenPhaseIds: ReadonlySet<string>,
): readonly ModelEnrichmentAttachment[] {
  const nodesByRef = new Map(
    thread.graph.nodes.map((node) => [graphRefKey(node.ref), node]),
  );
  const derivedFromByTarget = new Map<string, typeof thread.graph.edges>();
  for (const edge of thread.graph.edges) {
    if (edge.relation !== "derived_from") continue;
    const target = graphRefKey(edge.to);
    const existing = derivedFromByTarget.get(target) ?? [];
    existing.push(edge);
    derivedFromByTarget.set(target, existing);
  }
  const orderByPhaseId = new Map(
    brief.phases.map((item) => [item.phase.id, item.phase.order]),
  );

  const attachments: ModelEnrichmentAttachment[] = [];
  for (const view of brief.phases) {
    if (hiddenPhaseIds.has(view.phase.id)) continue;
    const evidenceKeys = view.phase.evidenceRefs
      .filter((ref) => ref.kind === "artifact")
      .map((ref) => graphRefKey(ref));
    if (evidenceKeys.length === 0) continue;
    const candidateOrder = orderByPhaseId.get(view.phase.id);
    if (candidateOrder === undefined) continue;

    const parentPhaseIds = new Set<string>();
    const everyEvidenceIsEnrichment = evidenceKeys.every((evidenceKey) => {
      const evidenceNode = nodesByRef.get(evidenceKey);
      if (evidenceNode?.artifactKind !== "sysml-model") return false;
      if (isArchitectureCaptureArtifact(thread, evidenceNode.ref.id)) {
        return false;
      }
      const parents = (derivedFromByTarget.get(evidenceKey) ?? [])
        .filter((edge) =>
          nodesByRef.get(graphRefKey(edge.from))?.artifactKind === "sysml-model"
        )
        .flatMap((
          edge,
        ) => [...(artifactPhases.get(graphRefKey(edge.from)) ?? [])])
        .filter((phaseId) =>
          phaseId !== view.phase.id &&
          !hiddenPhaseIds.has(phaseId) &&
          (orderByPhaseId.get(phaseId) ?? Number.POSITIVE_INFINITY) <
            candidateOrder
        );
      if (parents.length === 0) return false;
      parents.forEach((phaseId) => parentPhaseIds.add(phaseId));
      return true;
    });
    if (!everyEvidenceIsEnrichment || parentPhaseIds.size === 0) continue;
    attachments.push({
      phaseId: view.phase.id,
      parentPhaseIds: [...parentPhaseIds],
    });
  }
  return attachments;
}

/**
 * Associate each known artifact with the macro phase that owns its local
 * artifact lineage. Only `derived_from` artifact edges participate: structural
 * cross-tool inputs must not accidentally turn a CAD correction into an ERP or
 * SysML phase attachment.
 */
function phaseIdsByArtifactLineage(
  snapshot: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot,
  brief: ProjectBrief,
): ReadonlyMap<string, ReadonlySet<string>> {
  const predecessors = new Map<string, string[]>();
  for (const edge of thread.graph.edges) {
    if (
      edge.relation !== "derived_from" || edge.from.kind !== "artifact" ||
      edge.to.kind !== "artifact"
    ) continue;
    const target = graphRefKey(edge.to);
    const source = graphRefKey(edge.from);
    const existing = predecessors.get(target) ?? [];
    existing.push(source);
    predecessors.set(target, existing);
  }

  const phaseIds = new Map<string, Set<string>>();
  for (const view of brief.phases) {
    const workItems = view.phase.workItemIds.flatMap((id) => {
      const item = snapshot.workItems.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    });
    const roots = [
      ...view.phase.evidenceRefs,
      ...workItems.flatMap((item) => item.evidenceRefs),
    ].filter((ref) => ref.kind === "artifact");
    for (const root of roots) {
      for (
        const artifactKey of artifactPredecessors(
          graphRefKey(root),
          predecessors,
        )
      ) {
        const existing = phaseIds.get(artifactKey) ?? new Set<string>();
        existing.add(view.phase.id);
        phaseIds.set(artifactKey, existing);
      }
    }
  }
  return phaseIds;
}

const ARCHITECTURE_CAPTURE_URI_PREFIX = "casys://architecture-capture/";

function isArchitectureCaptureArtifact(
  thread: ThreadWorkbenchSnapshot,
  artifactId: string,
): boolean {
  const artifact = thread.artifacts.find((item) => item.id === artifactId);
  return artifact?.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX) === true;
}

/**
 * A later architecture-capture tip in one current BFF family is a wrapped
 * revision of the earlier phase that owns the historical member — not a
 * second project gate.
 */
function architectureVersionAttachments(
  snapshot: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot,
  brief: ProjectBrief,
  hiddenPhaseIds: ReadonlySet<string>,
): readonly RevisionAttachment[] {
  const orderByPhaseId = new Map(
    brief.phases.map((item) => [item.phase.id, item.phase.order]),
  );
  const ownersByArtifactId = new Map<string, string[]>();
  for (const view of brief.phases) {
    const workItems = view.phase.workItemIds.flatMap((id) => {
      const item = snapshot.workItems.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    });
    const refs = [
      ...view.phase.evidenceRefs,
      ...workItems.flatMap((item) => item.evidenceRefs),
    ].filter((ref) => ref.kind === "artifact");
    for (const ref of refs) {
      const owners = ownersByArtifactId.get(ref.id) ?? [];
      owners.push(view.phase.id);
      ownersByArtifactId.set(ref.id, owners);
    }
  }

  const attachments: RevisionAttachment[] = [];
  for (const view of brief.phases) {
    if (hiddenPhaseIds.has(view.phase.id)) continue;
    const evidenceIds = view.phase.evidenceRefs
      .filter((ref) => ref.kind === "artifact")
      .map((ref) => ref.id);
    if (evidenceIds.length === 0) continue;
    const families = thread.evidenceFamilyGraph.families.filter((family) =>
      family.entityKind === "artifact" &&
      family.status === "current" &&
      family.currentRefs.length === 1 &&
      evidenceIds.every((id) =>
        [...family.historicalRefs, ...family.currentRefs].some((ref) =>
          ref.kind === "artifact" && ref.id === id
        )
      )
    );
    if (families.length !== 1) continue;
    const family = families[0]!;
    const candidateOrder = orderByPhaseId.get(view.phase.id);
    if (candidateOrder === undefined) continue;
    const parentPhaseIds = new Set<string>();
    for (const historical of family.historicalRefs) {
      if (historical.kind !== "artifact") continue;
      for (const phaseId of ownersByArtifactId.get(historical.id) ?? []) {
        if (
          phaseId !== view.phase.id &&
          !hiddenPhaseIds.has(phaseId) &&
          (orderByPhaseId.get(phaseId) ?? Number.POSITIVE_INFINITY) <
            candidateOrder
        ) {
          parentPhaseIds.add(phaseId);
        }
      }
    }
    if (parentPhaseIds.size !== 1) continue;
    attachments.push({
      phaseId: view.phase.id,
      parentPhaseId: [...parentPhaseIds][0]!,
    });
  }
  return attachments;
}

function artifactPredecessors(
  root: string,
  predecessors: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const known = new Set<string>([root]);
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const predecessor of predecessors.get(current) ?? []) {
      if (known.has(predecessor)) continue;
      known.add(predecessor);
      pending.push(predecessor);
    }
  }
  return known;
}

function correctionAttachments(
  thread: ThreadWorkbenchSnapshot,
  brief: ProjectBrief,
  artifactPhases: ReadonlyMap<string, ReadonlySet<string>>,
): readonly CorrectionAttachment[] {
  const nodesByRef = new Map(
    thread.graph.nodes.map((node) => [graphRefKey(node.ref), node]),
  );
  const changesByTarget = new Map<string, typeof thread.graph.edges>();
  const supersedesBySuccessor = new Map<string, typeof thread.graph.edges>();
  for (const edge of thread.graph.edges) {
    const target = graphRefKey(edge.to);
    if (edge.relation === "changes") {
      const existing = changesByTarget.get(target) ?? [];
      existing.push(edge);
      changesByTarget.set(target, existing);
    }
    if (edge.relation === "supersedes") {
      const existing = supersedesBySuccessor.get(target) ?? [];
      existing.push(edge);
      supersedesBySuccessor.set(target, existing);
    }
  }

  const attachments: CorrectionAttachment[] = [];
  for (const view of brief.phases) {
    const evidenceKeys = view.phase.evidenceRefs
      .filter((ref) => ref.kind === "artifact")
      .map((ref) => graphRefKey(ref));
    const correctionEvidenceKeys: string[] = [];
    const affectedComponentIds = new Set<string>();
    const parentPhaseIds = new Set<string>();
    for (const evidenceKey of evidenceKeys) {
      const correctionNodes = (changesByTarget.get(evidenceKey) ?? [])
        .map((edge) => nodesByRef.get(graphRefKey(edge.from)))
        .filter((node) =>
          node?.entityKind === "change" &&
          typeof node.affectedComponentId === "string" &&
          node.affectedComponentId.trim().length > 0
        );
      if (correctionNodes.length === 0) continue;
      const predecessorEdges = supersedesBySuccessor.get(evidenceKey) ?? [];
      const predecessorPhaseIds = predecessorEdges.flatMap((
        edge,
      ) => [...(artifactPhases.get(graphRefKey(edge.from)) ?? [])]);
      if (predecessorPhaseIds.length === 0) continue;

      correctionEvidenceKeys.push(evidenceKey);
      correctionNodes.forEach((node) =>
        affectedComponentIds.add(node!.affectedComponentId!.trim())
      );
      predecessorPhaseIds.forEach((phaseId) => parentPhaseIds.add(phaseId));
    }
    if (
      correctionEvidenceKeys.length === 0 || affectedComponentIds.size === 0 ||
      parentPhaseIds.size === 0
    ) continue;
    attachments.push({
      phaseId: view.phase.id,
      evidenceKeys: correctionEvidenceKeys,
      affectedComponentIds: [...affectedComponentIds].toSorted(),
      parentPhaseIds: [...parentPhaseIds],
    });
  }
  return attachments;
}

/**
 * An empty-evidence phase whose only work is cancelled+superseded-by-successor
 * is retained history of the unique later phase that executed the same
 * registered operation. Ambiguous successors stay visible as planned.
 */
function cancelledSupersededSeedAttachments(
  snapshot: EngineeringProjectSnapshot,
  brief: ProjectBrief,
): {
  readonly folds: readonly RevisionAttachment[];
  readonly plannedPhaseIds: ReadonlySet<string>;
} {
  const folds: RevisionAttachment[] = [];
  const plannedPhaseIds = new Set<string>();
  for (const view of brief.phases) {
    if (!isEmptyCancelledSupersededPhase(snapshot, view.phase)) continue;
    const successorPhaseId = uniqueSuccessorPhaseId(snapshot, view.phase);
    if (successorPhaseId && successorPhaseId !== view.phase.id) {
      folds.push({ phaseId: view.phase.id, parentPhaseId: successorPhaseId });
      continue;
    }
    plannedPhaseIds.add(view.phase.id);
  }
  return { folds, plannedPhaseIds };
}

function isEmptyCancelledSupersededPhase(
  snapshot: EngineeringProjectSnapshot,
  phase: EngineeringProjectPhase,
): boolean {
  if (phase.evidenceRefs.length !== 0) return false;
  const workItems = phase.workItemIds.flatMap((id) => {
    const item = snapshot.workItems.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  });
  return workItems.length > 0 &&
    workItems.every((item) =>
      item.status === "cancelled" &&
      item.reconciliation?.kind === "superseded-by-successor"
    );
}

function uniqueSuccessorPhaseId(
  snapshot: EngineeringProjectSnapshot,
  phase: EngineeringProjectPhase,
): string | undefined {
  const successorPhaseIds = new Set<string>();
  for (const id of phase.workItemIds) {
    const item = snapshot.workItems.find((candidate) => candidate.id === id);
    if (!item) return undefined;
    const successorPhaseId = successorPhaseIdForCancelledWork(snapshot, item);
    if (!successorPhaseId || successorPhaseId === phase.id) return undefined;
    successorPhaseIds.add(successorPhaseId);
  }
  return successorPhaseIds.size === 1 ? [...successorPhaseIds][0] : undefined;
}

function successorPhaseIdForCancelledWork(
  snapshot: EngineeringProjectSnapshot,
  item: EngineeringWorkItem,
): string | undefined {
  const reconciliation = item.reconciliation;
  if (reconciliation?.kind !== "superseded-by-successor") return undefined;
  const operationKey = registeredOperationKey(item);
  if (!operationKey) return undefined;
  const successorWork = "successorWorkItemId" in reconciliation
    ? snapshot.workItems.find((candidate) =>
      candidate.id === reconciliation.successorWorkItemId
    )
    : successorWorkFromRun(snapshot, reconciliation.successorRunId);
  if (
    !successorWork || registeredOperationKey(successorWork) !== operationKey
  ) {
    return undefined;
  }
  if (!("successorWorkItemId" in reconciliation)) {
    const owned = phaseOwnsEvidenceRefs(
      snapshot,
      successorWork.phaseId,
      reconciliation.successorEvidenceRefs,
    );
    if (!owned) return undefined;
  }
  return successorWork.phaseId;
}

function successorWorkFromRun(
  snapshot: EngineeringProjectSnapshot,
  successorRunId: string,
): EngineeringWorkItem | undefined {
  const run = snapshot.agentRuns.find((candidate) =>
    candidate.id === successorRunId
  );
  return run
    ? snapshot.workItems.find((candidate) => candidate.id === run.workItemId)
    : undefined;
}

function phaseOwnsEvidenceRefs(
  snapshot: EngineeringProjectSnapshot,
  phaseId: string,
  refs: readonly EngineeringThreadEntityRef[],
): boolean {
  if (refs.length === 0) return false;
  const phase = snapshot.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) return false;
  const owned = new Set([
    ...phase.evidenceRefs.map((ref) => graphRefKey(ref)),
    ...phase.workItemIds.flatMap((id) => {
      const item = snapshot.workItems.find((candidate) => candidate.id === id);
      return item?.status === "completed"
        ? item.evidenceRefs.map((ref) => graphRefKey(ref))
        : [];
    }),
  ]);
  return refs.every((ref) => owned.has(graphRefKey(ref)));
}

function revisionAttachments(
  snapshot: EngineeringProjectSnapshot,
  brief: ProjectBrief,
  correctionEvidenceKeys: ReadonlySet<string>,
  corrections: readonly CorrectionAttachment[],
): readonly RevisionAttachment[] {
  const attachments: RevisionAttachment[] = [];
  for (const candidate of brief.phases) {
    const candidateOperations = phaseOperations(snapshot, candidate.phase);
    if (candidateOperations.length === 0) continue;
    const consumedCorrections = candidateOperations.flatMap((operation) =>
      operation.bindings.flatMap((binding) =>
        binding.source.kind === "thread-entity" &&
          correctionEvidenceKeys.has(graphRefKey(binding.source.reference))
          ? [graphRefKey(binding.source.reference)]
          : []
      )
    );
    if (consumedCorrections.length === 0) continue;

    const parent = brief.phases.find((earlier) =>
      earlier.phase.order < candidate.phase.order &&
      phaseIsVersionedPredecessor(snapshot, earlier.phase, candidateOperations)
    );
    if (!parent) continue;

    const correctionReachesParent = corrections.some((correction) =>
      correction.evidenceKeys.some((key) =>
        consumedCorrections.includes(key)
      ) &&
      correction.parentPhaseIds.includes(parent.phase.id)
    );
    if (!correctionReachesParent) continue;
    attachments.push({
      phaseId: candidate.phase.id,
      parentPhaseId: parent.phase.id,
    });
  }
  return attachments;
}

function phaseOperations(
  snapshot: EngineeringProjectSnapshot,
  phase: EngineeringProjectPhase,
) {
  return phase.workItemIds.flatMap((id) => {
    const item = snapshot.workItems.find((candidate) => candidate.id === id);
    return item?.operation ? [item.operation] : [];
  });
}

function phaseIsVersionedPredecessor(
  snapshot: EngineeringProjectSnapshot,
  phase: EngineeringProjectPhase,
  candidateOperations: ReturnType<typeof phaseOperations>,
): boolean {
  const previousOperations = phaseOperations(snapshot, phase);
  return previousOperations.length > 0 &&
    candidateOperations.every((operation) =>
      previousOperations.some((previous) =>
        previous.id === operation.id && previous.version !== operation.version
      )
    );
}

function resolveMacroPhaseId(
  phaseId: string,
  revisionParentByPhaseId: ReadonlyMap<string, string>,
): string {
  const seen = new Set<string>();
  let current = phaseId;
  while (revisionParentByPhaseId.has(current) && !seen.has(current)) {
    seen.add(current);
    current = revisionParentByPhaseId.get(current)!;
  }
  return current;
}

function mutableLifecycle(
  lifecycles: Map<string, MutableProjectPhaseLifecycle>,
  phaseId: string,
): MutableProjectPhaseLifecycle {
  const existing = lifecycles.get(phaseId);
  if (existing) return existing;
  const lifecycle: MutableProjectPhaseLifecycle = {
    affectedComponentIds: new Set<string>(),
    correctionEvidenceKeys: new Set<string>(),
    revisionPhaseIds: new Set<string>(),
    enrichmentPhaseIds: new Set<string>(),
    measurementPhaseIds: new Set<string>(),
  };
  lifecycles.set(phaseId, lifecycle);
  return lifecycle;
}

function projectPhaseLifecycle(
  snapshot: EngineeringProjectSnapshot,
  lifecycle: MutableProjectPhaseLifecycle,
  phaseById: ReadonlyMap<string, ProjectPhaseView>,
): ProjectPhaseLifecycle {
  const revisions = [...lifecycle.revisionPhaseIds]
    .flatMap((id) => {
      const view = phaseById.get(id);
      return view ? [view] : [];
    })
    .toSorted((left, right) => left.phase.order - right.phase.order);
  const enrichments = [...lifecycle.enrichmentPhaseIds]
    .flatMap((id) => {
      const view = phaseById.get(id);
      return view ? [view] : [];
    })
    .toSorted((left, right) => left.phase.order - right.phase.order);
  const measurements = [...lifecycle.measurementPhaseIds]
    .flatMap((id) => {
      const view = phaseById.get(id);
      return view ? [view] : [];
    })
    .toSorted((left, right) => left.phase.order - right.phase.order);
  const latestLifecycleRecord = [
    ...revisions,
    ...enrichments,
    ...measurements,
  ]
    .toSorted((left, right) => left.phase.order - right.phase.order)
    .at(-1);
  const latestRun = latestLifecycleRecord
    ? latestRunForPhase(snapshot, latestLifecycleRecord.phase)
    : undefined;
  /**
   * Gate states are durable readings of the versioned record only. Live work
   * never colours a gate: the phase's own work counters already say 0/1, and
   * "What the agent is doing" plus the Activity feed own the in-flight story.
   * A failed latest run keeps its durable attention signal; an unfinished
   * lifecycle is retained history, never a promise of recomputation.
   */
  const state = latestRun?.status === "failed"
    ? "attention"
    : latestLifecycleRecord &&
        isEmptyCancelledSupersededPhase(snapshot, latestLifecycleRecord.phase)
    ? "retained"
    : latestLifecycleRecord?.status === "completed"
    ? "current"
    : "retained";
  return {
    affectedComponentIds: [...lifecycle.affectedComponentIds].toSorted(),
    correctionCount: lifecycle.correctionEvidenceKeys.size,
    revisionAttemptCount: revisions.length,
    ...(enrichments.length > 0
      ? { modelEnrichmentCount: enrichments.length }
      : {}),
    ...(measurements.length > 0
      ? { modelMeasurementCount: measurements.length }
      : {}),
    state,
  };
}

function latestRunForPhase(
  snapshot: EngineeringProjectSnapshot,
  phase: EngineeringProjectPhase,
): EngineeringAgentRun | undefined {
  const workItemIds = new Set(phase.workItemIds);
  return snapshot.agentRuns.filter((run) => workItemIds.has(run.workItemId))
    .toSorted((left, right) =>
      agentRunRecordedAt(left).localeCompare(agentRunRecordedAt(right)) ||
      left.id.localeCompare(right.id)
    )
    .at(-1);
}

/**
 * The timestamp at which the run reached the recorded state. A queued run is
 * cancelled without ever acquiring a `completedAt`; its human cancellation is
 * the terminal event and must therefore win over the earlier queue time.
 */
export function agentRunRecordedAt(run: EngineeringAgentRun): string {
  return run.cancellation?.cancelledAt ?? run.completedAt ?? run.startedAt ??
    run.queuedAt;
}

function lifecycleEffectivePhaseStatus(
  baseStatus: EngineeringPhaseStatus,
  lifecycle: ProjectPhaseLifecycle,
): EngineeringPhaseStatus {
  if (lifecycle.state === "attention") return "blocked";
  return baseStatus;
}

function deriveProjectPathStatus(
  phases: readonly ProjectPathPhaseView[],
  pendingDecisions: readonly EngineeringDecision[],
): EngineeringProjectStatus {
  if (phases.length === 0) return "planned";
  if (phases.every((phase) => phase.status === "completed")) {
    return "completed";
  }
  if (pendingDecisions.length > 0) return "attention-required";
  if (phases.some((phase) => phase.status === "blocked")) return "blocked";
  if (phases.some((phase) => phase.status === "active")) return "active";
  return "planned";
}

function isPendingDecision(decision: EngineeringDecision): boolean {
  return decision.status === "required" || decision.status === "proposed" ||
    decision.status === "rejected";
}

function graphRefKey(ref: Pick<ThreadGraphRef, "kind" | "id">): string {
  return `${ref.kind}:${ref.id}`;
}

function threadEntityReferenceKeys(
  item: EngineeringWorkItem,
): ReadonlySet<string> {
  return new Set(
    item.operation?.bindings.flatMap((binding) =>
      binding.source.kind === "thread-entity"
        ? [graphRefKey(binding.source.reference)]
        : []
    ) ?? [],
  );
}

export function projectStatusLabel(status: EngineeringProjectStatus): string {
  if (status === "attention-required") return "Decision required";
  if (status === "active") return "Active";
  if (status === "blocked") return "Blocked";
  if (status === "completed") return "Completed";
  if (status === "planned") return "Planned";
  return "Planned";
}

export function phaseStatusLabel(status: EngineeringPhaseStatus): string {
  if (status === "completed") return "Gate satisfied";
  if (status === "active") return "In progress";
  if (status === "blocked") return "Blocked";
  if (status === "planned") return "Planned";
  const _never: never = status;
  return _never;
}

export function projectBriefStatusLabel(brief: ProjectBrief): string {
  if (brief.status !== "attention-required") {
    return projectStatusLabel(brief.status);
  }
  if (
    brief.pendingDecisions.some((decision) => decision.status === "proposed")
  ) {
    return "Review required";
  }
  if (
    brief.pendingDecisions.some((decision) =>
      decision.status === "required" || decision.status === "rejected"
    )
  ) {
    return "Agent preparing proposal";
  }
  return "Attention required";
}

export function projectPathStatusLabel(path: ProjectPath): string {
  if (path.status !== "attention-required") {
    return projectStatusLabel(path.status);
  }
  if (
    path.pendingDecisions.some((decision) => decision.status === "proposed")
  ) {
    return "Review required";
  }
  if (
    path.pendingDecisions.some((decision) =>
      decision.status === "required" || decision.status === "rejected"
    )
  ) return "Agent preparing proposal";
  return "Attention required";
}

export function projectStatusTone(
  status: EngineeringProjectStatus,
): "neutral" | "active" | "attention" | "blocked" | "complete" {
  if (status === "attention-required") return "attention";
  if (status === "active") return "active";
  if (status === "blocked") return "blocked";
  if (status === "completed") return "complete";
  return "neutral";
}

export function workOwnerLabel(owner: EngineeringWorkItem["owner"]): string {
  if (owner === "shared") return "Agent + human review";
  return owner === "human" ? "Human review" : "Agent";
}

export function workStatusLabel(status: EngineeringWorkItem["status"]): string {
  return status.replaceAll("-", " ");
}

/**
 * Compact Activity pulse chip: the current run or work status as literal
 * Badge text, so planned/cancelled/completed stay readable when collapsed.
 */
export function projectPulseStatus(
  presentation:
    | {
      readonly kind: "active-run" | "last-settled-run";
      readonly run: { readonly status: string };
    }
    | {
      readonly kind: "current-work";
      readonly work: { readonly status: string };
    }
    | { readonly kind: "empty" },
): { readonly status: string; readonly label: string } {
  if (
    presentation.kind === "active-run" ||
    presentation.kind === "last-settled-run"
  ) {
    return {
      status: presentation.run.status,
      label: sentenceStatusLabel(presentation.run.status),
    };
  }
  if (presentation.kind === "current-work") {
    return {
      status: presentation.work.status,
      label: sentenceStatusLabel(presentation.work.status),
    };
  }
  return { status: "idle", label: "Idle" };
}

function sentenceStatusLabel(status: string): string {
  const label = status.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/**
 * The overview leads with the current engineering decision, while the full
 * Evidence space retains every historical criterion and relation for review.
 */
export function verificationChainDetail(
  thread: ThreadWorkbenchSnapshot,
): string {
  const requirements = currentRequirements(
    thread.requirements,
    thread.evidenceFamilyGraph,
  );
  const historicalCount = thread.requirements.length - requirements.length;
  const passed = requirements.filter((item) => item.status === "pass").length;
  const failed = requirements.filter((item) => item.status === "fail").length;
  const unresolved = requirements.length - passed - failed;
  const currentDetail = requirements.length === 0
    ? "No current modelled criteria"
    : `${passed}/${requirements.length} current criteria passing`;
  const verdictDetail = failed > 0
    ? `${failed} failed`
    : unresolved > 0
    ? `${unresolved} unresolved`
    : `${thread.violations.length} named violations`;
  const historyDetail = historicalCount > 0
    ? `${historicalCount} historical record${historicalCount === 1 ? "" : "s"}`
    : `${thread.graph.edges.length} recorded relations`;
  return `${currentDetail} · ${verdictDetail} · ${historyDetail}.`;
}

/**
 * Run summaries come from an agent-facing command surface. The cockpit is not
 * an audit-log dump: a short token or an accidental pasted fragment should not
 * become the most prominent explanation of current work. Exact records remain
 * available in the execution history.
 */
export function agentRunSummary(
  snapshot: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): string {
  const summary = run.summary.trim();
  if (isReadableRunSummary(summary)) return summary;

  const workItem = snapshot.workItems.find((item) =>
    item.id === run.workItemId
  );
  return workItem
    ? `Working on: ${workItem.title}`
    : "The agent is working on a recorded engineering task.";
}

function isReadableRunSummary(value: string): boolean {
  // A useful status sentence has enough context to be understood without
  // opening the technical record. This deliberately treats terse placeholders
  // such as "dsadsadas" as malformed UI content, not engineering truth.
  return value.length >= 12 && /\s/.test(value) &&
    /[A-Za-zÀ-ÖØ-öø-ÿ]{3}/.test(value);
}
