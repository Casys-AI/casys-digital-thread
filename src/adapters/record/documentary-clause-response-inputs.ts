/** Exact source reopening for documentary clause-response records. */
import type { ReopenAgentResource } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  assertUniqueThreadArtifactSources,
  documentaryClauseResponseClaimId,
  documentaryClauseResponseItemFingerprint,
  type DocumentaryClauseResponseProposal,
  type DocumentaryClauseResponseSource,
} from "../../domain/record/documentary-clause-response.ts";
import { parseAgentResourceReference } from "../../domain/resource/agent-resource-reference.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { assertThreadSnapshotLineageIntact } from "../shared/stores/thread-snapshot-lineage.ts";
import { reopenSignedApprovedBrief } from "./documentary-clause-response-brief.ts";
import {
  type DocumentaryClauseResponseHistoryDependencies,
  readDocumentaryClauseResponseHistory,
  selectDocumentaryClauseResponseHead,
} from "./documentary-clause-response-history.ts";

export { reopenSignedApprovedBrief } from "./documentary-clause-response-brief.ts";

export interface DocumentaryClauseResponseInputDependencies
  extends DocumentaryClauseResponseHistoryDependencies {
  readonly resources: ReopenAgentResource;
}

export async function resolveDocumentaryClauseResponseInputs(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly base: ThreadSnapshot;
  readonly proposal: DocumentaryClauseResponseProposal;
  readonly dependencies: DocumentaryClauseResponseInputDependencies;
  readonly mode: "current" | "historical";
}) {
  const { project, base, proposal, dependencies: d } = input;
  validateThreadSnapshot(base);
  if (base.subject.id !== project.project.subjectId) {
    reject("The clause-response basis belongs to another project subject.");
  }
  await assertThreadSnapshotLineageIntact(base, d.snapshots);
  const brief = await reopenSignedApprovedBrief({
    projects: d.projects,
    projectId: project.project.id,
    signedBasis: proposal.briefBasis,
    mode: input.mode,
  });
  const sourceItem = brief.items.find((item) => item.id === proposal.sourceItemId);
  if (!sourceItem) {
    reject("The named brief item is absent from the signed approved brief.");
  }
  if (sourceItem.kind !== proposal.itemKind) {
    reject("The named brief item kind does not match the signed proposal.");
  }
  const itemFingerprint = await documentaryClauseResponseItemFingerprint(sourceItem);
  if (!fingerprintsEqual(itemFingerprint, proposal.itemFingerprint)) {
    reject("The named brief item no longer equals its signed fingerprint.");
  }
  assertUniqueThreadArtifactSources(
    proposal.sources,
    proposal.predecessor?.artifactId,
  );
  const sources = await Promise.all(
    proposal.sources.map((source) => reopenSource(source, base, d)),
  );
  const claimId = await documentaryClauseResponseClaimId(
    project.project.id,
    proposal.sourceItemId,
  );
  const history = await readDocumentaryClauseResponseHistory({
    project,
    thread: base,
    dependencies: d,
  });
  const previous = selectDocumentaryClauseResponseHead(history, base, claimId);
  if (
    deterministicJson(previous?.reference ?? null) !==
      deterministicJson(proposal.predecessor ?? null)
  ) {
    reject("The proposal does not name the exact current clause-response predecessor.");
  }
  if (
    previous &&
    previous.capture.answer === proposal.answer &&
    previous.capture.scope === proposal.scope &&
    deterministicJson(previous.capture.sources) ===
      deterministicJson(proposal.sources) &&
    deterministicJson(previous.capture.briefBasis) ===
      deterministicJson(proposal.briefBasis) &&
    deterministicJson(previous.capture.sourceItem) === deterministicJson(sourceItem)
  ) {
    reject(
      "This clause-response repeats the same exact answer, scope, sources and brief item; no new record would be written.",
    );
  }
  return {
    briefBasis: brief.basis,
    sourceItem,
    sources,
    claim: {
      id: claimId,
      revision: (previous?.capture.claim.revision ?? 0) + 1,
      sourceItemId: proposal.sourceItemId,
      ...(previous ? { predecessor: previous.reference } : {}),
    },
    previous,
    threadSourceArtifacts: sources.flatMap((source) =>
      source.kind === "thread-artifact" ? [source.artifact] : []
    ),
  };
}

async function reopenSource(
  source: DocumentaryClauseResponseSource,
  base: ThreadSnapshot,
  dependencies: DocumentaryClauseResponseInputDependencies,
): Promise<
  | {
    readonly kind: "agent-resource";
    readonly source: DocumentaryClauseResponseSource;
  }
  | {
    readonly kind: "thread-artifact";
    readonly source: DocumentaryClauseResponseSource;
    readonly artifact: ThreadArtifact;
  }
> {
  if (source.kind === "agent-resource") {
    const expected = parseAgentResourceReference(source.resourceRef);
    const reopened = await dependencies.resources.reopenExact(expected);
    if (
      !fingerprintsEqual(reopened.reference.fingerprint, expected.fingerprint) ||
      reopened.reference.uri !== expected.uri
    ) {
      reject("The named agent resource is not the exact persisted capture.");
    }
    return { kind: "agent-resource", source };
  }
  const archived = archivedRefKeys(base);
  const matches = base.artifacts.filter((artifact) =>
    artifact.id === source.artifactId && !archived.has(`artifact:${artifact.id}`)
  );
  if (matches.length !== 1) {
    reject(
      `Thread artifact ${source.artifactId} is absent, archived, or ambiguous on this basis.`,
    );
  }
  const artifact = matches[0]!;
  if (
    !fingerprintsEqual(artifact.fingerprint, source.fingerprint) ||
    artifact.producer.runId !== source.producerRunId
  ) {
    reject("The named Thread artifact does not match its signed identity.");
  }
  return { kind: "thread-artifact", source, artifact };
}

function reject(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}
