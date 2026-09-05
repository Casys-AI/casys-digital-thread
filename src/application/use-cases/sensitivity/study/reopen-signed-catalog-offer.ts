/**
 * Reopen the unique signed sensitivity catalog offer on a Thread tip and
 * compile a sealable study template.
 *
 * Review and seal share this I/O. The domain joins stay in
 * `sensitivity-catalog-offer-join.ts`. This writes nothing.
 */

import type { TechnicalCompilationAdmissionReader } from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { parseFeaProofCaseCapture } from "../../../../domain/fea/seal-case/fea-proof-case-capture.ts";
import { compileSensitivityCatalogOfferFromAdmission } from "../../../../domain/sensitivity/study/sensitivity-catalog-from-proof.ts";
import { parseSensitivityCatalogOfferCapture } from "../../../../domain/sensitivity/study/sensitivity-catalog-offer-capture.ts";
import {
  bindSignedCatalogOffer,
  bindSignedOfferAdmissionArtifact,
  joinProofCaptureForOfferDigest,
  selectUniqueSignedCatalogOffer,
} from "../../../../domain/sensitivity/study/sensitivity-catalog-offer-join.ts";
import {
  listFeaProofCaseArtifacts,
  listSensitivityCatalogOfferArtifacts,
  type SensitivityStudySealDiagnostic,
} from "../../../../domain/sensitivity/study/sensitivity-study-seal-bindings.ts";
import type { SensitivityStudyCaseTemplate } from "../../../../domain/sensitivity/study/sensitivity-study-template.ts";
import type { SensitivityCadSource } from "../../../../domain/sensitivity/study/sensitivity-study-v3.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";

export interface ContentAddressedCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export type ReopenedSignedCatalogOffer =
  | {
    readonly status: "ok";
    readonly source: "signed-offer";
    readonly caseId: string;
    readonly template: SensitivityStudyCaseTemplate;
    readonly artifact: ThreadArtifact;
    readonly cadSource: SensitivityCadSource;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly caseId: string;
    readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
  }
  | { readonly status: "absent" };

export async function reopenSignedCatalogOffer(input: {
  readonly projectId: string;
  readonly namedCaseId?: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly snapshot: ThreadSnapshot;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly catalogOffers?: ContentAddressedCaptureReader;
  readonly proofCaptures?: ContentAddressedCaptureReader;
}): Promise<ReopenedSignedCatalogOffer> {
  const selected = selectUniqueSignedCatalogOffer(
    listSensitivityCatalogOfferArtifacts(input.snapshot),
  );
  if (selected.status === "absent") return { status: "absent" };
  if (selected.status === "ambiguous") {
    return offeredFailure("unresolved", input.namedCaseId, {
      code: "catalog-offer-ambiguous",
      artifactId: null,
      message: `Several signed sensitivity catalog offers are on the current tip: ${
        selected.artifacts.map((item) => item.id).join(", ")
      }. Name is not enough; uniqueness failed.`,
    });
  }
  const catalogOffers = input.catalogOffers;
  const proofCaptures = input.proofCaptures;
  if (!catalogOffers || !proofCaptures) {
    return offeredFailure("unavailable", input.namedCaseId, {
      code: "catalog-offer-unavailable",
      artifactId: selected.artifact.id,
      message:
        "A signed sensitivity catalog offer is on the current tip, but the review has no offer or proof capture reader.",
    });
  }
  const offerArtifact = selected.artifact;
  let raw: string | undefined;
  try {
    raw = await catalogOffers.read(offerArtifact.fingerprint);
  } catch {
    return offeredFailure("unavailable", input.namedCaseId, {
      code: "catalog-offer-unavailable",
      artifactId: offerArtifact.id,
      message:
        "The signed sensitivity catalog offer could not be reopened. Uniqueness of the case join is unproven.",
    });
  }
  if (raw === undefined) {
    return offeredFailure("unavailable", input.namedCaseId, {
      code: "catalog-offer-unavailable",
      artifactId: offerArtifact.id,
      message:
        "The signed sensitivity catalog offer is registered on the tip but its capture is unavailable.",
    });
  }
  let capture;
  try {
    capture = await parseSensitivityCatalogOfferCapture(raw);
  } catch (error) {
    return offeredFailure("unresolved", input.namedCaseId, {
      code: "catalog-offer-integrity-failed",
      artifactId: offerArtifact.id,
      message: error instanceof Error
        ? error.message
        : "The signed sensitivity catalog offer capture is invalid.",
    });
  }
  const proofJoin = await reopenUniqueProofForOffer(
    capture.offer.authority.proofDigest,
    input.snapshot,
    proofCaptures,
  );
  if (proofJoin.status !== "ok") {
    return offeredFailure(proofJoin.status, input.namedCaseId, proofJoin.diagnostic);
  }
  const { proofCapture } = proofJoin;
  const signedAdmission = capture.offer.authority.admissionArtifact;
  const boundAdmission = bindSignedOfferAdmissionArtifact({
    admissionArtifact: input.snapshot.artifacts.find((artifact) =>
      artifact.id === signedAdmission.id
    ),
    signedAdmission,
  });
  if (boundAdmission.status !== "ok") {
    return offeredFailure("unresolved", input.namedCaseId, boundAdmission.diagnostic);
  }
  const admissionArtifact = boundAdmission.artifact;
  let reopened;
  try {
    reopened = await input.admissions.read({
      projectId: input.projectId,
      basis: input.basis,
      artifactId: admissionArtifact.id,
      artifactFingerprint: admissionArtifact.fingerprint,
    });
  } catch {
    return offeredFailure("unavailable", input.namedCaseId, {
      code: "admission-unavailable",
      artifactId: admissionArtifact.id,
      message:
        "The signed catalog-offer admission could not be reopened. No decisionParameters.",
    });
  }
  if (!reopened) {
    return offeredFailure("unavailable", input.namedCaseId, {
      code: "admission-unavailable",
      artifactId: admissionArtifact.id,
      message:
        "The signed catalog-offer admission is unavailable. No decisionParameters.",
    });
  }
  const bound = await bindSignedCatalogOffer({
    offerArtifact,
    offerDigest: capture.offerDigest,
    recompiled: compileSensitivityCatalogOfferFromAdmission({
      proofCase: proofCapture.proofCase,
      proofDigest: proofCapture.proofDigest,
      admissionArtifact: {
        id: admissionArtifact.id,
        fingerprint: admissionArtifact.fingerprint,
      },
      document: reopened.document,
    }),
    proofCase: proofCapture.proofCase,
    proofDigest: proofCapture.proofDigest,
    admissionArtifact,
    namedCaseId: input.namedCaseId,
    projectId: input.projectId,
    subjectId: input.snapshot.subject.id,
  });
  if (bound.status !== "ok") {
    return offeredFailure("unresolved", input.namedCaseId, bound.diagnostic);
  }
  return {
    status: "ok",
    source: "signed-offer",
    caseId: bound.caseId,
    template: bound.template,
    artifact: admissionArtifact,
    cadSource: bound.cadSource,
  };
}

async function reopenUniqueProofForOffer(
  proofDigest: string,
  snapshot: ThreadSnapshot,
  proofCaptures: ContentAddressedCaptureReader,
): Promise<
  | {
    readonly status: "ok";
    readonly proofArtifact: ThreadArtifact;
    readonly proofCapture: Awaited<ReturnType<typeof parseFeaProofCaseCapture>>;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostic: SensitivityStudySealDiagnostic;
  }
> {
  const candidates = listFeaProofCaseArtifacts(snapshot);
  if (candidates.length === 0) {
    return {
      status: "unresolved",
      diagnostic: {
        code: "catalog-offer-integrity-failed",
        artifactId: null,
        message:
          "The current tip has no sealed FEA proof capture for the signed catalog offer.",
      },
    };
  }
  const attempts = [];
  for (const artifact of candidates) {
    let proofText: string | undefined;
    try {
      proofText = await proofCaptures.read(artifact.fingerprint);
    } catch {
      attempts.push({ status: "unread" as const, artifact });
      continue;
    }
    if (proofText === undefined) {
      attempts.push({ status: "unread" as const, artifact });
      continue;
    }
    try {
      const proofCapture = await parseFeaProofCaseCapture(proofText);
      if (proofCapture.proofDigest === proofDigest) {
        attempts.push({
          status: "matched" as const,
          artifact,
          proofCapture,
        });
      } else {
        attempts.push({ status: "other" as const, artifact });
      }
    } catch {
      attempts.push({ status: "invalid" as const, artifact });
    }
  }
  const joined = joinProofCaptureForOfferDigest(attempts);
  if (joined.status !== "ok") return joined;
  return {
    status: "ok",
    proofArtifact: joined.artifact,
    proofCapture: joined.proofCapture,
  };
}

function offeredFailure(
  status: "unresolved" | "unavailable",
  caseId: string | undefined,
  diagnostic: SensitivityStudySealDiagnostic,
): {
  readonly status: "unresolved" | "unavailable";
  readonly caseId: string;
  readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
} {
  return {
    status,
    caseId: caseId ?? "",
    diagnostics: [diagnostic],
  };
}
