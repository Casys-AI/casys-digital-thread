/**
 * Read-only Buy seal review. No ERP dispatch.
 */

import type {
  ProjectBuyConfigurationCostSealReviewCommand,
  ProjectBuyConfigurationCostSealReviewResult,
  ProjectBuyConfigurationCostSealReviewUseCase,
} from "../../ports/in/buy/project-buy-configuration-cost-seal-review.ts";
import { buyGeometryApplicability } from "../../../domain/buy/buy-applicability.ts";
import {
  recrossBuyCandidateSealAuthority,
  resolveBuyCandidateCaptureRun,
} from "../../../domain/buy/buy-candidate-seal-authority.ts";
import { encodeBuySealDecisionParameters } from "../../../domain/buy/buy-proposal.ts";
import {
  exactRecord,
  nonEmptyText,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import { parseExactThreadSnapshotBasis } from "../../../domain/project/thread-tip.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import {
  canonicalBuyCandidateCaptureText,
  isExactBuyCandidateArtifact,
  validateBuyCandidateCapture,
} from "../../../domain/buy/buy-candidate-capture.ts";

export interface BuyCandidateCaptureReader {
  read(
    fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  ): Promise<string | undefined>;
}

export class PrepareProjectBuyConfigurationCostSealReview
  implements ProjectBuyConfigurationCostSealReviewUseCase {
  constructor(
    private readonly snapshots: ThreadSnapshotStore,
    private readonly candidates: BuyCandidateCaptureReader,
    private readonly projects: EngineeringProjectRevisionStore,
  ) {}

  async execute(
    value: unknown,
  ): Promise<ProjectBuyConfigurationCostSealReviewResult> {
    const command = parseCommand(value);
    const snapshot = await this.snapshots.get(command.basis.snapshotId);
    if (
      !snapshot ||
      snapshot.id !== command.basis.snapshotId ||
      snapshot.revision !== command.basis.revision ||
      snapshot.subject.id !== command.basis.subjectId
    ) {
      return {
        status: "unresolved",
        reason: "The exact Thread basis snapshot could not be reopened.",
      };
    }
    const artifact = snapshot.artifacts.find((item) =>
      item.id === command.candidateArtifactId
    );
    if (
      !artifact || !isExactBuyCandidateArtifact(artifact) ||
      artifact.fingerprint.digest !== command.candidateFingerprint.digest
    ) {
      return {
        status: "unresolved",
        reason: "The signed Buy candidate artefact is not on this basis.",
      };
    }
    const text = await this.candidates.read(artifact.fingerprint);
    if (text === undefined) {
      return {
        status: "unresolved",
        reason: "The Buy candidate capture is not readable.",
      };
    }
    const candidate = await validateBuyCandidateCapture(JSON.parse(text));
    if (canonicalBuyCandidateCaptureText(candidate) !== text) {
      return {
        status: "unavailable",
        reason: "The Buy candidate capture bytes are not canonical.",
      };
    }
    if (
      (await sha256Fingerprint(candidate)).digest !==
        artifact.fingerprint.digest
    ) {
      return {
        status: "unavailable",
        reason: "The Buy candidate capture fingerprint is not canonical.",
      };
    }
    const project = await this.projects.get(command.projectId);
    if (!project) {
      return {
        status: "unresolved",
        reason: "The engineering project could not be reopened.",
      };
    }
    const authority = recrossBuyCandidateSealAuthority({
      projectId: command.projectId,
      sealBasis: command.basis,
      configuration: candidate.configuration,
      trustedRunId: candidate.trustedRunId,
      producerRunId: artifact.producer.runId,
      captureRun: resolveBuyCandidateCaptureRun(
        project,
        candidate.trustedRunId,
      ),
    });
    if (authority.status !== "current") {
      return { status: "unresolved", reason: authority.reason };
    }
    const applicability = buyGeometryApplicability(
      snapshot,
      candidate.configuration,
    );
    if (applicability.status !== "current") {
      return {
        status: "unresolved",
        reason: applicability.status === "historical"
          ? applicability.reason
          : applicability.reason,
      };
    }
    const admission = {
      candidateDigest: artifact.fingerprint.digest,
      bundleDigest: candidate.bundleDigest,
      configurationDigest: candidate.configurationDigest,
      stepFingerprint: candidate.configuration.geometry.stepFingerprint,
      coverageStatus: candidate.bundle.coverage.status,
      sourceCaptureCount: candidate.sourceCaptures.length,
      sourceCaptureDigests: candidate.sourceCaptures.map((item) =>
        item.fingerprint.replace(/^sha256:/, "")
      ),
    };
    return {
      status: "ready",
      bundle: candidate.bundle,
      decisionParameters: encodeBuySealDecisionParameters(admission),
      admission,
    };
  }
}

function parseCommand(
  value: unknown,
): ProjectBuyConfigurationCostSealReviewCommand {
  const root = exactRecord(value, [
    "projectId",
    "basis",
    "candidateArtifactId",
    "candidateFingerprint",
  ], "$buySealReview");
  const fingerprint = exactRecord(
    root.candidateFingerprint,
    ["algorithm", "digest"],
    "$buySealReview.candidateFingerprint",
  );
  return {
    projectId: safeId(root.projectId, "$buySealReview.projectId"),
    basis: parseExactThreadSnapshotBasis(root.basis, "$buySealReview.basis"),
    candidateArtifactId: safeId(
      root.candidateArtifactId,
      "$buySealReview.candidateArtifactId",
    ),
    candidateFingerprint: {
      algorithm: "sha256",
      digest: nonEmptyText(
        fingerprint.digest,
        "$buySealReview.candidateFingerprint.digest",
      ),
    },
  };
}
