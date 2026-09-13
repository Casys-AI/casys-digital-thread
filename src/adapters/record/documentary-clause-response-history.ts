/** Reopen sealed clause-response records and select exact successor heads. */
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX,
  documentaryClauseResponseArtifactId,
  type DocumentaryClauseResponseCapture,
  documentaryClauseResponseClaimId,
  documentaryClauseResponseItemFingerprint,
  type DocumentaryClauseResponseRecordReference,
  documentaryClauseResponseUri,
  parseDocumentaryClauseResponseCapture,
  RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
} from "../../domain/record/documentary-clause-response.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { requireDocumentaryClauseResponseApproval } from "./documentary-clause-response-approval.ts";
import { reopenSignedApprovedBrief } from "./documentary-clause-response-brief.ts";

export interface DocumentaryClauseResponseHistoryDependencies {
  readonly captures: {
    save?(
      fingerprint: ContentFingerprint,
      canonicalText: string,
    ): Promise<unknown>;
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly projects: Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
}

export interface ReopenedDocumentaryClauseResponseRecord {
  readonly artifact: ThreadArtifact;
  readonly capture: DocumentaryClauseResponseCapture;
  readonly reference: DocumentaryClauseResponseRecordReference;
}

/**
 * No producer-label or hash heuristic. Every declared candidate is canonical
 * CAS + completed Project run + exact human MRTR + stored approved brief,
 * then linked by the explicit predecessor. One unreadable candidate makes
 * history unavailable.
 */
export async function readDocumentaryClauseResponseHistory(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly dependencies: DocumentaryClauseResponseHistoryDependencies;
}): Promise<readonly ReopenedDocumentaryClauseResponseRecord[]> {
  const { project, thread, dependencies: d } = input;
  validateThreadSnapshot(thread);
  const records: ReopenedDocumentaryClauseResponseRecord[] = [];
  for (const artifact of thread.artifacts) {
    if (!artifact.uri?.startsWith(DOCUMENTARY_CLAUSE_RESPONSE_URI_PREFIX)) {
      continue;
    }
    const text = await d.captures.read(artifact.fingerprint);
    if (text === undefined) {
      reject("A declared clause-response capture is unavailable.");
    }
    const capture = parseDocumentaryClauseResponseCapture(JSON.parse(text));
    if (
      deterministicJson(capture) !== text ||
      !fingerprintsEqual(await sha256Fingerprint(capture), artifact.fingerprint)
    ) {
      reject("A clause-response capture is not its exact canonical content hash.");
    }
    const inputIds = [
      ...capture.sources.flatMap((source) =>
        source.kind === "thread-artifact" ? [source.artifactId] : []
      ),
      ...(capture.claim.predecessor ? [capture.claim.predecessor.artifactId] : []),
    ];
    if (
      artifact.id !== documentaryClauseResponseArtifactId(artifact.fingerprint) ||
      artifact.kind !== "document" ||
      artifact.version !== artifact.fingerprint.digest ||
      artifact.uri !== documentaryClauseResponseUri(artifact.fingerprint) ||
      artifact.mediaType !== "application/json" ||
      artifact.producer.serverId !== "digital-thread" ||
      artifact.producer.tool !==
        `${RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.id}@${RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.version}` ||
      artifact.producer.runId !== capture.trustedRunId ||
      artifact.freshness.changedAt !== capture.linkedAt ||
      deterministicJson(artifact.inputArtifactIds) !== deterministicJson(inputIds)
    ) {
      reject(
        "A clause-response artifact does not equal its sealed producer, time, identity and inputs.",
      );
    }
    if (
      capture.projectId !== project.project.id ||
      capture.basis.subjectId !== project.project.subjectId
    ) {
      reject("A clause-response belongs to another project or subject.");
    }
    const expectedClaimId = await documentaryClauseResponseClaimId(
      project.project.id,
      capture.claim.sourceItemId,
    );
    if (capture.claim.id !== expectedClaimId) {
      reject(
        "The clause-response claim does not equal its project and approved brief item identity.",
      );
    }
    const run = project.agentRuns.find((item) => item.id === capture.trustedRunId);
    if (
      !run || run.status !== "completed" || !run.resultSnapshot ||
      run.startedAt !== capture.linkedAt ||
      deterministicJson(run.basis) !== deterministicJson(capture.basis)
    ) {
      reject("The clause-response does not have its exact completed Project run.");
    }
    const approved = await requireApproval(project, run);
    if (
      approved.decision.id !== capture.decision.decisionId ||
      !fingerprintsEqual(
        approved.decision.inputFingerprint,
        capture.decision.inputFingerprint,
      ) ||
      deterministicJson(approved.decision.proposal.parameters) !==
        deterministicJson(capture.parameters)
    ) {
      reject("The clause-response does not equal its signed MRTR parameters.");
    }
    const expectedEvidence = [{
      snapshotId: run.resultSnapshot.snapshotId,
      snapshotRevision: run.resultSnapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }];
    if (deterministicJson(run.evidenceRefs) !== deterministicJson(expectedEvidence)) {
      reject(
        "The completed clause-response run does not name its exact output document.",
      );
    }
    const base = await d.snapshots.get(capture.basis.snapshotId);
    const result = await d.snapshots.get(run.resultSnapshot.snapshotId);
    if (
      !base || base.id !== capture.basis.snapshotId ||
      base.revision !== capture.basis.revision ||
      base.subject.id !== capture.basis.subjectId || !result ||
      result.id !== run.resultSnapshot.snapshotId ||
      result.revision !== base.revision + 1 ||
      result.revision !== run.resultSnapshot.revision ||
      result.subject.id !== base.subject.id ||
      run.resultSnapshot.subjectId !== base.subject.id ||
      result.previous?.snapshotId !== base.id ||
      result.previous.revision !== base.revision
    ) {
      reject("The clause-response's exact direct Thread successor is unavailable.");
    }
    validateThreadSnapshot(base);
    validateThreadSnapshot(result);
    reopenExactThreadArtifactSources(capture, base);
    if (
      deterministicJson(result.artifacts.find((item) => item.id === artifact.id)) !==
        deterministicJson(artifact)
    ) {
      reject(
        "The visible clause-response artifact differs from its published Thread successor.",
      );
    }
    const brief = await reopenSignedApprovedBrief({
      projects: d.projects,
      projectId: project.project.id,
      signedBasis: capture.briefBasis,
      mode: "historical",
    }).catch((error) => reject(error instanceof Error ? error.message : String(error)));
    const sourceItem = brief.items.find((item) =>
      item.id === capture.claim.sourceItemId
    );
    if (!sourceItem) {
      reject("The named brief item is absent from the signed approved brief.");
    }
    if (deterministicJson(sourceItem) !== deterministicJson(capture.sourceItem)) {
      reject(
        "The clause-response item does not equal its stored approved brief item.",
      );
    }
    const itemFingerprint = await documentaryClauseResponseItemFingerprint(
      sourceItem,
    );
    if (!fingerprintsEqual(itemFingerprint, approved.proposal.itemFingerprint)) {
      reject("The named brief item no longer equals its signed fingerprint.");
    }
    records.push({
      artifact,
      capture,
      reference: {
        artifactId: artifact.id,
        fingerprint: artifact.fingerprint,
        producerRunId: capture.trustedRunId,
      },
    });
  }

  const byArtifact = new Map(
    records.map((record) => [record.artifact.id, record]),
  );
  for (const record of records) {
    const seen = new Set<string>();
    let cursor = record;
    while (cursor.capture.claim.predecessor) {
      if (seen.has(cursor.artifact.id)) {
        reject("The clause-response predecessor chain contains a cycle.");
      }
      seen.add(cursor.artifact.id);
      const previous = byArtifact.get(cursor.capture.claim.predecessor.artifactId);
      if (
        !previous ||
        deterministicJson(previous.reference) !==
          deterministicJson(cursor.capture.claim.predecessor) ||
        previous.capture.claim.id !== cursor.capture.claim.id ||
        previous.capture.claim.sourceItemId !==
          cursor.capture.claim.sourceItemId ||
        previous.capture.claim.revision + 1 !== cursor.capture.claim.revision ||
        previous.capture.basis.revision >= cursor.capture.basis.revision
      ) {
        reject("The clause-response does not continue its exact previous version.");
      }
      cursor = previous;
    }
    if (cursor.capture.claim.revision !== 1) {
      reject("A clause-response predecessor chain has no initial version.");
    }
  }
  const claimIds = new Set(records.map((record) => record.capture.claim.id));
  for (const claimId of claimIds) {
    selectDocumentaryClauseResponseHead(records, thread, claimId);
  }
  return records;
}

/**
 * History keeps this read-side equivalent of the writer's source reopening
 * local: importing documentary-clause-response-inputs would form a cycle
 * because that resolver itself reads history to select the predecessor.
 */
function reopenExactThreadArtifactSources(
  capture: DocumentaryClauseResponseCapture,
  basis: ThreadSnapshot,
): void {
  const archived = archivedRefKeys(basis);
  for (const source of capture.sources) {
    if (source.kind !== "thread-artifact") continue;
    const matches = basis.artifacts.filter((artifact) =>
      artifact.id === source.artifactId &&
      !archived.has(`artifact:${artifact.id}`)
    );
    if (matches.length !== 1) {
      reject(
        `Thread artifact ${source.artifactId} is absent, archived, or ambiguous on the clause-response basis.`,
      );
    }
    const artifact = matches[0]!;
    if (
      !fingerprintsEqual(artifact.fingerprint, source.fingerprint) ||
      artifact.producer.runId !== source.producerRunId
    ) {
      reject(
        "The clause-response Thread source does not match its sealed identity.",
      );
    }
  }
}

export function selectDocumentaryClauseResponseHead(
  history: readonly ReopenedDocumentaryClauseResponseRecord[],
  thread: ThreadSnapshot,
  claimId: string,
): ReopenedDocumentaryClauseResponseRecord | undefined {
  const family = history.filter((record) => record.capture.claim.id === claimId);
  if (family.length === 0) return undefined;
  const archived = archivedRefKeys(thread);
  const referenced = new Set(
    family.flatMap((record) =>
      record.capture.claim.predecessor
        ? [record.capture.claim.predecessor.artifactId]
        : []
    ),
  );
  const heads = family.filter((record) => !referenced.has(record.artifact.id));
  if (heads.length !== 1) {
    reject("The clause-response series has a split head.");
  }
  if (archived.has(`artifact:${heads[0]!.artifact.id}`)) {
    reject("The clause-response series is retired; it cannot silently restart.");
  }
  return heads[0];
}

async function requireApproval(
  project: EngineeringProjectSnapshot,
  run: NonNullable<EngineeringProjectSnapshot["agentRuns"][number]>,
) {
  try {
    return await requireDocumentaryClauseResponseApproval(project, run);
  } catch (error) {
    reject(error instanceof Error ? error.message : String(error));
  }
}

function reject(message: string): never {
  throw new TypeError(message);
}
