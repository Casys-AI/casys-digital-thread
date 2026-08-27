/**
 * Precedence and post-I/O joins for a signed sensitivity catalog offer.
 *
 * Named catalog ids and a unique catalog JSON still win. catalog-absent and
 * catalog-ambiguous fall through to a unique signed offer. Several same
 * proofDigest captures are one case. An invalid sibling must not brick a
 * unique digest match. After the unique offer, proof and admission are
 * reopened, `bindSignedCatalogOffer` compiles the study template.
 */

import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { ThreadArtifact } from "../../thread/thread-snapshot.ts";
import type { MechanicalProofCase } from "../../fea/seal-case/mechanical-proof-case.ts";
import type { SensitivityCatalogOffer } from "./sensitivity-catalog-from-proof.ts";
import {
  isCompileAdmissionArtifact,
  SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL,
  sensitivityCadSourceUri,
  type SensitivityStudySealDiagnostic,
} from "./sensitivity-study-seal-bindings.ts";
import { compileSensitivityStudyTemplateFromOffer } from "./sensitivity-study-from-offer.ts";
import type { SensitivityStudyCaseTemplate } from "./sensitivity-study-template.ts";
import type { SensitivityCadSource } from "./sensitivity-study-v2.ts";

export interface OfferJoinArtifactIdentity {
  readonly id: string;
}

export type SensitivityStudySealAuthorityKind = "catalog" | "signed-offer";

export type CatalogOpenStatus =
  | "ok"
  | "unresolved"
  | "catalog_unavailable"
  | "catalog_integrity_failed";

/**
 * Whether the review may reopen a signed catalog offer after the catalog pass.
 *
 * The application determines the catalog status through its injected reader.
 * This pure domain rule deliberately knows neither catalog ids nor paths.
 */
export function shouldOpenSignedCatalogOffer(input: {
  readonly catalogStatus: CatalogOpenStatus;
}): boolean {
  return input.catalogStatus === "unresolved";
}

export function selectUniqueSignedCatalogOffer<
  A extends OfferJoinArtifactIdentity,
>(
  artifacts: readonly A[],
):
  | { readonly status: "absent" }
  | { readonly status: "ambiguous"; readonly artifacts: readonly A[] }
  | { readonly status: "ok"; readonly artifact: A } {
  if (artifacts.length === 0) return { status: "absent" };
  if (artifacts.length > 1) return { status: "ambiguous", artifacts };
  return { status: "ok", artifact: artifacts[0]! };
}

export type ProofCaptureJoinAttempt<
  T,
  A extends OfferJoinArtifactIdentity = OfferJoinArtifactIdentity,
> =
  | {
    readonly status: "matched";
    readonly artifact: A;
    readonly proofCapture: T;
  }
  | { readonly status: "unread"; readonly artifact: A }
  | { readonly status: "invalid"; readonly artifact: A }
  | { readonly status: "other"; readonly artifact: A };

export function joinProofCaptureForOfferDigest<
  T extends { readonly proofDigest: string },
  A extends OfferJoinArtifactIdentity = OfferJoinArtifactIdentity,
>(
  attempts: readonly ProofCaptureJoinAttempt<T, A>[],
):
  | {
    readonly status: "ok";
    readonly artifact: A;
    readonly proofCapture: T;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostic: SensitivityStudySealDiagnostic;
  } {
  const matched = attempts.filter((item) => item.status === "matched");
  if (matched.length >= 1) {
    return {
      status: "ok",
      artifact: matched[0]!.artifact,
      proofCapture: matched[0]!.proofCapture,
    };
  }
  const unread = attempts.find((item) => item.status === "unread");
  if (unread) {
    return {
      status: "unavailable",
      diagnostic: {
        code: "catalog-offer-unavailable",
        artifactId: unread.artifact.id,
        message:
          "A sealed FEA proof capture on the current tip could not be reopened. The catalog-offer join is unproven.",
      },
    };
  }
  const invalid = attempts.find((item) => item.status === "invalid");
  return {
    status: "unresolved",
    diagnostic: {
      code: "catalog-offer-integrity-failed",
      artifactId: invalid?.artifact.id ?? attempts[0]?.artifact.id ?? null,
      message: invalid
        ? "A sealed FEA proof capture on the current tip is invalid."
        : "No sealed FEA proof capture matches the signed catalog-offer proof digest.",
    },
  };
}

export function bindSignedOfferAdmissionArtifact(input: {
  readonly admissionArtifact: ThreadArtifact | undefined;
  readonly signedAdmission: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
}):
  | { readonly status: "ok"; readonly artifact: ThreadArtifact }
  | {
    readonly status: "unlinked";
    readonly diagnostic: SensitivityStudySealDiagnostic;
  } {
  const artifact = input.admissionArtifact;
  if (
    !artifact ||
    !fingerprintsEqual(artifact.fingerprint, input.signedAdmission.fingerprint)
  ) {
    return {
      status: "unlinked",
      diagnostic: {
        code: "catalog-offer-admission-unlinked",
        artifactId: input.signedAdmission.id,
        message:
          "The signed catalog-offer admission is absent from the current tip or has drifted.",
      },
    };
  }
  if (!isCompileAdmissionArtifact(artifact)) {
    return {
      status: "unlinked",
      diagnostic: {
        code: "catalog-offer-admission-unlinked",
        artifactId: artifact.id,
        message:
          `The signed catalog-offer admission is not a ${SENSITIVITY_CAD_SOURCE_ADMISSION_TOOL} document.`,
      },
    };
  }
  if (artifact.fingerprint.algorithm !== "sha256") {
    return {
      status: "unlinked",
      diagnostic: {
        code: "catalog-offer-admission-unlinked",
        artifactId: artifact.id,
        message: "cadSource sha256 must be the Thread admission fingerprint.",
      },
    };
  }
  return { status: "ok", artifact };
}

/**
 * Post-I/O join once the unique offer, proof and admission document are
 * already reopened. Compiles the study template from the recompiled offer
 * after the digest check. Does not reopen CAS.
 */
export async function bindSignedCatalogOffer(input: {
  readonly offerArtifact: { readonly id: string; readonly version?: string };
  readonly offerDigest: string;
  readonly recompiled: SensitivityCatalogOffer;
  readonly proofCase: MechanicalProofCase;
  readonly proofDigest: string;
  readonly admissionArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly namedCaseId?: string;
  readonly projectId: string;
  readonly subjectId: string;
}): Promise<
  | {
    readonly status: "ok";
    readonly caseId: string;
    readonly template: SensitivityStudyCaseTemplate;
    readonly cadSource: SensitivityCadSource;
  }
  | {
    readonly status: "unresolved";
    readonly diagnostic: SensitivityStudySealDiagnostic;
  }
> {
  if (input.offerArtifact.version !== input.offerDigest) {
    return unresolvedOffer(
      "catalog-offer-integrity-failed",
      input.offerArtifact.id,
      "The Thread catalog-offer artifact version is not the sealed offer digest.",
    );
  }
  if (input.recompiled.status !== "ready-for-opt-in") {
    return unresolvedOffer(
      "catalog-offer-admission-unlinked",
      input.admissionArtifact.id,
      `The signed sensitivity catalog offer no longer compiles: ${input.recompiled.status}.`,
    );
  }
  const recompiledDigest = (await sha256Fingerprint(input.recompiled)).digest;
  if (recompiledDigest !== input.offerDigest) {
    return unresolvedOffer(
      "catalog-offer-integrity-failed",
      input.offerArtifact.id,
      "The recompiled sensitivity catalog offer does not match the sealed offer digest.",
    );
  }
  let template: SensitivityStudyCaseTemplate;
  try {
    template = compileSensitivityStudyTemplateFromOffer({
      offer: input.recompiled,
      proofCase: input.proofCase,
      proofDigest: input.proofDigest,
      projectId: input.projectId,
      subjectId: input.subjectId,
    });
  } catch (error) {
    return unresolvedOffer(
      "catalog-offer-integrity-failed",
      input.offerArtifact.id,
      error instanceof Error
        ? error.message
        : "The signed catalog offer could not compile a sensitivity-study template.",
    );
  }
  const mismatch = namedOfferCaseMismatch(
    input.namedCaseId,
    template.id,
    input.offerArtifact.id,
  );
  if (mismatch) {
    return { status: "unresolved", diagnostic: mismatch };
  }
  return {
    status: "ok",
    caseId: template.id,
    template,
    cadSource: {
      artifactUri: sensitivityCadSourceUri(
        input.projectId,
        input.admissionArtifact.id,
      ),
      sha256: input.admissionArtifact.fingerprint.digest,
    },
  };
}

function unresolvedOffer(
  code: SensitivityStudySealDiagnostic["code"],
  artifactId: string | null,
  message: string,
): {
  readonly status: "unresolved";
  readonly diagnostic: SensitivityStudySealDiagnostic;
} {
  return {
    status: "unresolved",
    diagnostic: { code, artifactId, message },
  };
}

export function namedOfferCaseMismatch(
  namedCaseId: string | undefined,
  compiledCaseId: string,
  offerArtifactId: string,
): SensitivityStudySealDiagnostic | undefined {
  if (!namedCaseId || namedCaseId === compiledCaseId) return undefined;
  return {
    code: "catalog-offer-case-mismatch",
    artifactId: offerArtifactId,
    message:
      `Sensitivity case "${namedCaseId}" is not the compiled id "${compiledCaseId}" of the unique signed catalog offer.`,
  };
}
