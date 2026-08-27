import type { FeaProofCaseCapture } from "../../../../../domain/fea/seal-case/fea-proof-case-capture.ts";
import type { EngineeringProjectSnapshot } from "../../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../../domain/thread/thread-snapshot.ts";

export interface FeaIsolatedRunAdmissionReviewInput {
  readonly project: EngineeringProjectSnapshot;
  readonly snapshot: ThreadSnapshot;
  readonly proofArtifact: ThreadArtifact;
  /** Actual plan binding when admission is invoked by the resolver. */
  readonly geometryArtifact?: ThreadArtifact;
}

export interface FeaIsolatedRunAdmissionReview {
  readonly capture: FeaProofCaseCapture;
  readonly stepArtifact: ThreadArtifact;
  /** Exact bytes already reread and verified by admission. */
  readonly stepBytes: Uint8Array;
}

/**
 * Read-only source admission shared with the isolated plan resolver.
 *
 * This validates the already sealed proof authority and canonical STEP. It
 * cannot pre-approve the distinct future isolated `@3` run MRTR or queue
 * transition.
 */
export interface FeaIsolatedRunAdmissionReviewer {
  reviewIsolatedCalculixAdmission(
    input: FeaIsolatedRunAdmissionReviewInput,
  ): Promise<FeaIsolatedRunAdmissionReview>;
}
