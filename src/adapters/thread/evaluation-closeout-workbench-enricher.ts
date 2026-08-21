/**
 * BFF-only projection of provider-free static-mechanical L5 closeouts.
 *
 * It opens only the immutable local closeout capture named by a Thread
 * document. It does not run CalculiX, call SysON, select a provider, or expose
 * a command. A closeout is current only on its direct successor basis; a
 * later Thread successor leaves the old decision visible as historical.
 */

import type {
  ThreadArtifact,
  ThreadEvaluationCloseoutCard,
  ThreadEvaluationCloseoutEvidenceRef,
  ThreadEvaluationCloseoutIndex,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
} from "../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import {
  EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
  validateStaticMechanicalEvaluationCloseoutCapture,
} from "../fea/evaluation-closeout/static-mechanical-evaluation-closeout-capture.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const PRODUCERS = new Set([
  `${DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id}@${DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.version}`,
  `${DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.id}@${DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.version}`,
]);

export interface EvaluationCloseoutCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

/** Add a typed, display-only closeout index to one Workbench projection. */
export async function enrichThreadWorkbenchWithEvaluationCloseouts(
  snapshot: ThreadWorkbenchSnapshot,
  captures: EvaluationCloseoutCaptureReader,
): Promise<
  ThreadWorkbenchSnapshot & { evaluationCloseouts: ThreadEvaluationCloseoutIndex }
> {
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "document" && PRODUCERS.has(artifact.producedBy ?? "") &&
    artifact.id.startsWith("evaluation-closeout-")
  );
  const cards: ThreadEvaluationCloseoutCard[] = [];
  let unresolved = false;
  for (const artifact of candidates) {
    const identity = captureIdentity(artifact);
    if (!identity) {
      unresolved = true;
      continue;
    }
    let text: string | undefined;
    try {
      text = await captures.read(identity);
    } catch {
      unresolved = true;
      continue;
    }
    if (text === undefined) {
      unresolved = true;
      continue;
    }
    try {
      const capture = validateStaticMechanicalEvaluationCloseoutCapture(
        JSON.parse(text),
      );
      const card = projectCard(snapshot, artifact, capture, identity.digest);
      if (!card) {
        unresolved = true;
        continue;
      }
      cards.push(card);
    } catch {
      unresolved = true;
    }
  }
  cards.sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  const status = unresolved
    ? "unresolved"
    : cards.some((card) => card.status === "current")
    ? "current"
    : cards.length > 0
    ? "historical"
    : "not-recorded";
  return {
    ...snapshot,
    evaluationCloseouts: {
      schemaVersion: "thread-evaluation-closeouts/1.0",
      family: "static-mechanical",
      status,
      cards,
    },
  };
}

function captureIdentity(artifact: ThreadArtifact): ContentFingerprint | undefined {
  const fingerprint = parseFingerprint(artifact.fingerprint);
  if (
    !fingerprint || artifact.id !== `evaluation-closeout-${fingerprint.digest}` ||
    artifact.uri !==
      `${EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX}sha256/${fingerprint.digest}`
  ) return undefined;
  return fingerprint;
}

function projectCard(
  snapshot: ThreadWorkbenchSnapshot,
  artifact: ThreadArtifact,
  capture: ReturnType<typeof validateStaticMechanicalEvaluationCloseoutCapture>,
  digest: string,
): ThreadEvaluationCloseoutCard | undefined {
  const expectedProducer = `${capture.operation.id}@${capture.operation.version}`;
  if (
    artifact.producedBy !== expectedProducer ||
    artifact.producerRunId !== capture.trustedRunId ||
    artifact.fingerprint !== `sha256:${digest}` ||
    capture.operation.id !==
      (capture.admission.consequence === "accept"
        ? DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id
        : DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.id)
  ) return undefined;
  const expectedInputs = [
    capture.admission.canonicalStep.id,
    capture.admission.sealedProof.id,
    capture.admission.executionEvidence.id,
    capture.admission.evaluationCapture.id,
  ];
  if (
    artifact.dependsOn.length !== expectedInputs.length ||
    artifact.dependsOn.some((id, index) => id !== expectedInputs[index])
  ) return undefined;
  const evidence = {
    canonicalStep: evidenceRef(snapshot, capture.admission.canonicalStep),
    sealedProof: evidenceRef(snapshot, capture.admission.sealedProof),
    executionEvidence: evidenceRef(snapshot, capture.admission.executionEvidence),
    evaluationCapture: evidenceRef(snapshot, capture.admission.evaluationCapture),
  };
  if (Object.values(evidence).some((entry) => entry === undefined)) return undefined;
  const exactEvidence = evidence as {
    canonicalStep: ThreadEvaluationCloseoutEvidenceRef;
    sealedProof: ThreadEvaluationCloseoutEvidenceRef;
    executionEvidence: ThreadEvaluationCloseoutEvidenceRef;
    evaluationCapture: ThreadEvaluationCloseoutEvidenceRef;
  };
  const eligibility = capture.admission.criteria.every((criterion) =>
    criterion.status === "pass"
  );
  if (capture.admission.consequence === "accept" && !eligibility) return undefined;
  const current =
    snapshot.previous?.snapshotId === capture.admission.basis.snapshotId &&
    snapshot.previous.revision === capture.admission.basis.revision &&
    artifact.freshness === "fresh" &&
    Object.values(exactEvidence).every((entry) => entry.freshness === "fresh");
  return {
    artifactId: artifact.id,
    captureFingerprint: `sha256:${digest}`,
    basis: {
      snapshotId: capture.admission.basis.snapshotId,
      revision: capture.admission.basis.revision,
      fingerprint: `sha256:${capture.admission.basis.fingerprint.digest}`,
    },
    humanDisposition: capture.admission.consequence,
    rejectionDisposition: capture.admission.rejectionDisposition,
    acceptanceEligibility: eligibility,
    status: current ? "current" : "historical",
    criteria: capture.admission.criteria.map((criterion) => ({ ...criterion })),
    proofLimitations: {
      proofScope: capture.proofLimitations.proofScope,
      evidenceBoundary: capture.proofLimitations.evidenceBoundary,
      cadEngineeringBoundary: {
        designIntent: capture.proofLimitations.cadEngineeringBoundary.designIntent,
        editableCad: capture.proofLimitations.cadEngineeringBoundary.editableCad,
        manufacturability:
          capture.proofLimitations.cadEngineeringBoundary.manufacturability,
        limitations: [...capture.proofLimitations.cadEngineeringBoundary.limitations],
      },
    },
    evidence: exactEvidence,
  };
}

function evidenceRef(
  snapshot: ThreadWorkbenchSnapshot,
  expected: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  },
): ThreadEvaluationCloseoutEvidenceRef | undefined {
  const matches = snapshot.artifacts.filter((candidate) =>
    candidate.id === expected.id
  );
  const artifact = matches[0];
  if (
    matches.length !== 1 || !artifact ||
    artifact.fingerprint !== `sha256:${expected.fingerprint.digest}` ||
    artifact.producerRunId !== expected.producerRunId
  ) return undefined;
  return {
    id: artifact.id,
    fingerprint: artifact.fingerprint,
    producerRunId: artifact.producerRunId,
    freshness: artifact.freshness === "fresh"
      ? "fresh"
      : artifact.freshness === "stale"
      ? "stale"
      : "unavailable",
  };
}

function parseFingerprint(value: string | undefined): ContentFingerprint | undefined {
  const match = /^sha256:([a-f0-9]{64})$/.exec(value ?? "");
  return match && SHA256.test(match[1]!)
    ? { algorithm: "sha256", digest: match[1]! }
    : undefined;
}
