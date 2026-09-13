/** Server-owned, read-only compilation of a documentary clause-response MRTR. */
import type {
  ProjectDocumentaryClauseResponseReviewCommand,
  ProjectDocumentaryClauseResponseReviewResult,
  ProjectDocumentaryClauseResponseReviewSourceRef,
  ProjectDocumentaryClauseResponseReviewUseCase,
} from "../../application/ports/in/record/project-documentary-clause-response-review.ts";
import { approvedBriefBasisForProject } from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  closedRecord,
  exactRecord,
  nonEmptyText,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { selectCurrentThreadTip } from "../../domain/project/thread-tip.ts";
import {
  assertUniqueThreadArtifactSources,
  DOCUMENTARY_CLAUSE_RESPONSE_ANSWER_MAX,
  DOCUMENTARY_CLAUSE_RESPONSE_SCOPE_MAX,
  DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX,
  documentaryClauseResponseClaimId,
  documentaryClauseResponseItemFingerprint,
  documentaryClauseResponseParameters,
  type DocumentaryClauseResponseSource,
  RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
} from "../../domain/record/documentary-clause-response.ts";
import { parseAgentResourceReference } from "../../domain/resource/agent-resource-reference.ts";
import {
  archivedRefKeys,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  readDocumentaryClauseResponseHistory,
  selectDocumentaryClauseResponseHead,
} from "./documentary-clause-response-history.ts";
import {
  type DocumentaryClauseResponseInputDependencies,
  resolveDocumentaryClauseResponseInputs,
} from "./documentary-clause-response-inputs.ts";

export class PrepareProjectDocumentaryClauseResponseReview
  implements ProjectDocumentaryClauseResponseReviewUseCase {
  constructor(private readonly d: DocumentaryClauseResponseInputDependencies) {}

  async execute(
    value: unknown,
  ): Promise<ProjectDocumentaryClauseResponseReviewResult> {
    try {
      const command = parseCommand(value);
      const project = await this.d.projects.get(command.projectId);
      if (!project) throw new TypeError("The engineering project is unavailable.");
      const tip = selectCurrentThreadTip(project.threadSnapshots);
      if (tip.status !== "ok") throw new TypeError(tip.diagnostic.message);
      const base = await this.d.snapshots.get(tip.basis.snapshotId);
      if (
        !base || base.id !== tip.basis.snapshotId ||
        base.revision !== tip.basis.revision ||
        base.subject.id !== tip.basis.subjectId
      ) {
        throw new TypeError(
          "The unique current Thread snapshot cannot be reopened exactly.",
        );
      }
      const briefBasis = approvedBriefBasisForProject(project);
      const brief = project.framing?.currentBrief;
      const sourceItem = brief?.items.find((item) => item.id === command.sourceItemId);
      if (!brief || !sourceItem) {
        throw new TypeError(
          "The named item is absent from the current human-approved brief.",
        );
      }
      const claimId = await documentaryClauseResponseClaimId(
        project.project.id,
        sourceItem.id,
      );
      const history = await readDocumentaryClauseResponseHistory({
        project,
        thread: base,
        dependencies: this.d,
      });
      const previous = selectDocumentaryClauseResponseHead(history, base, claimId);
      const sources = reopenDeclaredSources(command.sourceRefs, base);
      assertUniqueThreadArtifactSources(sources, previous?.reference.artifactId);
      const proposal = {
        sourceItemId: sourceItem.id,
        answer: command.answer,
        scope: command.scope,
        briefBasis,
        itemKind: sourceItem.kind,
        itemFingerprint: await documentaryClauseResponseItemFingerprint(sourceItem),
        sources,
        ...(previous ? { predecessor: previous.reference } : {}),
      };
      const inputs = await resolveDocumentaryClauseResponseInputs({
        project,
        base,
        proposal,
        dependencies: this.d,
        mode: "current",
      });
      return {
        status: "resolved",
        operation: RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
        briefBasis: inputs.briefBasis,
        baseSnapshot: tip.basis,
        inputEvidenceRefs: [],
        decisionParameters: documentaryClauseResponseParameters(proposal),
        diagnostics: [],
      };
    } catch (error) {
      return {
        status: "unresolved",
        diagnostics: [{
          code: "source-unresolved",
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }
}

function parseCommand(
  value: unknown,
): ProjectDocumentaryClauseResponseReviewCommand {
  const root = exactRecord(value, [
    "projectId",
    "sourceItemId",
    "answer",
    "scope",
    "sourceRefs",
  ], "$clauseResponseReview");
  return {
    projectId: safeId(root.projectId, "$clauseResponseReview.projectId"),
    sourceItemId: safeId(root.sourceItemId, "$clauseResponseReview.sourceItemId"),
    answer: bounded(
      nonEmptyText(root.answer, "$clauseResponseReview.answer"),
      DOCUMENTARY_CLAUSE_RESPONSE_ANSWER_MAX,
      "$clauseResponseReview.answer",
    ),
    scope: bounded(
      nonEmptyText(root.scope, "$clauseResponseReview.scope"),
      DOCUMENTARY_CLAUSE_RESPONSE_SCOPE_MAX,
      "$clauseResponseReview.scope",
    ),
    sourceRefs: parseSourceRefs(root.sourceRefs),
  };
}

function parseSourceRefs(
  value: unknown,
): readonly ProjectDocumentaryClauseResponseReviewSourceRef[] {
  if (!Array.isArray(value)) {
    throw new TypeError("$clauseResponseReview.sourceRefs must be an array.");
  }
  if (
    value.length < 1 || value.length > DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX
  ) {
    throw new TypeError(
      `$clauseResponseReview.sourceRefs must contain 1 to ${DOCUMENTARY_CLAUSE_RESPONSE_SOURCE_MAX} sources.`,
    );
  }
  const refs = value.map((entry, index) => {
    const path = `$clauseResponseReview.sourceRefs[${index}]`;
    const root = closedRecord(
      entry,
      ["kind", "resourceRef", "artifactId"],
      ["kind"],
      path,
    );
    if (root.kind === "agent-resource") {
      if (root.artifactId !== undefined) {
        throw new TypeError(`${path} agent-resource must not name artifactId.`);
      }
      parseAgentResourceReference(root.resourceRef, `${path}.resourceRef`);
      return { kind: "agent-resource" as const, resourceRef: root.resourceRef };
    }
    if (root.kind === "thread-artifact") {
      if (root.resourceRef !== undefined) {
        throw new TypeError(`${path} thread-artifact must not carry resourceRef.`);
      }
      return {
        kind: "thread-artifact" as const,
        artifactId: safeId(root.artifactId, `${path}.artifactId`),
      };
    }
    throw new TypeError(`${path}.kind must be agent-resource or thread-artifact.`);
  });
  const artifactIds = refs.flatMap((ref) =>
    ref.kind === "thread-artifact" ? [ref.artifactId] : []
  );
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new TypeError(
      "Documentary clause-response Thread artifact sources must be unique.",
    );
  }
  return refs;
}

function reopenDeclaredSources(
  refs: readonly ProjectDocumentaryClauseResponseReviewSourceRef[],
  base: ThreadSnapshot,
): DocumentaryClauseResponseSource[] {
  const archived = archivedRefKeys(base);
  return refs.map((ref) => {
    if (ref.kind === "agent-resource") {
      return {
        kind: "agent-resource" as const,
        resourceRef: parseAgentResourceReference(ref.resourceRef),
      };
    }
    const matches = base.artifacts.filter((artifact) =>
      artifact.id === ref.artifactId && !archived.has(`artifact:${artifact.id}`)
    );
    if (matches.length !== 1) {
      throw new TypeError(
        `Thread artifact ${ref.artifactId} is absent, archived, or ambiguous on this basis.`,
      );
    }
    const artifact = matches[0]!;
    return {
      kind: "thread-artifact" as const,
      artifactId: artifact.id,
      fingerprint: artifact.fingerprint,
      producerRunId: artifact.producer.runId,
    };
  });
}

function bounded(value: string, max: number, path: string): string {
  if (value.length > max) {
    throw new TypeError(`${path} must be at most ${max} characters.`);
  }
  return value;
}
