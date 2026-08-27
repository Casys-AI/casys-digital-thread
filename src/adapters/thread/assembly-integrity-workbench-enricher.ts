/**
 * Read-only Workbench projection for the bounded assembly-integrity vertical.
 *
 * The adapter reopens three immutable CAS records named by Thread artifacts:
 * L3 observation, L4 evaluation and human L5 closeout.  It does not import a
 * CAD provider, execute a method, select a runtime, infer a current result
 * from labels/timestamps, or compute an engineering verdict.  Every displayed
 * fact is recrossed to exact artifact identity and ordered dependencies.
 */

import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  assemblyIntegrityObservationCaptureUri,
  fingerprintAssemblyIntegrityObservationCapture,
  validateAssemblyIntegrityObservationCapture,
} from "../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import {
  assemblyIntegrityEvaluationCaptureUri,
  fingerprintAssemblyIntegrityEvaluationCapture,
  validateAssemblyIntegrityEvaluationCapture,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
  validateAssemblyIntegrityEvaluationCloseoutCapture,
} from "../cad/assembly-integrity/assembly-integrity-evaluation-closeout-capture.ts";
import type {
  ThreadArtifact,
  ThreadAssemblyIntegrityArtifactRef,
  ThreadAssemblyIntegrityBasis,
  ThreadAssemblyIntegrityChain,
  ThreadAssemblyIntegrityCloseoutCard,
  ThreadAssemblyIntegrityEvaluationCard,
  ThreadAssemblyIntegrityFact,
  ThreadAssemblyIntegrityIndex,
  ThreadAssemblyIntegrityObservationCard,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const OBSERVATION_PRODUCER = "verify.observe-assembly-integrity@1";
const EVALUATION_PRODUCER = "verify.evaluate-assembly-integrity@1";
const CLOSEOUT_PRODUCERS = new Set([
  `${DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id}@${DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version}`,
  `${DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.id}@${DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION.version}`,
]);

type ObservationCapture = Awaited<
  ReturnType<typeof validateAssemblyIntegrityObservationCapture>
>;
type EvaluationCapture = Awaited<
  ReturnType<typeof validateAssemblyIntegrityEvaluationCapture>
>;
type CloseoutCapture = ReturnType<
  typeof validateAssemblyIntegrityEvaluationCloseoutCapture
>;

export interface AssemblyIntegrityWorkbenchCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

/** Explicit readers preserve the L3/L4/L5 store boundary in both BFF compositions. */
export interface AssemblyIntegrityWorkbenchCaptureReaders {
  observations: AssemblyIntegrityWorkbenchCaptureReader;
  evaluations: AssemblyIntegrityWorkbenchCaptureReader;
  closeouts: AssemblyIntegrityWorkbenchCaptureReader;
}

interface ObservationRecord {
  readonly capture: ObservationCapture;
  readonly card: ThreadAssemblyIntegrityObservationCard;
}

interface EvaluationRecord {
  readonly capture: EvaluationCapture;
  readonly card: ThreadAssemblyIntegrityEvaluationCard;
  readonly observation: ObservationRecord;
}

interface CloseoutRecord {
  readonly capture: CloseoutCapture;
  readonly card: ThreadAssemblyIntegrityCloseoutCard;
  readonly evaluation: EvaluationRecord;
}

/**
 * Add the versioned assembly-integrity slice to one already-projected Thread
 * snapshot. A malformed, missing or identity-mismatched candidate makes the
 * family unresolved; valid historical evidence remains visible.
 */
export async function enrichThreadWorkbenchWithAssemblyIntegrity(
  snapshot: ThreadWorkbenchSnapshot,
  captures: AssemblyIntegrityWorkbenchCaptureReaders,
): Promise<
  ThreadWorkbenchSnapshot & { assemblyIntegrity: ThreadAssemblyIntegrityIndex }
> {
  const observations = new Map<string, ObservationRecord>();
  const evaluations: EvaluationRecord[] = [];
  const closeouts: CloseoutRecord[] = [];
  let unresolved = false;

  for (const artifact of snapshot.artifacts.filter(isObservationCandidate)) {
    const identity = captureIdentity(artifact);
    if (!identity) {
      unresolved = true;
      continue;
    }
    try {
      const text = await captures.observations.read(identity);
      if (text === undefined) {
        unresolved = true;
        continue;
      }
      const capture = await validateAssemblyIntegrityObservationCapture(
        JSON.parse(text),
      );
      const fingerprint = await fingerprintAssemblyIntegrityObservationCapture(
        capture,
      );
      if (!fingerprintsEqual(fingerprint, identity)) {
        unresolved = true;
        continue;
      }
      const card = projectObservation(snapshot, artifact, capture, identity);
      if (!card || observations.has(card.record.id)) {
        unresolved = true;
        continue;
      }
      observations.set(card.record.id, { capture, card });
    } catch {
      unresolved = true;
    }
  }

  for (const artifact of snapshot.artifacts.filter(isEvaluationCandidate)) {
    const identity = captureIdentity(artifact);
    if (!identity) {
      unresolved = true;
      continue;
    }
    try {
      const text = await captures.evaluations.read(identity);
      if (text === undefined) {
        unresolved = true;
        continue;
      }
      const capture = await validateAssemblyIntegrityEvaluationCapture(
        JSON.parse(text),
      );
      const fingerprint = await fingerprintAssemblyIntegrityEvaluationCapture(capture);
      if (!fingerprintsEqual(fingerprint, identity)) {
        unresolved = true;
        continue;
      }
      const observation = observations.get(capture.observation.artifactId);
      const card = observation
        ? projectEvaluation(snapshot, artifact, capture, identity, observation)
        : undefined;
      if (!observation || !card) {
        unresolved = true;
        continue;
      }
      evaluations.push({ capture, card, observation });
    } catch {
      unresolved = true;
    }
  }

  for (const artifact of snapshot.artifacts.filter(isCloseoutCandidate)) {
    const identity = captureIdentity(artifact);
    if (!identity) {
      unresolved = true;
      continue;
    }
    try {
      const text = await captures.closeouts.read(identity);
      if (text === undefined) {
        unresolved = true;
        continue;
      }
      const capture = validateAssemblyIntegrityEvaluationCloseoutCapture(
        JSON.parse(text),
      );
      const fingerprint = await sha256Fingerprint(capture);
      if (!fingerprintsEqual(fingerprint, identity)) {
        unresolved = true;
        continue;
      }
      const evaluation = evaluations.find((candidate) =>
        candidate.card.record.id === capture.evaluationCapture.id
      );
      const card = evaluation
        ? projectCloseout(snapshot, artifact, capture, identity, evaluation)
        : undefined;
      if (!evaluation || !card) {
        unresolved = true;
        continue;
      }
      closeouts.push({ capture, card, evaluation });
    } catch {
      unresolved = true;
    }
  }

  const chains = buildChains(snapshot, observations, evaluations, closeouts);
  const status: ThreadAssemblyIntegrityIndex["status"] = unresolved
    ? "unresolved"
    : chains.some((chain) => chain.status === "current")
    ? "current"
    : chains.length > 0
    ? "historical"
    : "not-recorded";
  return {
    ...snapshot,
    assemblyIntegrity: {
      schemaVersion: "thread-assembly-integrity/1.0",
      family: "assembly-integrity",
      status,
      chains,
    },
  };
}

function isObservationCandidate(artifact: ThreadArtifact): boolean {
  return artifact.kind === "evidence" &&
    artifact.producedBy === OBSERVATION_PRODUCER &&
    artifact.id.startsWith("assembly-integrity-observation-");
}

function isEvaluationCandidate(artifact: ThreadArtifact): boolean {
  return artifact.kind === "evidence" &&
    artifact.producedBy === EVALUATION_PRODUCER &&
    artifact.id.startsWith("assembly-integrity-evaluation-");
}

function isCloseoutCandidate(artifact: ThreadArtifact): boolean {
  return artifact.kind === "document" &&
    CLOSEOUT_PRODUCERS.has(artifact.producedBy ?? "") &&
    artifact.id.startsWith("assembly-integrity-evaluation-closeout-");
}

function projectObservation(
  snapshot: ThreadWorkbenchSnapshot,
  artifact: ThreadArtifact,
  capture: ObservationCapture,
  fingerprint: ContentFingerprint,
): ThreadAssemblyIntegrityObservationCard | undefined {
  const record = ownArtifactRef(
    artifact,
    fingerprint,
    `${capture.operation.id}@${capture.operation.version}`,
    [capture.geometryModule.artifactId, capture.assemblyStep.artifactId],
    `assembly-integrity-observation-${fingerprint.digest}`,
    assemblyIntegrityObservationCaptureUri(fingerprint.digest),
  );
  const geometryModule = evidenceRef(snapshot, capture.geometryModule);
  const assemblyStep = evidenceRef(snapshot, capture.assemblyStep);
  if (!record || !geometryModule || !assemblyStep) return undefined;
  if (capture.basis.subjectId !== snapshot.subject.id) return undefined;
  return {
    record,
    basis: projectThreadBasis(capture.basis),
    inputBundle: {
      fingerprint: fingerprintText(capture.inputBundle.fingerprint),
      byteCount: capture.inputBundle.byteCount,
    },
    evidence: { geometryModule, assemblyStep },
    facts: {
      importability: projectFact(capture.observation.importability),
      importFacts: {
        unitSystem: projectFact(capture.observation.importFacts.unitSystem),
        solidCount: projectFact(capture.observation.importFacts.solidCount),
      },
      topology: {
        brepValidity: projectFact(capture.observation.topology.brepValidity),
        degenerateEdgeCount: projectFact(
          capture.observation.topology.degenerateEdgeCount,
        ),
        freeEdgeCount: projectFact(capture.observation.topology.freeEdgeCount),
        shellCount: projectFact(capture.observation.topology.shellCount),
      },
      occurrences: capture.observation.occurrences.map((occurrence) => ({
        usageElementId: occurrence.usageElementId,
        target: projectFact(occurrence.target),
        transformStatus: occurrence.transform.status,
      })),
      pairs: capture.observation.pairs.map((pair) => ({
        firstUsageElementId: pair.firstUsageElementId,
        secondUsageElementId: pair.secondUsageElementId,
        linearToleranceMm: pair.linearToleranceMm,
        minimumDistanceMm: projectFact(pair.minimumDistanceMm),
        intersectionVolumeMm3: projectFact(pair.intersectionVolumeMm3),
        contact: projectFact(pair.contact),
      })),
    },
    limitations: { ...capture.limits },
  };
}

function projectEvaluation(
  snapshot: ThreadWorkbenchSnapshot,
  artifact: ThreadArtifact,
  capture: EvaluationCapture,
  fingerprint: ContentFingerprint,
  observation: ObservationRecord,
): ThreadAssemblyIntegrityEvaluationCard | undefined {
  if (
    capture.basis.subjectId !== snapshot.subject.id ||
    capture.observation.artifactId !== observation.card.record.id ||
    !fingerprintsEqual(
      capture.observation.fingerprint,
      captureFingerprint(observation.card.record),
    ) ||
    !fingerprintsEqual(
      capture.observation.observationFingerprint,
      observation.capture.observationFingerprint,
    ) ||
    !sameArtifactIdentity(capture.geometryModule, observation.capture.geometryModule) ||
    !sameArtifactIdentity(capture.assemblyStep, observation.capture.assemblyStep) ||
    !fingerprintsEqual(
      capture.inputBundle.fingerprint,
      observation.capture.inputBundle.fingerprint,
    ) ||
    capture.inputBundle.byteCount !== observation.capture.inputBundle.byteCount
  ) return undefined;
  const record = ownArtifactRef(
    artifact,
    fingerprint,
    `${capture.operation.id}@${capture.operation.version}`,
    [
      capture.geometryModule.artifactId,
      capture.assemblyStep.artifactId,
      capture.observation.artifactId,
    ],
    `assembly-integrity-evaluation-${fingerprint.digest}`,
    assemblyIntegrityEvaluationCaptureUri(fingerprint.digest),
  );
  const geometryModule = evidenceRef(snapshot, capture.geometryModule);
  const assemblyStep = evidenceRef(snapshot, capture.assemblyStep);
  const observationRef = evidenceRef(snapshot, {
    id: capture.observation.artifactId,
    fingerprint: capture.observation.fingerprint,
  });
  if (!record || !geometryModule || !assemblyStep || !observationRef) return undefined;
  return {
    record,
    basis: projectThreadBasis(capture.basis),
    evidence: {
      geometryModule,
      assemblyStep,
      observation: observationRef,
    },
    method: {
      id: capture.method.id,
      version: capture.method.version,
      fingerprint: fingerprintText(capture.method.fingerprint),
    },
    criteria: capture.evaluation.criteria.map((criterion) => ({ ...criterion })),
    aggregateVerdict: capture.evaluation.verdict,
    limitations: { ...capture.method.limitations },
  };
}

function projectCloseout(
  snapshot: ThreadWorkbenchSnapshot,
  artifact: ThreadArtifact,
  capture: CloseoutCapture,
  fingerprint: ContentFingerprint,
  evaluation: EvaluationRecord,
): ThreadAssemblyIntegrityCloseoutCard | undefined {
  const admission = capture.admission;
  if (
    admission.subjectId !== snapshot.subject.id ||
    capture.evaluationCapture.id !== evaluation.card.record.id ||
    !fingerprintsEqual(
      capture.evaluationCapture.fingerprint,
      captureFingerprint(evaluation.card.record),
    ) ||
    capture.evaluationCapture.uri !== evaluation.card.record.uri ||
    !sameAdmissionIdentity(admission.evaluationCapture, evaluation.card.record) ||
    !sameAdmissionIdentity(
      admission.geometryModule,
      evaluation.card.evidence.geometryModule,
    ) ||
    !sameAdmissionIdentity(
      admission.assemblyStep,
      evaluation.card.evidence.assemblyStep,
    ) ||
    !sameAdmissionIdentity(
      admission.observation,
      evaluation.card.evidence.observation,
    ) ||
    !fingerprintsEqual(
      admission.observation.observationFingerprint,
      evaluation.observation.capture.observationFingerprint,
    ) ||
    !sameCriteria(admission.criteria, evaluation.card.criteria) ||
    admission.evaluationCapture.id !== evaluation.card.record.id ||
    admission.method.id !== evaluation.card.method.id ||
    admission.method.version !== evaluation.card.method.version ||
    admission.method.schemaVersion !== "assembly-integrity-evaluation-method/1.0" ||
    !fingerprintsEqual(admission.method.fingerprint, {
      algorithm: "sha256",
      digest: evaluation.card.method.fingerprint.slice("sha256:".length),
    })
  ) return undefined;
  const record = ownArtifactRef(
    artifact,
    fingerprint,
    `${capture.operation.id}@${capture.operation.version}`,
    [capture.evaluationCapture.id],
    `assembly-integrity-evaluation-closeout-${fingerprint.digest}`,
    `${ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`,
  );
  const evaluationRef = evidenceRef(snapshot, admission.evaluationCapture);
  const geometryModule = evidenceRef(snapshot, admission.geometryModule);
  const assemblyStep = evidenceRef(snapshot, admission.assemblyStep);
  const observation = evidenceRef(snapshot, admission.observation);
  if (!record || !evaluationRef || !geometryModule || !assemblyStep || !observation) {
    return undefined;
  }
  return {
    record,
    basis: {
      snapshotId: admission.basis.snapshotId,
      revision: admission.basis.revision,
      fingerprint: fingerprintText(admission.basis.fingerprint),
    },
    humanDisposition: admission.consequence,
    rejectionDisposition: admission.rejectionDisposition,
    approvedBriefBasis: {
      projectId: admission.approvedBriefBasis.projectId,
      projectSnapshotId: admission.approvedBriefBasis.projectSnapshotId,
      projectRevision: admission.approvedBriefBasis.projectRevision,
      briefId: admission.approvedBriefBasis.briefId,
      briefSnapshotId: admission.approvedBriefBasis.briefSnapshotId,
      briefRevision: admission.approvedBriefBasis.briefRevision,
      fingerprint: fingerprintText(
        admission.approvedBriefBasis.approvedBriefFingerprint,
      ),
    },
    verificationAuthority: {
      id: "assembly-integrity",
      version: "1.0",
    },
    gateClaims: admission.gateClaims.map((claim) => ({ ...claim })),
    evidence: {
      evaluation: evaluationRef,
      geometryModule,
      assemblyStep,
      observation,
    },
    l4Limitations: { ...capture.l4Limitations },
    limitations: { ...capture.limits },
  };
}

function buildChains(
  snapshot: ThreadWorkbenchSnapshot,
  observations: ReadonlyMap<string, ObservationRecord>,
  evaluations: readonly EvaluationRecord[],
  closeouts: readonly CloseoutRecord[],
): ThreadAssemblyIntegrityChain[] {
  const closeoutsByEvaluation = new Map<string, CloseoutRecord[]>();
  for (const closeout of closeouts) {
    const entries = closeoutsByEvaluation.get(closeout.evaluation.card.record.id) ?? [];
    entries.push(closeout);
    closeoutsByEvaluation.set(closeout.evaluation.card.record.id, entries);
  }
  const evaluationsByObservation = new Map<string, EvaluationRecord[]>();
  for (const evaluation of evaluations) {
    const entries =
      evaluationsByObservation.get(evaluation.observation.card.record.id) ?? [];
    entries.push(evaluation);
    evaluationsByObservation.set(evaluation.observation.card.record.id, entries);
  }
  const chains: ThreadAssemblyIntegrityChain[] = [];
  for (const observation of observations.values()) {
    const linkedEvaluations =
      evaluationsByObservation.get(observation.card.record.id) ?? [];
    if (linkedEvaluations.length === 0) {
      chains.push({
        id: observation.card.record.id,
        status: statusForObservation(snapshot, observation.card),
        observation: observation.card,
      });
      continue;
    }
    for (const evaluation of linkedEvaluations) {
      const linkedCloseouts = closeoutsByEvaluation.get(evaluation.card.record.id) ??
        [];
      if (linkedCloseouts.length === 0) {
        chains.push({
          id: evaluation.card.record.id,
          status: statusForEvaluation(snapshot, evaluation.card),
          observation: observation.card,
          evaluation: evaluation.card,
        });
        continue;
      }
      for (const closeout of linkedCloseouts) {
        chains.push({
          id: closeout.card.record.id,
          status: statusForCloseout(snapshot, closeout.card),
          observation: observation.card,
          evaluation: evaluation.card,
          closeout: closeout.card,
        });
      }
    }
  }
  return chains.sort((left, right) => left.id.localeCompare(right.id));
}

function statusForObservation(
  snapshot: ThreadWorkbenchSnapshot,
  card: ThreadAssemblyIntegrityObservationCard,
): ThreadAssemblyIntegrityChain["status"] {
  return isDirectCurrent(snapshot, card.basis) &&
      allFresh([card.record, card.evidence.geometryModule, card.evidence.assemblyStep])
    ? "current"
    : "historical";
}

function statusForEvaluation(
  snapshot: ThreadWorkbenchSnapshot,
  card: ThreadAssemblyIntegrityEvaluationCard,
): ThreadAssemblyIntegrityChain["status"] {
  return isDirectCurrent(snapshot, card.basis) &&
      allFresh([
        card.record,
        card.evidence.geometryModule,
        card.evidence.assemblyStep,
        card.evidence.observation,
      ])
    ? "current"
    : "historical";
}

function statusForCloseout(
  snapshot: ThreadWorkbenchSnapshot,
  card: ThreadAssemblyIntegrityCloseoutCard,
): ThreadAssemblyIntegrityChain["status"] {
  return isDirectCurrent(snapshot, card.basis) &&
      allFresh([
        card.record,
        card.evidence.evaluation,
        card.evidence.geometryModule,
        card.evidence.assemblyStep,
        card.evidence.observation,
      ])
    ? "current"
    : "historical";
}

function isDirectCurrent(
  snapshot: ThreadWorkbenchSnapshot,
  basis: Pick<ThreadAssemblyIntegrityBasis, "snapshotId" | "revision">,
): boolean {
  return snapshot.previous?.snapshotId === basis.snapshotId &&
    snapshot.previous.revision === basis.revision;
}

function allFresh(refs: readonly ThreadAssemblyIntegrityArtifactRef[]): boolean {
  return refs.every((ref) => ref.freshness === "fresh");
}

function ownArtifactRef(
  artifact: ThreadArtifact,
  fingerprint: ContentFingerprint,
  producer: string,
  dependsOn: readonly string[],
  expectedId: string,
  expectedUri: string,
): ThreadAssemblyIntegrityArtifactRef | undefined {
  const reference = artifactRef(artifact);
  if (
    !reference || artifact.id !== expectedId || artifact.uri !== expectedUri ||
    artifact.producedBy !== producer || artifact.producerRunId === undefined ||
    !fingerprintsEqual(captureFingerprint(reference), fingerprint) ||
    !sameIds(artifact.dependsOn, dependsOn)
  ) return undefined;
  return reference;
}

function evidenceRef(
  snapshot: ThreadWorkbenchSnapshot,
  expected: {
    readonly artifactId?: string;
    readonly id?: string;
    readonly fingerprint: ContentFingerprint;
  },
): ThreadAssemblyIntegrityArtifactRef | undefined {
  const id = expected.artifactId ?? expected.id;
  if (!id) return undefined;
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === id);
  if (matches.length !== 1) return undefined;
  const reference = artifactRef(matches[0]!);
  return reference &&
      fingerprintsEqual(captureFingerprint(reference), expected.fingerprint)
    ? reference
    : undefined;
}

function artifactRef(
  artifact: ThreadArtifact,
): ThreadAssemblyIntegrityArtifactRef | undefined {
  const fingerprint = parseFingerprint(artifact.fingerprint);
  if (
    !fingerprint || typeof artifact.uri !== "string" || artifact.uri.length === 0 ||
    typeof artifact.producerRunId !== "string" || artifact.producerRunId.length === 0
  ) {
    return undefined;
  }
  return {
    id: artifact.id,
    uri: artifact.uri,
    fingerprint: fingerprintText(fingerprint),
    producerRunId: artifact.producerRunId,
    dependsOn: [...artifact.dependsOn],
    freshness: artifact.freshness === "fresh"
      ? "fresh"
      : artifact.freshness === "stale"
      ? "stale"
      : "unavailable",
  };
}

function captureIdentity(artifact: ThreadArtifact): ContentFingerprint | undefined {
  return parseFingerprint(artifact.fingerprint);
}

function parseFingerprint(value: string | undefined): ContentFingerprint | undefined {
  const match = /^sha256:([a-f0-9]{64})$/.exec(value ?? "");
  return match && SHA256.test(match[1]!)
    ? { algorithm: "sha256", digest: match[1]! }
    : undefined;
}

function captureFingerprint(
  reference: { readonly fingerprint: string },
): ContentFingerprint {
  const parsed = parseFingerprint(reference.fingerprint);
  if (!parsed) {
    throw new TypeError(
      "Assembly-integrity projection received an invalid fingerprint.",
    );
  }
  return parsed;
}

function fingerprintText(fingerprint: ContentFingerprint): string {
  return `sha256:${fingerprint.digest}`;
}

function projectThreadBasis(
  basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
): ThreadAssemblyIntegrityBasis {
  return {
    snapshotId: basis.snapshotId,
    revision: basis.revision,
    subjectId: basis.subjectId,
  };
}

function projectFact<T>(
  fact:
    | { readonly status: "observed"; readonly value: T }
    | {
      readonly status: "unresolved";
      readonly reason: "identity-missing" | "observability-missing";
    }
    | { readonly status: "unavailable"; readonly reason: "unsupported" },
): ThreadAssemblyIntegrityFact<T> {
  return fact.status === "observed"
    ? { status: "observed", value: fact.value }
    : fact.status === "unresolved"
    ? { status: "unresolved", reason: fact.reason }
    : { status: "unavailable", reason: fact.reason };
}

function sameArtifactIdentity(
  left: { readonly artifactId: string; readonly fingerprint: ContentFingerprint },
  right: { readonly artifactId: string; readonly fingerprint: ContentFingerprint },
): boolean {
  return left.artifactId === right.artifactId &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function sameAdmissionIdentity(
  left: { readonly id: string; readonly fingerprint: ContentFingerprint },
  right: ThreadAssemblyIntegrityArtifactRef,
): boolean {
  return left.id === right.id &&
    fingerprintsEqual(left.fingerprint, captureFingerprint(right));
}

function sameCriteria(
  left: readonly { readonly id: string; readonly verdict: string }[],
  right: readonly { readonly id: string; readonly verdict: string }[],
): boolean {
  return left.length === right.length &&
    left.every((criterion, index) =>
      criterion.id === right[index]?.id && criterion.verdict === right[index]?.verdict
    );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
