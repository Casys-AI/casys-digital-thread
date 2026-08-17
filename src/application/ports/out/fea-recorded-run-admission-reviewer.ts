import type { FeaProofCaseCapture } from "../../../domain/analysis/fea-proof-case-capture.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";

export interface FeaRecordedRunAdmissionReviewInput {
  readonly project: EngineeringProjectSnapshot;
  readonly snapshot: ThreadSnapshot;
  readonly proofArtifact: ThreadArtifact;
  /** Actual plan binding when admission is invoked by the resolver. */
  readonly geometryArtifact?: ThreadArtifact;
}

export interface FeaRecordedRunAdmissionReview {
  readonly capture: FeaProofCaseCapture;
  readonly stepArtifact: ThreadArtifact;
  /** Exact bytes already reread and verified by admission. */
  readonly stepBytes: Uint8Array;
}

/**
 * Read-only source admission shared with the recorded-operation-plan resolver.
 *
 * This validates the already sealed proof authority and canonical STEP. It
 * cannot pre-approve the distinct future @2 run MRTR or queue transition.
 */
export interface FeaRecordedRunAdmissionReviewer {
  reviewRecordedCalculixAdmission(
    input: FeaRecordedRunAdmissionReviewInput,
  ): Promise<FeaRecordedRunAdmissionReview>;
}
