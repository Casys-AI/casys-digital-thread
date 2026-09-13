/**
 * Server-owned exhaustive index of the current human-approved brief.
 *
 * Joins exact requirement traces and Thread evaluations. It never infers
 * clause satisfaction, coverage, manufacturing mapping, or a solver
 * obligation for assumptions, exclusions, or open questions.
 */

import type {
  ProjectResponseProjectionQuery,
  ProjectResponseReadQuery,
  ProjectResponseUseCase,
} from "../../ports/in/project-response/project-response.ts";
import {
  PROJECT_RESPONSE_SCHEMA,
  type ProjectResponseApplicability,
  projectResponseBasesEqual,
  type ProjectResponseBasis,
  type ProjectResponseClauseResponse,
  type ProjectResponseClauseSourceRef,
  type ProjectResponseCorrespondence,
  type ProjectResponseDiagnostic,
  type ProjectResponseGap,
  type ProjectResponseItem,
  type ProjectResponseReadModel,
  type ProjectResponseRequirementEvaluation,
  type ProjectResponseRequirementEvidence,
  unavailableProjectResponse,
} from "../../../domain/project/project-response.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import type {
  ProjectResponseAvailableTraceFact,
  ProjectResponseClauseResponseFact,
  ProjectResponseEvidenceFacts,
  ProjectResponseEvidenceReader,
  ProjectResponseThreadArtifactFact,
  ProjectResponseThreadEvaluationFact,
  ProjectResponseThreadObservationFact,
  ProjectResponseThreadRequirementFact,
} from "../../ports/out/project-response/project-response-evidence-reader.ts";
import { approvedBriefBasisForProject } from "../project/engineering-project-command-service.ts";
import { deepFreeze } from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import {
  isProjectBriefGateKind,
  type ProjectBriefItem,
  type ProjectBriefRevision,
} from "../../../domain/project/project-brief.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";

export interface ReadProjectResponseDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly evidence: ProjectResponseEvidenceReader;
}

interface IndexedEvidence {
  readonly traces: readonly ProjectResponseAvailableTraceFact[];
  readonly clauseResponses: readonly ProjectResponseClauseResponseFact[];
  readonly gapTraces: readonly { artifactId: string }[];
  readonly requirements: ReadonlyMap<string, ProjectResponseThreadRequirementFact>;
  readonly evaluations: ReadonlyMap<string, ProjectResponseThreadEvaluationFact[]>;
  readonly observations: ReadonlyMap<string, ProjectResponseThreadObservationFact>;
  readonly artifacts: ReadonlyMap<string, ProjectResponseThreadArtifactFact>;
}

export class ReadProjectResponse implements ProjectResponseUseCase {
  readonly #projects: ReadProjectResponseDependencies["projects"];
  readonly #snapshots: ReadProjectResponseDependencies["snapshots"];
  readonly #evidence: ProjectResponseEvidenceReader;

  constructor(dependencies: ReadProjectResponseDependencies) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#evidence = dependencies.evidence;
  }

  async read(query: ProjectResponseReadQuery): Promise<ProjectResponseReadModel> {
    const projectId = query.projectId;
    if (
      !projectId || projectId !== projectId.trim() ||
      projectId.toLowerCase() === "latest"
    ) {
      return unavailableProjectResponse({
        diagnostics: [diagnostic(
          "basis.unavailable",
          "The project identity is missing or uses a latest alias.",
        )],
      });
    }
    const project = await this.#projects.get(projectId);
    if (!project || project.project.id !== projectId) {
      return unavailableProjectResponse({
        diagnostics: [diagnostic(
          "basis.unavailable",
          `Project ${projectId} is unavailable.`,
        )],
      });
    }

    const extraDiagnostics: ProjectResponseDiagnostic[] = [];
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    let thread: ThreadSnapshot | undefined;
    if (tip.status === "ok") {
      const snapshot = await this.#snapshots.get(tip.basis.snapshotId);
      if (
        snapshot &&
        snapshot.id !== "latest" &&
        snapshot.id === tip.basis.snapshotId &&
        snapshot.revision === tip.basis.revision &&
        snapshot.subject.id === tip.basis.subjectId
      ) {
        thread = snapshot;
      } else {
        extraDiagnostics.push(diagnostic(
          "thread.unavailable",
          "The current Thread tip cannot be reread as the named snapshot.",
        ));
      }
    } else if (tip.diagnostic.code === "basis-ambiguous") {
      extraDiagnostics.push(diagnostic(
        "thread.unresolved",
        tip.diagnostic.message,
      ));
    }

    const result = await this.compose(project, thread, extraDiagnostics);
    if (query.expectedBasis === undefined) return result;
    if (result.basis && projectResponseBasesEqual(query.expectedBasis, result.basis)) {
      return result;
    }
    return unavailableProjectResponse({
      basis: result.basis,
      diagnostics: [
        diagnostic(
          "basis.stale",
          "The expected project-response basis does not match the current readable basis.",
        ),
        ...result.diagnostics.filter((item) => item.code !== "thread.absent"),
      ],
    });
  }

  async project(
    query: ProjectResponseProjectionQuery,
  ): Promise<ProjectResponseReadModel> {
    const extraDiagnostics: ProjectResponseDiagnostic[] = [];
    let thread = query.thread;
    if (thread) {
      const bound = boundSnapshot(query.project, thread);
      if (!bound) {
        extraDiagnostics.push(diagnostic(
          "thread.unbound",
          "The supplied Thread is not the exact snapshot listed on this project revision.",
        ));
        thread = undefined;
      } else {
        thread = bound;
      }
    } else {
      const tip = selectCurrentThreadTip(query.project.threadSnapshots);
      if (tip.status === "ok") {
        extraDiagnostics.push(diagnostic(
          "thread.unavailable",
          "The declared Thread tip is absent from this resolved projection.",
        ));
      } else if (tip.diagnostic.code === "basis-ambiguous") {
        extraDiagnostics.push(diagnostic(
          "thread.unresolved",
          tip.diagnostic.message,
        ));
      }
    }
    return await this.compose(query.project, thread, extraDiagnostics);
  }

  private async compose(
    project: EngineeringProjectSnapshot,
    thread: ThreadSnapshot | undefined,
    extraDiagnostics: readonly ProjectResponseDiagnostic[],
  ): Promise<ProjectResponseReadModel> {
    const approved = currentApprovedBrief(project);
    if (!approved) {
      return unavailableProjectResponse({
        status: extraDiagnostics.some((item) => item.code === "thread.unbound")
          ? "unresolved"
          : "unavailable",
        diagnostics: [
          diagnostic(
            "brief.unavailable",
            "The project has no exact human-approved canonical brief.",
          ),
          ...extraDiagnostics,
        ],
      });
    }

    const facts = await this.#evidence.read({ project, thread });
    const failure = facts.clauseResponseFailure;
    const evidenceDiagnostics = [
      ...extraDiagnostics,
      ...(failure ? [diagnostic(failure.code, failure.message)] : []),
    ];
    const indexed = indexFacts(facts);
    const items = approved.brief.items.map((item) =>
      projectItem(item, approved.brief, indexed, thread === undefined)
    );
    const retained = retainedClauseDiagnostics(approved.brief, indexed);
    const diagnostics = [
      ...evidenceDiagnostics,
      ...traceGapDiagnostics(indexed.gapTraces),
      ...retained,
      ...(thread || evidenceDiagnostics.length > 0 ? [] : [diagnostic(
        "thread.absent",
        "No Thread snapshot is bound to this approved brief; items list missing-evidence gaps.",
      )]),
    ];
    const basis = responseBasis(project, approved.brief, thread);
    const status =
      evidenceDiagnostics.some((item) =>
          item.code === "thread.unresolved" ||
          item.code === "thread.unbound" ||
          item.code === "clause-response.unresolved"
        )
        ? "unresolved"
        : evidenceDiagnostics.some((item) =>
            item.code === "thread.unavailable" ||
            item.code === "clause-response.unavailable"
          )
        ? "unavailable"
        : "available";
    return deepFreeze({
      schemaVersion: PROJECT_RESPONSE_SCHEMA,
      status,
      basis,
      items,
      diagnostics,
      grants: "none",
    });
  }
}

function currentApprovedBrief(
  project: EngineeringProjectSnapshot,
): { readonly brief: ProjectBriefRevision } | undefined {
  try {
    approvedBriefBasisForProject(project);
  } catch {
    return undefined;
  }
  const brief = project.framing?.currentBrief;
  return brief ? { brief } : undefined;
}

function responseBasis(
  project: EngineeringProjectSnapshot,
  brief: ProjectBriefRevision,
  thread: ThreadSnapshot | undefined,
): ProjectResponseBasis {
  return {
    projectId: project.project.id,
    projectRevision: project.revision,
    brief: {
      briefId: brief.briefId,
      snapshotId: brief.id,
      revision: brief.revision,
    },
    ...(thread
      ? {
        thread: {
          snapshotId: thread.id,
          revision: thread.revision,
          subjectId: thread.subject.id,
        },
      }
      : {}),
  };
}

function boundSnapshot(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
): ThreadSnapshot | undefined {
  if (
    snapshot.id === "latest" ||
    snapshot.subject.id !== project.project.subjectId
  ) {
    return undefined;
  }
  const listed = project.threadSnapshots.some((item) =>
    item.snapshotId === snapshot.id &&
    item.revision === snapshot.revision &&
    item.subjectId === snapshot.subject.id
  );
  return listed ? snapshot : undefined;
}

function indexFacts(facts: ProjectResponseEvidenceFacts): IndexedEvidence {
  const archived = new Set(facts.archivedRefKeys);
  const live = (kind: string, id: string) => !archived.has(`${kind}:${id}`);
  const evaluations = new Map<string, ProjectResponseThreadEvaluationFact[]>();
  for (const evaluation of facts.evaluations) {
    if (!live("evaluation", evaluation.id)) continue;
    const group = evaluations.get(evaluation.requirementId) ?? [];
    group.push(evaluation);
    evaluations.set(evaluation.requirementId, group);
  }
  for (const group of evaluations.values()) {
    group.sort((left, right) =>
      left.evaluatedAt.localeCompare(right.evaluatedAt) ||
      left.id.localeCompare(right.id)
    );
  }
  return {
    traces: facts.traces.filter((trace) => trace.status === "available"),
    clauseResponses: facts.clauseResponseFailure ? [] : facts.clauseResponses,
    gapTraces: facts.traces.filter((trace) => trace.status === "TRACE GAP").map(
      (trace) => ({ artifactId: trace.artifactId }),
    ),
    requirements: new Map(
      facts.requirements.filter((item) => live("requirement", item.id)).map((
        item,
      ) => [item.id, item]),
    ),
    evaluations,
    observations: new Map(
      facts.observations.filter((item) => live("observation", item.id)).map((
        item,
      ) => [item.id, item]),
    ),
    artifacts: new Map(
      facts.artifacts.filter((item) => live("artifact", item.id)).map((
        item,
      ) => [item.id, item]),
    ),
  };
}

function projectItem(
  item: ProjectBriefItem,
  brief: ProjectBriefRevision,
  facts: IndexedEvidence,
  threadAbsent: boolean,
): ProjectResponseItem {
  const candidates = tracesForItem(item.id, facts.traces);
  const projected = candidates.flatMap((trace) =>
    trace.requirements.filter((entry) => entry.sourceItemId === item.id).map(
      (entry) => projectRequirement(item, brief, trace, entry, facts),
    )
  );
  const requirements = projected.map((entry) => entry.requirement)
    .toSorted((left, right) =>
      left.threadRequirementId.localeCompare(right.threadRequirementId) ||
      left.traceArtifactId.localeCompare(right.traceArtifactId)
    );
  const correspondence = itemCorrespondence(candidates);
  const clauseResponses = projectClauseResponses(item, brief, facts);
  const gaps = itemGaps({
    item,
    candidates,
    requirements,
    clauseResponses,
    evaluationIssues: projected.flatMap((entry) => entry.issues),
    threadAbsent,
  });
  return {
    item: structuredClone(item),
    correspondence,
    requirements,
    clauseResponses,
    gaps,
  };
}

function projectClauseResponses(
  item: ProjectBriefItem,
  brief: ProjectBriefRevision,
  facts: IndexedEvidence,
): readonly ProjectResponseClauseResponse[] {
  const superseded = new Set(
    facts.clauseResponses.flatMap((record) =>
      record.predecessorArtifactId ? [record.predecessorArtifactId] : []
    ),
  );
  return facts.clauseResponses
    .filter((record) => record.sourceItemId === item.id)
    .map((record) => {
      const current = record.sourceBrief.briefId === brief.briefId &&
        record.sourceBrief.snapshotId === brief.id &&
        record.sourceBrief.revision === brief.revision;
      const sameItem = deterministicJson(record.sourceItem) ===
        deterministicJson(item);
      return {
        artifactId: record.artifactId,
        revision: record.revision,
        sourceItemId: record.sourceItemId,
        sourceBrief: { ...record.sourceBrief },
        sourceState: sameItem ? "unchanged" as const : "changed" as const,
        applicability: current && sameItem && !superseded.has(record.artifactId)
          ? "current" as const
          : "historical" as const,
        recordingStatus: record.recordingStatus,
        authorKind: record.authorKind,
        scope: record.scope,
        answer: record.answer,
        sourceRefs: record.sourceRefs.map(
          (ref): ProjectResponseClauseSourceRef =>
            ref.kind === "agent-resource"
              ? { kind: "agent-resource", uri: ref.uri }
              : { kind: "thread-artifact", artifactId: ref.artifactId },
        ),
        ...(record.predecessorArtifactId
          ? { predecessorArtifactId: record.predecessorArtifactId }
          : {}),
      };
    })
    .toSorted((left, right) =>
      left.revision - right.revision ||
      left.artifactId.localeCompare(right.artifactId)
    );
}

function retainedClauseDiagnostics(
  brief: ProjectBriefRevision,
  facts: IndexedEvidence,
): readonly ProjectResponseDiagnostic[] {
  const currentIds = new Set(brief.items.map((item) => item.id));
  return facts.clauseResponses
    .filter((record) => !currentIds.has(record.sourceItemId))
    .map((record) =>
      diagnostic(
        "clause-response.removed-item",
        `Historical documentary clause-response ${record.artifactId} for removed item ${record.sourceItemId} is retained and is not current.`,
      )
    );
}

function tracesForItem(
  itemId: string,
  traces: readonly ProjectResponseAvailableTraceFact[],
): readonly ProjectResponseAvailableTraceFact[] {
  return traces.filter((trace) =>
    trace.requirements.some((entry) => entry.sourceItemId === itemId)
  );
}

function itemCorrespondence(
  candidates: readonly ProjectResponseAvailableTraceFact[],
): ProjectResponseCorrespondence {
  if (candidates.length === 0) return "unresolved";
  if (candidates.length > 1) return "unresolved";
  return candidates[0]!.origin;
}

function projectRequirement(
  item: ProjectBriefItem,
  brief: ProjectBriefRevision,
  trace: ProjectResponseAvailableTraceFact,
  entry: ProjectResponseAvailableTraceFact["requirements"][number],
  facts: IndexedEvidence,
): {
  readonly requirement: ProjectResponseRequirementEvidence;
  readonly issues: readonly string[];
} {
  const applicability = clauseApplicability(trace, item, brief);
  const liveRequirement = facts.requirements.get(entry.threadRequirementId);
  const projected = liveRequirement === undefined
    ? []
    : (facts.evaluations.get(entry.threadRequirementId) ?? [])
      .filter((evaluation) => evaluation.requirementId === entry.threadRequirementId)
      .map((evaluation) =>
        projectEvaluation(evaluation, applicability, liveRequirement, facts)
      );
  return {
    requirement: {
      threadRequirementId: entry.threadRequirementId,
      requirementsArtifactId: trace.requirementsArtifactId,
      traceArtifactId: trace.artifactId,
      origin: trace.origin,
      sourceBrief: { ...trace.sourceBrief },
      sourceItemId: entry.sourceItemId,
      sourceState: entry.sourceState,
      applicability,
      evaluations: projected.map((item) => item.evaluation),
    },
    issues: projected.flatMap((item) => item.issues),
  };
}

function clauseApplicability(
  trace: ProjectResponseAvailableTraceFact,
  item: ProjectBriefItem,
  brief: ProjectBriefRevision,
): ProjectResponseApplicability {
  if (trace.requirements.every((entry) => entry.sourceItemId !== item.id)) {
    return "unresolved";
  }
  const current = trace.sourceBrief.briefId === brief.briefId &&
    trace.sourceBrief.snapshotId === brief.id &&
    trace.sourceBrief.revision === brief.revision;
  return current ? "current" : "historical";
}

function projectEvaluation(
  evaluation: ProjectResponseThreadEvaluationFact,
  requirementApplicability: ProjectResponseApplicability,
  requirement: ProjectResponseThreadRequirementFact,
  facts: IndexedEvidence,
): {
  readonly evaluation: ProjectResponseRequirementEvaluation;
  readonly issues: readonly string[];
} {
  const judged = judgeEvaluation(
    evaluation,
    requirementApplicability,
    requirement,
    facts,
  );
  return {
    evaluation: {
      evaluationId: evaluation.id,
      status: evaluation.status,
      applicability: judged.applicability,
      observationIds: [...evaluation.observationIds],
      evidenceArtifactIds: [...evaluation.evidenceArtifactIds],
      evaluatedAt: evaluation.evaluatedAt,
      freshness: structuredClone(evaluation.freshness),
    },
    issues: judged.issues,
  };
}

function judgeEvaluation(
  evaluation: ProjectResponseThreadEvaluationFact,
  requirementApplicability: ProjectResponseApplicability,
  requirement: ProjectResponseThreadRequirementFact,
  facts: IndexedEvidence,
): {
  readonly applicability: ProjectResponseApplicability;
  readonly issues: readonly string[];
} {
  const issues: string[] = [];
  if (requirement.freshness.status !== "fresh") {
    issues.push("evaluation.requirement-stale");
  }
  const sourceArtifact = facts.artifacts.get(requirement.sourceArtifactId);
  if (!sourceArtifact) {
    issues.push("evaluation.artifact-missing");
  } else if (effectiveArtifactStatus(sourceArtifact) !== "fresh") {
    issues.push("evaluation.artifact-stale");
  }
  for (const observationId of evaluation.observationIds) {
    const observation = facts.observations.get(observationId);
    if (!observation) {
      issues.push("evaluation.observation-missing");
      continue;
    }
    if (observation.freshness.status !== "fresh") {
      issues.push("evaluation.observation-stale");
    }
    for (const artifactId of observation.sourceArtifactIds) {
      const source = facts.artifacts.get(artifactId);
      if (!source) {
        issues.push("evaluation.artifact-missing");
        continue;
      }
      if (effectiveArtifactStatus(source) !== "fresh") {
        issues.push("evaluation.artifact-stale");
      }
    }
  }
  for (const artifactId of evaluation.evidenceArtifactIds) {
    const artifact = facts.artifacts.get(artifactId);
    if (!artifact) {
      issues.push("evaluation.artifact-missing");
      continue;
    }
    if (effectiveArtifactStatus(artifact) !== "fresh") {
      issues.push("evaluation.artifact-stale");
    }
  }
  if (evaluation.freshness.status !== "fresh") {
    issues.push("evaluation.stale");
  }
  const unique = [...new Set(issues)];
  if (
    unique.includes("evaluation.observation-missing") ||
    unique.includes("evaluation.artifact-missing")
  ) {
    return { applicability: "unresolved", issues: unique };
  }
  if (
    requirementApplicability !== "current" ||
    unique.includes("evaluation.observation-stale") ||
    unique.includes("evaluation.artifact-stale") ||
    unique.includes("evaluation.requirement-stale") ||
    unique.includes("evaluation.stale")
  ) {
    return {
      applicability: requirementApplicability === "unresolved"
        ? "unresolved"
        : "historical",
      issues: unique,
    };
  }
  return { applicability: "current", issues: unique };
}

function effectiveArtifactStatus(
  artifact: ProjectResponseThreadArtifactFact,
): ThreadFreshnessStatus {
  return artifact.consumptionMismatch ? "stale" : artifact.freshness.status;
}

type ThreadFreshnessStatus = ProjectResponseThreadArtifactFact["freshness"]["status"];

function itemGaps(input: {
  readonly item: ProjectBriefItem;
  readonly candidates: readonly ProjectResponseAvailableTraceFact[];
  readonly requirements: readonly ProjectResponseRequirementEvidence[];
  readonly clauseResponses: readonly ProjectResponseClauseResponse[];
  readonly evaluationIssues: readonly string[];
  readonly threadAbsent: boolean;
}): readonly ProjectResponseGap[] {
  const gaps: ProjectResponseGap[] = [];
  if (input.threadAbsent) {
    gaps.push(gap(
      "evidence.missing",
      `Item ${input.item.id} has no Thread evidence on this basis.`,
    ));
  }
  if (input.candidates.length === 0 && !input.threadAbsent) {
    gaps.push(gap(
      "correspondence.missing",
      `Item ${input.item.id} has no exact requirements-brief correspondence.`,
    ));
  }
  if (input.candidates.length > 1) {
    gaps.push(gap(
      "correspondence.ambiguous",
      `Item ${input.item.id} has ${input.candidates.length} exact mapping candidates.`,
    ));
  }
  if (
    input.item.kind === "manufacturing-evidence" &&
    input.candidates.length === 0
  ) {
    gaps.push(gap(
      "mapping.missing",
      `Manufacturing-evidence item ${input.item.id} has no exact persisted clause mapping.`,
    ));
  }
  if (
    isProjectBriefGateKind(input.item.kind) &&
    input.requirements.length > 0 &&
    input.requirements.some((requirement) => requirement.evaluations.length === 0)
  ) {
    gaps.push(gap(
      "evaluation.missing",
      `Item ${input.item.id} has at least one exactly mapped requirement without a recorded evaluation.`,
    ));
  }
  if (
    isProjectBriefGateKind(input.item.kind) &&
    input.clauseResponses.some((record) => record.applicability === "current") &&
    !input.requirements.some((requirement) =>
      requirement.evaluations.some((evaluation) =>
        evaluation.applicability === "current" && evaluation.status === "pass"
      )
    )
  ) {
    gaps.push(gap(
      "clause-response.not-proof",
      `Documentary clause-response for ${input.item.id} does not satisfy this verification clause; exact applicable proof is still required.`,
    ));
  }
  for (const code of unique(input.evaluationIssues)) {
    gaps.push(gap(
      code,
      `Item ${input.item.id} evaluation is not currently applicable (${code}).`,
    ));
  }
  return gaps;
}

function traceGapDiagnostics(
  traces: readonly { artifactId: string }[],
): readonly ProjectResponseDiagnostic[] {
  return traces.map((trace) =>
    diagnostic(
      "correspondence.trace-gap",
      `Requirements capture ${trace.artifactId} is TRACE GAP; it has no exact source item identity.`,
    )
  );
}

function diagnostic(code: string, message: string): ProjectResponseDiagnostic {
  return { code, message };
}

function gap(code: string, message: string): ProjectResponseGap {
  return { code, message };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
