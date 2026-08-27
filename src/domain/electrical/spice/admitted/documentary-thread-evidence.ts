/**
 * Pure documentary Thread successor for one admitted SPICE isolated run.
 *
 * Builds the exact three artifacts, native raw observations, and provenance
 * from values already reopened. `capturedAt` is the durable run start; this
 * module has no clock. Observations are L3 documentary only: no pass/fail,
 * requirement join, derived power, L4, L5, or safety.
 */

import type { IsolatedCodeExecutionReceipt } from "../../../compile/isolation/isolated-code-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadObservation,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../../thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../../thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../../thread/thread-snapshot-validation.ts";
import type { SpiceAdmittedExecutionCapture } from "./execution-evidence.ts";
import { COMPILE_SEAL_ADMISSION_PRODUCER_TOOL } from "../../../compile/admission/technical-compilation-proposal.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "./run-proposal.ts";

export interface DocumentarySuccessor {
  readonly snapshot: ThreadSnapshot;
  readonly artifacts: readonly [ThreadArtifact, ThreadArtifact, ThreadArtifact];
  readonly observations: readonly ThreadObservation[];
}

export interface AdmittedSpiceDocumentaryThreadEvidence {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
  readonly artifacts: {
    readonly capture: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly evidence: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly result: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
    };
  };
}

export function buildDocumentarySuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly runId: string;
  readonly capturedAt: string;
  readonly capture: SpiceAdmittedExecutionCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
  readonly receipt: IsolatedCodeExecutionReceipt;
}): DocumentarySuccessor {
  const capturedAt = input.capturedAt;
  const admissionArtifact = exactAdmissionArtifact(
    input.basisSnapshot,
    input.capture.admission.admissionArtifact.id,
    input.capture.admission.admissionArtifact.fingerprint,
  );
  const operation = {
    serverId: "digital-thread",
    tool:
      `${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id}@${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version}`,
    runId: input.runId,
  };
  const freshness = {
    status: "fresh" as const,
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const outputs = new Map(
    input.receipt.outputs.map((output) => [output.role, output]),
  );
  const evidenceOutput = outputs.get("evidence")!;
  const resultOutput = outputs.get("result")!;
  const captureArtifact: ThreadArtifact = {
    id: `spice-admitted-capture-${input.captureFingerprint.digest}`,
    name: "Admitted SPICE execution capture",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [admissionArtifact.id],
    freshness,
  };
  const evidenceArtifact: ThreadArtifact = {
    id: `spice-admitted-evidence-${evidenceOutput.sha256}`,
    name: "Admitted SPICE isolated evidence",
    kind: "evidence",
    version: evidenceOutput.sha256,
    fingerprint: { algorithm: "sha256", digest: evidenceOutput.sha256 },
    uri: evidenceOutput.casUri,
    mediaType: evidenceOutput.mediaType,
    producer: operation,
    inputArtifactIds: [admissionArtifact.id],
    freshness,
  };
  const resultArtifact: ThreadArtifact = {
    id: `spice-admitted-result-${resultOutput.sha256}`,
    name: "Admitted SPICE operating-point result",
    kind: "solver-result",
    version: resultOutput.sha256,
    fingerprint: { algorithm: "sha256", digest: resultOutput.sha256 },
    uri: resultOutput.casUri,
    mediaType: resultOutput.mediaType,
    producer: operation,
    inputArtifactIds: [admissionArtifact.id],
    freshness,
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${admissionArtifact.id}-by-${captureArtifact.id}`,
    artifactId: admissionArtifact.id,
    consumer: operation,
    observedFingerprint: admissionArtifact.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };
  const observations = admittedSpiceObservations({
    capture: input.capture,
    runId: input.runId,
    operation,
    evidenceArtifactId: evidenceArtifact.id,
    resultArtifactId: resultArtifact.id,
    capturedAt,
    freshness,
  });
  const provenance: ThreadProvenanceLink[] = [
    ...[captureArtifact, evidenceArtifact, resultArtifact].map((artifact) => ({
      id: `derived-from-${admissionArtifact.id}-by-${artifact.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifact.id },
      to: { kind: "artifact" as const, id: admissionArtifact.id },
      rationale:
        "The admitted SPICE executor reopened the exact reviewed technical-compilation admission before isolated execution.",
    })),
    {
      id: `uses-${consumption.id}`,
      relation: "uses",
      from: { kind: "consumption", id: consumption.id },
      to: { kind: "artifact", id: admissionArtifact.id },
      rationale:
        "The execution verified the exact admission artifact fingerprint before dispatch.",
    },
    ...observations.flatMap((observation) =>
      observation.source.artifactIds.map((artifactId) => ({
        id: `${observation.id}-from-${artifactId}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observation.id },
        to: { kind: "artifact" as const, id: artifactId },
        rationale:
          "The observation is a native ngspice operating-point quantity from the exact evidence and result.",
      }))
    ),
  ];
  const extension: ThreadSnapshotExtension = {
    id: `simulate-run-admitted-spice-${input.runId}`,
    name: "Record admitted SPICE isolated run",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [captureArtifact, evidenceArtifact, resultArtifact],
    consumptions: [consumption],
    observations,
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw new TypeError(
      "The admitted SPICE documentary branch is already present.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifacts: [captureArtifact, evidenceArtifact, resultArtifact],
    observations,
  };
}

export function admittedSpiceObservations(input: {
  readonly capture: SpiceAdmittedExecutionCapture;
  readonly runId: string;
  readonly operation: ThreadObservation["source"]["operation"];
  readonly evidenceArtifactId: string;
  readonly resultArtifactId: string;
  readonly capturedAt: string;
  readonly freshness: ThreadObservation["freshness"];
}): ThreadObservation[] {
  return input.capture.observables.map((observable) => {
    const slug = spiceObservableSlug(observable.nativeName);
    return {
      id: `spice-admitted-${slug}-${input.runId}`,
      name: `Admitted SPICE ${observable.nativeName}`,
      metric: observable.nativeName,
      quantity: { value: observable.value, unit: observable.unit },
      source: {
        operation: input.operation,
        artifactIds: [input.evidenceArtifactId, input.resultArtifactId],
        capturedAt: input.capturedAt,
      },
      freshness: input.freshness,
    };
  });
}

export function spiceObservableSlug(nativeName: string): string {
  return nativeName
    .replaceAll("@", "")
    .replaceAll("(", ".")
    .replaceAll(")", "")
    .replaceAll("[", ".")
    .replaceAll("]", "");
}

export function exactAdmissionArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ContentFingerprint,
): ThreadArtifact {
  const digest = fingerprint.digest;
  const matches = snapshot.artifacts.filter((artifact) =>
    id === `technical-compilation-admission-${digest}` &&
    artifact.id === id && artifact.kind === "document" &&
    fingerprintsEqual(artifact.fingerprint, fingerprint) &&
    artifact.version === digest &&
    artifact.uri ===
      `casys://technical-compilation-admission-capture/sha256/${digest}` &&
    artifact.mediaType === "application/json" &&
    artifact.freshness.status === "fresh" &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === COMPILE_SEAL_ADMISSION_PRODUCER_TOOL &&
    !archivedRefKeys(snapshot).has(`artifact:${artifact.id}`)
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `Technical-compilation admission ${id} is absent, stale, archived, ambiguous, or has divergent identity, fingerprint, producer, URI, or media type in the exact Thread basis.`,
    );
  }
  return matches[0]!;
}

export function threadEvidenceFor(
  expected: DocumentarySuccessor,
): AdmittedSpiceDocumentaryThreadEvidence {
  const [capture, evidence, result] = expected.artifacts;
  return {
    snapshotId: expected.snapshot.id,
    revision: expected.snapshot.revision,
    subjectId: expected.snapshot.subject.id,
    artifacts: {
      capture: { id: capture.id, fingerprint: capture.fingerprint },
      evidence: { id: evidence.id, fingerprint: evidence.fingerprint },
      result: { id: result.id, fingerprint: result.fingerprint },
    },
  };
}

export function assertThreadEvidenceExact(
  actual: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
    readonly artifacts: AdmittedSpiceDocumentaryThreadEvidence["artifacts"];
    readonly fingerprint?: unknown;
  },
  expected: DocumentarySuccessor,
): void {
  const { fingerprint: _fingerprint, ...actualEvidence } = actual;
  if (
    deterministicJson(actualEvidence) !==
      deterministicJson(threadEvidenceFor(expected))
  ) {
    throw new TypeError(
      "The admitted SPICE journal does not name the exact documentary Thread successor.",
    );
  }
}
