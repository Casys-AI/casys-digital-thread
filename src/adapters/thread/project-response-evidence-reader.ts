/**
 * Map existing requirements-brief traces and immutable Thread entities into
 * application-neutral project-response facts. No viewer package, MCP argument,
 * or provider is chosen here.
 */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  emptyProjectResponseEvidenceFacts,
  type ProjectResponseAvailableTraceFact,
  type ProjectResponseEvidenceFacts,
  type ProjectResponseEvidenceReader,
  type ProjectResponseTraceFact,
} from "../../application/ports/out/project-response/project-response-evidence-reader.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type {
  RequirementsBriefTraceHistoryDependencies,
} from "../record/requirements-brief-trace-history.ts";
import {
  projectRequirementsBriefTraces,
  type RequirementsBriefTraceCaptureReader,
  type RequirementsBriefTraceProjectHistory,
} from "./requirements-brief-trace-workbench.ts";
import type { EngineeringWorkbenchRequirementsBriefTrace } from "../../presentation/workbench/engineering/evidence.ts";

export interface ThreadProjectResponseEvidenceReaderDependencies {
  readonly projects: Pick<
    EngineeringProjectRevisionStore,
    "get" | "getRevision"
  >;
  readonly captures: RequirementsBriefTraceCaptureReader;
  readonly claimHistory?: RequirementsBriefTraceHistoryDependencies;
}

export class ThreadProjectResponseEvidenceReader
  implements ProjectResponseEvidenceReader {
  readonly #projects: RequirementsBriefTraceProjectHistory;
  readonly #captures: RequirementsBriefTraceCaptureReader;
  readonly #claimHistory: RequirementsBriefTraceHistoryDependencies | undefined;

  constructor(dependencies: ThreadProjectResponseEvidenceReaderDependencies) {
    this.#projects = dependencies.projects;
    this.#captures = dependencies.captures;
    this.#claimHistory = dependencies.claimHistory;
  }

  async read(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly thread?: ThreadSnapshot;
  }): Promise<ProjectResponseEvidenceFacts> {
    if (!input.thread) return emptyProjectResponseEvidenceFacts();
    const traces = await projectRequirementsBriefTraces({
      project: input.project,
      thread: input.thread,
      projects: this.#projects,
      captures: this.#captures,
      claimHistory: this.#claimHistory,
    });
    return {
      traces: traces.map(mapTrace),
      ...threadFacts(input.thread),
    };
  }
}

function mapTrace(
  trace: EngineeringWorkbenchRequirementsBriefTrace,
): ProjectResponseTraceFact {
  if (trace.status === "TRACE GAP") {
    return {
      status: "TRACE GAP",
      artifactId: trace.artifactId,
      threadRequirementIds: [...trace.threadRequirementIds],
    };
  }
  const declaration = trace.declaration;
  const mapped: ProjectResponseAvailableTraceFact = {
    status: "available",
    artifactId: trace.artifactId,
    threadRequirementIds: [...trace.threadRequirementIds],
    origin: declaration ? "documentary" : "native",
    sourceBrief: {
      briefId: trace.originalBrief.briefId,
      snapshotId: trace.originalBrief.snapshotId,
      revision: trace.originalBrief.revision,
    },
    requirementsArtifactId: declaration?.requirementsArtifactId ??
      trace.artifactId,
    ...(declaration
      ? {
        declaration: {
          kind: "retrospective-documentary",
          linkedAt: declaration.linkedAt,
          artifactId: declaration.artifactId,
          requirementsArtifactId: declaration.requirementsArtifactId,
          claimId: declaration.claimId,
          revision: declaration.revision,
        },
      }
      : {}),
    requirements: trace.requirements.map((requirement) => ({
      threadRequirementId: requirement.threadRequirementId,
      requirementId: requirement.requirementId,
      sourceItemId: requirement.sourceItemId,
      sourceState: requirement.state,
    })),
  };
  return mapped;
}

function threadFacts(thread: ThreadSnapshot): Omit<
  ProjectResponseEvidenceFacts,
  "traces"
> {
  return {
    requirements: thread.requirements.map((requirement) => ({
      id: requirement.id,
      sourceArtifactId: requirement.trace.sourceArtifactId,
      freshness: structuredClone(requirement.freshness),
    })),
    evaluations: thread.evaluations.map((evaluation) => ({
      id: evaluation.id,
      requirementId: evaluation.requirementId,
      status: evaluation.status,
      observationIds: [...evaluation.observationIds],
      evidenceArtifactIds: [...evaluation.evidenceArtifactIds],
      evaluatedAt: evaluation.evaluatedAt,
      freshness: structuredClone(evaluation.freshness),
    })),
    observations: thread.observations.map((observation) => ({
      id: observation.id,
      sourceArtifactIds: [...observation.source.artifactIds],
      freshness: structuredClone(observation.freshness),
    })),
    artifacts: thread.artifacts.map((artifact) => ({
      id: artifact.id,
      freshness: structuredClone(artifact.freshness),
      consumptionMismatch: thread.consumptions.some((consumption) =>
        consumption.status === "mismatch" &&
        consumption.consumer.serverId === artifact.producer.serverId &&
        consumption.consumer.tool === artifact.producer.tool &&
        consumption.consumer.runId === artifact.producer.runId &&
        artifact.inputArtifactIds.includes(consumption.artifactId)
      ),
    })),
    archivedRefKeys: [...archivedRefKeys(thread)].toSorted((left, right) =>
      left.localeCompare(right)
    ),
  };
}
