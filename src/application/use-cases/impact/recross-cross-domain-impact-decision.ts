/**
 * Shared recross for the human X09 impact decision.
 *
 * Runtime execution names the current X09 run; it reopens the X08 evaluation
 * named by that work revision's required dependsOn leaf. Read-only review
 * happens before X09 exists: it selects the unique current completed X08
 * activity leaf, then recrosses that exact work through the same evidence
 * resolver. Labels, timestamps, recency, and `latest` never select. X07/X08
 * records workItemInvalidations and rerunProposals as `none`; this recross
 * does not invent work items, change work-item lifecycle, or queue a rerun.
 */

import type { CrossDomainImpactEvaluationCaptureStore } from "../../ports/out/impact/cross-domain-impact-capture-store.ts";
import type { CrossDomainImpactBriefGateReader } from "../../ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import {
  recrossCrossDomainImpactWorkItemClaims,
} from "../../../domain/impact/cross-domain-impact-decision.ts";
import {
  CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA,
  CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  type CrossDomainImpactDecisionAdmission,
  DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
  validateCrossDomainImpactDecisionAdmission,
} from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
  evaluateCrossDomainImpactWorkItemOperation,
} from "../../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
} from "../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import {
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  resolveExactCompletedDependencyArtifact,
  resolveExactCompletedWorkArtifact,
  selectUniqueCompletedOperationLeaf,
} from "../project/resolve-exact-completed-dependency-artifact.ts";

export type CrossDomainImpactDecisionRecrossCode =
  | "evaluation_capture_unavailable"
  | "evaluation_capture_mismatch"
  | "evaluation_capture_archived"
  | "brief_unavailable"
  | "brief_mismatch"
  | "work_item_claim_unresolved";

export class CrossDomainImpactDecisionRecrossError extends Error {
  constructor(
    readonly code: CrossDomainImpactDecisionRecrossCode,
    message: string,
  ) {
    super(message);
    this.name = "CrossDomainImpactDecisionRecrossError";
  }
}

export interface RecrossCrossDomainImpactDecisionInput {
  readonly project: EngineeringProjectSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly snapshot: ThreadSnapshot;
  readonly briefGates: CrossDomainImpactBriefGateReader;
  readonly captures: CrossDomainImpactEvaluationCaptureStore;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly trustedRunId?: string;
  readonly excludeWorkItemId?: string;
}

export interface RecrossedCrossDomainImpactDecision {
  readonly capture: CrossDomainImpactEvaluationCapture;
  readonly artifact: ThreadArtifact;
  readonly admission: CrossDomainImpactDecisionAdmission;
}

export async function recrossCrossDomainImpactDecision(
  input: RecrossCrossDomainImpactDecisionInput,
): Promise<RecrossedCrossDomainImpactDecision> {
  const snapshotFingerprint = await sha256Fingerprint(input.snapshot);
  if (
    input.snapshot.id !== input.basis.snapshotId ||
    input.snapshot.revision !== input.basis.revision ||
    input.snapshot.subject.id !== input.basis.subjectId
  ) {
    throw new CrossDomainImpactDecisionRecrossError(
      "evaluation_capture_unavailable",
      "The exact Thread basis for the impact decision is unavailable.",
    );
  }
  const selected = input.trustedRunId
    ? await resolveExactCompletedDependencyArtifact({
      project: input.project,
      trustedRunId: input.trustedRunId,
      head: input.snapshot,
      basis: input.basis,
      currentOperation: {
        id: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
        version: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
        requiresDependsOnOperation: {
          id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
          version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
        },
      },
      expectedDependencyOperation: evaluateCrossDomainImpactWorkItemOperation(),
      expectedProducer: x08ExpectedProducer(),
      snapshots: input.snapshots,
    })
    : await resolvePreflightX08EvaluationDocument(input);
  if (selected.status !== "resolved") {
    throw new CrossDomainImpactDecisionRecrossError(
      selected.code === "artifact_archived"
        ? "evaluation_capture_archived"
        : selected.status === "unresolved"
        ? "evaluation_capture_mismatch"
        : "evaluation_capture_unavailable",
      selected.reason,
    );
  }
  const artifact = selected.artifact;
  const capture = await input.captures.read(artifact.fingerprint);
  if (!capture) {
    throw new CrossDomainImpactDecisionRecrossError(
      "evaluation_capture_unavailable",
      "The exact impact-evaluation capture is unavailable.",
    );
  }
  const captureFingerprint = await sha256Fingerprint(capture);
  const evaluationRun = selected.producerRun;
  if (
    !evaluationRun ||
    evaluationRun.startedAt !== capture.evaluatedAt ||
    capture.trustedRunId !== evaluationRun.id
  ) {
    throw new CrossDomainImpactDecisionRecrossError(
      "evaluation_capture_mismatch",
      "The impact-evaluation capture does not recross its exact X08 trusted run.",
    );
  }
  for (const reference of capture.artifactInputs) {
    const inputs = input.snapshot.artifacts.filter((candidate) =>
      candidate.id === reference.id
    );
    if (
      inputs.length !== 1 ||
      !fingerprintsEqual(inputs[0]!.fingerprint, reference.fingerprint)
    ) {
      throw new CrossDomainImpactDecisionRecrossError(
        "evaluation_capture_mismatch",
        "The impact-evaluation capture inputs are not the exact X08 Thread artifacts.",
      );
    }
  }
  const expected = expectedX08EvaluationArtifact(capture, captureFingerprint);
  if (
    deterministicJson(x08EvaluationArtifactIdentity(artifact)) !==
      deterministicJson(expected)
  ) {
    throw new CrossDomainImpactDecisionRecrossError(
      "evaluation_capture_mismatch",
      "The impact-evaluation document is not the exact X08 evaluation artifact.",
    );
  }
  if (
    capture.evaluation.project.id !== input.project.project.id ||
    capture.evaluation.subject.id !== input.project.project.subjectId ||
    capture.evaluation.subject.id !== input.snapshot.subject.id
  ) {
    throw new CrossDomainImpactDecisionRecrossError(
      "evaluation_capture_mismatch",
      "The impact-evaluation capture does not recross this project or subject.",
    );
  }

  let approvedBrief;
  try {
    approvedBrief = await input.briefGates.read(input.project.project.id);
  } catch {
    throw new CrossDomainImpactDecisionRecrossError(
      "brief_unavailable",
      "The current approved Brief V2 is unavailable.",
    );
  }
  if (!approvedBrief) {
    throw new CrossDomainImpactDecisionRecrossError(
      "brief_unavailable",
      "The current approved Brief V2 is unavailable.",
    );
  }
  if (
    approvedBrief.contractVersion !== "2.0" ||
    approvedBrief.projectId !== input.project.project.id ||
    approvedBrief.brief.id !== capture.brief.id ||
    approvedBrief.brief.revision !== capture.brief.revision ||
    !fingerprintsEqual(approvedBrief.brief.fingerprint, capture.brief.fingerprint)
  ) {
    throw new CrossDomainImpactDecisionRecrossError(
      "brief_mismatch",
      "The current approved Brief V2 is not the exact impact-evaluation brief gate.",
    );
  }
  for (const gate of capture.brief.gates) {
    const matches = approvedBrief.gates.filter((item) => item.id === gate.gateItemId);
    if (matches.length !== 1) {
      throw new CrossDomainImpactDecisionRecrossError(
        "brief_mismatch",
        "The current approved Brief V2 does not recross every exact impact-evaluation gate.",
      );
    }
    const current = matches[0]!;
    if (
      current.kind !== gate.kind ||
      current.dependsOnItemIds === undefined ||
      !fingerprintsEqual(current.fingerprint, gate.fingerprint) ||
      deterministicJson(current.dependsOnItemIds) !==
        deterministicJson(gate.dependsOnItemIds)
    ) {
      throw new CrossDomainImpactDecisionRecrossError(
        "brief_mismatch",
        "The current approved Brief V2 does not recross every exact impact-evaluation gate.",
      );
    }
  }

  let workItemClaims;
  try {
    workItemClaims = recrossCrossDomainImpactWorkItemClaims(
      input.project.workItems,
      capture.evaluation.gateClaims.map((claim) => ({
        gateItemId: claim.gateItemId,
        role: claim.role,
        status: claim.status,
      })),
      { excludeWorkItemId: input.excludeWorkItemId },
    );
  } catch (error) {
    throw new CrossDomainImpactDecisionRecrossError(
      "work_item_claim_unresolved",
      error instanceof Error
        ? error.message
        : "The exact impact-evaluation gate claims do not recross current work items.",
    );
  }

  const admission = validateCrossDomainImpactDecisionAdmission({
    schemaVersion: CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA,
    consequence: "accept",
    projectId: input.project.project.id,
    subjectId: input.project.project.subjectId,
    basis: {
      snapshotId: input.basis.snapshotId,
      revision: input.basis.revision,
      fingerprint: snapshotFingerprint,
    },
    brief: {
      id: capture.brief.id,
      revision: capture.brief.revision,
      fingerprint: capture.brief.fingerprint,
    },
    evaluation: {
      capture: { id: artifact.id, fingerprint: artifact.fingerprint },
      trustedRunId: capture.trustedRunId,
    },
    manifestSeal: capture.manifestSeal.artifact,
    workItemClaims,
    limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  });
  return { capture, artifact, admission };
}

async function resolvePreflightX08EvaluationDocument(
  input: RecrossCrossDomainImpactDecisionInput,
) {
  const leaf = selectUniqueCompletedOperationLeaf(
    input.project.workItems,
    ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
  );
  if (leaf.status !== "resolved") return leaf;
  return await resolveExactCompletedWorkArtifact({
    project: input.project,
    dependencyWork: leaf.work,
    head: input.snapshot,
    basis: input.basis,
    expectedDependencyOperation: evaluateCrossDomainImpactWorkItemOperation(),
    expectedProducer: x08ExpectedProducer(),
    snapshots: input.snapshots,
  });
}

function x08ExpectedProducer() {
  return {
    serverId: "digital-thread",
    tool:
      `${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id}@${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version}`,
  };
}

export function expectedX08EvaluationArtifact(
  capture: CrossDomainImpactEvaluationCapture,
  captureFingerprint: ContentFingerprint,
) {
  return {
    id: `cross-domain-impact-evaluation-${captureFingerprint.digest}`,
    name: "Cross-domain impact evaluation",
    kind: "document" as const,
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: crossDomainImpactEvaluationCaptureUri(captureFingerprint.digest),
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool:
        `${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id}@${ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version}`,
      runId: capture.trustedRunId,
    },
    inputArtifactIds: capture.artifactInputs.map((item) => item.id),
    freshness: {
      status: "fresh" as const,
      changedAt: capture.evaluatedAt,
      invalidatedByChangeIds: [] as const,
    },
  };
}

export function x08EvaluationArtifactIdentity(artifact: ThreadArtifact) {
  return {
    id: artifact.id,
    name: artifact.name,
    kind: artifact.kind,
    version: artifact.version,
    fingerprint: artifact.fingerprint,
    uri: artifact.uri,
    mediaType: artifact.mediaType,
    producer: artifact.producer,
    inputArtifactIds: artifact.inputArtifactIds,
    freshness: {
      status: artifact.freshness.status,
      changedAt: artifact.freshness.changedAt,
      invalidatedByChangeIds: artifact.freshness.invalidatedByChangeIds,
    },
  };
}
