/** Reopen reviewed claim records and select exact immutable successor chains. */
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import { assertTracedRequirementsProposalAtProjectBoundary } from "../../application/use-cases/project/commands/requirements-brief-source-guard.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  parseRequirementsBriefTraceCapture,
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
  REQUIREMENTS_BRIEF_TRACE_URI_PREFIX,
  requirementsBriefTraceArtifactId,
  type RequirementsBriefTraceCapture,
  requirementsBriefTraceClaimId,
  type RequirementsBriefTraceRecordReference,
  requirementsBriefTraceUri,
} from "../../domain/record/requirements-brief-trace.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  parseExactRequirementsCapture,
  requirementsCaptureObservedAt,
  requirementsCaptureProducerTool,
} from "../architecture/requirements/requirements-capture.ts";
import {
  requirementsArtifactId,
  requirementsUriFor,
} from "../architecture/requirements/requirements-identities.ts";
import { requireRequirementsBriefTraceApproval } from "./requirements-brief-trace-approval.ts";
import { requirementsBriefTraceMemberMatchesProposal } from "./requirements-brief-trace-member.ts";

export interface RequirementsBriefTraceHistoryDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly captures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly traces: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
}

export interface ReopenedRequirementsBriefTraceRecord {
  readonly artifact: ThreadArtifact;
  readonly capture: RequirementsBriefTraceCapture;
  readonly reference: RequirementsBriefTraceRecordReference;
}

/**
 * No newest-file/label heuristic. Every candidate is canonical CAS + completed
 * Project run + exact human MRTR + stored approved brief, then linked by the
 * explicit predecessor. One unreadable candidate makes history unavailable.
 */
export async function readRequirementsBriefTraceHistory(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly dependencies: RequirementsBriefTraceHistoryDependencies;
}): Promise<readonly ReopenedRequirementsBriefTraceRecord[]> {
  const { project, thread, dependencies: d } = input;
  const records: ReopenedRequirementsBriefTraceRecord[] = [];
  for (const artifact of thread.artifacts) {
    if (!artifact.uri?.startsWith(REQUIREMENTS_BRIEF_TRACE_URI_PREFIX)) continue;
    const text = await d.traces.read(artifact.fingerprint);
    if (text === undefined) reject("A declared claim capture is unavailable.");
    const capture = parseRequirementsBriefTraceCapture(JSON.parse(text));
    if (
      deterministicJson(capture) !== text ||
      !fingerprintsEqual(await sha256Fingerprint(capture), artifact.fingerprint)
    ) reject("A claim capture is not its exact canonical content hash.");
    const inputIds = [
      capture.requirementsCapture.artifactId,
      ...(capture.claim.predecessor ? [capture.claim.predecessor.artifactId] : []),
    ];
    if (
      artifact.id !== requirementsBriefTraceArtifactId(artifact.fingerprint) ||
      artifact.kind !== "document" ||
      artifact.version !== artifact.fingerprint.digest ||
      artifact.uri !== requirementsBriefTraceUri(artifact.fingerprint) ||
      artifact.mediaType !== "application/json" ||
      artifact.producer.serverId !== "digital-thread" ||
      artifact.producer.tool !==
        `${RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.id}@${RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.version}` ||
      artifact.producer.runId !== capture.trustedRunId ||
      artifact.freshness.changedAt !== capture.linkedAt ||
      deterministicJson(artifact.inputArtifactIds) !== deterministicJson(inputIds)
    ) {
      reject(
        "A claim artifact does not equal its sealed producer, time, identity and inputs.",
      );
    }
    const derived = thread.provenance.filter((link) =>
      link.from.kind === "artifact" && link.from.id === artifact.id &&
      link.relation === "derived_from"
    );
    if (
      derived.length !== inputIds.length || derived.some((link) =>
        link.to.kind !== "artifact"
      ) || deterministicJson(
          derived.map((link) => link.to.id).toSorted(),
        ) !== deterministicJson([...inputIds].toSorted())
    ) reject("The claim input lineage is not exact.");
    if (
      capture.projectId !== project.project.id ||
      capture.basis.subjectId !== project.project.subjectId
    ) reject("A claim belongs to another project or subject.");
    const run = project.agentRuns.find((item) => item.id === capture.trustedRunId);
    if (
      !run || run.status !== "completed" || !run.resultSnapshot ||
      run.startedAt !== capture.linkedAt ||
      deterministicJson(run.basis) !== deterministicJson(capture.basis)
    ) reject("The claim does not have its exact completed Project run.");
    const approved = await requireRequirementsBriefTraceApproval(project, run);
    if (
      approved.decision.id !== capture.decision.decisionId ||
      !fingerprintsEqual(
        approved.decision.inputFingerprint,
        capture.decision.inputFingerprint,
      ) ||
      deterministicJson(approved.decision.proposal.parameters) !==
        deterministicJson(capture.parameters)
    ) reject("The claim does not equal its signed MRTR parameters.");
    const expectedEvidence = [{
      snapshotId: run.resultSnapshot.snapshotId,
      snapshotRevision: run.resultSnapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }];
    if (deterministicJson(run.evidenceRefs) !== deterministicJson(expectedEvidence)) {
      reject("The completed claim run does not name its exact output document.");
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
    ) reject("The claim's exact direct Thread successor is unavailable.");
    validateThreadSnapshot(base);
    validateThreadSnapshot(result);
    if (
      deterministicJson(result.artifacts.find((item) => item.id === artifact.id)) !==
        deterministicJson(artifact)
    ) reject("The visible claim artifact differs from its published Thread successor.");
    for (const id of inputIds) {
      const historicalArtifact = base.artifacts.find((item) => item.id === id);
      const visibleArtifact = thread.artifacts.find((item) => item.id === id);
      if (
        !historicalArtifact ||
        deterministicJson(historicalArtifact) !== deterministicJson(visibleArtifact)
      ) {
        reject(
          "The claim input was not present unchanged in its reviewed Thread basis.",
        );
      }
    }
    const source = base.artifacts.find((item) =>
      item.id === capture.requirementsCapture.artifactId
    )!;
    if (
      !fingerprintsEqual(source.fingerprint, capture.requirementsCapture.fingerprint) ||
      source.producer.runId !== capture.requirementsCapture.producerRunId
    ) reject("The claim references a different requirements capture.");
    const sourceText = await d.captures.read(source.fingerprint);
    if (sourceText === undefined) {
      reject("A claimed requirements capture is unavailable.");
    }
    const native = parseExactRequirementsCapture(JSON.parse(sourceText));
    if (
      deterministicJson(native) !== sourceText ||
      !fingerprintsEqual(await sha256Fingerprint(native), source.fingerprint) ||
      native.schemaVersion !== capture.requirementsCapture.schemaVersion ||
      native.trustedRunId !== source.producer.runId ||
      source.id !==
        requirementsArtifactId(native.containerComponent, source.fingerprint.digest) ||
      source.uri !==
        requirementsUriFor(native.containerComponent, source.fingerprint) ||
      source.kind !== "sysml-model" || source.mediaType !== "application/json" ||
      source.producer.serverId !== "syson" ||
      source.producer.tool !== requirementsCaptureProducerTool(native) ||
      source.freshness.changedAt !== requirementsCaptureObservedAt(native)
    ) reject("The claim's native requirements source is not exact.");
    const member = native.requirements.find((item) =>
      item.metric === capture.claim.requirementId
    );
    const proposed = approved.proposal.requirements.requirements[0]!;
    if (
      !member ||
      native.containerComponent !== approved.proposal.requirements.containerComponent ||
      native.partDefName !== approved.proposal.requirements.partDefName ||
      native.target.elementId !== capture.claim.targetElementId ||
      !requirementsBriefTraceMemberMatchesProposal(member, {
        name: proposed.name,
        metric: proposed.metric,
        operator: proposed.operator,
        limit: proposed.threshold,
      }) ||
      capture.claim.id !==
        await requirementsBriefTraceClaimId(
          project.project.id,
          native.target.elementId,
          member.metric,
        )
    ) reject("The claim subject is not the exact captured canonical requirement.");
    const provenance = await assertTracedRequirementsProposalAtProjectBoundary({
      projects: d.projects,
      project,
      workItemId: run.workItemId,
      decisionId: approved.decision.id,
      proposal: approved.decision.proposal,
      mode: "historical",
    });
    if (deterministicJson(provenance) !== deterministicJson(capture.briefProvenance)) {
      reject("The claim clause differs from its stored human-approved brief.");
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

  const byArtifact = new Map(records.map((record) => [record.artifact.id, record]));
  for (const record of records) {
    const seen = new Set<string>();
    let cursor = record;
    while (cursor.capture.claim.predecessor) {
      if (seen.has(cursor.artifact.id)) {
        reject("The claim predecessor chain contains a cycle.");
      }
      seen.add(cursor.artifact.id);
      const previous = byArtifact.get(cursor.capture.claim.predecessor.artifactId);
      if (
        !previous ||
        deterministicJson(previous.reference) !==
          deterministicJson(cursor.capture.claim.predecessor) ||
        previous.capture.claim.id !== cursor.capture.claim.id ||
        previous.capture.claim.targetElementId !==
          cursor.capture.claim.targetElementId ||
        previous.capture.claim.requirementId !== cursor.capture.claim.requirementId ||
        previous.capture.claim.revision + 1 !== cursor.capture.claim.revision ||
        previous.capture.basis.revision >= cursor.capture.basis.revision
      ) reject("The claim does not continue its exact previous version.");
      cursor = previous;
    }
    if (cursor.capture.claim.revision !== 1) {
      reject("A claim predecessor chain has no initial version.");
    }
  }
  return records;
}

export function selectRequirementsBriefClaimHead(
  records: readonly ReopenedRequirementsBriefTraceRecord[],
  thread: ThreadSnapshot,
  claimId: string,
): ReopenedRequirementsBriefTraceRecord | undefined {
  const family = records.filter((record) => record.capture.claim.id === claimId);
  if (family.length === 0) return undefined;
  const consumed = new Set(
    family.flatMap((record) =>
      record.capture.claim.predecessor
        ? [record.capture.claim.predecessor.artifactId]
        : []
    ),
  );
  const heads = family.filter((record) => !consumed.has(record.artifact.id));
  if (heads.length !== 1) reject("The claim has ambiguous successor heads.");
  if (archivedRefKeys(thread).has(`artifact:${heads[0]!.artifact.id}`)) {
    reject("The claim series is retired; it cannot silently restart.");
  }
  return heads[0];
}

function reject(message: string): never {
  throw new TypeError(message);
}
