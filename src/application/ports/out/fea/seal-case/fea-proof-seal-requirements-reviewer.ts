import type { FeaProofSealBindingDiagnostic } from "../../../../../domain/fea/seal-case/fea-proof-seal-bindings.ts";
import type { MechanicalProofCase } from "../../../../../domain/fea/seal-case/mechanical-proof-case.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../../domain/thread/thread-snapshot.ts";

export interface FeaProofSealRequirementsReviewInput {
  readonly snapshot: ThreadSnapshot;
  readonly proofCase: MechanicalProofCase;
}

export type FeaProofSealRequirementsReviewResult =
  | { readonly status: "resolved"; readonly artifact: ThreadArtifact }
  | {
    readonly status: "unresolved";
    readonly diagnostics: readonly FeaProofSealBindingDiagnostic[];
  };

/**
 * Reopen and validate the exact active requirements capture for a proof.
 *
 * The application sees only this inward result; capture stores and SysON seed
 * formats remain adapter concerns.
 */
export interface FeaProofSealRequirementsReviewer {
  review(
    input: FeaProofSealRequirementsReviewInput,
  ): Promise<FeaProofSealRequirementsReviewResult>;
}
