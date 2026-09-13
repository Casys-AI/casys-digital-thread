/**
 * Map existing requirements-brief traces and immutable Thread entities into
 * application-neutral project-response facts. No viewer package, MCP argument,
 * or provider is chosen here.
 */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  emptyProjectResponseEvidenceFacts,
  type ProjectResponseAvailableTraceFact,
  type ProjectResponseClauseResponseFact,
  type ProjectResponseClauseResponseFailure,
  type ProjectResponseEvidenceFacts,
  type ProjectResponseEvidenceReader,
  type ProjectResponseTraceFact,
} from "../../application/ports/out/project-response/project-response-evidence-reader.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import type {
  RequirementsBriefTraceHistoryDependencies,
} from "../record/requirements-brief-trace-history.ts";
import {
  projectRequirementsBriefTraces,
  type RequirementsBriefTraceCaptureReader,
  type RequirementsBriefTraceProjectHistory,
} from "./requirements-brief-trace-workbench.ts";
import type { EngineeringWorkbenchRequirementsBriefTrace } from "../../presentation/workbench/engineering/evidence.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  readDocumentaryClauseResponseHistory,
  type ReopenedDocumentaryClauseResponseRecord,
} from "../record/documentary-clause-response-history.ts";

export interface ThreadProjectResponseEvidenceReaderDependencies {
  readonly projects: Pick<
    EngineeringProjectRevisionStore,
    "get" | "getRevision"
  >;
  readonly snapshots?: Pick<ThreadSnapshotStore, "get">;
  readonly captures: RequirementsBriefTraceCaptureReader;
  readonly claimHistory?: RequirementsBriefTraceHistoryDependencies;
  readonly clauseResponses?: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
}

export class ThreadProjectResponseEvidenceReader
  implements ProjectResponseEvidenceReader {
  readonly #projects:
    & RequirementsBriefTraceProjectHistory
    & Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  readonly #snapshots:
    | ThreadProjectResponseEvidenceReaderDependencies["snapshots"]
    | undefined;
  readonly #captures: RequirementsBriefTraceCaptureReader;
  readonly #claimHistory: RequirementsBriefTraceHistoryDependencies | undefined;
  readonly #clauseResponses:
    | ThreadProjectResponseEvidenceReaderDependencies["clauseResponses"]
    | undefined;

  constructor(dependencies: ThreadProjectResponseEvidenceReaderDependencies) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#captures = dependencies.captures;
    this.#claimHistory = dependencies.claimHistory;
    this.#clauseResponses = dependencies.clauseResponses;
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
    const clause = await readClauseResponses({
      project: input.project,
      thread: input.thread,
      projects: this.#projects,
      snapshots: this.#snapshots,
      captures: this.#clauseResponses,
    });
    return {
      traces: traces.map(mapTrace),
      clauseResponses: clause.records,
      ...(clause.failure ? { clauseResponseFailure: clause.failure } : {}),
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

async function readClauseResponses(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly projects: Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get"> | undefined;
  readonly captures:
    | { read(fingerprint: ContentFingerprint): Promise<string | undefined> }
    | undefined;
}): Promise<{
  readonly records: readonly ProjectResponseClauseResponseFact[];
  readonly failure?: ProjectResponseClauseResponseFailure;
}> {
  if (!input.captures) return { records: [] };
  if (!input.snapshots) {
    return {
      records: [],
      failure: {
        status: "unavailable",
        code: "clause-response.unavailable",
        message:
          "Documentary clause-response history cannot be reopened without the exact Thread snapshot store.",
      },
    };
  }
  try {
    const history = await readDocumentaryClauseResponseHistory({
      project: input.project,
      thread: input.thread,
      dependencies: {
        captures: input.captures,
        projects: input.projects,
        snapshots: input.snapshots,
      },
    });
    const archived = archivedRefKeys(input.thread);
    return {
      records: history.flatMap((record) => {
        if (archived.has(`artifact:${record.artifact.id}`)) return [];
        return [mapClauseResponse(record)];
      }),
    };
  } catch (error) {
    return { records: [], failure: clauseResponseFailure(error) };
  }
}

function mapClauseResponse(
  record: ReopenedDocumentaryClauseResponseRecord,
): ProjectResponseClauseResponseFact {
  const { capture, reference } = record;
  return {
    artifactId: reference.artifactId,
    revision: capture.claim.revision,
    sourceItemId: capture.claim.sourceItemId,
    sourceBrief: {
      briefId: capture.briefBasis.briefId,
      snapshotId: capture.briefBasis.briefSnapshotId,
      revision: capture.briefBasis.briefRevision,
    },
    sourceItem: structuredClone(capture.sourceItem),
    recordingStatus: capture.recording.status,
    authorKind: capture.recording.authorKind,
    scope: capture.scope,
    answer: capture.answer,
    sourceRefs: capture.sources.map((source) =>
      source.kind === "agent-resource"
        ? { kind: "agent-resource", uri: source.resourceRef.uri }
        : { kind: "thread-artifact", artifactId: source.artifactId }
    ),
    ...(capture.claim.predecessor
      ? { predecessorArtifactId: capture.claim.predecessor.artifactId }
      : {}),
  };
}

function clauseResponseFailure(
  error: unknown,
): ProjectResponseClauseResponseFailure {
  const message = error instanceof Error ? error.message : String(error);
  const unresolved =
    /split head|predecessor|previous version|initial version|cycle|retired/i
      .test(message);
  return {
    status: unresolved ? "unresolved" : "unavailable",
    code: unresolved ? "clause-response.unresolved" : "clause-response.unavailable",
    message,
  };
}

function threadFacts(thread: ThreadSnapshot): Omit<
  ProjectResponseEvidenceFacts,
  "traces" | "clauseResponses" | "clauseResponseFailure"
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
