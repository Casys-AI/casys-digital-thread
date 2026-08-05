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
  type EngineeringWorkItem,
} from "../../../domain/engineering-project.ts";
import type { ThreadGraphRef, ThreadWorkbenchSnapshot } from "../thread/types.ts";
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
  readonly pendingDecisions: readonly EngineeringDecision[];
  readonly openBlockers: readonly EngineeringBlocker[];
}

/**
 * The operational subset of a project brief for a linked, current evidence
 * snapshot. It never removes immutable work or run history: it prevents only
 * a cancelled attempt with an explicit immutable reconciliation from being
 * offered as the next action again.
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
 * One bounded exception is an identity-only evidence repair. It is attached
 * only when the exact registered repair operation directly supersedes the
 * retained R3/r10 evidence named in its input and that evidence already
 * belongs to the explicitly anchored component correction lifecycle.
 *
 * It deliberately uses no labels, title fragments or loose identifiers. If a
 * future project does not provide this evidence, its phase remains visible.
 */
export const PROJECT_PATH_PRESENTATION_POLICY = {
  version: "project-path/1.0",
  macroStages: "initial project phases",
  lifecycleAttachments:
    "explicit correction component + supersedes lineage + versioned operation identity",
  identityRepair: {
    operationId: "repair.coffee-machine-cm01-drip-tray-mechanical-r3-identity",
    operationVersion: "1",
    requiredLineage:
      "direct supersedes successor of an anchored R3/r10 correction descendant",
  },
} as const;

export interface ProjectPhaseLifecycle {
  /** Explicit catalog identities; never derived from a friendly label. */
  readonly affectedComponentIds: readonly string[];
  readonly correctionCount: number;
  /** Historical operation attempts retained below this macro stage. */
  readonly revisionAttemptCount: number;
  /** Identity-only repairs are retained beside the evidence, never as gates. */
  readonly identityRepairCount?: number;
  /**
   * The compact macro-stage reading state, not a replacement for its history.
   * "retained" is the terminal reading on a completed project: the lifecycle
   * never finished and never will — history kept, no recomputation promised.
   */
  readonly state: "current" | "recomputing" | "attention" | "retained";
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

export function buildProjectBrief(
  snapshot: EngineeringProjectSnapshot,
): ProjectBrief {
  const phases = [...snapshot.phases]
    .sort((left, right) => left.order - right.order)
    .map((phase): ProjectPhaseView => {
      const workItems = phase.workItemIds.flatMap((id) => {
        const item = snapshot.workItems.find((candidate) => candidate.id === id);
        return item ? [item] : [];
      });
      const decisions = phase.requiredDecisionIds.flatMap((id) => {
        const decision = snapshot.decisions.find((candidate) => candidate.id === id);
        return decision ? [decision] : [];
      });
      return {
        phase,
        status: deriveEngineeringPhaseStatus(snapshot, phase.id),
        completedWorkItems: workItems.filter((item) =>
          item.status === "completed"
        ).length,
        totalWorkItems: workItems.length,
        approvedDecisions:
          decisions.filter((decision) => decision.status === "approved").length,
        requiredDecisions: decisions.length,
        evidenceCount: phase.evidenceRefs.length,
      };
    });

  return {
    status: deriveEngineeringProjectStatus(snapshot),
    phases,
    completedPhases: phases.filter((phase) => phase.status === "completed")
      .length,
    currentWork: snapshot.workItems.filter((item) =>
      item.status === "in-progress" ||
      item.status === "waiting-for-decision"
    ),
    nextWork: snapshot.workItems.filter((item) => item.status === "ready"),
    activeRuns: snapshot.agentRuns.filter((run) =>
      run.status === "queued" || run.status === "running" ||
      run.status === "waiting-for-decision" || run.status === "publishing"
    ),
    pendingDecisions: snapshot.decisions.filter((decision) =>
      decision.status === "required" || decision.status === "proposed" ||
      decision.status === "rejected"
    ),
    openBlockers: snapshot.blockers.filter((blocker) => blocker.status === "open"),
  };
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

  return {
    nextWork: brief.nextWork.filter((item) => !historicalWorkItemIds.has(item.id)),
    historicalWorkItemIds: [...historicalWorkItemIds].toSorted(),
    closedActionTargetIds: [...closedActionTargetIds].toSorted(),
  };
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
  const identityRepairs = identityRepairAttachments(
    snapshot,
    thread,
    brief,
    artifactPhases,
    correctionEvidenceKeys,
    corrections,
    revisionParentByPhaseId,
  );
  const hiddenPhaseIds = new Set([
    ...corrections.map((attachment) => attachment.phaseId),
    ...revisions.map((attachment) => attachment.phaseId),
    ...identityRepairs.map((attachment) => attachment.phaseId),
  ]);
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

  for (const revision of revisions) {
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

  for (const repair of identityRepairs) {
    if (!phaseById.has(repair.parentPhaseId)) continue;
    mutableLifecycle(lifecycles, repair.parentPhaseId).identityRepairPhaseIds
      .add(repair.phaseId);
  }

  const phases = brief.phases
    .filter((item) => !hiddenPhaseIds.has(item.phase.id))
    .map((item): ProjectPathPhaseView => {
      const lifecycle = lifecycles.get(item.phase.id);
      const lifecycleView = lifecycle
        ? projectPhaseLifecycle(snapshot, lifecycle, phaseById)
        : undefined;
      return {
        ...item,
        status: lifecycleView
          ? lifecycleEffectivePhaseStatus(item.status, lifecycleView)
          : item.status,
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

interface IdentityRepairAttachment {
  readonly phaseId: string;
  readonly parentPhaseId: string;
}

interface MutableProjectPhaseLifecycle {
  readonly affectedComponentIds: Set<string>;
  readonly correctionEvidenceKeys: Set<string>;
  readonly revisionPhaseIds: Set<string>;
  readonly identityRepairPhaseIds: Set<string>;
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
      correction.evidenceKeys.some((key) => consumedCorrections.includes(key)) &&
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

/**
 * The r11 operation corrects a historical R3 evidence identity; it does not
 * make or verify a new product phase. The named operation is intentionally
 * narrow. Its input must name the old R3/r10 artifact, the phase must publish
 * a direct `supersedes` successor, and that old artifact must already be a
 * versioned descendant of the same explicit component correction.
 */
function identityRepairAttachments(
  snapshot: EngineeringProjectSnapshot,
  thread: ThreadWorkbenchSnapshot,
  brief: ProjectBrief,
  artifactPhases: ReadonlyMap<string, ReadonlySet<string>>,
  correctionEvidenceKeys: ReadonlySet<string>,
  corrections: readonly CorrectionAttachment[],
  revisionParentByPhaseId: ReadonlyMap<string, string>,
): readonly IdentityRepairAttachment[] {
  const attachments: IdentityRepairAttachment[] = [];
  for (const candidate of brief.phases) {
    const operations = phaseOperations(snapshot, candidate.phase);
    if (!isExactIdentityRepairOperation(operations)) continue;
    const historicalEvidenceKeys = threadEntityEvidenceKeys(operations);
    const repairedEvidenceKeys = phaseArtifactEvidenceKeys(
      snapshot,
      candidate.phase,
    );
    if (historicalEvidenceKeys.size === 0 || repairedEvidenceKeys.size === 0) {
      continue;
    }

    const macroPhaseIds = new Set<string>();
    for (const edge of thread.graph.edges) {
      if (
        edge.relation !== "supersedes" || edge.from.kind !== "artifact" ||
        edge.to.kind !== "artifact" ||
        !historicalEvidenceKeys.has(graphRefKey(edge.from)) ||
        !repairedEvidenceKeys.has(graphRefKey(edge.to))
      ) continue;
      for (
        const sourcePhaseId of artifactPhases.get(graphRefKey(edge.from)) ?? []
      ) {
        const macroPhaseId = revisionParentByPhaseId.get(sourcePhaseId);
        if (!macroPhaseId) continue;
        const sourcePhase = brief.phases.find((item) =>
          item.phase.id === sourcePhaseId
        );
        if (!sourcePhase) continue;
        const consumedCorrections = correctionEvidenceKeysForPhase(
          snapshot,
          sourcePhase.phase,
          correctionEvidenceKeys,
        );
        const anchoredCorrection = corrections.some((correction) =>
          correction.parentPhaseIds.includes(macroPhaseId) &&
          correction.affectedComponentIds.length > 0 &&
          correction.evidenceKeys.some((key) => consumedCorrections.has(key))
        );
        if (anchoredCorrection) macroPhaseIds.add(macroPhaseId);
      }
    }
    if (macroPhaseIds.size !== 1) continue;
    attachments.push({
      phaseId: candidate.phase.id,
      parentPhaseId: [...macroPhaseIds][0]!,
    });
  }
  return attachments;
}

function isExactIdentityRepairOperation(
  operations: ReturnType<typeof phaseOperations>,
): boolean {
  return operations.length === 1 &&
    operations[0]!.id ===
      PROJECT_PATH_PRESENTATION_POLICY.identityRepair.operationId &&
    operations[0]!.version ===
      PROJECT_PATH_PRESENTATION_POLICY.identityRepair.operationVersion;
}

function threadEntityEvidenceKeys(
  operations: ReturnType<typeof phaseOperations>,
): ReadonlySet<string> {
  return new Set(
    operations.flatMap((operation) =>
      operation.bindings.flatMap((binding) =>
        binding.source.kind === "thread-entity"
          ? [graphRefKey(binding.source.reference)]
          : []
      )
    ),
  );
}

function correctionEvidenceKeysForPhase(
  snapshot: EngineeringProjectSnapshot,
  phase: EngineeringProjectPhase,
  correctionEvidenceKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(
    phaseOperations(snapshot, phase).flatMap((operation) =>
      operation.bindings.flatMap((binding) =>
        binding.source.kind === "thread-entity" &&
          correctionEvidenceKeys.has(graphRefKey(binding.source.reference))
          ? [graphRefKey(binding.source.reference)]
          : []
      )
    ),
  );
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

function phaseArtifactEvidenceKeys(
  snapshot: EngineeringProjectSnapshot,
  phase: EngineeringProjectPhase,
): ReadonlySet<string> {
  const workItems = phase.workItemIds.flatMap((id) => {
    const item = snapshot.workItems.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  });
  return new Set([
    ...phase.evidenceRefs,
    ...workItems.flatMap((item) => item.evidenceRefs),
  ].flatMap((reference) =>
    reference.kind === "artifact" ? [graphRefKey(reference)] : []
  ));
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
    identityRepairPhaseIds: new Set<string>(),
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
  const identityRepairs = [...lifecycle.identityRepairPhaseIds]
    .flatMap((id) => {
      const view = phaseById.get(id);
      return view ? [view] : [];
    })
    .toSorted((left, right) => left.phase.order - right.phase.order);
  const latestLifecycleRecord = [...revisions, ...identityRepairs]
    .toSorted((left, right) => left.phase.order - right.phase.order)
    .at(-1);
  const latestRun = latestLifecycleRecord
    ? latestRunForPhase(snapshot, latestLifecycleRecord.phase)
    : undefined;
  /**
   * "recomputing" promises that new evidence is on its way. Once the project
   * itself is completed nothing will ever recompute again, so an unfinished
   * lifecycle is shown as retained history instead of a perpetual promise.
   * A failed latest run keeps its attention signal even on a closed project.
   */
  const projectClosed = deriveEngineeringProjectStatus(snapshot) === "completed";
  const state = latestRun?.status === "failed"
    ? "attention"
    : !latestLifecycleRecord
    ? (projectClosed ? "retained" : "recomputing")
    : latestRun && isActiveRun(latestRun)
    ? "recomputing"
    : latestLifecycleRecord.status === "completed"
    ? "current"
    : (projectClosed ? "retained" : "recomputing");
  return {
    affectedComponentIds: [...lifecycle.affectedComponentIds].toSorted(),
    correctionCount: lifecycle.correctionEvidenceKeys.size,
    revisionAttemptCount: revisions.length,
    ...(identityRepairs.length > 0
      ? { identityRepairCount: identityRepairs.length }
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
      runRecordedAt(left).localeCompare(runRecordedAt(right)) ||
      left.id.localeCompare(right.id)
    )
    .at(-1);
}

function runRecordedAt(run: EngineeringAgentRun): string {
  return run.completedAt ?? run.startedAt ?? run.queuedAt;
}

function isActiveRun(run: EngineeringAgentRun): boolean {
  return run.status === "queued" || run.status === "running" ||
    run.status === "waiting-for-decision" || run.status === "publishing";
}

function lifecycleEffectivePhaseStatus(
  baseStatus: EngineeringPhaseStatus,
  lifecycle: ProjectPhaseLifecycle,
): EngineeringPhaseStatus {
  if (lifecycle.state === "attention") return "blocked";
  if (lifecycle.state === "recomputing") return "active";
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
  return "Planned";
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

  const workItem = snapshot.workItems.find((item) => item.id === run.workItemId);
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
